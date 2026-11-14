import os from 'node:os';
import path from 'node:path';
import { CANONICAL_HUD_URI, formatDurationCompact, formatPct } from '../core/formatters';
import { buildModelCatalog, type ModelCatalog } from '../core/model-catalog';
import { normalizeQuotaSummary } from '../core/quota-calculator';
import { buildTopologyGraph } from '../core/topology-builder';
import { ReadOnlyLsClient } from '../rpc/ls-client';
import {
  ConfigValidationError,
  loadConfig,
  updateConfigPartial,
  validateConfigPatch,
} from '../state/config-store';
import {
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
  ComputeBudgetAdvice,
  PulseUserConfig,
  QuotaSummaryView,
  SmartGovernanceBanner,
} from '../types/telemetry';
import { type CardThemeMode, writeStatusCardFile } from './embed-card';

export const MCP_SERVER_NAME = 'antigravity-pulse';
export const MCP_SERVER_VERSION = '0.1.0';
export const DEFAULT_PROTOCOL_VERSION = '2024-11-05';
export const SIDECAR_PILL_MARKDOWN = `[Model Pulse](${CANONICAL_HUD_URI})`;

const MAX_CONTENT_LENGTH_BYTES = 16 * 1024 * 1024;
const LS_RPC_TIMEOUT_MS = 1500;
const STALE_THRESHOLD_MS = 30_000;
const MAX_LIVE_META_CASCADES = 12;

export type RpcFramingMode = 'ndjson' | 'content-length';

export interface DecodedFrame {
  framing: RpcFramingMode;
  rawJson?: string;
  parseError?: boolean;
}

export interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpServerContext {
  stateDir?: string;
  antigravityDataDir?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: () => number;
}

export interface LoadedMcpTelemetry {
  nowMs: number;
  generatedAt: string;
  hostConnected: boolean;
  stale: boolean;
  staleAgeMs: number | null;
  conversationId: string | null;
  activeNode: CascadeNodeView | null;
  treeNodes: CascadeNodeView[];
  allNodes: CascadeNodeView[];
  quota: QuotaSummaryView | null;
  smartGovernanceBanner: SmartGovernanceBanner | null;
  config: PulseUserConfig;
  warnings: string[];
}

