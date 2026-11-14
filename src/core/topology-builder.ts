import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { CascadeQuotaBaseline } from '../state/state-dir';
import type {
  GeneratorMetadataEntryRaw,
  SubagentDescriptorFileRaw,
  SwarmMemberRaw,
  SwarmMembersFileRaw,
  TrajectoryStepRaw,
  TrajectorySummaryRaw,
} from '../types/rpc';
import type {
  CascadeNodeView,
  HookRingEvent,
  HudSnapshotResponse,
  PulseUserConfig,
} from '../types/telemetry';
import {
  computeCacheHitPct,
  parseDurationMs,
  toIntToken,
} from './formatters';
import {
  computeContextWindow,
  type ModelCatalog,
  reconcileRequestedVsServed,
} from './model-catalog';
import { deriveCascadePhase } from './state-machine';

export interface TopologyBuildInput {
  antigravityDataDir: string;
  trajectories: Record<string, TrajectorySummaryRaw>;
  generatorMetadataByCascade: Record<string, GeneratorMetadataEntryRaw[]>;
  stepsByCascade?: Record<string, TrajectoryStepRaw[]>;
  recentHookEvents?: HookRingEvent[];
  modelCatalog: ModelCatalog;
  quotaBaselines?: Record<string, CascadeQuotaBaseline>;
  prevNodesByCascadeId?: Record<string, CascadeNodeView>;
  smartThresholds?: PulseUserConfig['smartThresholds'];
  lsConnected?: boolean;
  nowMs?: number;
  enableSqliteFallback?: boolean;
}

export interface TopologyBuildOutput {
  nodesByCascadeId: Record<string, CascadeNodeView>;
  rootByCascadeId: Record<string, string>;
  treesByRootId: Record<string, CascadeNodeView[]>;
  warnings: string[];
}

interface DiscoveredCascade {
  cascadeId: string;
  summary?: TrajectorySummaryRaw;
  parentCascadeId: string | null;
  explicitRootId: string | null;
  kind: CascadeNodeView['kind'];
  role: string | null;
  typeName: string | null;
  spawnStepIndex: number | null;
  workspaceUris: string[];
  swarmMember?: SwarmMemberRaw;
  swarmState?: CascadeNodeView['swarmState'];
  requestedModelRaw?: string | null;
  requestedSource?: CascadeNodeView['requestedModel']['source'];
  provisionalServedModelRaw?: string | null;
  isPreflightSynthetic?: boolean;
  preflightHook?: HookRingEvent;
}

function isSafeSegment(segment: string): boolean {
  return (
    Boolean(segment) &&
    !segment.includes('/') &&
    !segment.includes('\\') &&
    !segment.includes('..') &&
    !segment.includes('\0')
  );
}

function unescapePbtxtString(raw: string): string {
  return raw
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\');
}

export function readFallbackTitleFromAnnotations(
  antigravityDataDir: string,
  cascadeId: string
): string | null {
  if (!antigravityDataDir || !isSafeSegment(cascadeId)) {
    return null;
  }
  const pbtxtPath = path.join(antigravityDataDir, 'annotations', `${cascadeId}.pbtxt`);
  if (!existsSync(pbtxtPath)) {
    return null;
  }
  try {
    const content = readFileSync(pbtxtPath, 'utf8');
    const match = /^\s*title:\s*"((?:[^"\\]|\\.)*)"/m.exec(content);
    if (!match?.[1]) {
      return null;
    }
    const title = unescapePbtxtString(match[1]).trim();
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

export function extractWorkspaceBasename(uri: string | null | undefined): string | null {
  if (!uri || typeof uri !== 'string') {
    return null;
  }
  let cleaned = uri.trim();
  if (!cleaned) {
    return null;
  }
  cleaned = cleaned.replace(/^file:\/\//i, '');
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // Keep undecoded string if malformed percent-encoding
  }
  cleaned = cleaned.replace(/[\\/]+$/, '');
  if (!cleaned) {
    return null;
  }
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ? last.trim() : null;
}

