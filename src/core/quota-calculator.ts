import type { CascadeQuotaBaseline, QuotaCacheFile } from '../state/state-dir';
import type { QuotaBucketRaw, RetrieveUserQuotaSummaryResponse } from '../types/rpc';
import type {
  CascadeNodeView,
  PulseUserConfig,
  QuotaBucketView,
  QuotaSummaryView,
  SmartGovernanceBanner,
} from '../types/telemetry';

export interface QuotaBurnSample {
  tsMs: number;
  remainingFraction: number;
}

export interface CascadeActivitySignal {
  cascadeId: string;
  isRunning: boolean;
  stepCountIncremented?: boolean;
  tokenDelta?: number;
}

export interface UpdateQuotaBaselinesInput {
  prevBaselines: Record<string, CascadeQuotaBaseline>;
  prevGlobal5hFraction: number | null;
  currGlobal5hFraction: number | null;
  activeCascades: CascadeActivitySignal[];
  allKnownCascadeIds?: string[];
  nowIso: string;
}

export interface NormalizeQuotaResult {
  quota: QuotaSummaryView;
  cascadeBaselines: Record<string, CascadeQuotaBaseline>;
}

const FIVE_MIN_MS = 5 * 60 * 1000;
const RESET_HYSTERESIS = 0.005;

function round8(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1e8) / 1e8;
}

export function formatResetCountdown(
  resetTime: string | null | undefined,
  nowMs = Date.now()
): { resetInSeconds: number | null; resetInLabel: string } {
  if (!resetTime || typeof resetTime !== 'string') {
    return { resetInSeconds: null, resetInLabel: '—' };
  }
  const targetMs = Date.parse(resetTime);
  if (!Number.isFinite(targetMs)) {
    return { resetInSeconds: null, resetInLabel: '—' };
  }

  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  if (diffSec <= 0) {
    return { resetInSeconds: 0, resetInLabel: '0m' };
  }
  if (diffSec < 3600) {
    return { resetInSeconds: diffSec, resetInLabel: `${Math.ceil(diffSec / 60)}m` };
  }
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    return { resetInSeconds: diffSec, resetInLabel: `${hours}h ${mins}m` };
  }
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  return { resetInSeconds: diffSec, resetInLabel: `${days}d ${hours}h` };
}

export function computeBurnRate5hPctPerMin(
  samples: QuotaBurnSample[],
  nowMs?: number
): number | null {
  if (!Array.isArray(samples) || samples.length < 2) {
    return null;
  }
  const valid = samples
    .filter(
      (s) =>
        Number.isFinite(s.tsMs) &&
        Number.isFinite(s.remainingFraction) &&
        s.remainingFraction >= 0 &&
        s.remainingFraction <= 1
    )
    .sort((a, b) => a.tsMs - b.tsMs);

  if (valid.length < 2) {
    return null;
  }

  const refMs = nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : valid[valid.length - 1].tsMs;
  const windowSamples = valid.filter((s) => s.tsMs >= refMs - FIVE_MIN_MS && s.tsMs <= refMs);
  if (windowSamples.length < 2) {
    return null;
  }

  const elapsedMs = windowSamples[windowSamples.length - 1].tsMs - windowSamples[0].tsMs;
  if (elapsedMs < 10_000) {
    return null;
  }

  let positiveDropsPct = 0;
  for (let i = 1; i < windowSamples.length; i += 1) {
    const drop = windowSamples[i - 1].remainingFraction - windowSamples[i].remainingFraction;
    if (drop > 0) {
      positiveDropsPct += drop * 100;
    }
  }

  if (positiveDropsPct <= 0) {
    return null;
  }

  const elapsedMinutes = elapsedMs / 60_000;
  return elapsedMinutes > 0 ? round8(positiveDropsPct / elapsedMinutes) : null;
}

