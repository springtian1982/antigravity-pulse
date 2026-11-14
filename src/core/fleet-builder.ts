import type { CascadeQuotaBaseline } from '../state/state-dir';
import type { TrajectorySummaryRaw, TrajectoryWorkspaceRaw } from '../types/rpc';
import type {
  CascadeNodeView,
  FleetProjectGroup,
  FleetSnapshotResponse,
  FleetTreeSummary,
  ModelTier,
  QuotaBurnerEntry,
  QuotaSummaryView,
} from '../types/telemetry';
import { extractWorkspaceBasename } from './topology-builder';

export const ROLLING_5H_WINDOW_MS = 5 * 60 * 60 * 1000;

export type { CascadeQuotaBaseline };

export interface BuildFleetInput {
  nowMs?: number;
  hostConnected: boolean;
  trajectories: Record<string, TrajectorySummaryRaw>;
  nodesByCascadeId: Record<string, CascadeNodeView>;
  quota: QuotaSummaryView;
  cascadeBaselines: Record<string, CascadeQuotaBaseline>;
  recentIdleWindowMs?: number;
  maxIdleTreesPerProject?: number;
}

const TIER_WEIGHT: Record<ModelTier, number> = {
  alert: 0,
  fast: 1,
  orchestrator: 2,
  workhorse: 3,
  apex: 4,
};

const EFFORT_SHORT_MAP: Record<string, string> = {
  xhigh: '(XH)',
  high: '(H)',
  medium: '(M)',
  med: '(M)',
  low: '(L)',
};

function compareStringAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round8(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1e8) / 1e8;
}

function parseValidMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function isNodeRunning(node: CascadeNodeView): boolean {
  return (
    node.status === 'CASCADE_RUN_STATUS_RUNNING' ||
    (node.phase !== 'IDLE' && node.phase !== 'ERROR_OR_QUOTA')
  );
}

function isRootNode(node: CascadeNodeView): boolean {
  return node.kind === 'root' || node.parentCascadeId === null;
}

export function compactModelLabel(servedModel: CascadeNodeView['servedModel']): string {
  let label = (
    servedModel.displayName ||
    servedModel.responseModel ||
    servedModel.modelEnum ||
    'Unknown'
  ).trim();
  if (!label) {
    return 'Unknown';
  }

  const pendingStripped = label.replace(/\s*\(pending\)\s*$/i, '').trim();
  if (pendingStripped) {
    label = pendingStripped;
  }

  let effortSuffix = '';
  const effortMatch = /\s*\((xhigh|high|medium|med|low)\)\s*$/i.exec(label);
  if (effortMatch?.[1]) {
    effortSuffix = EFFORT_SHORT_MAP[effortMatch[1].toLowerCase()] ?? '';
    label = label.slice(0, effortMatch.index).trim();
  }

  label = label
    .replace(/^(?:Gemini|Claude)\s+(?:\d+(?:\.\d+)*\s+)?/i, '')
    .replace(/^OpenAI\s+/i, '')
    .replace(/^(Opus|Sonnet|Haiku|Carbon|Argon|Hydrogen|Flash(?:\s+Lite)?)\s+\d+(?:\.\d+)*$/i, '$1')
    .trim();

  if (!label) {
    label = 'Unknown';
  }

  return `${label}${effortSuffix}`;
}