export function resolveCascadeTitle(
  summary: TrajectorySummaryRaw | undefined,
  antigravityDataDir: string,
  cascadeId: string,
  role?: string | null,
  extraWorkspaceUris?: string[]
): string {
  const summaryTitle = typeof summary?.summary === 'string' ? summary.summary.trim() : '';
  if (summaryTitle) {
    return summaryTitle;
  }

  const annotationTitle = readFallbackTitleFromAnnotations(antigravityDataDir, cascadeId);
  if (annotationTitle) {
    return annotationTitle;
  }

  const workspaceUri =
    summary?.workspaces?.[0]?.workspaceFolderAbsoluteUri ??
    summary?.workspaces?.[0]?.gitRootAbsoluteUri ??
    extraWorkspaceUris?.[0];
  const workspaceBase = extractWorkspaceBasename(workspaceUri);
  if (workspaceBase) {
    return workspaceBase;
  }

  const trimmedRole = typeof role === 'string' ? role.trim() : '';
  if (trimmedRole) {
    return trimmedRole;
  }

  return `Cascade ${cascadeId.slice(0, 8)}`;
}

function readParentRefsFromSqliteReadOnly(
  dbPath: string
): { parentCascadeId?: string; rootCascadeId?: string } | null {
  if (!existsSync(dbPath) || typeof process.getBuiltinModule !== 'function') {
    return null;
  }
  const sqlite = process.getBuiltinModule('node:sqlite');
  if (!sqlite?.DatabaseSync) {
    return null;
  }

  let db: InstanceType<typeof sqlite.DatabaseSync> | null = null;
  try {
    db = new sqlite.DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name?: string }>;

    for (const table of tables) {
      const tableName = table.name;
      if (!tableName || !/^[A-Za-z0-9_]+$/.test(tableName)) {
        continue;
      }
      const cols = db
        .prepare(`PRAGMA table_info(${tableName})`)
        .all() as Array<{ name?: string }>;
      const colNames = new Set(cols.map((c) => c.name).filter((n): n is string => Boolean(n)));
      if (colNames.has('parent_cascade_id') || colNames.has('root_cascade_id')) {
        const selectCols = [
          colNames.has('parent_cascade_id') ? 'parent_cascade_id' : 'NULL AS parent_cascade_id',
          colNames.has('root_cascade_id') ? 'root_cascade_id' : 'NULL AS root_cascade_id',
        ].join(', ');
        const row = db.prepare(`SELECT ${selectCols} FROM ${tableName} LIMIT 1`).get() as
          | { parent_cascade_id?: unknown; root_cascade_id?: unknown }
          | undefined;
        if (row) {
          const parentCascadeId =
            typeof row.parent_cascade_id === 'string' && row.parent_cascade_id.trim()
              ? row.parent_cascade_id.trim()
              : undefined;
          const rootCascadeId =
            typeof row.root_cascade_id === 'string' && row.root_cascade_id.trim()
              ? row.root_cascade_id.trim()
              : undefined;
          if (parentCascadeId || rootCascadeId) {
            return { parentCascadeId, rootCascadeId };
          }
        }
      }
    }
  } catch {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close error
      }
    }
  }
  return null;
}

export function buildBreadcrumb(
  rootCascadeId: string | null,
  activeConversationId: string | null,
  nodesByCascadeId: Record<string, CascadeNodeView>
): HudSnapshotResponse['breadcrumb'] {
  if (!activeConversationId) {
    return [];
  }
  const active = nodesByCascadeId[activeConversationId];
  if (!active) {
    return [];
  }

  const trail: HudSnapshotResponse['breadcrumb'] = [];
  const visited = new Set<string>();
  let curr: CascadeNodeView | undefined = active;

  while (curr && !visited.has(curr.cascadeId)) {
    visited.add(curr.cascadeId);
    trail.push({
      cascadeId: curr.cascadeId,
      title: curr.title,
      role: curr.role,
    });
    if (!curr.parentCascadeId || curr.cascadeId === rootCascadeId) {
      break;
    }
    curr = nodesByCascadeId[curr.parentCascadeId];
  }

  return trail.reverse();
}

