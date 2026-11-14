import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFleetSnapshot } from '../core/fleet-builder';
import { buildModelCatalog, type ModelCatalog } from '../core/model-catalog';
import {
  evaluateSmartGovernanceBanner,
  normalizeQuotaSummary,
} from '../core/quota-calculator';
import { buildBreadcrumb, buildTopologyGraph } from '../core/topology-builder';
import { ReadOnlyLsClient } from '../rpc/ls-client';
import { loadConfig } from '../state/config-store';
import {
  assertValidUuid,
  getStatePaths,
  isValidUuid,
  type LiveSnapshotFile,
  type ModelMapFile,
  type QuotaCacheFile,
  readJsonSafe,
} from '../state/state-dir';
import type {
  GeneratorMetadataEntryRaw,
  TrajectoryStepRaw,
  TrajectorySummaryRaw,
} from '../types/rpc';
import type {
  CascadeNodeView,
  FleetSnapshotResponse,
  LifecyclePhase,
  PulseUserConfig,
  QuotaSummaryView,
  SmartGovernanceBanner,
} from '../types/telemetry';

export type CliStatusClass = 'disconnected' | 'alert' | 'warning' | 'active' | 'idle';

export interface CliLsEnv {
  address?: string;
  csrfToken?: string;
  conversationId?: string;
  antigravityDataDir?: string;
}

export interface LoadCliTelemetryOptions {
  conversationId?: string;
  live?: boolean;
  stateDir?: string;
  lsEnv?: CliLsEnv;
  nowMs?: number;
  fetchFn?: typeof fetch;
}

export interface CliTelemetryView {
  generatedAt: string;
  stateDir: string;
  source: 'live-ls' | 'snapshot' | 'cache-only' | 'none';
  snapshotUpdatedAt: string | null;
  hostConnected: boolean;
  stale: boolean;
  staleAgeMs: number | null;
  statusClass: CliStatusClass;
  activeConversationId: string | null;
  rootCascadeId: string | null;
  breadcrumb: Array<{
    cascadeId: string;
    title: string;
    role: string | null;
  }>;
  activeNode: CascadeNodeView | null;
  treeNodes: CascadeNodeView[];
  activeSubagentCount: number;
  fleetHeadline: FleetSnapshotResponse['activeHeadline'] | null;
  fleet: FleetSnapshotResponse | null;
  quota: QuotaSummaryView | null;
  smartGovernanceBanner: SmartGovernanceBanner;
  config: PulseUserConfig;
  warnings: string[];
}

const LIVE_LS_STALE_TRIGGER_MS = 10_000;
const SNAPSHOT_STALE_THRESHOLD_MS = 30_000;
const LIVE_LS_TIMEOUT_MS = 1500;
const MAX_META_FETCH_CASCADES = 12;
const META_FETCH_CONCURRENCY = 6;

const PHASE_PRIORITY: Record<LifecyclePhase, number> = {
  BLOCKED_APPROVAL: 0,
  ERROR_OR_QUOTA: 1,
  TOOL_RUNNING: 2,
  STREAMING: 3,
  THINKING: 4,
  PRE_FLIGHT: 5,
  IDLE: 6,
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLiveSnapshotFile(raw: unknown): raw is LiveSnapshotFile {
  return (
    isPlainRecord(raw) &&
    raw.schemaVersion === 1 &&
    isPlainRecord(raw.nodesByCascadeId)
  );
}

function isQuotaCacheFile(raw: unknown): raw is QuotaCacheFile {
  return (
    isPlainRecord(raw) &&
    raw.schemaVersion === 1 &&
    isPlainRecord(raw.quota)
  );
}

function isModelMapFile(raw: unknown): raw is ModelMapFile {
  return (
    isPlainRecord(raw) &&
    raw.schemaVersion === 1 &&
    isPlainRecord(raw.modelsByEnum)
  );
}

function parseIsoMs(iso: string | null | undefined): number | null {
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

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (cursor < items.length) {
        const idx = cursor;
        cursor += 1;
        await worker(items[idx]);
      }
    })
  );
}

/**
 * Deterministic tree node sorting shared between CLI `top` and snapshot inspection.
 */
