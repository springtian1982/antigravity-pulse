import type { GeneratorMetadataEntryRaw } from '../types/rpc';
import type { CascadeNodeView, TimelineTurnItem } from '../types/telemetry';
import { computeCacheHitPct, parseDurationMs, toIntToken } from './formatters';
import { type ModelCatalog, reconcileRequestedVsServed } from './model-catalog';

export const OVERTHINKING_RATIO_THRESHOLD_PCT = 75;
export const OVERTHINKING_SHORT_RESPONSE_MAX_TOKENS = 500;

export interface BuildTimelineInput {
  activeConversationId: string;
  scope: 'conversation' | 'tree';
  nodesByCascadeId: Record<string, CascadeNodeView>;
  generatorMetadataByCascade: Record<string, GeneratorMetadataEntryRaw[]>;
  modelCatalog: ModelCatalog;
  turnDeltaQuotaByKey?: Record<string, number>;
}

export interface BuildTimelineResult {
  rootCascadeId: string | null;
  scope: 'conversation' | 'tree';
  turns: TimelineTurnItem[];
}

export function isOverthinkingTurn(
  turn: Pick<TimelineTurnItem, 'thinkingRatioPct' | 'outputTokens' | 'responseOutputTokens' | 'tier'>
): boolean {
  return (
    turn.outputTokens > 0 &&
    turn.thinkingRatioPct >= OVERTHINKING_RATIO_THRESHOLD_PCT &&
    (turn.responseOutputTokens <= OVERTHINKING_SHORT_RESPONSE_MAX_TOKENS || turn.tier === 'apex')
  );
}

interface ParsedTimestamp {
  ms: number | null;
  iso: string | null;
}

function parseTimestamp(raw: unknown): ParsedTimestamp {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return { ms: null, iso: null };
    }
    const ms = raw < 1e11 ? raw * 1000 : raw;
    return { ms, iso: new Date(ms).toISOString() };
  }
  if (typeof raw !== 'string') {
    return { ms: null, iso: null };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ms: null, iso: null };
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      const ms = num < 1e11 ? num * 1000 : num;
      return { ms, iso: new Date(ms).toISOString() };
    }
    return { ms: null, iso: null };
  }
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) {
    return { ms: null, iso: null };
  }
  return { ms: parsedMs, iso: trimmed };
}

function parseValidMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

interface SortableTurnRecord {
  cascadeId: string;
  sortTimeMs: number;
  depth: number;
  spawnStepIndex: number;
  roleKey: string;
  firstStepIndex: number;
  minStepIndex: number;
  entryIndex: number;
  turn: Omit<TimelineTurnItem, 'turnIndex' | 'routingChangedFromPrevTurn'>;
}

function compareStringAsc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareSortableTurnsAsc(a: SortableTurnRecord, b: SortableTurnRecord): number {
  if (a.sortTimeMs !== b.sortTimeMs) {
    return a.sortTimeMs - b.sortTimeMs;
  }
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }
  if (a.spawnStepIndex !== b.spawnStepIndex) {
    return a.spawnStepIndex - b.spawnStepIndex;
  }
  const roleCmp = compareStringAsc(a.roleKey, b.roleKey);
  if (roleCmp !== 0) {
    return roleCmp;
  }
  const cidCmp = compareStringAsc(a.cascadeId, b.cascadeId);
  if (cidCmp !== 0) {
    return cidCmp;
  }
  if (a.firstStepIndex !== b.firstStepIndex) {
    return a.firstStepIndex - b.firstStepIndex;
  }
  if (a.minStepIndex !== b.minStepIndex) {
    return a.minStepIndex - b.minStepIndex;
  }
  return a.entryIndex - b.entryIndex;
}