export const MCP_TOOL_DEFINITIONS = [
  {
    name: 'pulse_status_card',
    description:
      'Generate a self-contained Flexoki Light/Dark HTML status card in $PULSE_STATE_DIR/cards/ for the active conversation, multi-agent topology, and quota buckets, returning an <agent-embed> tag and sidecar:// pill.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'Optional 36-character conversation UUID. Defaults to active conversation context.',
        },
        theme: {
          type: 'string',
          enum: ['auto', 'light', 'dark'],
          description: 'Card color theme polarity (defaults to auto).',
        },
        includeTree: {
          type: 'boolean',
          description: 'Include multi-agent subagent/workflow/swarm topology table (defaults to true).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pulse_get_compute_budget',
    description:
      'Query live active model routing, context window saturation (%), and 5h/weekly quota headroom before spawning parallel subagents or swarms; recommends inherit, argon, or flash.',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: {
          type: 'string',
          description: 'Optional 36-character conversation UUID.',
        },
        plannedSubagentCount: {
          type: 'integer',
          minimum: 0,
          description: 'Optional count of parallel subagent/swarm workers planned to spawn.',
        },
        taskKind: {
          type: 'string',
          enum: ['exploration', 'coding', 'review', 'general'],
          description: 'Optional task category for subagent tier recommendation.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'pulse_set_preference',
    description:
      'Validate and atomically persist Model Pulse user preferences in $PULSE_STATE_DIR/config.json (inlineStampMode, hudSortMode, timelineScope, smartThresholds).',
    inputSchema: {
      type: 'object',
      properties: {
        inlineStampMode: {
          type: 'string',
          enum: ['smart', 'every-turn', 'off'],
          description: 'Inline chat turn stamp policy.',
        },
        hudSortMode: {
          type: 'string',
          enum: ['active-first', 'topology-tree'],
          description: 'Pulse HUD live agent list ordering mode.',
        },
        timelineScope: {
          type: 'string',
          enum: ['conversation', 'tree'],
          description: 'Timeline scope (single conversation vs whole cascade tree).',
        },
        smartThresholds: {
          type: 'object',
          properties: {
            contextWarnPct: { type: 'number', minimum: 1, maximum: 100 },
            contextCriticalPct: { type: 'number', minimum: 1, maximum: 100 },
            stampContextTriggerPct: { type: 'number', minimum: 1, maximum: 100 },
            quotaLowTriggerPct: { type: 'number', minimum: 1, maximum: 100 },
            heavyConcurrentAlertCount: { type: 'integer', minimum: 1, maximum: 100 },
            heavyQuotaThresholdPct: { type: 'number', minimum: 1, maximum: 100 },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function serializeJsonRpcMessage(
  payload: unknown,
  framing: RpcFramingMode
): string {
  const json = JSON.stringify(payload);
  if (framing === 'content-length') {
    const bytes = Buffer.byteLength(json, 'utf8');
    return `Content-Length: ${bytes}\r\n\r\n${json}`;
  }
  return `${json}\n`;
}

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0d || byte === 0x0a;
}

function findHeaderTerminator(buf: Buffer): { index: number; length: number } | null {
  const crlfIdx = buf.indexOf('\r\n\r\n');
  const lfIdx = buf.indexOf('\n\n');
  if (crlfIdx === -1 && lfIdx === -1) {
    return null;
  }
  if (crlfIdx !== -1 && (lfIdx === -1 || crlfIdx < lfIdx)) {
    return { index: crlfIdx, length: 4 };
  }
  return { index: lfIdx, length: 2 };
}

export class McpFrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer, eof = false): DecodedFrame[] {
    if (chunk.length > 0) {
      this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    }
    return this.drain(eof);
  }

  flushEnd(): DecodedFrame[] {
    return this.drain(true);
  }

  private drain(eof: boolean): DecodedFrame[] {
    const frames: DecodedFrame[] = [];

    while (this.buffer.length > 0) {
      let start = 0;
      while (start < this.buffer.length && isAsciiWhitespace(this.buffer[start])) {
        start += 1;
      }
      if (start > 0) {
        this.buffer = this.buffer.subarray(start);
      }
      if (this.buffer.length === 0) {
        break;
      }

      const firstByte = this.buffer[0];
      if (firstByte === 0x7b || firstByte === 0x5b) {
        const nlIdx = this.buffer.indexOf(0x0a);
        if (nlIdx === -1) {
          if (!eof) {
            break;
          }
          const trailing = this.buffer.toString('utf8').trim();
          this.buffer = Buffer.alloc(0);
          if (trailing) {
            frames.push({ framing: 'ndjson', rawJson: trailing });
          }
          break;
        }
        const line = this.buffer
          .subarray(0, nlIdx)
          .toString('utf8')
          .replace(/\r$/, '')
          .trim();
        this.buffer = this.buffer.subarray(nlIdx + 1);
        if (line) {
          frames.push({ framing: 'ndjson', rawJson: line });
        }
        continue;
      }

      const nlIdx = this.buffer.indexOf(0x0a);
      if (nlIdx === -1) {
        if (!eof) {
          break;
        }
        const trailing = this.buffer.toString('utf8').trim();
        this.buffer = Buffer.alloc(0);
        if (trailing) {
          if (/^content-(?:length|type)\s*:/i.test(trailing)) {
            frames.push({ framing: 'content-length', parseError: true });
          } else {
            frames.push({ framing: 'ndjson', rawJson: trailing });
          }
        }
        break;
      }

      const firstLine = this.buffer
        .subarray(0, nlIdx)
        .toString('latin1')
        .replace(/\r$/, '');

      if (!/^content-(?:length|type)\s*:/i.test(firstLine)) {
        const line = this.buffer
          .subarray(0, nlIdx)
          .toString('utf8')
          .replace(/\r$/, '')
          .trim();
        this.buffer = this.buffer.subarray(nlIdx + 1);
        if (line) {
          frames.push({ framing: 'ndjson', rawJson: line });
        }
        continue;
      }

      const term = findHeaderTerminator(this.buffer);
      if (!term) {
        if (!eof) {
          break;
        }
        this.buffer = Buffer.alloc(0);
        frames.push({ framing: 'content-length', parseError: true });
        break;
      }

      const headersRaw = this.buffer.subarray(0, term.index).toString('latin1');
      const lenMatch = /(?:^|\r?\n)\s*content-length\s*:\s*(\d+)\s*(?=\r?\n|$)/i.exec(headersRaw);
      const contentLength = lenMatch?.[1] ? Number.parseInt(lenMatch[1], 10) : Number.NaN;
      const bodyStart = term.index + term.length;

      if (
        !Number.isSafeInteger(contentLength) ||
        contentLength < 0 ||
        contentLength > MAX_CONTENT_LENGTH_BYTES
      ) {
        this.buffer = this.buffer.subarray(bodyStart);
        frames.push({ framing: 'content-length', parseError: true });
        continue;
      }

      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) {
        if (!eof) {
          break;
        }
        this.buffer = Buffer.alloc(0);
        frames.push({ framing: 'content-length', parseError: true });
        break;
      }

      const rawJson = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
      this.buffer = this.buffer.subarray(bodyEnd);
      frames.push({ framing: 'content-length', rawJson });
    }

    return frames;
  }
}

function makeToolError(message: string): McpToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ ok: false, error: message }, null, 2),
      },
    ],
    isError: true,
  };
}