export function sortTreeNodes(
  nodes: CascadeNodeView[],
  sortMode: 'active-first' | 'topology-tree',
  activeCid: string | null
): CascadeNodeView[] {
  if (nodes.length <= 1) {
    return [...nodes];
  }

  if (sortMode === 'topology-tree') {
    const byId = new Map<string, CascadeNodeView>();
    for (const node of nodes) {
      byId.set(node.cascadeId, node);
    }
    const childrenByParent = new Map<string, CascadeNodeView[]>();
    const roots: CascadeNodeView[] = [];
    for (const node of nodes) {
      if (node.parentCascadeId && byId.has(node.parentCascadeId)) {
        const list = childrenByParent.get(node.parentCascadeId) ?? [];
        list.push(node);
        childrenByParent.set(node.parentCascadeId, list);
      } else {
        roots.push(node);
      }
    }
    const sortSiblings = (list: CascadeNodeView[]) =>
      list.sort((a, b) => {
        if (
          a.spawnStepIndex !== null &&
          b.spawnStepIndex !== null &&
          a.spawnStepIndex !== b.spawnStepIndex
        ) {
          return a.spawnStepIndex - b.spawnStepIndex;
        }
        return (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0);
      });
    sortSiblings(roots);
    const ordered: CascadeNodeView[] = [];
    const visited = new Set<string>();
    const visit = (node: CascadeNodeView) => {
      if (visited.has(node.cascadeId)) return;
      visited.add(node.cascadeId);
      ordered.push(node);
      const children = sortSiblings([...(childrenByParent.get(node.cascadeId) ?? [])]);
      for (const child of children) {
        visit(child);
      }
    };
    for (const root of roots) {
      visit(root);
    }
    for (const node of nodes) {
      visit(node);
    }
    return ordered;
  }

  return [...nodes].sort((a, b) => {
    const pa = PHASE_PRIORITY[a.phase] ?? 9;
    const pb = PHASE_PRIORITY[b.phase] ?? 9;
    if (pa !== pb) return pa - pb;
    if (activeCid) {
      if (a.cascadeId === activeCid && b.cascadeId !== activeCid) return -1;
      if (b.cascadeId === activeCid && a.cascadeId !== activeCid) return 1;
    }
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0);
  });
}

function modelCatalogFromFile(file: ModelMapFile | null): ModelCatalog {
  if (!file) {
    return buildModelCatalog(null);
  }
  const modelsById: ModelCatalog['modelsById'] = {};
  for (const entry of Object.values(file.modelsByEnum)) {
    if (entry?.modelId) {
      modelsById[entry.modelId] = entry;
    }
  }
  return {
    defaultModelEnum: file.defaultModelEnum ?? null,
    modelsByEnum: file.modelsByEnum,
    modelsById,
  };
}

function resolveTargetCid(
  nodesById: Record<string, CascadeNodeView>,
  explicitCid: string | undefined,
  envCid: string | null,
  snapshotActiveCid: string | null | undefined
): string | null {
  if (explicitCid) {
    return explicitCid;
  }
  if (envCid && (nodesById[envCid] || !snapshotActiveCid)) {
    return envCid;
  }
  if (snapshotActiveCid && nodesById[snapshotActiveCid]) {
    return snapshotActiveCid;
  }

  const allNodes = Object.values(nodesById);
  if (allNodes.length === 0) {
    return snapshotActiveCid ?? envCid ?? null;
  }

  const running = allNodes
    .filter(isNodeRunning)
    .sort((a, b) => (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0));
  if (running.length > 0) {
    return running[0].cascadeId;
  }

  const roots = allNodes
    .filter((n) => n.parentCascadeId === null)
    .sort((a, b) => (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0));
  if (roots.length > 0) {
    return roots[0].cascadeId;
  }

  return allNodes
    .slice()
    .sort((a, b) => (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0))[0]
    .cascadeId;
}

interface LiveLsFetchResult {
  nodesById: Record<string, CascadeNodeView>;
  quota: QuotaSummaryView;
  fleet: FleetSnapshotResponse;
  warnings: string[];
}