export function updateCascadeQuotaBaselines(
  input: UpdateQuotaBaselinesInput
): Record<string, CascadeQuotaBaseline> {
  const nextBaselines: Record<string, CascadeQuotaBaseline> = {};
  for (const [cid, entry] of Object.entries(input.prevBaselines)) {
    nextBaselines[cid] = { ...entry };
  }

  const dedupedSignals = new Map<string, CascadeActivitySignal>();
  for (const signal of input.activeCascades) {
    if (!signal.cascadeId) continue;
    const prev = dedupedSignals.get(signal.cascadeId);
    if (!prev) {
      dedupedSignals.set(signal.cascadeId, { ...signal });
    } else {
      dedupedSignals.set(signal.cascadeId, {
        cascadeId: signal.cascadeId,
        isRunning: prev.isRunning || signal.isRunning,
        stepCountIncremented: Boolean(prev.stepCountIncremented || signal.stepCountIncremented),
        tokenDelta: Math.max(0, prev.tokenDelta ?? 0) + Math.max(0, signal.tokenDelta ?? 0),
      });
    }
  }

  const ensureBaseline = (cid: string): CascadeQuotaBaseline => {
    const existing = nextBaselines[cid];
    if (existing) {
      return existing;
    }
    const created: CascadeQuotaBaseline = {
      firstSeenAt: input.nowIso,
      baseline5hFraction: input.currGlobal5hFraction,
      last5hFraction: input.currGlobal5hFraction,
      delta5hPct: 0,
    };
    nextBaselines[cid] = created;
    return created;
  };

  for (const cid of dedupedSignals.keys()) {
    ensureBaseline(cid);
  }
  for (const cid of input.allKnownCascadeIds ?? []) {
    if (cid) ensureBaseline(cid);
  }

  const prevGlobal = input.prevGlobal5hFraction;
  const currGlobal = input.currGlobal5hFraction;

  if (currGlobal === null || !Number.isFinite(currGlobal)) {
    return nextBaselines;
  }

  if (prevGlobal === null || !Number.isFinite(prevGlobal)) {
    for (const entry of Object.values(nextBaselines)) {
      if (entry.baseline5hFraction === null) {
        entry.baseline5hFraction = currGlobal;
      }
      entry.last5hFraction = currGlobal;
    }
    return nextBaselines;
  }

  if (currGlobal > prevGlobal + RESET_HYSTERESIS) {
    for (const entry of Object.values(nextBaselines)) {
      entry.baseline5hFraction = currGlobal;
      entry.last5hFraction = currGlobal;
      entry.delta5hPct = Math.max(0, entry.delta5hPct);
    }
    return nextBaselines;
  }

  if (currGlobal <= prevGlobal) {
    const tickDropPct = round8(Math.max(0, (prevGlobal - currGlobal) * 100));
    if (tickDropPct > 0) {
      const attributed = Array.from(dedupedSignals.values()).filter(
        (c) => c.isRunning || c.stepCountIncremented || (c.tokenDelta ?? 0) > 0
      );
      if (attributed.length > 0) {
        const totalTokenDelta = attributed.reduce(
          (sum, c) => sum + Math.max(0, c.tokenDelta ?? 0),
          0
        );
        for (const sig of attributed) {
          const entry = ensureBaseline(sig.cascadeId);
          const share =
            totalTokenDelta > 0
              ? tickDropPct * (Math.max(0, sig.tokenDelta ?? 0) / totalTokenDelta)
              : tickDropPct / attributed.length;
          entry.delta5hPct = round8(Math.max(0, entry.delta5hPct + share));
        }
      }
    }
  }

  for (const entry of Object.values(nextBaselines)) {
    entry.last5hFraction = currGlobal;
  }

  return nextBaselines;
}

function toBucketView(
  rawBucket: QuotaBucketRaw,
  groupId: string | undefined,
  nowMs: number
): QuotaBucketView {
  const bucketId = (rawBucket.bucketId ?? '').trim();
  const displayName = (rawBucket.displayName ?? bucketId) || 'Quota';
  const rawFraction =
    typeof rawBucket.remainingFraction === 'number' &&
    Number.isFinite(rawBucket.remainingFraction)
      ? rawBucket.remainingFraction
      : 0;
  const remainingFraction = Math.min(1, Math.max(0, rawFraction));
  const remainingPct = remainingFraction * 100;
  const resetTime = rawBucket.resetTime ?? null;
  const { resetInSeconds, resetInLabel } = formatResetCountdown(resetTime, nowMs);
  const inferredWindow =
    rawBucket.window?.trim() ||
    (/week/i.test(`${bucketId} ${displayName}`) ? 'weekly' : '5h');

  return {
    bucketId,
    ...(groupId ? { groupId } : {}),
    displayName,
    window: inferredWindow,
    remainingFraction,
    remainingPct,
    resetTime,
    resetInSeconds,
    resetInLabel,
    isLowAlert: remainingPct < 15,
  };
}