function makeToolSuccess(payload: unknown): McpToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function parseExplicitUuidArg(args: Record<string, unknown>): { provided: boolean; uuid: string | null } {
  if (!Object.hasOwn(args, 'conversationId') || args.conversationId === undefined || args.conversationId === null) {
    return { provided: false, uuid: null };
  }
  if (typeof args.conversationId !== 'string') {
    throw new RangeError('Invalid conversationId: expected 36-character UUID string');
  }
  const trimmed = args.conversationId.trim();
  if (!trimmed) {
    return { provided: false, uuid: null };
  }
  if (!isValidUuid(trimmed)) {
    throw new RangeError('Invalid conversationId: expected 36-character UUID');
  }
  return { provided: true, uuid: trimmed };
}

function resolveTreeNodes(
  nodesByCascadeId: Record<string, CascadeNodeView>,
  targetCid: string | null
): { activeNode: CascadeNodeView | null; treeNodes: CascadeNodeView[] } {
  const allNodes = Object.values(nodesByCascadeId);
  if (allNodes.length === 0) {
    return { activeNode: null, treeNodes: [] };
  }

  const activeNode = targetCid ? (nodesByCascadeId[targetCid] ?? null) : null;
  const rootId = activeNode?.rootCascadeId ?? targetCid;
  if (!rootId) {
    return { activeNode: null, treeNodes: [] };
  }

  const matching = allNodes.filter((n) => n.rootCascadeId === rootId || n.cascadeId === rootId);
  if (matching.length === 0) {
    return { activeNode, treeNodes: activeNode ? [activeNode] : [] };
  }

  const ordered: CascadeNodeView[] = [];
  const seen = new Set<string>();
  const visit = (cid: string) => {
    if (seen.has(cid)) return;
    const node = nodesByCascadeId[cid];
    if (!node || (node.rootCascadeId !== rootId && node.cascadeId !== rootId)) {
      return;
    }
    seen.add(cid);
    ordered.push(node);
    for (const childId of node.childrenIds ?? []) {
      visit(childId);
    }
  };
  visit(rootId);

  const remaining = matching
    .filter((n) => !seen.has(n.cascadeId))
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      const aSpawn = a.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
      const bSpawn = b.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
      if (aSpawn !== bSpawn) return aSpawn - bSpawn;
      return a.cascadeId < b.cascadeId ? -1 : a.cascadeId > b.cascadeId ? 1 : 0;
    });

  return {
    activeNode: activeNode ?? ordered[0] ?? remaining[0] ?? null,
    treeNodes: [...ordered, ...remaining],
  };
}

function pickFallbackConversationId(
  snapshot: LiveSnapshotFile | null,
  nodesByCascadeId: Record<string, CascadeNodeView>
): string | null {
  if (snapshot?.activeConversationId && isValidUuid(snapshot.activeConversationId)) {
    if (Object.keys(nodesByCascadeId).length === 0 || nodesByCascadeId[snapshot.activeConversationId]) {
      return snapshot.activeConversationId;
    }
  }

  const allNodes = Object.values(nodesByCascadeId);
  if (allNodes.length === 0) {
    return snapshot?.activeConversationId ?? null;
  }

  const byModDesc = (a: CascadeNodeView, b: CascadeNodeView) => {
    const aMs = Date.parse(a.lastModifiedTime) || 0;
    const bMs = Date.parse(b.lastModifiedTime) || 0;
    if (bMs !== aMs) return bMs - aMs;
    return a.cascadeId < b.cascadeId ? -1 : a.cascadeId > b.cascadeId ? 1 : 0;
  };

  const runningNode = allNodes
    .filter(
      (n) =>
        n.status === 'CASCADE_RUN_STATUS_RUNNING' ||
        (n.phase !== 'IDLE' && n.phase !== 'ERROR_OR_QUOTA')
    )
    .sort(byModDesc)[0];
  if (runningNode) {
    return runningNode.cascadeId;
  }

  const latestRoot = allNodes
    .filter((n) => n.parentCascadeId === null || n.kind === 'root')
    .sort(byModDesc)[0];
  if (latestRoot) {
    return latestRoot.cascadeId;
  }

  return allNodes.sort(byModDesc)[0]?.cascadeId ?? null;
}

function buildCatalogFromMapFile(mapFile: ModelMapFile | null): ModelCatalog {
  if (!mapFile || !mapFile.modelsByEnum) {
    return buildModelCatalog(null);
  }
  const modelsById: ModelCatalog['modelsById'] = {};
  for (const entry of Object.values(mapFile.modelsByEnum)) {
    if (entry?.modelId) {
      modelsById[entry.modelId] = entry;
    }
  }
  return {
    defaultModelEnum: mapFile.defaultModelEnum ?? null,
    modelsByEnum: mapFile.modelsByEnum,
    modelsById,
  };
}

function isRunningSummary(summary: TrajectorySummaryRaw | undefined): boolean {
  return summary?.status === 'CASCADE_RUN_STATUS_RUNNING';
}