export function buildTopologyGraph(input: TopologyBuildInput): TopologyBuildOutput {
  const nowMs = input.nowMs ?? Date.now();
  const warnings: string[] = [];
  const discovery = new Map<string, DiscoveredCascade>();

  const getOrCreate = (cid: string): DiscoveredCascade => {
    const existing = discovery.get(cid);
    if (existing) {
      return existing;
    }
    const created: DiscoveredCascade = {
      cascadeId: cid,
      parentCascadeId: null,
      explicitRootId: null,
      kind: 'root',
      role: null,
      typeName: null,
      spawnStepIndex: null,
      workspaceUris: [],
    };
    discovery.set(cid, created);
    return created;
  };

  for (const [cid, summary] of Object.entries(input.trajectories)) {
    if (!cid) continue;
    const rec = getOrCreate(cid);
    rec.summary = summary;
  }

  for (const cid of Object.keys(input.generatorMetadataByCascade)) {
    if (cid) {
      getOrCreate(cid);
    }
  }

  // Recursive BFS across brain/<cid>/.system_generated/{subagents/*.json, swarm/members.json}
  const brainQueue: string[] = Array.from(discovery.keys());
  const visitedBrain = new Set<string>();

  while (brainQueue.length > 0) {
    const parentCid = brainQueue.shift();
    if (!parentCid || visitedBrain.has(parentCid) || !isSafeSegment(parentCid)) {
      continue;
    }
    visitedBrain.add(parentCid);

    if (!input.antigravityDataDir) {
      continue;
    }

    const sysGenDir = path.join(input.antigravityDataDir, 'brain', parentCid, '.system_generated');
    if (!existsSync(sysGenDir)) {
      continue;
    }

    // Source 1: subagents/*.json
    const subagentsDir = path.join(sysGenDir, 'subagents');
    if (existsSync(subagentsDir)) {
      try {
        const files = readdirSync(subagentsDir)
          .filter((name) => name.endsWith('.json'))
          .sort();
        for (const fileName of files) {
          const fullPath = path.join(subagentsDir, fileName);
          try {
            const parsed = JSON.parse(readFileSync(fullPath, 'utf8')) as SubagentDescriptorFileRaw;
            const subCid = parsed.conversationId?.trim();
            if (!subCid || subCid === parentCid) {
              continue;
            }
            const childRec = getOrCreate(subCid);
            childRec.parentCascadeId = parentCid;
            childRec.kind = 'subagent';
            childRec.role = parsed.subagentDescriptor?.role?.trim() || childRec.role;
            childRec.typeName = parsed.subagentDescriptor?.typeName?.trim() || childRec.typeName;
            if (typeof parsed.spawnStepIndex === 'number' && Number.isFinite(parsed.spawnStepIndex)) {
              childRec.spawnStepIndex = parsed.spawnStepIndex;
            }
            if (Array.isArray(parsed.workspaceUris)) {
              childRec.workspaceUris = parsed.workspaceUris.filter(
                (u): u is string => typeof u === 'string' && u.trim().length > 0
              );
            }
            if (!visitedBrain.has(subCid)) {
              brainQueue.push(subCid);
            }
          } catch (err) {
            warnings.push(
              `Skipped malformed subagent descriptor ${fileName}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      } catch (err) {
        warnings.push(
          `Failed reading subagents dir for ${parentCid}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Source 2: swarm/members.json (L-005: members is an object map, NOT an array)
    const swarmMembersPath = path.join(sysGenDir, 'swarm', 'members.json');
    if (existsSync(swarmMembersPath)) {
      try {
        const parsed = JSON.parse(readFileSync(swarmMembersPath, 'utf8')) as SwarmMembersFileRaw;
        for (const [memberName, member] of Object.entries(parsed?.members ?? {})) {
          if (!member || typeof member !== 'object') {
            continue;
          }
          const subCid: string =
            member.conversation_id?.trim() || `swarm:${parentCid}:${memberName}`;
          if (!subCid || subCid === parentCid) {
            continue;
          }
          const childRec = getOrCreate(subCid);
          childRec.parentCascadeId = parentCid;
          childRec.kind = 'swarm_member';
          childRec.role = member.role?.trim() || memberName;
          childRec.typeName = 'swarm';
          childRec.swarmMember = member;
          childRec.swarmState = {
            memberName,
            ...(member.desired_state !== undefined ? { desiredState: member.desired_state } : {}),
            ...(member.phase !== undefined ? { phase: member.phase } : {}),
            ...(member.wake_mode !== undefined ? { wakeMode: member.wake_mode } : {}),
            ...(member.killed !== undefined ? { killed: member.killed } : {}),
          };
          const reqRaw =
            member.desired_model?.trim() ||
            member.model?.trim() ||
            member.applied_model?.trim() ||
            null;
          if (reqRaw) {
            childRec.requestedModelRaw = reqRaw;
            childRec.requestedSource = 'swarm';
          }
          const appliedRaw = member.applied_model?.trim() || member.model?.trim() || null;
          if (appliedRaw) {
            childRec.provisionalServedModelRaw = appliedRaw;
          }
          if (member.conversation_id && !visitedBrain.has(subCid)) {
            brainQueue.push(subCid);
          }
        }
      } catch (err) {
        warnings.push(
          `Failed reading swarm/members.json for ${parentCid}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // Source 3: generatorMetadata customMetadata + optional strictly read-only SQLite fallback
  for (const [cid, rec] of Array.from(discovery.entries())) {
    const genList = input.generatorMetadataByCascade[cid] ?? [];
    for (let i = genList.length - 1; i >= 0; i -= 1) {
      const custom = genList[i]?.chatModel?.customMetadata;
      if (!custom) continue;
      if (!rec.parentCascadeId && typeof custom.parent_cascade_id === 'string') {
        const p = custom.parent_cascade_id.trim();
        if (p && p !== cid) {
          rec.parentCascadeId = p;
        }
      }
      if (!rec.explicitRootId && typeof custom.root_cascade_id === 'string') {
        const r = custom.root_cascade_id.trim();
        if (r) {
          rec.explicitRootId = r;
        }
      }
      if (rec.parentCascadeId && rec.explicitRootId) {
        break;
      }
    }

    if (
      !rec.parentCascadeId &&
      input.enableSqliteFallback !== false &&
      input.antigravityDataDir &&
      isSafeSegment(cid)
    ) {
      const dbPath = path.join(input.antigravityDataDir, 'conversations', `${cid}.db`);
      if (existsSync(dbPath)) {
        const sqliteRefs = readParentRefsFromSqliteReadOnly(dbPath);
        if (sqliteRefs?.parentCascadeId && sqliteRefs.parentCascadeId !== cid) {
          rec.parentCascadeId = sqliteRefs.parentCascadeId;
        }
        if (sqliteRefs?.rootCascadeId && !rec.explicitRootId) {
          rec.explicitRootId = sqliteRefs.rootCascadeId;
        }
      }
    }

    if (rec.parentCascadeId && rec.kind === 'root') {
      const titleHint = rec.summary?.summary ?? '';
      rec.kind = /workflow/i.test(titleHint) ? 'workflow' : 'subagent';
    }
  }

  // Source 4: T=0ms Pre-flight invoke_subagent hook overlay (deduplicated once real subagent appears)
  const hookEvents = input.recentHookEvents ?? [];
  for (const ev of hookEvents) {
    if (
      ev.event !== 'PreToolUse' ||
      ev.toolName !== 'invoke_subagent' ||
      !ev.subagentRequest ||
      !ev.conversationId ||
      ev.conversationId === 'unknown'
    ) {
      continue;
    }
    if (nowMs - ev.ts > 15_000 || ev.ts > nowMs + 5_000) {
      continue;
    }

    const reqRole = ev.subagentRequest.role?.trim() || null;
    const reqType = ev.subagentRequest.typeName?.trim() || null;

    let alreadyMaterialized = false;
    for (const candidate of discovery.values()) {
      if (candidate.parentCascadeId !== ev.conversationId || candidate.isPreflightSynthetic) {
        continue;
      }
      const roleMatch = !reqRole || candidate.role === reqRole;
      const typeMatch = !reqType || candidate.typeName === reqType;
      if (roleMatch && typeMatch) {
        const createdMs = Date.parse(
          candidate.summary?.createdTime ?? candidate.summary?.lastModifiedTime ?? ''
        );
        const isActiveSummary = candidate.summary?.status === 'CASCADE_RUN_STATUS_RUNNING';
        if (isActiveSummary || (Number.isFinite(createdMs) && createdMs >= ev.ts - 2_000)) {
          alreadyMaterialized = true;
          break;
        }
      }
    }
    if (alreadyMaterialized) {
      continue;
    }

    getOrCreate(ev.conversationId);
    const preflightId = `preflight:${ev.conversationId}:${ev.toolCallId || ev.ts}`;
    const preRec = getOrCreate(preflightId);
    preRec.parentCascadeId = ev.conversationId;
    preRec.kind = 'subagent';
    preRec.role = reqRole;
    preRec.typeName = reqType;
    preRec.isPreflightSynthetic = true;
    preRec.preflightHook = ev;
    if (ev.subagentRequest.model?.trim()) {
      preRec.requestedModelRaw = ev.subagentRequest.model.trim();
      preRec.requestedSource = 'explicit';
    } else {
      preRec.requestedModelRaw = 'inherit';
      preRec.requestedSource = 'inherited';
    }
  }

  // Cycle-safe parent -> root & depth resolution
  const effectiveParentByCid = new Map<string, string | null>();
  const rootByCascadeId: Record<string, string> = {};
  const depthByCid = new Map<string, number>();
  const childrenByCid = new Map<string, string[]>();

  for (const cid of discovery.keys()) {
    childrenByCid.set(cid, []);
  }

  const cycleWarned = new Set<string>();
  for (const cid of Array.from(discovery.keys()).sort()) {
    const chain: string[] = [cid];
    const visited = new Set<string>([cid]);
    let curr = cid;

    while (true) {
      const parent = discovery.get(curr)?.parentCascadeId;
      if (!parent || !discovery.has(parent)) {
        break;
      }
      if (visited.has(parent)) {
        const cycleKey = [curr, parent].sort().join('<->');
        if (!cycleWarned.has(cycleKey)) {
          cycleWarned.add(cycleKey);
          warnings.push(`Cycle detected in cascade topology involving ${curr} and ${parent}; broken safely.`);
        }
        break;
      }
      visited.add(parent);
      chain.push(parent);
      curr = parent;
    }

    const effectiveParent = chain.length > 1 ? chain[1] : null;
    effectiveParentByCid.set(cid, effectiveParent);
    if (effectiveParent) {
      childrenByCid.get(effectiveParent)?.push(cid);
    }

    const rec = discovery.get(cid);
    const walkedRoot = chain[chain.length - 1];
    if (
      chain.length === 1 &&
      rec?.explicitRootId &&
      rec.explicitRootId !== cid &&
      discovery.has(rec.explicitRootId)
    ) {
      rootByCascadeId[cid] = rec.explicitRootId;
      depthByCid.set(cid, 1);
    } else {
      rootByCascadeId[cid] = walkedRoot;
      depthByCid.set(cid, chain.length - 1);
    }
  }

  // Assemble CascadeNodeView records
  const lsConnected =
    input.lsConnected ?? Object.keys(input.trajectories).length > 0;
  const nodesByCascadeId: Record<string, CascadeNodeView> = {};

  for (const [cid, rec] of discovery.entries()) {
    const summary = rec.summary;
    const genMetas = input.generatorMetadataByCascade[cid] ?? [];
    let latestGenMeta: GeneratorMetadataEntryRaw | null = null;
    for (let i = genMetas.length - 1; i >= 0; i -= 1) {
      if (genMetas[i]?.chatModel) {
        latestGenMeta = genMetas[i];
        break;
      }
    }
    const latestChat = latestGenMeta?.chatModel;

    let inputTokens = 0;
    let cacheReadTokens = 0;
    let outputTokens = 0;
    let thinkingOutputTokens = 0;
    let responseOutputTokens = 0;
    let turnCount = 0;

    for (const entry of genMetas) {
      if (!entry.chatModel) continue;
      turnCount += 1;
      const usage = entry.chatModel.usage;
      if (!usage) continue;
      const turnIn = toIntToken(usage.inputTokens);
      const turnCache = toIntToken(usage.cacheReadTokens);
      const turnOut = toIntToken(usage.outputTokens);
      const turnThink = toIntToken(usage.thinkingOutputTokens);
      const turnResp =
        usage.responseOutputTokens !== undefined
          ? toIntToken(usage.responseOutputTokens)
          : Math.max(0, turnOut - turnThink);

      inputTokens += turnIn;
      cacheReadTokens += turnCache;
      outputTokens += turnOut;
      thinkingOutputTokens += turnThink;
      responseOutputTokens += turnResp;
    }

    const cacheHitPct = computeCacheHitPct(inputTokens, cacheReadTokens);
    const contextWindow = computeContextWindow(
      latestChat?.chatStartMetadata?.contextWindowMetadata,
      input.smartThresholds
        ? {
            warnPct: input.smartThresholds.contextWarnPct,
            criticalPct: input.smartThresholds.contextCriticalPct,
          }
        : undefined
    );

    const cascadeHooks = hookEvents
      .filter((ev) => ev.conversationId === cid)
      .sort((a, b) => a.ts - b.ts);
    const latestInvocationHook = [...cascadeHooks]
      .reverse()
      .find((ev) => Boolean(ev.modelRaw));

    const tailSteps = input.stepsByCascade?.[cid] ?? [];
    const latestStep = tailSteps.length > 0 ? tailSteps[tailSteps.length - 1] : undefined;

    const requestedRaw =
      rec.requestedModelRaw ??
      latestInvocationHook?.modelRaw ??
      latestChat?.customMetadata?.model_enum ??
      null;
    const requestedSource: CascadeNodeView['requestedModel']['source'] | undefined =
      rec.requestedSource ??
      (latestInvocationHook?.modelRaw
        ? 'user'
        : latestChat?.customMetadata?.model_enum
          ? 'user'
          : rec.parentCascadeId
            ? 'inherited'
            : undefined);

    const provisionalServed =
      rec.provisionalServedModelRaw ?? latestStep?.metadata?.generatorModel ?? null;

    const routing = reconcileRequestedVsServed({
      catalog: input.modelCatalog,
      requestedModelRaw: requestedRaw,
      requestedSource,
      latestGenMeta,
      provisionalServedModelRaw: provisionalServed,
    });

    const prevNode = input.prevNodesByCascadeId?.[cid] ?? null;
    const state = rec.isPreflightSynthetic && rec.preflightHook
      ? {
          phase: 'PRE_FLIGHT' as const,
          phaseStartedAt: rec.preflightHook.iso,
          phaseElapsedMs: Math.max(0, nowMs - rec.preflightHook.ts),
          lastTool: null,
          streamingTokPerSec: null,
        }
      : deriveCascadePhase({
          cascadeId: cid,
          lsConnected,
          summary,
          tailSteps,
          latestGenMeta,
          recentHookEvents: cascadeHooks,
          prevNode,
          swarmMember: rec.swarmMember,
          nowMs,
        });

    const title = rec.isPreflightSynthetic
      ? rec.role || rec.typeName || 'Spawning Subagent'
      : resolveCascadeTitle(
          summary,
          input.antigravityDataDir,
          cid,
          rec.role,
          rec.workspaceUris
        );

    const lastTtftMs = latestChat?.timeToFirstToken
      ? parseDurationMs(latestChat.timeToFirstToken)
      : null;
    const lastStreamingMs = latestChat?.streamingDuration
      ? parseDurationMs(latestChat.streamingDuration)
      : null;

    const lastModifiedTime =
      summary?.lastModifiedTime ??
      rec.preflightHook?.iso ??
      latestChat?.timestamp ??
      latestChat?.createdAt ??
      new Date(nowMs).toISOString();

    const sortedChildren = [...(childrenByCid.get(cid) ?? [])].sort((a, b) => {
      const aSpawn = discovery.get(a)?.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
      const bSpawn = discovery.get(b)?.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
      if (aSpawn !== bSpawn) return aSpawn - bSpawn;
      return a < b ? -1 : a > b ? 1 : 0;
    });

    const node: CascadeNodeView = {
      cascadeId: cid,
      rootCascadeId: rootByCascadeId[cid] ?? cid,
      parentCascadeId: effectiveParentByCid.get(cid) ?? null,
      kind: rec.kind,
      title,
      role: rec.role,
      typeName: rec.typeName,
      depth: depthByCid.get(cid) ?? 0,
      status:
        summary?.status ??
        (rec.isPreflightSynthetic ? 'CASCADE_RUN_STATUS_RUNNING' : 'CASCADE_RUN_STATUS_IDLE'),
      phase: state.phase,
      phaseStartedAt: state.phaseStartedAt,
      phaseElapsedMs: state.phaseElapsedMs,
      requestedModel: routing.requestedModel,
      servedModel: routing.servedModel,
      routingStatus: routing.routingStatus,
      retryCount: routing.retryCount,
      lastTool: state.lastTool,
      stepCount: summary?.stepCount ?? 0,
      turnCount,
      streamingTokPerSec: state.streamingTokPerSec,
      contextWindow,
      cacheHitPct,
      tokens: {
        inputTokens,
        cacheReadTokens,
        outputTokens,
        thinkingOutputTokens,
        responseOutputTokens,
      },
      deltaQuota5hPct: input.quotaBaselines?.[cid]?.delta5hPct ?? null,
      lastTtftMs,
      lastStreamingMs,
      lastModifiedTime,
      spawnStepIndex: rec.spawnStepIndex,
      ...(rec.swarmState ? { swarmState: rec.swarmState } : {}),
      childrenIds: sortedChildren,
    };

    nodesByCascadeId[cid] = node;
  }

  // Group into trees by rootCascadeId (DFS pre-order per tree)
  const treesByRootId: Record<string, CascadeNodeView[]> = {};
  const roots = Object.values(nodesByCascadeId)
    .filter((n) => n.parentCascadeId === null)
    .sort((a, b) => (a.cascadeId < b.cascadeId ? -1 : a.cascadeId > b.cascadeId ? 1 : 0));

  for (const root of roots) {
    const ordered: CascadeNodeView[] = [];
    const seen = new Set<string>();
    const visit = (nid: string) => {
      if (seen.has(nid)) return;
      seen.add(nid);
      const node = nodesByCascadeId[nid];
      if (!node) return;
      ordered.push(node);
      for (const childId of node.childrenIds) {
        visit(childId);
      }
    };
    visit(root.cascadeId);
    treesByRootId[root.cascadeId] = ordered;
  }

  // Catch any nodes whose root wasn't in roots (e.g. explicitRootId missing from nodesByCascadeId)
  for (const node of Object.values(nodesByCascadeId)) {
    const rootId = node.rootCascadeId;
    if (!treesByRootId[rootId]) {
      treesByRootId[rootId] = [];
    }
    if (!treesByRootId[rootId].some((n) => n.cascadeId === node.cascadeId)) {
      treesByRootId[rootId].push(node);
    }
  }

  return {
    nodesByCascadeId,
    rootByCascadeId,
    treesByRootId,
    warnings,
  };
}