export function normalizeQuotaSummary(
  raw: RetrieveUserQuotaSummaryResponse | null | undefined,
  prevCache?: QuotaCacheFile | null,
  activeTreeNodeIds: string[] = [],
  fetchedAt: string = new Date().toISOString(),
  burnSamples: QuotaBurnSample[] = [],
  activeCascades?: CascadeActivitySignal[]
): NormalizeQuotaResult {
  const parsedMs = Date.parse(fetchedAt);
  const nowMs = Number.isFinite(parsedMs) ? parsedMs : Date.now();
  const groups = raw?.response?.groups ?? raw?.groups ?? [];

  const buckets: QuotaBucketView[] = [];
  for (const group of groups) {
    for (const rawBucket of group.buckets ?? []) {
      buckets.push(toBucketView(rawBucket, group.groupId, nowMs));
    }
  }

  const findSlot = (exactId: string, fallbackRe: RegExp): QuotaBucketView | null =>
    buckets.find((b) => b.bucketId === exactId) ??
    buckets.find((b) => fallbackRe.test(`${b.bucketId} ${b.displayName}`)) ??
    null;

  const gemini5h = findSlot('gemini-5h', /gemini.*5h/i);
  const geminiWeekly = findSlot('gemini-weekly', /gemini.*week/i);
  const thirdParty5h = findSlot('3p-5h', /(?:3p|third[-_ ]?party|claude).*5h/i);
  const thirdPartyWeekly = findSlot('3p-weekly', /(?:3p|third[-_ ]?party|claude).*week/i);

  const uniqueTreeIds = Array.from(new Set(activeTreeNodeIds.filter(Boolean)));
  const effectiveSignals: CascadeActivitySignal[] =
    activeCascades !== undefined
      ? activeCascades
      : uniqueTreeIds.map((cascadeId) => ({
          cascadeId,
          isRunning: true,
        }));

  const prevGlobal5hFraction = prevCache?.quota?.gemini5h?.remainingFraction ?? null;
  const currGlobal5hFraction = gemini5h?.remainingFraction ?? null;

  const cascadeBaselines = updateCascadeQuotaBaselines({
    prevBaselines: prevCache?.cascadeBaselines ?? {},
    prevGlobal5hFraction,
    currGlobal5hFraction,
    activeCascades: effectiveSignals,
    allKnownCascadeIds: uniqueTreeIds,
    nowIso: fetchedAt,
  });

  let treeNetDelta5hPct: number | null = null;
  if (uniqueTreeIds.length > 0) {
    let hasAnyBaseline = false;
    let totalDelta = 0;
    for (const cid of uniqueTreeIds) {
      const entry = cascadeBaselines[cid];
      if (entry) {
        hasAnyBaseline = true;
        totalDelta += Math.max(0, entry.delta5hPct);
      }
    }
    if (hasAnyBaseline) {
      treeNetDelta5hPct = round8(totalDelta);
    }
  }

  const burnRate5hPctPerMin = computeBurnRate5hPctPerMin(burnSamples, nowMs);

  return {
    quota: {
      fetchedAt,
      buckets,
      gemini5h,
      geminiWeekly,
      thirdParty5h,
      thirdPartyWeekly,
      treeNetDelta5hPct,
      burnRate5hPctPerMin,
    },
    cascadeBaselines,
  };
}

export function evaluateSmartGovernanceBanner(
  treeNodes: CascadeNodeView[],
  gemini5hRemainingPct: number | null,
  burnRatePctPerMin: number | null,
  config: Pick<PulseUserConfig, 'smartThresholds'>
): SmartGovernanceBanner {
  const heavyConcurrentCount = treeNodes.filter(
    (node) =>
      node.phase !== 'IDLE' &&
      node.phase !== 'ERROR_OR_QUOTA' &&
      node.servedModel.tier === 'apex'
  ).length;

  const alertCount = config.smartThresholds.heavyConcurrentAlertCount;
  const quotaThreshold = config.smartThresholds.heavyQuotaThresholdPct;
  const effectiveRemaining = gemini5hRemainingPct ?? 100;
  const active = heavyConcurrentCount >= alertCount && effectiveRemaining < quotaThreshold;

  if (!active) {
    return {
      active: false,
      heavyConcurrentCount,
      gemini5hRemainingPct,
      estimatedBurnPctPerMin: burnRatePctPerMin,
      message: null,
    };
  }

  const burnSuffix =
    burnRatePctPerMin !== null && Number.isFinite(burnRatePctPerMin) && burnRatePctPerMin > 0
      ? `预计每分钟消耗 ~${burnRatePctPerMin.toFixed(1)}% 5h 配额`
      : '建议将探索类子代理切换为 Argon / Flash';

  return {
    active: true,
    heavyConcurrentCount,
    gemini5hRemainingPct,
    estimatedBurnPctPerMin: burnRatePctPerMin,
    message: `💡 当前有 ${heavyConcurrentCount} 个节点并发运行于 Apex 旗舰模型（5h 余量 ${effectiveRemaining.toFixed(1)}%），${burnSuffix}`,
  };
}