export async function loadMcpTelemetry(
  options: {
    explicitConversationId?: string | null;
    metaConversationId?: unknown;
    context?: McpServerContext;
  } = {}
): Promise<LoadedMcpTelemetry> {
  const env = options.context?.env ?? process.env;
  const nowMs = options.context?.nowMs ? options.context.nowMs() : Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const paths = getStatePaths(options.context?.stateDir);
  const config = loadConfig(paths.stateDir);
  const antigravityDataDir =
    options.context?.antigravityDataDir?.trim() ||
    env.ANTIGRAVITY_DATA_DIR?.trim() ||
    path.join(os.homedir(), '.gemini', 'antigravity');

  const snapshot = readJsonSafe<LiveSnapshotFile | null>(paths.liveSnapshot, null);
  const quotaCache = readJsonSafe<QuotaCacheFile | null>(paths.quotaCache, null);
  const modelMap = readJsonSafe<ModelMapFile | null>(paths.modelMap, null);

  let nodesByCascadeId: Record<string, CascadeNodeView> =
    snapshot && isPlainRecord(snapshot.nodesByCascadeId) ? snapshot.nodesByCascadeId : {};
  let quota: QuotaSummaryView | null = snapshot?.quota ?? quotaCache?.quota ?? null;
  let hostConnected = Boolean(snapshot?.hostConnected);
  let liveRefreshSucceeded = false;
  const warnings: string[] = [];

  // Resolve preferred conversation ID before optional live LS queries (tiers 1..4)
  const metaCidRaw =
    typeof options.metaConversationId === 'string' ? options.metaConversationId.trim() : '';
  const envCidRaw = typeof env.ANTIGRAVITY_CONVERSATION_ID === 'string'
    ? env.ANTIGRAVITY_CONVERSATION_ID.trim()
    : '';

  const preferredCid =
    (options.explicitConversationId && isValidUuid(options.explicitConversationId)
      ? options.explicitConversationId
      : null) ??
    (metaCidRaw && isValidUuid(metaCidRaw) ? metaCidRaw : null) ??
    (envCidRaw && isValidUuid(envCidRaw) ? envCidRaw : null);

  const lsAddress = env.ANTIGRAVITY_LS_ADDRESS?.trim() || '';
  const lsCsrf = env.ANTIGRAVITY_CSRF_TOKEN?.trim() || '';

  if (lsAddress && lsCsrf) {
    const lsClient = new ReadOnlyLsClient({
      address: lsAddress,
      csrfToken: lsCsrf,
      timeoutMs: LS_RPC_TIMEOUT_MS,
    });
    if (lsClient.isConfigured()) {
      const [modelRes, quotaRes, trajRes] = await Promise.allSettled([
        lsClient.getCascadeModelConfigData(),
        lsClient.retrieveUserQuotaSummary(),
        lsClient.getAllCascadeTrajectories(),
      ]);

      const catalog =
        modelRes.status === 'fulfilled'
          ? buildModelCatalog(modelRes.value)
          : buildCatalogFromMapFile(modelMap);

      let trajectories: Record<string, TrajectorySummaryRaw> = {};
      if (trajRes.status === 'fulfilled') {
        trajectories = trajRes.value.trajectorySummaries ?? {};
        liveRefreshSucceeded = true;
        hostConnected = true;
      }

      if (quotaRes.status === 'fulfilled') {
        const normalized = normalizeQuotaSummary(
          quotaRes.value,
          quotaCache,
          Object.keys(trajectories),
          generatedAt
        );
        quota = normalized.quota;
        liveRefreshSucceeded = true;
        hostConnected = true;
      }

      const trajIds = Object.keys(trajectories);
      if (trajIds.length > 0) {
        const prioritizedIds = [...trajIds]
          .sort((a, b) => {
            if (preferredCid) {
              if (a === preferredCid) return -1;
              if (b === preferredCid) return 1;
            }
            const aRun = isRunningSummary(trajectories[a]) ? 1 : 0;
            const bRun = isRunningSummary(trajectories[b]) ? 1 : 0;
            if (bRun !== aRun) return bRun - aRun;
            const aMod = Date.parse(trajectories[a]?.lastModifiedTime ?? '') || 0;
            const bMod = Date.parse(trajectories[b]?.lastModifiedTime ?? '') || 0;
            return bMod - aMod;
          })
          .slice(0, MAX_LIVE_META_CASCADES);

        const generatorMetadataByCascade: Record<string, GeneratorMetadataEntryRaw[]> = {};
        const stepsByCascade: Record<string, TrajectoryStepRaw[]> = {};

        await Promise.all(
          prioritizedIds.map(async (cid) => {
            const summary = trajectories[cid];
            const metaPromise = lsClient
              .getCascadeTrajectoryGeneratorMetadata(cid)
              .then((res) => {
                generatorMetadataByCascade[cid] = res.generatorMetadata ?? [];
              })
              .catch(() => {});

            // L-004: Call GetCascadeTrajectorySteps ONLY when status === CASCADE_RUN_STATUS_RUNNING
            const stepsPromise = isRunningSummary(summary)
              ? lsClient
                  .getCascadeTrajectorySteps(cid, summary?.stepCount ?? 0)
                  .then((res) => {
                    stepsByCascade[cid] = res.steps ?? [];
                  })
                  .catch(() => {})
              : Promise.resolve();

            await Promise.all([metaPromise, stepsPromise]);
          })
        );

        const topo = buildTopologyGraph({
          antigravityDataDir,
          trajectories,
          generatorMetadataByCascade,
          stepsByCascade,
          modelCatalog: catalog,
          quotaBaselines: quotaCache?.cascadeBaselines,
          prevNodesByCascadeId: nodesByCascadeId,
          smartThresholds: config.smartThresholds,
          lsConnected: true,
          nowMs,
          enableSqliteFallback: false,
        });
        if (Object.keys(topo.nodesByCascadeId).length > 0) {
          nodesByCascadeId = topo.nodesByCascadeId;
        }
      }
    }
  }

  let staleAgeMs: number | null = null;
  let stale = false;
  if (!liveRefreshSucceeded) {
    const parsedUpdatedAt = snapshot?.updatedAt ? Date.parse(snapshot.updatedAt) : Number.NaN;
    staleAgeMs = Number.isFinite(parsedUpdatedAt) ? Math.max(0, nowMs - parsedUpdatedAt) : null;
    stale =
      snapshot === null ||
      !snapshot.hostConnected ||
      staleAgeMs === null ||
      !Number.isFinite(staleAgeMs) ||
      staleAgeMs > STALE_THRESHOLD_MS;
  } else {
    staleAgeMs = 0;
    stale = false;
  }

  const conversationId =
    preferredCid ?? pickFallbackConversationId(snapshot, nodesByCascadeId);
  const { activeNode, treeNodes } = resolveTreeNodes(nodesByCascadeId, conversationId);
  const allNodes = Object.values(nodesByCascadeId);

  if (quota && quotaCache?.cascadeBaselines && treeNodes.length > 0) {
    let hasBaseline = false;
    let sum = 0;
    for (const node of treeNodes) {
      const b = quotaCache.cascadeBaselines[node.cascadeId];
      if (b) {
        hasBaseline = true;
        sum += Math.max(0, b.delta5hPct);
      }
    }
    if (hasBaseline) {
      quota = {
        ...quota,
        treeNetDelta5hPct: Math.round(sum * 1e8) / 1e8,
      };
    }
  }

  const runningApexCount = (treeNodes.length > 0 ? treeNodes : allNodes).filter(
    (n) =>
      n.phase !== 'IDLE' &&
      n.phase !== 'ERROR_OR_QUOTA' &&
      n.servedModel.tier === 'apex'
  ).length;
  const g5hPct = quota?.gemini5h?.remainingPct ?? null;
  const smartBannerActive =
    runningApexCount >= config.smartThresholds.heavyConcurrentAlertCount &&
    (g5hPct ?? 100) < config.smartThresholds.heavyQuotaThresholdPct;

  const smartGovernanceBanner: SmartGovernanceBanner | null = smartBannerActive
    ? {
        active: true,
        heavyConcurrentCount: runningApexCount,
        gemini5hRemainingPct: g5hPct,
        estimatedBurnPctPerMin: quota?.burnRate5hPctPerMin ?? null,
        message: `Smart Governance: ${runningApexCount} concurrent apex nodes active at ${g5hPct !== null ? g5hPct.toFixed(1) : '—'}% 5h quota.`,
      }
    : null;

  return {
    nowMs,
    generatedAt,
    hostConnected,
    stale,
    staleAgeMs,
    conversationId,
    activeNode,
    treeNodes,
    allNodes,
    quota,
    smartGovernanceBanner,
    config,
    warnings,
  };
}

