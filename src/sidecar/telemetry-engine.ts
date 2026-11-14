import {
  closeSync,
  existsSync,
  type FSWatcher,
  openSync,
  readSync,
  statSync,
  watch,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeHudSemanticEtag,
  computeDeterministicEtag,
  isEtagMatch,
  makeUnchangedResponse,
} from '../core/etag';
import { buildFleetSnapshot } from '../core/fleet-builder';
import { toIntToken } from '../core/formatters';
import { buildModelCatalog, type ModelCatalog } from '../core/model-catalog';
import {
  type CascadeActivitySignal,
  evaluateSmartGovernanceBanner,
  normalizeQuotaSummary,
  type QuotaBurnSample,
} from '../core/quota-calculator';
import { buildTimelineTurns } from '../core/timeline-builder';
import { buildBreadcrumb, buildTopologyGraph, type TopologyBuildOutput } from '../core/topology-builder';
import { ReadOnlyLsClient } from '../rpc/ls-client';
import { loadConfig, updateConfigPartial } from '../state/config-store';
import {
  type CascadeQuotaBaseline,
  ensureStateDir,
  getStatePaths,
  isValidUuid,
  type LiveSnapshotFile,
  type ModelMapFile,
  type QuotaCacheFile,
  readJsonSafe,
  RING_MAX_BYTES,
  rotateRingIfNeeded,
  type StateDirPaths,
  writeJsonAtomic,
} from '../state/state-dir';
import type {
  GeneratorMetadataEntryRaw,
  GetAllCascadeTrajectoriesResponse,
  GetCascadeModelConfigDataResponse,
  GetCascadeTrajectoryGeneratorMetadataResponse,
  GetCascadeTrajectoryStepsResponse,
  RetrieveUserQuotaSummaryResponse,
  TrajectoryStepRaw,
  TrajectorySummaryRaw,
} from '../types/rpc';
import type {
  CascadeNodeView,
  FleetSnapshotResponse,
  HookRingEvent,
  HudSnapshotResponse,
  PulseUserConfig,
  QuotaSummaryView,
  TimelineSnapshotResponse,
  UnchangedEtagResponse,
} from '../types/telemetry';

export interface LsClientLike {
  isConfigured(): boolean;
  getCascadeModelConfigData(): Promise<GetCascadeModelConfigDataResponse>;
  retrieveUserQuotaSummary(): Promise<RetrieveUserQuotaSummaryResponse>;
  getAllCascadeTrajectories(): Promise<GetAllCascadeTrajectoriesResponse>;
  getCascadeTrajectoryGeneratorMetadata(
    cascadeId: string
  ): Promise<GetCascadeTrajectoryGeneratorMetadataResponse>;
  getCascadeTrajectorySteps(
    cascadeId: string,
    stepCount: number
  ): Promise<GetCascadeTrajectoryStepsResponse>;
}

export interface TelemetryEngineOptions {
  lsClient?: LsClientLike;
  stateDir?: string;
  statePaths?: StateDirPaths;
  antigravityDataDir?: string;
  initialConfig?: Partial<PulseUserConfig>;
  onWarning?: (message: string) => void;
  enableSqliteFallback?: boolean;
}

const RECENT_REQUEST_TTL_MS = 60_000;
const RECENT_HOOK_ACTIVITY_WINDOW_MS = 5_000;
const HOOK_EVENT_RETENTION_MS = 120_000;
const BURN_SAMPLE_RETENTION_MS = 10 * 60 * 1000;
const MAX_HOOKS_PER_CASCADE = 32;
const FS_WATCH_DEBOUNCE_MS = 50;
const MAX_CONCURRENT_META_RPCS = 6;

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

function stripVolatileFleetFields(
  fleet: Omit<FleetSnapshotResponse, 'etag' | 'generatedAt' | 'unchanged'>
) {
  const { fetchedAt: _ignoredFetchedAt, ...stableQuota } = fleet.quota;
  return {
    hostConnected: fleet.hostConnected,
    activeHeadline: fleet.activeHeadline,
    projects: fleet.projects.map((project) => ({
      ...project,
      trees: project.trees.map((tree) => {
        const { elapsedMs: _ignoredElapsed, nodes, ...restTree } = tree;
        return {
          ...restTree,
          nodes: nodes.map((node) => {
            const { phaseElapsedMs: _ignoredNodeElapsed, ...restNode } = node;
            return restNode;
          }),
        };
      }),
    })),
    topQuotaBurners: fleet.topQuotaBurners,
    quota: stableQuota,
  };
}