function normalizeUriKey(uri: string): string {
  return uri.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

interface ResolvedProjectIdentity {
  projectKey: string;
  projectName: string;
  workspaceUris: string[];
}

function collectWorkspacesFromNodes(
  rootCascadeId: string,
  treeNodes: CascadeNodeView[],
  trajectories: Record<string, TrajectorySummaryRaw>
): TrajectoryWorkspaceRaw[] {
  const rootWorkspaces = trajectories[rootCascadeId]?.workspaces;
  if (Array.isArray(rootWorkspaces) && rootWorkspaces.length > 0) {
    return rootWorkspaces;
  }
  for (const node of treeNodes) {
    const childWorkspaces = trajectories[node.cascadeId]?.workspaces;
    if (Array.isArray(childWorkspaces) && childWorkspaces.length > 0) {
      return childWorkspaces;
    }
  }
  return [];
}

function resolveProjectIdentity(
  rootCascadeId: string,
  treeNodes: CascadeNodeView[],
  trajectories: Record<string, TrajectorySummaryRaw>
): ResolvedProjectIdentity {
  const workspaces = collectWorkspacesFromNodes(rootCascadeId, treeNodes, trajectories);
  const rawUris: string[] = [];
  const repoNames: string[] = [];

  for (const ws of workspaces) {
    const uri =
      ws.workspaceFolderAbsoluteUri?.trim() ||
      ws.gitRootAbsoluteUri?.trim() ||
      '';
    if (uri && !rawUris.includes(uri)) {
      rawUris.push(uri);
    }
    const repoName = ws.repository?.computedName?.trim() || '';
    if (repoName && !repoNames.includes(repoName)) {
      repoNames.push(repoName);
    }
  }

  if (rawUris.length > 0) {
    const normalizedKeys = Array.from(new Set(rawUris.map(normalizeUriKey))).sort(compareStringAsc);
    const projectKey = normalizedKeys.join('|');
    const firstBase = extractWorkspaceBasename(rawUris[0]);
    const projectName = firstBase || repoNames[0] || 'Workspace Unavailable';
    return {
      projectKey,
      projectName,
      workspaceUris: rawUris,
    };
  }

  if (repoNames.length > 0) {
    return {
      projectKey: `repo:${repoNames[0].toLowerCase()}`,
      projectName: repoNames[0],
      workspaceUris: [],
    };
  }

  return {
    projectKey: '__global__',
    projectName: 'Workspace Unavailable',
    workspaceUris: [],
  };
}

function computeTreeDelta5hPct(
  treeNodes: CascadeNodeView[],
  cascadeBaselines: Record<string, CascadeQuotaBaseline>
): { treeDeltaQuota5hPct: number | null; positiveConsumedPct: number } {
  let hasBaseline = false;
  let total = 0;

  for (const node of treeNodes) {
    const baseline = cascadeBaselines[node.cascadeId];
    if (baseline) {
      hasBaseline = true;
      total += Math.max(0, baseline.delta5hPct);
    } else if (
      node.deltaQuota5hPct !== null &&
      node.deltaQuota5hPct !== undefined &&
      Number.isFinite(node.deltaQuota5hPct)
    ) {
      hasBaseline = true;
      total += Math.max(0, node.deltaQuota5hPct);
    }
  }

  const rounded = round8(Math.max(0, total));
  return {
    treeDeltaQuota5hPct: hasBaseline ? rounded : null,
    positiveConsumedPct: rounded,
  };
}

function nodeTotalTokens(node: CascadeNodeView): number {
  return (
    Math.max(0, node.tokens.inputTokens) +
    Math.max(0, node.tokens.cacheReadTokens) +
    Math.max(0, node.tokens.outputTokens)
  );
}

function selectDominantNode(treeNodes: CascadeNodeView[], rootCascadeId: string): CascadeNodeView {
  let best = treeNodes[0];
  for (let i = 1; i < treeNodes.length; i += 1) {
    const candidate = treeNodes[i];
    const bestTok = nodeTotalTokens(best);
    const candTok = nodeTotalTokens(candidate);
    if (candTok !== bestTok) {
      if (candTok > bestTok) {
        best = candidate;
      }
      continue;
    }

    const bestTierWeight = TIER_WEIGHT[best.servedModel.tier] ?? 0;
    const candTierWeight = TIER_WEIGHT[candidate.servedModel.tier] ?? 0;
    if (candTierWeight !== bestTierWeight) {
      if (candTierWeight > bestTierWeight) {
        best = candidate;
      }
      continue;
    }

    const bestIsRoot = best.cascadeId === rootCascadeId ? 1 : 0;
    const candIsRoot = candidate.cascadeId === rootCascadeId ? 1 : 0;
    if (candIsRoot !== bestIsRoot) {
      if (candIsRoot > bestIsRoot) {
        best = candidate;
      }
      continue;
    }

    if (compareStringAsc(candidate.cascadeId, best.cascadeId) < 0) {
      best = candidate;
    }
  }
  return best;
}

interface InternalTreeRecord {
  summary: FleetTreeSummary;
  projectIdentity: ResolvedProjectIdentity;
  maxLastModifiedMs: number;
  maxLastModifiedIso: string;
  positiveConsumed5hPct: number;
  totalTokens: number;
  dominantModel: string;
  dominantTier: ModelTier;
}

export function buildFleetSnapshot(
  input: BuildFleetInput
): Omit<FleetSnapshotResponse, 'etag'> {
  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const recentIdleWindowMs = input.recentIdleWindowMs ?? ROLLING_5H_WINDOW_MS;
  const maxIdleTreesPerProject = input.maxIdleTreesPerProject ?? 5;
  const allNodes = Object.values(input.nodesByCascadeId);

  if (allNodes.length === 0) {
    return {
      generatedAt,
      hostConnected: input.hostConnected,
      activeHeadline: {
        runningRoots: 0,
        runningSubagents: 0,
        totalRunningNodes: 0,
        modelHistogram: [],
      },
      projects: [],
      topQuotaBurners: [],
      quota: input.quota,
    };
  }

  // 1. Active compute headline & model histogram across all running nodes
  let runningRoots = 0;
  let runningSubagents = 0;
  const histogramMap = new Map<string, { label: string; tier: ModelTier; count: number }>();

  for (const node of allNodes) {
    if (!isNodeRunning(node)) {
      continue;
    }
    if (isRootNode(node)) {
      runningRoots += 1;
    } else {
      runningSubagents += 1;
    }
    const label = compactModelLabel(node.servedModel);
    const key = `${label}\0${node.servedModel.tier}`;
    const prev = histogramMap.get(key);
    if (prev) {
      prev.count += 1;
    } else {
      histogramMap.set(key, { label, tier: node.servedModel.tier, count: 1 });
    }
  }

  const modelHistogram = Array.from(histogramMap.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    const labelCmp = compareStringAsc(a.label, b.label);
    if (labelCmp !== 0) {
      return labelCmp;
    }
    return compareStringAsc(a.tier, b.tier);
  });

  // 2. Group nodes into trees by rootCascadeId
  const nodesByRoot = new Map<string, CascadeNodeView[]>();
  for (const node of allNodes) {
    const rootId = node.rootCascadeId || node.cascadeId;
    const list = nodesByRoot.get(rootId);
    if (list) {
      list.push(node);
    } else {
      nodesByRoot.set(rootId, [node]);
    }
  }

  const treeRecords: InternalTreeRecord[] = [];

  for (const [rootCascadeId, rawTreeNodes] of nodesByRoot.entries()) {
    const rootNode =
      rawTreeNodes.find((n) => n.cascadeId === rootCascadeId) ??
      rawTreeNodes.find((n) => n.parentCascadeId === null) ??
      rawTreeNodes[0];

    const activeNodes = rawTreeNodes.filter(isNodeRunning);
    const activeNodeCount = activeNodes.length;
    const totalNodeCount = rawTreeNodes.length;

    let elapsedMs = 0;
    if (activeNodeCount > 0) {
      let earliestMs: number | null = null;
      for (const active of activeNodes) {
        const tsMs =
          parseValidMs(active.phaseStartedAt) ?? parseValidMs(active.lastModifiedTime);
        if (tsMs !== null && (earliestMs === null || tsMs < earliestMs)) {
          earliestMs = tsMs;
        }
      }
      elapsedMs =
        earliestMs !== null
          ? Math.max(0, nowMs - earliestMs)
          : Math.max(0, ...activeNodes.map((n) => n.phaseElapsedMs));
    }

    const mixSourceNodes = activeNodeCount > 0 ? activeNodes : rawTreeNodes;
    const mixCounts = new Map<string, number>();
    for (const n of mixSourceNodes) {
      const label = compactModelLabel(n.servedModel);
      mixCounts.set(label, (mixCounts.get(label) ?? 0) + 1);
    }
    const modelMix: Record<string, number> = {};
    for (const label of Array.from(mixCounts.keys()).sort(compareStringAsc)) {
      modelMix[label] = mixCounts.get(label) ?? 0;
    }

    const sortedNodes = [...rawTreeNodes].sort((a, b) => {
      const activeDiff = (isNodeRunning(b) ? 1 : 0) - (isNodeRunning(a) ? 1 : 0);
      if (activeDiff !== 0) {
        return activeDiff;
      }
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      const titleCmp = compareStringAsc(a.title.toLowerCase(), b.title.toLowerCase());
      if (titleCmp !== 0) {
        return titleCmp;
      }
      return compareStringAsc(a.cascadeId, b.cascadeId);
    });

    const { treeDeltaQuota5hPct, positiveConsumedPct } = computeTreeDelta5hPct(
      rawTreeNodes,
      input.cascadeBaselines
    );

    let maxLastModifiedMs = 0;
    let maxLastModifiedIso = rootNode.lastModifiedTime || generatedAt;
    let totalTokens = 0;
    for (const n of rawTreeNodes) {
      totalTokens += nodeTotalTokens(n);
      const ms = parseValidMs(n.lastModifiedTime);
      if (ms !== null && ms > maxLastModifiedMs) {
        maxLastModifiedMs = ms;
        maxLastModifiedIso = n.lastModifiedTime;
      }
    }
    const trajModMs = parseValidMs(input.trajectories[rootCascadeId]?.lastModifiedTime);
    if (trajModMs !== null && trajModMs > maxLastModifiedMs) {
      maxLastModifiedMs = trajModMs;
      maxLastModifiedIso = input.trajectories[rootCascadeId]?.lastModifiedTime ?? maxLastModifiedIso;
    }

    const dominantNode = selectDominantNode(rawTreeNodes, rootCascadeId);
    const projectIdentity = resolveProjectIdentity(
      rootCascadeId,
      rawTreeNodes,
      input.trajectories
    );

    treeRecords.push({
      summary: {
        rootCascadeId,
        rootTitle: rootNode.title,
        rootPhase: rootNode.phase,
        activeNodeCount,
        totalNodeCount,
        elapsedMs,
        modelMix,
        nodes: sortedNodes,
        treeDeltaQuota5hPct,
      },
      projectIdentity,
      maxLastModifiedMs,
      maxLastModifiedIso,
      positiveConsumed5hPct: positiveConsumedPct,
      totalTokens,
      dominantModel: compactModelLabel(dominantNode.servedModel),
      dominantTier: dominantNode.servedModel.tier,
    });
  }

  // 3. Group trees by project (with recent idle window & per-project idle cap)
  const idleCutoffMs = nowMs - recentIdleWindowMs;
  const projectMap = new Map<
    string,
    {
      projectKey: string;
      projectName: string;
      workspaceUris: Set<string>;
      activeTrees: InternalTreeRecord[];
      idleTrees: InternalTreeRecord[];
      maxLastModifiedMs: number;
    }
  >();

  for (const rec of treeRecords) {
    const isTreeActive = rec.summary.activeNodeCount > 0;
    if (!isTreeActive && rec.maxLastModifiedMs < idleCutoffMs) {
      continue;
    }
    const { projectKey, projectName, workspaceUris } = rec.projectIdentity;
    let bucket = projectMap.get(projectKey);
    if (!bucket) {
      bucket = {
        projectKey,
        projectName,
        workspaceUris: new Set<string>(),
        activeTrees: [],
        idleTrees: [],
        maxLastModifiedMs: 0,
      };
      projectMap.set(projectKey, bucket);
    }
    for (const uri of workspaceUris) {
      bucket.workspaceUris.add(uri);
    }
    if (rec.maxLastModifiedMs > bucket.maxLastModifiedMs) {
      bucket.maxLastModifiedMs = rec.maxLastModifiedMs;
    }
    if (isTreeActive) {
      bucket.activeTrees.push(rec);
    } else {
      bucket.idleTrees.push(rec);
    }
  }

  const sortTreesDesc = (a: InternalTreeRecord, b: InternalTreeRecord): number => {
    const activeDiff =
      (b.summary.activeNodeCount > 0 ? 1 : 0) - (a.summary.activeNodeCount > 0 ? 1 : 0);
    if (activeDiff !== 0) {
      return activeDiff;
    }
    if (b.summary.activeNodeCount !== a.summary.activeNodeCount) {
      return b.summary.activeNodeCount - a.summary.activeNodeCount;
    }
    if (b.maxLastModifiedMs !== a.maxLastModifiedMs) {
      return b.maxLastModifiedMs - a.maxLastModifiedMs;
    }
    const titleCmp = compareStringAsc(
      a.summary.rootTitle.toLowerCase(),
      b.summary.rootTitle.toLowerCase()
    );
    if (titleCmp !== 0) {
      return titleCmp;
    }
    return compareStringAsc(a.summary.rootCascadeId, b.summary.rootCascadeId);
  };

  const projectsWithMeta: Array<{
    group: FleetProjectGroup;
    maxLastModifiedMs: number;
  }> = [];

  for (const bucket of projectMap.values()) {
    bucket.activeTrees.sort(sortTreesDesc);
    bucket.idleTrees.sort(sortTreesDesc);
    const cappedIdle =
      maxIdleTreesPerProject > 0
        ? bucket.idleTrees.slice(0, maxIdleTreesPerProject)
        : [];
    const combinedTrees = [...bucket.activeTrees, ...cappedIdle];
    if (combinedTrees.length === 0) {
      continue;
    }
    const runningCount = combinedTrees.reduce(
      (sum, t) => sum + t.summary.activeNodeCount,
      0
    );
    projectsWithMeta.push({
      group: {
        projectKey: bucket.projectKey,
        projectName: bucket.projectName,
        workspaceUris: Array.from(bucket.workspaceUris),
        runningCount,
        trees: combinedTrees.map((t) => t.summary),
      },
      maxLastModifiedMs: bucket.maxLastModifiedMs,
    });
  }

  projectsWithMeta.sort((a, b) => {
    const activeDiff =
      (b.group.runningCount > 0 ? 1 : 0) - (a.group.runningCount > 0 ? 1 : 0);
    if (activeDiff !== 0) {
      return activeDiff;
    }
    if (b.group.runningCount !== a.group.runningCount) {
      return b.group.runningCount - a.group.runningCount;
    }
    if (b.maxLastModifiedMs !== a.maxLastModifiedMs) {
      return b.maxLastModifiedMs - a.maxLastModifiedMs;
    }
    const nameCmp = compareStringAsc(
      a.group.projectName.toLowerCase(),
      b.group.projectName.toLowerCase()
    );
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return compareStringAsc(a.group.projectKey, b.group.projectKey);
  });

  // 4. Rolling 5-hour Top 5 Quota Burners
  const rollingCutoffMs = nowMs - ROLLING_5H_WINDOW_MS;
  const burnerCandidates = treeRecords.filter((rec) => {
    const in5hWindow =
      rec.summary.activeNodeCount > 0 || rec.maxLastModifiedMs >= rollingCutoffMs;
    const hasConsumption = rec.positiveConsumed5hPct > 0 || rec.totalTokens > 0;
    return (in5hWindow || rec.positiveConsumed5hPct > 0) && hasConsumption;
  });

  burnerCandidates.sort((a, b) => {
    if (b.positiveConsumed5hPct !== a.positiveConsumed5hPct) {
      return b.positiveConsumed5hPct - a.positiveConsumed5hPct;
    }
    if (b.totalTokens !== a.totalTokens) {
      return b.totalTokens - a.totalTokens;
    }
    if (b.maxLastModifiedMs !== a.maxLastModifiedMs) {
      return b.maxLastModifiedMs - a.maxLastModifiedMs;
    }
    return compareStringAsc(a.summary.rootCascadeId, b.summary.rootCascadeId);
  });

  const topQuotaBurners: QuotaBurnerEntry[] = burnerCandidates
    .slice(0, 5)
    .map((rec, idx) => ({
      rank: idx + 1,
      rootCascadeId: rec.summary.rootCascadeId,
      title: rec.summary.rootTitle,
      projectName: rec.projectIdentity.projectName,
      dominantModel: rec.dominantModel,
      dominantTier: rec.dominantTier,
      consumed5hPct: rec.positiveConsumed5hPct,
      delta5hPct: rec.positiveConsumed5hPct,
      totalTokens: rec.totalTokens,
      lastActiveAt: rec.maxLastModifiedIso,
      isRunning: rec.summary.activeNodeCount > 0,
    }));

  return {
    generatedAt,
    hostConnected: input.hostConnected,
    activeHeadline: {
      runningRoots,
      runningSubagents,
      totalRunningNodes: runningRoots + runningSubagents,
      modelHistogram,
    },
    projects: projectsWithMeta.map((p) => p.group),
    topQuotaBurners,
    quota: input.quota,
  };
}