export function evaluateComputeBudget(params: {
  telemetry: LoadedMcpTelemetry;
  plannedSubagentCount?: number;
  taskKind?: 'exploration' | 'coding' | 'review' | 'general';
}): ComputeBudgetAdvice {
  const { telemetry, plannedSubagentCount, taskKind } = params;
  const g5h = telemetry.quota?.gemini5h?.remainingPct ?? null;
  const gWk = telemetry.quota?.geminiWeekly?.remainingPct ?? null;
  const p3 = telemetry.quota?.thirdParty5h?.remainingPct ?? null;
  const resetInLabel = telemetry.quota?.gemini5h?.resetInLabel ?? null;

  const scopeNodes = telemetry.treeNodes.length > 0 ? telemetry.treeNodes : telemetry.allNodes;
  const runningApexNodes = scopeNodes.filter(
    (n) =>
      n.phase !== 'IDLE' &&
      n.phase !== 'ERROR_OR_QUOTA' &&
      n.servedModel.tier === 'apex'
  ).length;

  const planned = plannedSubagentCount ?? 0;
  const projectedHeavyCount = runningApexNodes + planned;

  let recommendedSubagentModel: ComputeBudgetAdvice['recommendedSubagentModel'] = 'inherit';
  let reason = '';

  if (g5h !== null && g5h < 25) {
    recommendedSubagentModel = 'flash';
    reason = `Gemini 5h quota is ${g5h.toFixed(1)}% (< 25%); downgrade non-critical subagents to flash.`;
  } else if (runningApexNodes >= 3 && (g5h ?? 100) < 40) {
    recommendedSubagentModel = 'flash';
    reason = `Smart Governance: ${runningApexNodes} concurrent apex nodes running with Gemini 5h quota at ${(g5h ?? 0).toFixed(1)}% (< 40%); use flash for subagents.`;
  } else if (taskKind === 'exploration' && g5h !== null && g5h < 45) {
    recommendedSubagentModel = 'flash';
    reason = `Exploration task under moderate Gemini 5h quota (${g5h.toFixed(1)}% < 45%); use flash for fast low-cost retrieval.`;
  } else if (
    (planned >= 4 && (g5h ?? 100) < 55) ||
    (projectedHeavyCount >= 5 && (g5h ?? 100) < 50)
  ) {
    recommendedSubagentModel = 'flash';
    reason = `Heavy subagent fan-out (${planned} planned, ${runningApexNodes} active apex) with Gemini 5h quota at ${g5h !== null ? g5h.toFixed(1) : 'unknown'}%; use flash.`;
  } else if (g5h !== null && g5h < 45) {
    recommendedSubagentModel = 'argon';
    reason = `Gemini 5h quota is ${g5h.toFixed(1)}% (25%..45%); use argon for balanced cost and capability.`;
  } else if (g5h === null) {
    recommendedSubagentModel = 'inherit';
    reason = 'Live quota telemetry unavailable; defaulting to inherit.';
  } else {
    recommendedSubagentModel = 'inherit';
    reason = `Gemini 5h quota is healthy (${g5h.toFixed(1)}% >= 45%); safe to inherit active model.`;
  }

  const contextWindowPct = telemetry.activeNode
    ? Math.round(telemetry.activeNode.contextWindow.pct * 10) / 10
    : null;

  const warnings: string[] = [];
  if (g5h === null) {
    warnings.push('Live quota telemetry unavailable; defaulting to inherit');
  } else if (g5h < 20) {
    warnings.push(`CRITICAL: Gemini 5h quota critically low (${g5h.toFixed(1)}% < 20%).`);
  } else if (g5h < 25) {
    warnings.push(`Low Gemini 5h quota (${g5h.toFixed(1)}% < 25%); preserve budget with flash.`);
  }

  if (contextWindowPct !== null) {
    if (contextWindowPct > 85) {
      warnings.push(
        `Context window critical (${contextWindowPct.toFixed(1)}% > 85%); recommend /compact before spawning subagents.`
      );
    } else if (contextWindowPct > 70) {
      warnings.push(`Context window elevated (${contextWindowPct.toFixed(1)}% > 70%).`);
    }
  }

  if (!telemetry.hostConnected) {
    warnings.push('Host telemetry disconnected; using cached/offline state.');
  } else if (telemetry.stale) {
    warnings.push('Telemetry snapshot is stale (> 30s).');
  }

  return {
    generatedAt: telemetry.generatedAt,
    conversationId: telemetry.conversationId,
    activeModel: telemetry.activeNode
      ? {
          displayName: telemetry.activeNode.servedModel.displayName,
          responseModel:
            telemetry.activeNode.servedModel.responseModel ||
            telemetry.activeNode.servedModel.modelEnum,
          tier: telemetry.activeNode.servedModel.tier,
        }
      : null,
    contextWindowPct,
    quota: {
      gemini5hRemainingPct: g5h,
      geminiWeeklyRemainingPct: gWk,
      thirdParty5hRemainingPct: p3,
      resetInLabel,
    },
    recommendedSubagentModel,
    reason,
    warnings,
  };
}