function createEmptyQuotaSummary(fetchedAt = new Date(0).toISOString()): QuotaSummaryView {
  return {
    fetchedAt,
    buckets: [],
    gemini5h: null,
    geminiWeekly: null,
    thirdParty5h: null,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: null,
    burnRate5hPctPerMin: null,
  };
}

function sumGeneratorTokens(entries: GeneratorMetadataEntryRaw[] | undefined): number {
  if (!entries || entries.length === 0) {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const usage = entry.chatModel?.usage;
    if (!usage) continue;
    total += toIntToken(usage.inputTokens) + toIntToken(usage.outputTokens);
  }
  return total;
}

export class TelemetryEngine {
  private readonly lsClient: LsClientLike;
  private readonly statePaths: StateDirPaths;
  private readonly antigravityDataDir: string;
  private readonly onWarning?: (message: string) => void;
  private readonly enableSqliteFallback: boolean;
  private readonly initialConfigPatch?: Partial<PulseUserConfig>;

  private config: PulseUserConfig;
  private started = false;
  private stopped = false;

  private pollTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private watcher: FSWatcher | null = null;

  private inFlightRefresh: Promise<void> | null = null;
  private pendingRefresh = false;

  private ringByteOffset = 0;
  private hooksByCascade = new Map<string, HookRingEvent[]>();
  private lastHookEventTsMs = 0;
  private latestHookCid: string | null = null;

  private hostConnected = false;
  private warnings: string[] = [];

  private modelCatalog: ModelCatalog = buildModelCatalog(null);
  private lastModelConfigAtMs = 0;

  private trajectories: Record<string, TrajectorySummaryRaw> = {};
  private prevStatuses: Record<string, string | undefined> = {};
  private cachedGenMetaStepCount: Record<string, number> = {};
  private generatorMetadataByCascade: Record<string, GeneratorMetadataEntryRaw[]> = {};
  private stepsByCascade: Record<string, TrajectoryStepRaw[]> = {};
  private prevTokensByCascade: Record<string, number> = {};

  private quotaCache: QuotaCacheFile;
  private lastQuotaAtMs = 0;
  private lastQuotaRaw: RetrieveUserQuotaSummaryResponse | null = null;
  private burnSamples: QuotaBurnSample[] = [];

  private topology: TopologyBuildOutput = {
    nodesByCascadeId: {},
    rootByCascadeId: {},
    treesByRootId: {},
    warnings: [],
  };

  private lastRequestedCid: string | null = null;
  private lastRequestedCidAtMs = 0;
  private activeConversationId: string | null = null;
  private lastPersistedModelKey = '';
  private lastConfigSignature = '';
  private turnDeltaQuotaByKey: Record<string, number> = {};

  constructor(options: TelemetryEngineOptions = {}) {
    this.lsClient = options.lsClient ?? new ReadOnlyLsClient();
    this.statePaths = options.statePaths ?? getStatePaths(options.stateDir);
    this.antigravityDataDir =
      options.antigravityDataDir?.trim() ||
      process.env.ANTIGRAVITY_DATA_DIR?.trim() ||
      path.join(os.homedir(), '.gemini', 'antigravity');
    this.onWarning = options.onWarning;
    this.enableSqliteFallback = Boolean(options.enableSqliteFallback);
    this.initialConfigPatch = options.initialConfig;

    this.config = loadConfig(this.statePaths.stateDir);
    this.recordCurrentConfigSignature();
    this.quotaCache = {
      schemaVersion: 1,
      updatedAt: new Date(0).toISOString(),
      quota: createEmptyQuotaSummary(),
      cascadeBaselines: {},
    };
  }

  private recordCurrentConfigSignature(): void {
    try {
      if (!existsSync(this.statePaths.configPath)) {
        this.lastConfigSignature = '';
        return;
      }
      const st = statSync(this.statePaths.configPath);
      this.lastConfigSignature = `${st.mtimeMs}:${st.size}`;
    } catch {
      // Ignore stat errors
    }
  }