async function fetchLiveFromLs(params: {
  address: string;
  csrfToken: string;
  fetchFn?: typeof fetch;
  antigravityDataDir: string;
  config: PulseUserConfig;
  modelMap: ModelMapFile | null;
  quotaCache: QuotaCacheFile | null;
  prevNodes: Record<string, CascadeNodeView>;
  preferredCids: string[];
  nowMs: number;
}): Promise<LiveLsFetchResult | null> {
  const client = new ReadOnlyLsClient({
    address: params.address,
    csrfToken: params.csrfToken,
    timeoutMs: LIVE_LS_TIMEOUT_MS,
    fetchFn: params.fetchFn,
  });
  if (!client.isConfigured()) {
    return null;
  }

  const warnings: string[] = [];
  const [modelRes, quotaRes, trajRes] = await Promise.allSettled([
    client.getCascadeModelConfigData(),
    client.retrieveUserQuotaSummary(),
    client.getAllCascadeTrajectories(),
  ]);

  if (trajRes.status === 'rejected') {
    return null;
  }

  const trajectories: Record<string, TrajectorySummaryRaw> =
    trajRes.value.trajectorySummaries ?? {};
  const modelCatalog =
    modelRes.status === 'fulfilled'
      ? buildModelCatalog(modelRes.value)
      : modelCatalogFromFile(params.modelMap);

  const entries = Object.entries(trajectories).sort(([, a], [, b]) => {
    const aRun = a.status === 'CASCADE_RUN_STATUS_RUNNING' ? 1 : 0;
    const bRun = b.status === 'CASCADE_RUN_STATUS_RUNNING' ? 1 : 0;
    if (bRun !== aRun) return bRun - aRun;
    return (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0);
  });

  const metaTargets = new Set<string>();
  for (const preferred of params.preferredCids) {
    if (preferred && trajectories[preferred]) {
      metaTargets.add(preferred);
    }
  }
  const runningTargets: Array<{ cid: string; stepCount: number }> = [];
  for (const [cid, summary] of entries) {
    if (summary.status === 'CASCADE_RUN_STATUS_RUNNING') {
      metaTargets.add(cid);
      runningTargets.push({
        cid,
        stepCount:
          typeof summary.stepCount === 'number' && Number.isFinite(summary.stepCount)
            ? summary.stepCount
            : 0,
      });
    } else if (metaTargets.size < MAX_META_FETCH_CASCADES) {
      metaTargets.add(cid);
    }
  }

  const generatorMetadataByCascade: Record<string, GeneratorMetadataEntryRaw[]> = {};
  const stepsByCascade: Record<string, TrajectoryStepRaw[]> = {};

  await Promise.all([
    runWithConcurrency(Array.from(metaTargets), META_FETCH_CONCURRENCY, async (cid) => {
      try {
        const res = await client.getCascadeTrajectoryGeneratorMetadata(cid);
        generatorMetadataByCascade[cid] = res.generatorMetadata ?? [];
      } catch {
        // Non-fatal per-cascade metadata failure
      }
    }),
    runWithConcurrency(runningTargets, META_FETCH_CONCURRENCY, async ({ cid, stepCount }) => {
      try {
        const res = await client.getCascadeTrajectorySteps(cid, stepCount);
        stepsByCascade[cid] = res.steps ?? [];
      } catch {
        // Non-fatal per-cascade step tail failure
      }
    }),
  ]);

  const nowIso = new Date(params.nowMs).toISOString();
  const normalizedQuota =
    quotaRes.status === 'fulfilled'
      ? normalizeQuotaSummary(
          quotaRes.value,
          params.quotaCache,
          Object.keys(trajectories),
          nowIso
        )
      : {
          quota:
            params.quotaCache?.quota ?? {
              fetchedAt: nowIso,
              buckets: [],
              gemini5h: null,
              geminiWeekly: null,
              thirdParty5h: null,
              thirdPartyWeekly: null,
              treeNetDelta5hPct: null,
              burnRate5hPctPerMin: null,
            },
          cascadeBaselines: params.quotaCache?.cascadeBaselines ?? {},
        };

  const topology = buildTopologyGraph({
    antigravityDataDir: params.antigravityDataDir,
    trajectories,
    generatorMetadataByCascade,
    stepsByCascade,
    modelCatalog,
    quotaBaselines: normalizedQuota.cascadeBaselines,
    prevNodesByCascadeId: params.prevNodes,
    smartThresholds: params.config.smartThresholds,
    lsConnected: true,
    nowMs: params.nowMs,
    enableSqliteFallback: false,
  });

  for (const w of topology.warnings) {
    warnings.push(w);
  }

  const fleetCore = buildFleetSnapshot({
    nowMs: params.nowMs,
    hostConnected: true,
    trajectories,
    nodesByCascadeId: topology.nodesByCascadeId,
    quota: normalizedQuota.quota,
    cascadeBaselines: normalizedQuota.cascadeBaselines,
  });

  return {
    nodesById: topology.nodesByCascadeId,
    quota: normalizedQuota.quota,
    fleet: {
      etag: 'live-cli',
      ...fleetCore,
    },
    warnings,
  };
}