export function buildTimelineTurns(input: BuildTimelineInput): BuildTimelineResult {
  const activeCid = input.activeConversationId?.trim() ?? '';
  if (!activeCid) {
    return {
      rootCascadeId: null,
      scope: input.scope,
      turns: [],
    };
  }

  const activeNode = input.nodesByCascadeId[activeCid];
  const rootCascadeId = activeNode?.rootCascadeId ?? activeCid;

  let candidateIds: string[];
  if (input.scope === 'conversation') {
    candidateIds = [activeCid];
  } else {
    const treeIds = Object.values(input.nodesByCascadeId)
      .filter((node) => node.rootCascadeId === rootCascadeId)
      .map((node) => node.cascadeId);
    if (!treeIds.includes(activeCid)) {
      treeIds.push(activeCid);
    }
    candidateIds = Array.from(new Set(treeIds));
  }

  const records: SortableTurnRecord[] = [];

  for (const cascadeId of candidateIds) {
    const entries = input.generatorMetadataByCascade[cascadeId];
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }

    const node = input.nodesByCascadeId[cascadeId];
    const cascadeTitle = node?.title || `Cascade ${cascadeId.slice(0, 8)}`;
    const role = node?.role ?? null;
    const nodeModifiedMs = parseValidMs(node?.lastModifiedTime) ?? 0;
    const depth = node?.depth ?? 0;
    const spawnStepIndex = node?.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
    const roleKey = (role || cascadeTitle || cascadeId).toLowerCase();

    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const chatModel = entry?.chatModel;
      if (!chatModel) {
        continue;
      }

      const stepIndices = Array.isArray(entry.stepIndices)
        ? entry.stepIndices
            .filter((idx): idx is number => typeof idx === 'number' && Number.isFinite(idx))
            .map((idx) => Math.trunc(idx))
        : [];
      const firstStepIndex =
        stepIndices.length > 0 ? stepIndices[0] : Number.MAX_SAFE_INTEGER;
      const minStepIndex =
        stepIndices.length > 0 ? Math.min(...stepIndices) : Number.MAX_SAFE_INTEGER;

      const rawTs =
        chatModel.chatStartMetadata?.createdAt ??
        chatModel.createdAt ??
        chatModel.timestamp ??
        null;
      const parsedTs = parseTimestamp(rawTs);
      const sortTimeMs = parsedTs.ms ?? nodeModifiedMs;

      const reqRaw =
        chatModel.customMetadata?.model_enum?.trim() ||
        (node?.requestedModel?.raw && node.requestedModel.raw !== 'unknown'
          ? node.requestedModel.raw
          : null);
      const routing = reconcileRequestedVsServed({
        catalog: input.modelCatalog,
        requestedModelRaw: reqRaw,
        requestedSource: node?.requestedModel?.source,
        latestGenMeta: entry,
      });

      const requestedLabel =
        routing.requestedModel.raw !== 'unknown'
          ? routing.requestedModel.displayName
          : node?.requestedModel?.displayName && node.requestedModel.displayName !== 'Unknown'
            ? node.requestedModel.displayName
            : routing.requestedModel.displayName;

      const ttftMs = parseDurationMs(chatModel.timeToFirstToken);
      const streamingMs = parseDurationMs(chatModel.streamingDuration);
      const totalMs = ttftMs + streamingMs;

      const usage = chatModel.usage;
      const inputTokens = toIntToken(usage?.inputTokens);
      const cacheReadTokens = toIntToken(usage?.cacheReadTokens);
      const cacheHitPct = computeCacheHitPct(inputTokens, cacheReadTokens);

      const outputTokens = toIntToken(usage?.outputTokens);
      const thinkingOutputTokens = toIntToken(usage?.thinkingOutputTokens);
      const responseOutputTokens =
        toIntToken(usage?.responseOutputTokens) ||
        Math.max(0, outputTokens - thinkingOutputTokens);
      const thinkingRatioPct =
        outputTokens > 0
          ? Math.min(100, (thinkingOutputTokens / outputTokens) * 100)
          : 0;

      const ctxMeta = chatModel.chatStartMetadata?.contextWindowMetadata;
      const contextUsedTokens = toIntToken(ctxMeta?.estimatedTokensUsed);
      const contextMaxTokens = toIntToken(ctxMeta?.maxContextTokens);
      const contextPct =
        contextMaxTokens > 0
          ? Math.min(100, Math.max(0, (contextUsedTokens / contextMaxTokens) * 100))
          : 0;

      const deltaKey =
        stepIndices.length > 0
          ? `${cascadeId}:${minStepIndex}`
          : `${cascadeId}:${entryIndex}`;
      const rawTurnDelta = input.turnDeltaQuotaByKey?.[deltaKey];
      const deltaQuota5hPct =
        typeof rawTurnDelta === 'number' && Number.isFinite(rawTurnDelta) && rawTurnDelta >= 0
          ? rawTurnDelta
          : null;

      const apiProvider =
        typeof usage?.apiProvider === 'string' && usage.apiProvider.trim()
          ? usage.apiProvider.trim()
          : null;

      records.push({
        cascadeId,
        sortTimeMs,
        depth,
        spawnStepIndex,
        roleKey,
        firstStepIndex,
        minStepIndex,
        entryIndex,
        turn: {
          cascadeId,
          cascadeTitle,
          role,
          stepIndices,
          timestamp: parsedTs.iso,
          requestedLabel,
          servedModelDisplayName: routing.servedModel.displayName,
          responseModel: routing.servedModel.responseModel,
          tier: routing.servedModel.tier,
          ttftMs,
          streamingMs,
          totalMs,
          inputTokens,
          cacheReadTokens,
          cacheHitPct,
          outputTokens,
          thinkingOutputTokens,
          responseOutputTokens,
          thinkingRatioPct,
          retryCount: routing.retryCount,
          contextUsedTokens,
          contextMaxTokens,
          contextPct,
          deltaQuota5hPct,
          apiProvider,
        },
      });
    }
  }

  if (records.length === 0) {
    return {
      rootCascadeId,
      scope: input.scope,
      turns: [],
    };
  }

  records.sort(compareSortableTurnsAsc);

  const prevServedKeyByCascade = new Map<string, string>();
  const chronologicalTurns: TimelineTurnItem[] = records.map((rec, idx) => {
    const servedKey = (
      rec.turn.responseModel ||
      rec.turn.servedModelDisplayName ||
      ''
    )
      .trim()
      .toLowerCase();
    const hadPrev = prevServedKeyByCascade.has(rec.cascadeId);
    const prevKey = prevServedKeyByCascade.get(rec.cascadeId);
    const routingChangedFromPrevTurn = hadPrev && prevKey !== servedKey;
    prevServedKeyByCascade.set(rec.cascadeId, servedKey);

    return {
      turnIndex: idx + 1,
      ...rec.turn,
      routingChangedFromPrevTurn,
    };
  });

  return {
    rootCascadeId,
    scope: input.scope,
    turns: chronologicalTurns.reverse(),
  };
}