  private syncConfigIfModified(): void {
    try {
      if (!existsSync(this.statePaths.configPath)) {
        return;
      }
      const st = statSync(this.statePaths.configPath);
      const sig = `${st.mtimeMs}:${st.size}`;
      if (sig !== this.lastConfigSignature) {
        this.lastConfigSignature = sig;
        this.config = loadConfig(this.statePaths.stateDir);
      }
    } catch {
      // Keep current config on transient stat error
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.stopped = false;
    this.started = true;

    ensureStateDir(this.statePaths.stateDir);
    if (this.initialConfigPatch) {
      this.config = updateConfigPartial(this.initialConfigPatch, this.statePaths.stateDir);
    } else {
      this.config = loadConfig(this.statePaths.stateDir);
    }
    this.recordCurrentConfigSignature();

    this.hydratePersistedCaches();
    await this.refreshOnce();
    this.startWatcher();
    this.scheduleNextPoll();
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // Ignore watcher shutdown errors
      }
      this.watcher = null;
    }
  }

  private hydratePersistedCaches(): void {
    const savedModels = readJsonSafe<ModelMapFile | null>(this.statePaths.modelMap, null);
    if (savedModels && savedModels.schemaVersion === 1 && savedModels.modelsByEnum) {
      const modelsById: ModelCatalog['modelsById'] = {};
      for (const entry of Object.values(savedModels.modelsByEnum)) {
        if (entry?.modelId) {
          modelsById[entry.modelId] = entry;
        }
      }
      this.modelCatalog = {
        defaultModelEnum: savedModels.defaultModelEnum ?? null,
        modelsByEnum: savedModels.modelsByEnum,
        modelsById,
      };
      this.lastPersistedModelKey = JSON.stringify({
        defaultModelEnum: this.modelCatalog.defaultModelEnum,
        modelsByEnum: this.modelCatalog.modelsByEnum,
      });
    }

    const savedQuota = readJsonSafe<QuotaCacheFile | null>(this.statePaths.quotaCache, null);
    if (savedQuota && savedQuota.schemaVersion === 1 && savedQuota.quota) {
      this.quotaCache = {
        schemaVersion: 1,
        updatedAt: savedQuota.updatedAt ?? new Date(0).toISOString(),
        quota: savedQuota.quota,
        cascadeBaselines: savedQuota.cascadeBaselines ?? {},
      };
    }
  }

  private emitWarning(message: string): void {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
    this.onWarning?.(message);
  }

  private startWatcher(): void {
    if (this.stopped || this.watcher) {
      return;
    }
    try {
      this.watcher = watch(this.statePaths.stateDir, (_eventType, filename) => {
        const name = filename ? String(filename) : '';
        if (name && name !== 'events.ring.jsonl' && name !== 'config.json') {
          return;
        }
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          if (name === 'config.json') {
            this.config = loadConfig(this.statePaths.stateDir);
            this.recordCurrentConfigSignature();
          }
          void this.refreshOnce().catch((err) => {
            this.emitWarning(`State watcher refresh error: ${err instanceof Error ? err.message : String(err)}`);
          });
        }, FS_WATCH_DEBOUNCE_MS);
      });
    } catch (err) {
      this.emitWarning(
        `fs.watch unavailable (${err instanceof Error ? err.message : String(err)}); falling back to polling`
      );
    }
  }

  private scheduleNextPoll(): void {
    if (this.stopped || !this.started) {
      return;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    const hasRunning = Object.values(this.trajectories).some(
      (s) => s.status === 'CASCADE_RUN_STATUS_RUNNING'
    );
    const hasRecentHook = Date.now() - this.lastHookEventTsMs < RECENT_HOOK_ACTIVITY_WINDOW_MS;
    const intervalMs =
      hasRunning || hasRecentHook
        ? this.config.pollIntervalsMs.active
        : this.config.pollIntervalsMs.idle;

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.refreshOnce()
        .catch((err) => {
          this.emitWarning(`Poll refresh error: ${err instanceof Error ? err.message : String(err)}`);
        })
        .finally(() => {
          this.scheduleNextPoll();
        });
    }, intervalMs);
  }

  async refreshOnce(nowMs = Date.now()): Promise<void> {
    if (this.inFlightRefresh) {
      this.pendingRefresh = true;
      await this.inFlightRefresh;
      return;
    }

    const run = async () => {
      try {
        await this.executeRefreshCycle(nowMs);
      } finally {
        this.inFlightRefresh = null;
      }
      if (this.pendingRefresh && !this.stopped) {
        this.pendingRefresh = false;
        await this.refreshOnce(Date.now());
      }
    };

    this.inFlightRefresh = run();
    await this.inFlightRefresh;
  }

  private tailEventsRing(nowMs: number): void {
    const ringPath = this.statePaths.eventsRing;
    if (!existsSync(ringPath)) {
      this.ringByteOffset = 0;
      return;
    }

    let size = 0;
    try {
      size = statSync(ringPath).size;
    } catch {
      return;
    }

    if (size < this.ringByteOffset) {
      this.ringByteOffset = 0;
    }

    if (size > this.ringByteOffset) {
      const bytesToRead = size - this.ringByteOffset;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const fd = openSync(ringPath, 'r');
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, buffer, 0, bytesToRead, this.ringByteOffset);
      } finally {
        closeSync(fd);
      }

      if (bytesRead > 0) {
        const slice = buffer.subarray(0, bytesRead);
        const lastNewlineIdx = slice.lastIndexOf(0x0a);
        if (lastNewlineIdx !== -1) {
          const completeChunk = slice.subarray(0, lastNewlineIdx + 1).toString('utf8');
          this.ringByteOffset += lastNewlineIdx + 1;
          for (const rawLine of completeChunk.split('\n')) {
            const trimmed = rawLine.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed) as HookRingEvent;
              if (event && typeof event.event === 'string' && typeof event.conversationId === 'string') {
                this.recordHookEvent(event);
              }
            } catch {
              // Ignore malformed JSON line gracefully
            }
          }
        }
      }
    }

    const rotation = rotateRingIfNeeded(this.statePaths.stateDir, RING_MAX_BYTES);
    if (rotation.rotated) {
      this.ringByteOffset = 0;
    }

    // Prune stale hook events
    const cutoff = nowMs - HOOK_EVENT_RETENTION_MS;
    for (const [cid, list] of this.hooksByCascade.entries()) {
      const kept = list.filter((ev) => ev.ts >= cutoff).slice(-MAX_HOOKS_PER_CASCADE);
      if (kept.length === 0) {
        this.hooksByCascade.delete(cid);
      } else {
        this.hooksByCascade.set(cid, kept);
      }
    }
  }

  private recordHookEvent(event: HookRingEvent): void {
    const cid = event.conversationId;
    if (event.ts > this.lastHookEventTsMs) {
      this.lastHookEventTsMs = event.ts;
      if (isValidUuid(cid)) {
        this.latestHookCid = cid;
      }
    }
    const existing = this.hooksByCascade.get(cid) ?? [];
    existing.push(event);
    if (existing.length > MAX_HOOKS_PER_CASCADE) {
      existing.splice(0, existing.length - MAX_HOOKS_PER_CASCADE);
    }
    this.hooksByCascade.set(cid, existing);
  }

  private collectRecentHookEvents(): HookRingEvent[] {
    const all: HookRingEvent[] = [];
    for (const list of this.hooksByCascade.values()) {
      all.push(...list);
    }
    all.sort((a, b) => a.ts - b.ts);
    return all;
  }

  private async refreshModelCatalog(nowMs: number): Promise<void> {
    const raw = await this.lsClient.getCascadeModelConfigData();
    this.modelCatalog = buildModelCatalog(raw);
    this.lastModelConfigAtMs = nowMs;

    const payload: ModelMapFile = {
      schemaVersion: 1,
      updatedAt: new Date(nowMs).toISOString(),
      defaultModelEnum: this.modelCatalog.defaultModelEnum,
      modelsByEnum: this.modelCatalog.modelsByEnum,
    };
    const serializedKey = JSON.stringify({
      defaultModelEnum: payload.defaultModelEnum,
      modelsByEnum: payload.modelsByEnum,
    });
    if (serializedKey !== this.lastPersistedModelKey) {
      this.lastPersistedModelKey = serializedKey;
      writeJsonAtomic(this.statePaths.modelMap, payload);
    }
  }

  private hasUnseenModelEnum(entries: GeneratorMetadataEntryRaw[]): boolean {
    for (const entry of entries) {
      const chat = entry.chatModel;
      if (!chat) continue;
      for (const candidate of [chat.customMetadata?.model_enum, chat.model]) {
        const trimmed = candidate?.trim();
        if (trimmed && !this.modelCatalog.modelsByEnum[trimmed] && !this.modelCatalog.modelsById[trimmed]) {
          return true;
        }
      }
    }
    return false;
  }

  private async executeRefreshCycle(nowMs: number): Promise<void> {
    this.warnings = [];
    this.tailEventsRing(nowMs);
    this.syncConfigIfModified();

    let anyStepIncremented = false;
    let anyRunningToIdle = false;
    const stepIncrementedCids = new Set<string>();
    const runningToIdleCids = new Set<string>();
    let modelConfigRefreshedThisCycle = false;
    let shouldRefreshQuotaNow = this.lastQuotaRaw === null ||
      nowMs - this.lastQuotaAtMs >= this.config.pollIntervalsMs.quota;

    if (!this.lsClient.isConfigured()) {
      this.hostConnected = false;
      this.emitWarning('Language Server not configured (ANTIGRAVITY_LS_ADDRESS / ANTIGRAVITY_CSRF_TOKEN missing)');
    } else {
      try {
        if (
          this.lastModelConfigAtMs === 0 ||
          nowMs - this.lastModelConfigAtMs >= this.config.pollIntervalsMs.modelConfig
        ) {
          await this.refreshModelCatalog(nowMs);
          modelConfigRefreshedThisCycle = true;
        }

        const trajResp = await this.lsClient.getAllCascadeTrajectories();
        const summaries = trajResp.trajectorySummaries ?? {};
        this.trajectories = summaries;
        this.hostConnected = true;

        const cidsToFetchMeta: string[] = [];
        const cidsToFetchSteps: Array<{ cid: string; stepCount: number }> = [];

        for (const [cid, summary] of Object.entries(summaries)) {
          const stepCount = typeof summary.stepCount === 'number' && Number.isFinite(summary.stepCount)
            ? summary.stepCount
            : 0;
          const prevStepCount = this.cachedGenMetaStepCount[cid];
          const prevStatus = this.prevStatuses[cid];
          const isRunning = summary.status === 'CASCADE_RUN_STATUS_RUNNING';

          if (prevStepCount !== undefined && stepCount > prevStepCount) {
            anyStepIncremented = true;
            stepIncrementedCids.add(cid);
          }
          if (prevStatus === 'CASCADE_RUN_STATUS_RUNNING' && !isRunning) {
            anyRunningToIdle = true;
            runningToIdleCids.add(cid);
          }
          this.prevStatuses[cid] = summary.status;

          if (!this.generatorMetadataByCascade[cid] || prevStepCount === undefined || stepCount > prevStepCount) {
            cidsToFetchMeta.push(cid);
          }
          if (isRunning) {
            cidsToFetchSteps.push({ cid, stepCount });
          } else {
            delete this.stepsByCascade[cid];
          }
        }

        // Remove step cache for vanished cascades
        for (const cachedCid of Object.keys(this.stepsByCascade)) {
          if (!summaries[cachedCid]) {
            delete this.stepsByCascade[cachedCid];
          }
        }

        cidsToFetchMeta.sort((a, b) => {
          const aRun = summaries[a]?.status === 'CASCADE_RUN_STATUS_RUNNING' ? 1 : 0;
          const bRun = summaries[b]?.status === 'CASCADE_RUN_STATUS_RUNNING' ? 1 : 0;
          if (bRun !== aRun) return bRun - aRun;
          const aMod = Date.parse(summaries[a]?.lastModifiedTime ?? '') || 0;
          const bMod = Date.parse(summaries[b]?.lastModifiedTime ?? '') || 0;
          return bMod - aMod;
        });

        let spottedUnseenModel = false;
        await runWithConcurrency(cidsToFetchMeta, MAX_CONCURRENT_META_RPCS, async (cid) => {
          try {
            const metaResp = await this.lsClient.getCascadeTrajectoryGeneratorMetadata(cid);
            const entries = metaResp.generatorMetadata ?? [];
            this.generatorMetadataByCascade[cid] = entries;
            this.cachedGenMetaStepCount[cid] = summaries[cid]?.stepCount ?? 0;
            if (this.hasUnseenModelEnum(entries)) {
              spottedUnseenModel = true;
            }
          } catch (err) {
            this.emitWarning(
              `GeneratorMetadata RPC failed for ${cid}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        });

        if (spottedUnseenModel && !modelConfigRefreshedThisCycle) {
          try {
            await this.refreshModelCatalog(nowMs);
          } catch (err) {
            this.emitWarning(
              `ModelConfig refresh failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        await Promise.all(
          cidsToFetchSteps.map(async ({ cid, stepCount }) => {
            try {
              const stepsResp = await this.lsClient.getCascadeTrajectorySteps(cid, stepCount);
              this.stepsByCascade[cid] = stepsResp.steps ?? [];
            } catch (err) {
              this.emitWarning(
                `TrajectorySteps RPC failed for ${cid}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          })
        );

        if (anyStepIncremented || anyRunningToIdle) {
          shouldRefreshQuotaNow = true;
        }

        if (shouldRefreshQuotaNow) {
          try {
            const quotaRaw = await this.lsClient.retrieveUserQuotaSummary();
            this.lastQuotaRaw = quotaRaw;
            this.lastQuotaAtMs = nowMs;

            const activeSignals: CascadeActivitySignal[] = [];
            for (const [cid, summary] of Object.entries(summaries)) {
              const isRunning = summary.status === 'CASCADE_RUN_STATUS_RUNNING';
              const stepInc = stepIncrementedCids.has(cid);
              const justFinished = runningToIdleCids.has(cid);
              const currentTokens = sumGeneratorTokens(this.generatorMetadataByCascade[cid]);
              const prevTokens = this.prevTokensByCascade[cid] ?? 0;
              const tokenDelta = Math.max(0, currentTokens - prevTokens);
              this.prevTokensByCascade[cid] = currentTokens;

              if (isRunning || stepInc || justFinished || tokenDelta > 0) {
                activeSignals.push({
                  cascadeId: cid,
                  isRunning: isRunning || justFinished,
                  stepCountIncremented: stepInc,
                  tokenDelta,
                });
              }
            }

            const nowIso = new Date(nowMs).toISOString();
            const preliminaryNormalized = normalizeQuotaSummary(
              quotaRaw,
              this.quotaCache,
              Object.keys(summaries),
              nowIso,
              this.burnSamples,
              activeSignals
            );
            const g5Fraction = preliminaryNormalized.quota.gemini5h?.remainingFraction;
            if (typeof g5Fraction === 'number' && Number.isFinite(g5Fraction)) {
              this.burnSamples.push({ tsMs: nowMs, remainingFraction: g5Fraction });
              const burnCutoff = nowMs - BURN_SAMPLE_RETENTION_MS;
              this.burnSamples = this.burnSamples.filter((s) => s.tsMs >= burnCutoff);
            }

            const finalNormalized = normalizeQuotaSummary(
              quotaRaw,
              this.quotaCache,
              Object.keys(summaries),
              nowIso,
              this.burnSamples,
              activeSignals
            );
            const prevBaselines = this.quotaCache.cascadeBaselines;
            for (const [cid, nextEntry] of Object.entries(finalNormalized.cascadeBaselines)) {
              const prevDelta = prevBaselines[cid]?.delta5hPct ?? 0;
              const deltaGain =
                Math.round(Math.max(0, nextEntry.delta5hPct - prevDelta) * 1e8) / 1e8;
              if (deltaGain <= 0) {
                continue;
              }
              const entries = this.generatorMetadataByCascade[cid];
              if (!entries || entries.length === 0) {
                continue;
              }
              let latestTurnKey: string | null = null;
              for (let i = entries.length - 1; i >= 0; i -= 1) {
                const entry = entries[i];
                if (!entry?.chatModel) continue;
                const indices = Array.isArray(entry.stepIndices)
                  ? entry.stepIndices.filter(
                      (n): n is number => typeof n === 'number' && Number.isFinite(n)
                    )
                  : [];
                latestTurnKey =
                  indices.length > 0 ? `${cid}:${Math.min(...indices)}` : `${cid}:${i}`;
                break;
              }
              if (latestTurnKey) {
                const prevTurnDelta = this.turnDeltaQuotaByKey[latestTurnKey] ?? 0;
                this.turnDeltaQuotaByKey[latestTurnKey] =
                  Math.round((prevTurnDelta + deltaGain) * 1e8) / 1e8;
              }
            }

            this.quotaCache = {
              schemaVersion: 1,
              updatedAt: nowIso,
              quota: finalNormalized.quota,
              cascadeBaselines: finalNormalized.cascadeBaselines,
            };
            writeJsonAtomic(this.statePaths.quotaCache, this.quotaCache);
          } catch (err) {
            this.emitWarning(
              `RetrieveUserQuotaSummary RPC failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      } catch (err) {
        this.hostConnected = false;
        this.emitWarning(
          `Language Server unreachable: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Build topology + state machine over latest RPC + hooks + brain/
    this.topology = buildTopologyGraph({
      antigravityDataDir: this.antigravityDataDir,
      trajectories: this.trajectories,
      generatorMetadataByCascade: this.generatorMetadataByCascade,
      stepsByCascade: this.stepsByCascade,
      recentHookEvents: this.collectRecentHookEvents(),
      modelCatalog: this.modelCatalog,
      quotaBaselines: this.quotaCache.cascadeBaselines,
      prevNodesByCascadeId: this.topology.nodesByCascadeId,
      smartThresholds: this.config.smartThresholds,
      lsConnected: this.hostConnected,
      nowMs,
      enableSqliteFallback: this.enableSqliteFallback,
    });
    for (const topoWarn of this.topology.warnings) {
      this.emitWarning(topoWarn);
    }

    this.activeConversationId = this.resolveActiveConversationId(null, nowMs);
    this.persistLiveSnapshot(nowMs);
  }

  private resolveActiveConversationId(requestedCid: string | null, nowMs: number): string | null {
    const nodes = this.topology.nodesByCascadeId;
    if (requestedCid && isValidUuid(requestedCid)) {
      if (
        nodes[requestedCid] ||
        this.trajectories[requestedCid] ||
        this.generatorMetadataByCascade[requestedCid]
      ) {
        return requestedCid;
      }
    }

    if (
      this.lastRequestedCid &&
      nowMs - this.lastRequestedCidAtMs <= RECENT_REQUEST_TTL_MS &&
      (nodes[this.lastRequestedCid] ||
        this.trajectories[this.lastRequestedCid] ||
        this.generatorMetadataByCascade[this.lastRequestedCid])
    ) {
      return this.lastRequestedCid;
    }

    if (
      this.latestHookCid &&
      (nodes[this.latestHookCid] ||
        this.trajectories[this.latestHookCid] ||
        this.generatorMetadataByCascade[this.latestHookCid])
    ) {
      return this.latestHookCid;
    }

    const allNodes = Object.values(nodes);
    const runningRoot = allNodes
      .filter((n) => n.parentCascadeId === null && n.status === 'CASCADE_RUN_STATUS_RUNNING')
      .sort((a, b) => Date.parse(b.lastModifiedTime) - Date.parse(a.lastModifiedTime))[0];
    if (runningRoot) {
      return runningRoot.cascadeId;
    }

    const latestRoot = allNodes
      .filter((n) => n.parentCascadeId === null)
      .sort((a, b) => Date.parse(b.lastModifiedTime) - Date.parse(a.lastModifiedTime))[0];
    if (latestRoot) {
      return latestRoot.cascadeId;
    }

    return allNodes[0]?.cascadeId ?? null;
  }

  private buildQuotaViewForTree(treeNodeIds: string[]): QuotaSummaryView {
    const uniqueIds = Array.from(new Set(treeNodeIds.filter(Boolean)));
    let treeNetDelta5hPct: number | null = null;
    if (uniqueIds.length > 0) {
      let hasBaseline = false;
      let sum = 0;
      for (const cid of uniqueIds) {
        const b = this.quotaCache.cascadeBaselines[cid];
        if (b) {
          hasBaseline = true;
          sum += Math.max(0, b.delta5hPct);
        }
      }
      if (hasBaseline) {
        treeNetDelta5hPct = Math.round(sum * 1e8) / 1e8;
      }
    }
    return {
      ...this.quotaCache.quota,
      treeNetDelta5hPct,
    };
  }

  private buildCurrentFleetSnapshot(nowMs: number): FleetSnapshotResponse {
    const fleetCore = buildFleetSnapshot({
      nowMs,
      hostConnected: this.hostConnected,
      trajectories: this.trajectories,
      nodesByCascadeId: this.topology.nodesByCascadeId,
      quota: this.quotaCache.quota,
      cascadeBaselines: this.quotaCache.cascadeBaselines,
    });
    const etag = computeDeterministicEtag(stripVolatileFleetFields(fleetCore));
    return {
      etag,
      ...fleetCore,
    };
  }

  private persistLiveSnapshot(nowMs: number): void {
    const nowIso = new Date(nowMs).toISOString();
    const activeCid = this.activeConversationId;
    const rootId = activeCid ? (this.topology.rootByCascadeId[activeCid] ?? activeCid) : null;
    const treeNodes = rootId ? (this.topology.treesByRootId[rootId] ?? []) : [];
    const quotaView = this.buildQuotaViewForTree(treeNodes.map((n) => n.cascadeId));

    const filePayload: LiveSnapshotFile = {
      schemaVersion: 1,
      updatedAt: nowIso,
      hostConnected: this.hostConnected,
      activeConversationId: activeCid,
      nodesByCascadeId: this.topology.nodesByCascadeId,
      fleet: this.buildCurrentFleetSnapshot(nowMs),
      quota: quotaView,
    };
    writeJsonAtomic(this.statePaths.liveSnapshot, filePayload);
  }

  getConfig(): PulseUserConfig {
    this.syncConfigIfModified();
    return this.config;
  }

  updateConfig(patch: unknown): PulseUserConfig {
    this.config = updateConfigPartial(patch, this.statePaths.stateDir);
    this.recordCurrentConfigSignature();
    // Re-evaluate context thresholds immediately against cached graph without waiting for next poll
    const nowMs = Date.now();
    this.topology = buildTopologyGraph({
      antigravityDataDir: this.antigravityDataDir,
      trajectories: this.trajectories,
      generatorMetadataByCascade: this.generatorMetadataByCascade,
      stepsByCascade: this.stepsByCascade,
      recentHookEvents: this.collectRecentHookEvents(),
      modelCatalog: this.modelCatalog,
      quotaBaselines: this.quotaCache.cascadeBaselines,
      prevNodesByCascadeId: this.topology.nodesByCascadeId,
      smartThresholds: this.config.smartThresholds,
      lsConnected: this.hostConnected,
      nowMs,
      enableSqliteFallback: this.enableSqliteFallback,
    });
    this.persistLiveSnapshot(nowMs);
    return this.config;
  }

  getHudSnapshot(
    conversationId: string | null,
    clientEtag?: string
  ): HudSnapshotResponse | UnchangedEtagResponse {
    const nowMs = Date.now();
    if (conversationId && isValidUuid(conversationId)) {
      this.lastRequestedCid = conversationId;
      this.lastRequestedCidAtMs = nowMs;
    }

    const effectiveCid = this.resolveActiveConversationId(conversationId, nowMs);
    const activeNode = effectiveCid ? (this.topology.nodesByCascadeId[effectiveCid] ?? null) : null;
    const rootCascadeId = effectiveCid
      ? (this.topology.rootByCascadeId[effectiveCid] ?? effectiveCid)
      : null;
    const treeNodes = rootCascadeId
      ? (this.topology.treesByRootId[rootCascadeId] ?? (activeNode ? [activeNode] : []))
      : [];
    const breadcrumb = buildBreadcrumb(
      rootCascadeId,
      effectiveCid,
      this.topology.nodesByCascadeId
    );
    const quota = this.buildQuotaViewForTree(treeNodes.map((n) => n.cascadeId));
    const smartGovernanceBanner = evaluateSmartGovernanceBanner(
      treeNodes,
      quota.gemini5h?.remainingPct ?? null,
      quota.burnRate5hPctPerMin,
      this.config
    );

    const semanticInput = {
      hostConnected: this.hostConnected,
      activeConversationId: effectiveCid,
      rootCascadeId,
      breadcrumb,
      activeNode,
      treeNodes,
      smartGovernanceBanner,
      quota,
      config: this.config,
      warnings: [...this.warnings],
    };

    const etag = computeHudSemanticEtag(semanticInput);
    if (isEtagMatch(clientEtag, etag)) {
      return makeUnchangedResponse(etag);
    }

    return {
      etag,
      generatedAt: new Date(nowMs).toISOString(),
      ...semanticInput,
    };
  }

  getTimelineSnapshot(
    conversationId?: string | null,
    scope?: 'conversation' | 'tree',
    clientEtag?: string
  ): TimelineSnapshotResponse | UnchangedEtagResponse {
    this.syncConfigIfModified();
    const nowMs = Date.now();
    const resolvedScope: 'conversation' | 'tree' = scope ?? this.config.timelineScope;
    const effectiveCid = this.resolveActiveConversationId(conversationId ?? null, nowMs);
    const result = buildTimelineTurns({
      activeConversationId: effectiveCid ?? '',
      scope: resolvedScope,
      nodesByCascadeId: this.topology.nodesByCascadeId,
      generatorMetadataByCascade: this.generatorMetadataByCascade,
      modelCatalog: this.modelCatalog,
      turnDeltaQuotaByKey: this.turnDeltaQuotaByKey,
    });
    const semanticPayload = {
      rootCascadeId: result.rootCascadeId,
      scope: result.scope,
      turns: result.turns,
    };
    const etag = computeDeterministicEtag(semanticPayload);
    if (isEtagMatch(clientEtag, etag)) {
      return makeUnchangedResponse(etag);
    }
    return {
      etag,
      generatedAt: new Date(nowMs).toISOString(),
      ...semanticPayload,
    };
  }

  getFleetSnapshot(clientEtag?: string): FleetSnapshotResponse | UnchangedEtagResponse {
    const snapshot = this.buildCurrentFleetSnapshot(Date.now());
    if (isEtagMatch(clientEtag, snapshot.etag)) {
      return makeUnchangedResponse(snapshot.etag);
    }
    return snapshot;
  }

  getHealthInfo(): {
    lsConnected: boolean;
    stateDir: string;
    activeConversationId: string | null;
  } {
    return {
      lsConnected: this.hostConnected,
      stateDir: this.statePaths.stateDir,
      activeConversationId: this.activeConversationId,
    };
  }

  // Stage 2 (S2-A) Extension Getters
  getAllGeneratorMetadataByCascade(): Record<string, GeneratorMetadataEntryRaw[]> {
    return this.generatorMetadataByCascade;
  }

  getCachedModelCatalog(): ModelCatalog {
    return this.modelCatalog;
  }

  getCachedTrajectories(): Record<string, TrajectorySummaryRaw> {
    return this.trajectories;
  }

  getCachedQuotaState(): QuotaSummaryView {
    return this.quotaCache.quota;
  }

  getCascadeBaselines(): Record<string, CascadeQuotaBaseline> {
    return this.quotaCache.cascadeBaselines;
  }

  getCascadeDelta5hPct(cid: string): number | null {
    return this.quotaCache.cascadeBaselines[cid]?.delta5hPct ?? null;
  }

  getCachedNodesByCascadeId(): Record<string, CascadeNodeView> {
    return this.topology.nodesByCascadeId;
  }

  getRootByCascadeId(): Record<string, string> {
    return this.topology.rootByCascadeId;
  }

  getAntigravityDataDir(): string {
    return this.antigravityDataDir;
  }
}