/**
 * Loads CLI telemetry from `$PULSE_STATE_DIR` (`live-snapshot.json`, `quota-cache.json`, `model-map.json`, `config.json`)
 * and optionally enhances/refreshes via read-only Connect-RPC when `ANTIGRAVITY_LS_ADDRESS` & `ANTIGRAVITY_CSRF_TOKEN` are set.
 * Strictly zero `/proc`, `ps`, `pgrep`, or `wmic` scraping (`D-003`).
 */
export async function loadCliTelemetry(
  options: LoadCliTelemetryOptions = {}
): Promise<CliTelemetryView> {
  if (options.conversationId !== undefined) {
    assertValidUuid(options.conversationId, 'conversationId');
  }

  const nowMs = options.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const paths = getStatePaths(options.stateDir);
  const config = loadConfig(options.stateDir);

  const rawSnapshot = readJsonSafe<unknown>(paths.liveSnapshot, null);
  const snapshot = isLiveSnapshotFile(rawSnapshot) ? rawSnapshot : null;

  const rawQuotaCache = readJsonSafe<unknown>(paths.quotaCache, null);
  const quotaCache = isQuotaCacheFile(rawQuotaCache) ? rawQuotaCache : null;

  const rawModelMap = readJsonSafe<unknown>(paths.modelMap, null);
  const modelMap = isModelMapFile(rawModelMap) ? rawModelMap : null;

  const snapshotUpdatedMs = parseIsoMs(snapshot?.updatedAt);
  const snapshotAgeMs =
    snapshotUpdatedMs !== null ? Math.max(0, nowMs - snapshotUpdatedMs) : null;
  const snapshotNeedsRefresh =
    snapshot === null ||
    !snapshot.hostConnected ||
    snapshotAgeMs === null ||
    snapshotAgeMs > LIVE_LS_STALE_TRIGGER_MS;

  const lsAddress = (options.lsEnv?.address ?? process.env.ANTIGRAVITY_LS_ADDRESS ?? '').trim();
  const lsCsrf = (options.lsEnv?.csrfToken ?? process.env.ANTIGRAVITY_CSRF_TOKEN ?? '').trim();
  const envCidRaw = (
    options.lsEnv?.conversationId ??
    process.env.ANTIGRAVITY_CONVERSATION_ID ??
    ''
  ).trim();
  const validEnvCid = isValidUuid(envCidRaw) ? envCidRaw : null;
  const antigravityDataDir =
    options.lsEnv?.antigravityDataDir?.trim() ||
    process.env.ANTIGRAVITY_DATA_DIR?.trim() ||
    path.join(os.homedir(), '.gemini', 'antigravity');

  const warnings: string[] = [];
  let liveResult: LiveLsFetchResult | null = null;
  const shouldTryLiveLs =
    lsAddress.length > 0 &&
    lsCsrf.length > 0 &&
    (options.live === true || snapshotNeedsRefresh);

  if (shouldTryLiveLs) {
    try {
      const preferred = [
        options.conversationId ?? '',
        validEnvCid ?? '',
        snapshot?.activeConversationId ?? '',
      ].filter(Boolean);
      liveResult = await fetchLiveFromLs({
        address: lsAddress,
        csrfToken: lsCsrf,
        fetchFn: options.fetchFn,
        antigravityDataDir,
        config,
        modelMap,
        quotaCache,
        prevNodes: snapshot?.nodesByCascadeId ?? {},
        preferredCids: preferred,
        nowMs,
      });
      if (!liveResult) {
        warnings.push('Live Language Server RPC unavailable; using cached state.');
      }
    } catch {
      liveResult = null;
      warnings.push('Live Language Server RPC failed; falling back to cached state.');
    }
  }

  let nodesById: Record<string, CascadeNodeView>;
  let hostConnected: boolean;
  let stale: boolean;
  let staleAgeMs: number | null;
  let snapshotUpdatedAt: string | null;
  let source: CliTelemetryView['source'];
  let quota: QuotaSummaryView | null;
  let fleet: FleetSnapshotResponse | null;
  let fleetHeadline: FleetSnapshotResponse['activeHeadline'] | null;

  if (liveResult) {
    nodesById = liveResult.nodesById;
    hostConnected = true;
    stale = false;
    staleAgeMs = 0;
    snapshotUpdatedAt = generatedAt;
    source = 'live-ls';
    quota = liveResult.quota;
    fleet = liveResult.fleet;
    fleetHeadline = liveResult.fleet.activeHeadline;
    warnings.push(...liveResult.warnings);
  } else {
    nodesById = snapshot?.nodesByCascadeId ?? {};
    hostConnected = Boolean(snapshot?.hostConnected);
    staleAgeMs = snapshotAgeMs;
    stale =
      snapshot === null ||
      !hostConnected ||
      snapshotAgeMs === null ||
      !Number.isFinite(snapshotAgeMs) ||
      snapshotAgeMs > SNAPSHOT_STALE_THRESHOLD_MS;
    snapshotUpdatedAt = snapshot?.updatedAt ?? null;
    source = snapshot ? 'snapshot' : quotaCache ? 'cache-only' : 'none';
    quota = snapshot?.quota ?? quotaCache?.quota ?? null;
    fleet = snapshot?.fleet ?? null;
    fleetHeadline = snapshot?.fleet?.activeHeadline ?? null;
  }

  const targetCid = resolveTargetCid(
    nodesById,
    options.conversationId,
    validEnvCid,
    snapshot?.activeConversationId
  );

  const activeNode = targetCid ? (nodesById[targetCid] ?? null) : null;
  if (options.conversationId && !activeNode && Object.keys(nodesById).length > 0) {
    warnings.push(`Conversation ${options.conversationId} was not found in telemetry.`);
  }

  const rootCascadeId = activeNode
    ? activeNode.rootCascadeId || activeNode.cascadeId
    : targetCid;

  const rawTreeNodes =
    activeNode && rootCascadeId
      ? Object.values(nodesById).filter(
          (n) => (n.rootCascadeId || n.cascadeId) === rootCascadeId
        )
      : [];

  const treeNodes = sortTreeNodes(
    rawTreeNodes,
    config.hudSortMode,
    activeNode?.cascadeId ?? null
  );

  const breadcrumb = buildBreadcrumb(
    rootCascadeId,
    activeNode?.cascadeId ?? null,
    nodesById
  );

  const activeSubagentCount = treeNodes.filter(
    (n) =>
      n.kind !== 'root' &&
      n.phase !== 'IDLE' &&
      n.phase !== 'ERROR_OR_QUOTA'
  ).length;

  const gemini5hPct = quota?.gemini5h?.remainingPct ?? null;
  const smartGovernanceBanner = evaluateSmartGovernanceBanner(
    treeNodes,
    gemini5hPct,
    quota?.burnRate5hPctPerMin ?? null,
    config
  );

  if (snapshot === null && !liveResult) {
    if (!existsSync(paths.stateDir)) {
      warnings.push(`State directory does not exist yet: ${paths.stateDir}`);
    } else {
      warnings.push(`No live-snapshot.json found in ${paths.stateDir}`);
    }
  } else if (stale && !liveResult) {
    warnings.push(
      staleAgeMs !== null
        ? `Cached telemetry is stale (${Math.round(staleAgeMs / 1000)}s old)`
        : 'Host is disconnected; displaying cached telemetry'
    );
  }

  let statusClass: CliStatusClass;
  if (!hostConnected || stale) {
    statusClass = 'disconnected';
  } else if (
    (gemini5hPct !== null && gemini5hPct < 15) ||
    activeNode?.phase === 'ERROR_OR_QUOTA' ||
    activeNode?.routingStatus === 'retrying' ||
    activeNode?.routingStatus === 'mismatch_or_fallback' ||
    activeNode?.contextWindow.level === 'critical_85'
  ) {
    statusClass = 'alert';
  } else if (
    (gemini5hPct !== null && gemini5hPct < 25) ||
    activeNode?.contextWindow.level === 'warn_70' ||
    activeNode?.phase === 'BLOCKED_APPROVAL' ||
    smartGovernanceBanner.active
  ) {
    statusClass = 'warning';
  } else if ((activeNode !== null && activeNode.phase !== 'IDLE') || activeSubagentCount > 0) {
    statusClass = 'active';
  } else {
    statusClass = 'idle';
  }

  return {
    generatedAt,
    stateDir: paths.stateDir,
    source,
    snapshotUpdatedAt,
    hostConnected,
    stale,
    staleAgeMs,
    statusClass,
    activeConversationId: activeNode?.cascadeId ?? targetCid,
    rootCascadeId,
    breadcrumb,
    activeNode,
    treeNodes,
    activeSubagentCount,
    fleetHeadline,
    fleet,
    quota,
    smartGovernanceBanner,
    config,
    warnings,
  };
}