function buildStatusCardSummary(telemetry: LoadedMcpTelemetry): string {
  const active = telemetry.activeNode;
  const g5h = telemetry.quota?.gemini5h;
  const quotaStr = g5h
    ? `Gemini 5h ${formatPct(g5h.remainingPct, 1)} (${g5h.resetInLabel})`
    : 'Gemini 5h —';

  if (!active) {
    const statusLabel = telemetry.hostConnected ? 'No active cascade' : 'Offline';
    return `Model Pulse · ${statusLabel} · ${quotaStr}`;
  }

  const activeSubagents = telemetry.treeNodes.filter(
    (n) =>
      n.cascadeId !== active.cascadeId &&
      n.phase !== 'IDLE' &&
      n.phase !== 'ERROR_OR_QUOTA'
  ).length;
  const phaseStr =
    active.phase === 'IDLE'
      ? 'IDLE'
      : `${active.phase} ${formatDurationCompact(active.phaseElapsedMs)}`;
  const modelPart = active.servedModel.responseModel
    ? `${active.servedModel.displayName} [${active.servedModel.responseModel}]`
    : active.servedModel.displayName;

  return [
    modelPart,
    phaseStr,
    `${activeSubagents} active subagent${activeSubagents === 1 ? '' : 's'}`,
    `CTX ${formatPct(active.contextWindow.pct, 1)}`,
    `Cache ${formatPct(active.cacheHitPct, 1)}`,
    quotaStr,
  ].join(' · ');
}

const ALLOWED_PREF_KEYS = new Set([
  'inlineStampMode',
  'hudSortMode',
  'timelineScope',
  'smartThresholds',
]);

async function handlePulseStatusCard(
  args: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  context: McpServerContext
): Promise<McpToolCallResult> {
  const { uuid: explicitCid } = parseExplicitUuidArg(args);

  let theme: CardThemeMode = 'auto';
  if (Object.hasOwn(args, 'theme') && args.theme !== undefined) {
    if (args.theme !== 'auto' && args.theme !== 'light' && args.theme !== 'dark') {
      return makeToolError('Invalid theme: expected auto | light | dark');
    }
    theme = args.theme;
  }

  let includeTree = true;
  if (Object.hasOwn(args, 'includeTree') && args.includeTree !== undefined) {
    if (typeof args.includeTree !== 'boolean') {
      return makeToolError('Invalid includeTree: expected boolean');
    }
    includeTree = args.includeTree;
  }

  const telemetry = await loadMcpTelemetry({
    explicitConversationId: explicitCid,
    metaConversationId: meta?.['antigravity.google/conversation_id'],
    context,
  });

  const cardWarnings = [...telemetry.warnings];
  if (!telemetry.hostConnected) {
    cardWarnings.push('Host telemetry disconnected; showing cached/offline state.');
  } else if (telemetry.stale) {
    cardWarnings.push('Telemetry snapshot is stale (> 30s).');
  }

  const persisted = writeStatusCardFile(
    {
      conversationId: telemetry.conversationId,
      generatedAt: telemetry.generatedAt,
      hostConnected: telemetry.hostConnected,
      stale: telemetry.stale,
      staleAgeMs: telemetry.staleAgeMs,
      activeNode: telemetry.activeNode,
      treeNodes: telemetry.treeNodes,
      quota: telemetry.quota,
      smartGovernanceBanner: telemetry.smartGovernanceBanner,
      warnings: cardWarnings,
      theme,
      includeTree,
    },
    {
      stateDir: context.stateDir,
      timestampMs: telemetry.nowMs,
    }
  );

  return makeToolSuccess({
    ok: true,
    conversationId: telemetry.conversationId,
    outputPath: persisted.outputPath,
    fileUri: persisted.fileUri,
    embedTag: `<agent-embed src="${persisted.fileUri}"></agent-embed>`,
    sidecarPill: SIDECAR_PILL_MARKDOWN,
    summary: buildStatusCardSummary(telemetry),
    hostConnected: telemetry.hostConnected,
    stale: telemetry.stale,
    nodeCount: telemetry.treeNodes.length,
  });
}

async function handlePulseGetComputeBudget(
  args: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
  context: McpServerContext
): Promise<McpToolCallResult> {
  const { uuid: explicitCid } = parseExplicitUuidArg(args);

  let plannedSubagentCount: number | undefined;
  if (Object.hasOwn(args, 'plannedSubagentCount') && args.plannedSubagentCount !== undefined) {
    if (
      typeof args.plannedSubagentCount !== 'number' ||
      !Number.isInteger(args.plannedSubagentCount) ||
      args.plannedSubagentCount < 0
    ) {
      return makeToolError('Invalid plannedSubagentCount: expected non-negative integer');
    }
    plannedSubagentCount = args.plannedSubagentCount;
  }

  let taskKind: 'exploration' | 'coding' | 'review' | 'general' | undefined;
  if (Object.hasOwn(args, 'taskKind') && args.taskKind !== undefined) {
    if (
      args.taskKind !== 'exploration' &&
      args.taskKind !== 'coding' &&
      args.taskKind !== 'review' &&
      args.taskKind !== 'general'
    ) {
      return makeToolError('Invalid taskKind: expected exploration | coding | review | general');
    }
    taskKind = args.taskKind;
  }

  const telemetry = await loadMcpTelemetry({
    explicitConversationId: explicitCid,
    metaConversationId: meta?.['antigravity.google/conversation_id'],
    context,
  });

  const advice = evaluateComputeBudget({
    telemetry,
    plannedSubagentCount,
    taskKind,
  });

  return makeToolSuccess(advice);
}

function handlePulseSetPreference(
  args: Record<string, unknown>,
  context: McpServerContext
): McpToolCallResult {
  const keys = Object.getOwnPropertyNames(args);
  if (keys.length === 0) {
    return makeToolError('At least one preference setting must be provided');
  }
  for (const key of keys) {
    if (!ALLOWED_PREF_KEYS.has(key)) {
      return makeToolError(`Unknown preference field: ${key}`);
    }
  }

  const validated = validateConfigPatch(args);
  const hasEffectiveSetting =
    validated.inlineStampMode !== undefined ||
    validated.hudSortMode !== undefined ||
    validated.timelineScope !== undefined ||
    (validated.smartThresholds !== undefined && Object.keys(validated.smartThresholds).length > 0);

  if (!hasEffectiveSetting) {
    return makeToolError('At least one recognized preference field must be provided');
  }

  const config = updateConfigPartial(validated, context.stateDir);
  return makeToolSuccess({
    ok: true,
    config,
    sidecarPill: SIDECAR_PILL_MARKDOWN,
  });
}

export async function dispatchToolCall(
  name: string,
  rawArgs: unknown,
  meta: Record<string, unknown> | undefined,
  context: McpServerContext = {}
): Promise<McpToolCallResult> {
  try {
    if (rawArgs !== undefined && rawArgs !== null && !isPlainRecord(rawArgs)) {
      return makeToolError('Tool arguments must be a JSON object');
    }
    const args = isPlainRecord(rawArgs) ? rawArgs : {};

    switch (name) {
      case 'pulse_status_card':
        return await handlePulseStatusCard(args, meta, context);
      case 'pulse_get_compute_budget':
        return await handlePulseGetComputeBudget(args, meta, context);
      case 'pulse_set_preference':
        return handlePulseSetPreference(args, context);
      default:
        return makeToolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof ConfigValidationError || err instanceof RangeError) {
      return makeToolError(err.message);
    }
    return makeToolError(err instanceof Error ? err.message : String(err));
  }
}

export async function handleJsonRpcMessage(
  parsed: unknown,
  context: McpServerContext = {}
): Promise<JsonRpcResponse | null> {
  if (!isPlainRecord(parsed)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  const rawId = Object.hasOwn(parsed, 'id') ? parsed.id : undefined;
  const responseId: string | number | null =
    typeof rawId === 'string' || typeof rawId === 'number' || rawId === null ? rawId : null;
  const hasId = rawId !== undefined && rawId !== null;

  if (parsed.jsonrpc !== undefined && parsed.jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: responseId,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  if (typeof parsed.method !== 'string' || parsed.method.trim() === '') {
    return {
      jsonrpc: '2.0',
      id: responseId,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  const method = parsed.method;
  const params = isPlainRecord(parsed.params) ? parsed.params : {};

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
    return null;
  }

  if (!hasId) {
    return null;
  }

  switch (method) {
    case 'initialize': {
      const reqVersion =
        typeof params.protocolVersion === 'string' && params.protocolVersion.trim()
          ? params.protocolVersion.trim()
          : DEFAULT_PROTOCOL_VERSION;
      return {
        jsonrpc: '2.0',
        id: rawId as string | number,
        result: {
          protocolVersion: reqVersion,
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            version: MCP_SERVER_VERSION,
          },
        },
      };
    }

    case 'ping': {
      return {
        jsonrpc: '2.0',
        id: rawId as string | number,
        result: {},
      };
    }

    case 'tools/list': {
      return {
        jsonrpc: '2.0',
        id: rawId as string | number,
        result: {
          tools: MCP_TOOL_DEFINITIONS,
        },
      };
    }

    case 'tools/call': {
      const toolName = typeof params.name === 'string' ? params.name : '';
      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id: rawId as string | number,
          result: makeToolError('Missing required parameter: params.name'),
        };
      }
      const meta = isPlainRecord(params._meta) ? params._meta : undefined;
      const result = await dispatchToolCall(toolName, params.arguments, meta, context);
      return {
        jsonrpc: '2.0',
        id: rawId as string | number,
        result,
      };
    }

    default: {
      return {
        jsonrpc: '2.0',
        id: rawId as string | number,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
    }
  }
}

export function startMcpServer(context: McpServerContext = {}): void {
  const decoder = new McpFrameDecoder();
  let queue: Promise<void> = Promise.resolve();

  const processFrames = (frames: DecodedFrame[]): void => {
    for (const frame of frames) {
      queue = queue.then(async () => {
        if (frame.parseError) {
          const errPayload: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          };
          process.stdout.write(serializeJsonRpcMessage(errPayload, frame.framing));
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(frame.rawJson ?? '');
        } catch {
          const errPayload: JsonRpcResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: 'Parse error' },
          };
          process.stdout.write(serializeJsonRpcMessage(errPayload, frame.framing));
          return;
        }

        const response = await handleJsonRpcMessage(parsed, context);
        if (response !== null) {
          process.stdout.write(serializeJsonRpcMessage(response, frame.framing));
        }
      });
    }
  };

  process.stdin.on('data', (chunk: Buffer | string) => {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    const frames = decoder.push(buf, false);
    processFrames(frames);
  });

  process.stdin.on('end', () => {
    const remaining = decoder.flushEnd();
    processFrames(remaining);
  });
}

const isMcpEntrypoint =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module &&
  typeof require.main?.filename === 'string' &&
  /(?:^|[\\/])(?:server|mcp)\.(?:c?js|mjs|ts)$/i.test(require.main.filename);

if (isMcpEntrypoint) {
  startMcpServer();
}
