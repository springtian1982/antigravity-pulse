import { readFileSync } from 'node:fs';
import { formatInlineTurnStamp } from '../core/formatters';
import { loadConfig } from '../state/config-store';
import {
  appendRingLine,
  getStatePaths,
  isValidUuid,
  readJsonSafe,
  writeJsonAtomic,
  type LiveSnapshotFile,
  type ModelMapFile,
  type QuotaCacheFile,
  type StampDedupEntry,
} from '../state/state-dir';
import type { HookEventName, HookStdinPayload, HookStdoutResponse } from '../types/rpc';
import type { CascadeNodeView, HookRingEvent, ModelConfigEntry } from '../types/telemetry';

export interface HookProbeOptions {
  overrideStateDir?: string;
  nowMs?: number;
}

export interface HookProbeResult {
  stdout: HookStdoutResponse;
  event: HookRingEvent | null;
  stamped: boolean;
  stampReason: string | null;
  hookDurationUs: number;
}

interface InternalStampDedupEntry extends StampDedupEntry {
  turnEpoch?: number;
}

interface InternalStampDedupFile {
  schemaVersion: 1;
  byConversation: Record<string, InternalStampDedupEntry>;
}

const KNOWN_HOOK_EVENTS = new Set<HookEventName>([
  'PreInvocation',
  'PostInvocation',
  'PreToolUse',
  'PostToolUse',
  'Stop',
]);

const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STAMP_DEDUP_MAX_ENTRIES = 200;
const TOOL_SUMMARY_MAX_LEN = 80;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const val of values) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function parseInvocationNum(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined;
  }
  return undefined;
}

function normalizeEventName(payload: HookStdinPayload): HookEventName | null {
  const raw = payload.hookEventName ?? payload.hook_event_name;
  if (typeof raw === 'string' && KNOWN_HOOK_EVENTS.has(raw as HookEventName)) {
    return raw as HookEventName;
  }
  return null;
}

function parseToolInput(raw: unknown): Record<string, unknown> | null {
  if (isPlainRecord(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isPlainRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function truncateSummary(raw: string, maxLen = TOOL_SUMMARY_MAX_LEN): string {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen - 3)}...`;
}

function extractToolSummary(toolInput: Record<string, unknown> | null): string | undefined {
  if (!toolInput) {
    return undefined;
  }
  const raw = firstNonEmptyString(
    toolInput.ToolSummary,
    toolInput.toolSummary,
    toolInput.tool_summary,
    toolInput.CommandLine,
    toolInput.commandLine,
    toolInput.command_line,
    toolInput.command,
    toolInput.TargetFile,
    toolInput.targetFile,
    toolInput.target_file,
    toolInput.AbsolutePath,
    toolInput.absolutePath,
    toolInput.filePath,
    toolInput.file_path,
    toolInput.Path,
    toolInput.path,
    toolInput.query,
    toolInput.Query,
    toolInput.Url,
    toolInput.url,
    toolInput.Task,
    toolInput.task,
    toolInput.Description,
    toolInput.description,
    toolInput.Role,
    toolInput.role
  );
  return raw ? truncateSummary(raw) : undefined;
}

function extractSubagentRequest(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | null
): HookRingEvent['subagentRequest'] | undefined {
  if (toolName !== 'invoke_subagent' || !toolInput) {
    return undefined;
  }
  const role = firstNonEmptyString(toolInput.Role, toolInput.role);
  const typeName = firstNonEmptyString(
    toolInput.TypeName,
    toolInput.typeName,
    toolInput.type_name,
    toolInput.subagent_type,
    toolInput.subagentType
  );
  const model = firstNonEmptyString(
    toolInput.Model,
    toolInput.model,
    toolInput.modelName,
    toolInput.model_name
  );
  if (!role && !typeName && !model) {
    return undefined;
  }
  return {
    ...(role ? { role } : {}),
    ...(typeName ? { typeName } : {}),
    ...(model ? { model } : {}),
  };
}

function resolveModelFromMap(
  modelRaw: string | undefined,
  modelMap: ModelMapFile | null
): ModelConfigEntry | null {
  if (!modelRaw || !modelMap || !isPlainRecord(modelMap.modelsByEnum)) {
    return null;
  }
  if (
    !PROTO_POLLUTION_KEYS.has(modelRaw) &&
    Object.hasOwn(modelMap.modelsByEnum, modelRaw)
  ) {
    const direct = modelMap.modelsByEnum[modelRaw];
    if (direct && typeof direct === 'object') {
      return direct;
    }
  }
  const needle = modelRaw.toLowerCase();
  for (const key of Object.keys(modelMap.modelsByEnum)) {
    const entry = modelMap.modelsByEnum[key];
    if (!entry || typeof entry !== 'object') continue;
    if (
      entry.modelEnum?.toLowerCase() === needle ||
      entry.modelId?.toLowerCase() === needle ||
      entry.label?.toLowerCase() === needle
    ) {
      return entry;
    }
  }
  return null;
}

function pickNewestQuotaPct(
  liveSnapshot: LiveSnapshotFile | null,
  quotaCache: QuotaCacheFile | null
): number | null {
  const livePct = liveSnapshot?.quota?.gemini5h?.remainingPct;
  const cachePct = quotaCache?.quota?.gemini5h?.remainingPct;
  const hasLivePct = typeof livePct === 'number' && Number.isFinite(livePct);
  const hasCachePct = typeof cachePct === 'number' && Number.isFinite(cachePct);

  if (hasLivePct && hasCachePct) {
    const liveTs = Date.parse(liveSnapshot?.updatedAt ?? '');
    const cacheTs = Date.parse(quotaCache?.updatedAt ?? '');
    if (Number.isFinite(liveTs) && Number.isFinite(cacheTs)) {
      return cacheTs >= liveTs ? cachePct : livePct;
    }
    return cachePct;
  }
  if (hasCachePct) return cachePct;
  if (hasLivePct) return livePct;
  return null;
}

function readStampDedup(filePath: string): InternalStampDedupFile {
  const raw = readJsonSafe<unknown>(filePath, null);
  const byConversation: Record<string, InternalStampDedupEntry> = {};
  if (isPlainRecord(raw) && isPlainRecord(raw.byConversation)) {
    for (const key of Object.keys(raw.byConversation)) {
      if (PROTO_POLLUTION_KEYS.has(key)) continue;
      if (key !== 'unknown' && !isValidUuid(key)) continue;
      const entry = raw.byConversation[key];
      if (!isPlainRecord(entry)) continue;
      const turnEpoch =
        typeof entry.turnEpoch === 'number' && Number.isFinite(entry.turnEpoch)
          ? Math.trunc(entry.turnEpoch)
          : undefined;
      byConversation[key] = {
        lastInvocationNum:
          typeof entry.lastInvocationNum === 'number' && Number.isFinite(entry.lastInvocationNum)
            ? Math.trunc(entry.lastInvocationNum)
            : 0,
        lastServedModel: typeof entry.lastServedModel === 'string' ? entry.lastServedModel : '',
        lastTurnStamped: entry.lastTurnStamped === true,
        lastContextAlertPct:
          typeof entry.lastContextAlertPct === 'number' &&
          Number.isFinite(entry.lastContextAlertPct)
            ? entry.lastContextAlertPct
            : 0,
        lastQuotaAlerted: entry.lastQuotaAlerted === true,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date(0).toISOString(),
        ...(turnEpoch !== undefined ? { turnEpoch } : {}),
      };
    }
  }
  return {
    schemaVersion: 1,
    byConversation,
  };
}

function pruneStampDedup(
  byConversation: Record<string, InternalStampDedupEntry>,
  keepKey?: string
): Record<string, InternalStampDedupEntry> {
  const entries = Object.entries(byConversation);
  if (entries.length <= STAMP_DEDUP_MAX_ENTRIES) {
    return byConversation;
  }
  entries.sort((a, b) => {
    if (keepKey) {
      if (a[0] === keepKey && b[0] !== keepKey) return -1;
      if (b[0] === keepKey && a[0] !== keepKey) return 1;
    }
    const ta = Date.parse(a[1].updatedAt);
    const tb = Date.parse(b[1].updatedAt);
    const va = Number.isFinite(ta) ? ta : 0;
    const vb = Number.isFinite(tb) ? tb : 0;
    return vb - va;
  });
  const pruned: Record<string, InternalStampDedupEntry> = {};
  for (let i = 0; i < STAMP_DEDUP_MAX_ENTRIES; i += 1) {
    const [key, value] = entries[i];
    pruned[key] = value;
  }
  return pruned;
}

function advanceTurnEpochOnStop(
  overrideStateDir: string | undefined,
  conversationId: string,
  nowIso: string
): void {
  const paths = getStatePaths(overrideStateDir);
  const dedup = readStampDedup(paths.stampDedup);
  const existing = Object.hasOwn(dedup.byConversation, conversationId)
    ? dedup.byConversation[conversationId]
    : undefined;

  if (existing) {
    const currentEpoch = Math.max(
      1,
      typeof existing.turnEpoch === 'number' && Number.isFinite(existing.turnEpoch)
        ? existing.turnEpoch
        : 0,
      existing.lastInvocationNum
    );
    dedup.byConversation[conversationId] = {
      ...existing,
      turnEpoch: currentEpoch + 1,
      updatedAt: nowIso,
    };
  } else {
    dedup.byConversation[conversationId] = {
      lastInvocationNum: 0,
      lastServedModel: '',
      lastTurnStamped: false,
      lastContextAlertPct: 0,
      lastQuotaAlerted: false,
      turnEpoch: 1,
      updatedAt: nowIso,
    };
  }
  dedup.byConversation = pruneStampDedup(dedup.byConversation, conversationId);
  writeJsonAtomic(paths.stampDedup, dedup);
}

function evaluatePostInvocationStamp(params: {
  overrideStateDir: string | undefined;
  conversationId: string;
  invocationNum: number | undefined;
  modelRaw: string | undefined;
  initialModelMap: ModelMapFile | null;
  nowIso: string;
}): { stdout: HookStdoutResponse; stamped: boolean; stampReason: string | null } {
  const config = loadConfig(params.overrideStateDir);
  if (config.inlineStampMode === 'off') {
    return { stdout: {}, stamped: false, stampReason: null };
  }

  const paths = getStatePaths(params.overrideStateDir);
  const dedup = readStampDedup(paths.stampDedup);
  const existing = Object.hasOwn(dedup.byConversation, params.conversationId)
    ? dedup.byConversation[params.conversationId]
    : undefined;

  const turnKey =
    params.invocationNum !== undefined
      ? params.invocationNum
      : existing && typeof existing.turnEpoch === 'number' && existing.turnEpoch > 0
        ? Math.max(existing.turnEpoch, existing.lastInvocationNum)
        : existing && existing.lastInvocationNum > 0
          ? existing.lastInvocationNum
          : 1;

  if (existing?.lastTurnStamped && existing.lastInvocationNum === turnKey) {
    return { stdout: {}, stamped: false, stampReason: null };
  }

  const liveSnapshot = readJsonSafe<LiveSnapshotFile | null>(paths.liveSnapshot, null);
  const quotaCache = readJsonSafe<QuotaCacheFile | null>(paths.quotaCache, null);
  const modelMap =
    params.initialModelMap ?? readJsonSafe<ModelMapFile | null>(paths.modelMap, null);

  const node: CascadeNodeView | undefined =
    liveSnapshot &&
    isPlainRecord(liveSnapshot.nodesByCascadeId) &&
    !PROTO_POLLUTION_KEYS.has(params.conversationId) &&
    Object.hasOwn(liveSnapshot.nodesByCascadeId, params.conversationId)
      ? liveSnapshot.nodesByCascadeId[params.conversationId]
      : undefined;

  const mapEntry =
    resolveModelFromMap(params.modelRaw, modelMap) ??
    (modelMap?.defaultModelEnum ? resolveModelFromMap(modelMap.defaultModelEnum, modelMap) : null);

  const servedDisplayName =
    firstNonEmptyString(
      node?.servedModel?.displayName,
      mapEntry?.label,
      params.modelRaw,
      node?.servedModel?.responseModel,
      node?.servedModel?.modelEnum
    ) ?? 'Unknown Model';

  const responseModel =
    firstNonEmptyString(
      node?.servedModel?.responseModel,
      mapEntry?.modelId,
      node?.servedModel?.modelEnum,
      mapEntry?.modelEnum,
      params.modelRaw
    ) ?? null;

  const servedModelId =
    firstNonEmptyString(
      node?.servedModel?.responseModel,
      mapEntry?.modelId,
      node?.servedModel?.modelEnum,
      params.modelRaw
    ) ?? '';

  const requestedLabel =
    firstNonEmptyString(
      node?.requestedModel?.displayName,
      node?.requestedModel?.raw,
      mapEntry?.label,
      params.modelRaw
    ) ?? null;

  const routingStatus = node?.routingStatus ?? 'unknown';
  const retryCount =
    typeof node?.retryCount === 'number' && Number.isFinite(node.retryCount) && node.retryCount > 0
      ? Math.trunc(node.retryCount)
      : 0;
  const ttftMs =
    typeof node?.lastTtftMs === 'number' && Number.isFinite(node.lastTtftMs) && node.lastTtftMs >= 0
      ? node.lastTtftMs
      : null;
  const nodeContextPct =
    typeof node?.contextWindow?.pct === 'number' &&
    Number.isFinite(node.contextWindow.pct) &&
    node.contextWindow.pct >= 0
      ? node.contextWindow.pct
      : null;
  const contextPct = nodeContextPct ?? 0;
  const gemini5hRemainingPct = pickNewestQuotaPct(liveSnapshot, quotaCache);

  const ctxTriggerPct = config.smartThresholds.stampContextTriggerPct;
  const quotaTriggerPct = config.smartThresholds.quotaLowTriggerPct;

  const isTurn1 = !existing || !existing.lastTurnStamped;
  const prevMapEntry = existing?.lastServedModel
    ? resolveModelFromMap(existing.lastServedModel, modelMap)
    : null;
  const sameModelViaMap =
    prevMapEntry !== null &&
    node?.servedModel?.modelEnum !== undefined &&
    node.servedModel.modelEnum !== '' &&
    prevMapEntry.modelEnum === node.servedModel.modelEnum &&
    prevMapEntry.label === node.servedModel.displayName;
  const modelChanged =
    servedModelId !== '' &&
    existing !== undefined &&
    existing.lastServedModel !== '' &&
    servedModelId !== existing.lastServedModel &&
    !sameModelViaMap;
  const hasRetryOrFallback =
    retryCount > 0 || routingStatus === 'retrying' || routingStatus === 'mismatch_or_fallback';
  const contextCrossed =
    contextPct > ctxTriggerPct && (!existing || existing.lastContextAlertPct <= ctxTriggerPct);
  const quotaCrossed =
    gemini5hRemainingPct !== null &&
    gemini5hRemainingPct < quotaTriggerPct &&
    (!existing || !existing.lastQuotaAlerted);

  let stampReason: string | null = null;
  if (config.inlineStampMode === 'every-turn') {
    stampReason = 'every-turn';
  } else if (isTurn1) {
    stampReason = 'turn_1';
  } else if (modelChanged) {
    stampReason = 'model_changed';
  } else if (hasRetryOrFallback) {
    stampReason = 'retry_or_fallback';
  } else if (contextCrossed) {
    stampReason = 'context_high';
  } else if (quotaCrossed) {
    stampReason = 'quota_low';
  }

  const nextQuotaAlerted =
    gemini5hRemainingPct !== null
      ? gemini5hRemainingPct < quotaTriggerPct
      : (existing?.lastQuotaAlerted ?? false);

  if (!stampReason) {
    const nextTurnEpoch = existing
      ? Math.max(
          1,
          typeof existing.turnEpoch === 'number' && Number.isFinite(existing.turnEpoch)
            ? existing.turnEpoch
            : 0,
          existing.lastInvocationNum,
          params.invocationNum ?? 0
        )
      : 1;
    if (
      existing &&
      (existing.lastContextAlertPct !== contextPct ||
        existing.lastQuotaAlerted !== nextQuotaAlerted ||
        existing.turnEpoch !== nextTurnEpoch)
    ) {
      dedup.byConversation[params.conversationId] = {
        ...existing,
        lastContextAlertPct: contextPct,
        lastQuotaAlerted: nextQuotaAlerted,
        turnEpoch: nextTurnEpoch,
        updatedAt: params.nowIso,
      };
      dedup.byConversation = pruneStampDedup(dedup.byConversation, params.conversationId);
      writeJsonAtomic(paths.stampDedup, dedup);
    }
    return { stdout: {}, stamped: false, stampReason: null };
  }

  const userMarkdown = formatInlineTurnStamp({
    modelDisplayName: servedDisplayName,
    responseModel,
    requestedLabel,
    routingStatus,
    modelSwitched: modelChanged,
    retryCount,
    ttftMs,
    contextPct: nodeContextPct,
    gemini5hRemainingPct,
    stampContextTriggerPct: ctxTriggerPct,
    quotaLowTriggerPct: quotaTriggerPct,
  });

  const nextTurnEpoch = Math.max(
    1,
    typeof existing?.turnEpoch === 'number' && Number.isFinite(existing.turnEpoch)
      ? existing.turnEpoch
      : 0,
    existing?.lastInvocationNum ?? 0,
    turnKey
  );

  dedup.byConversation[params.conversationId] = {
    lastInvocationNum: turnKey,
    lastServedModel: servedModelId || existing?.lastServedModel || '',
    lastTurnStamped: true,
    lastContextAlertPct: contextPct,
    lastQuotaAlerted: nextQuotaAlerted,
    turnEpoch: nextTurnEpoch,
    updatedAt: params.nowIso,
  };
  dedup.byConversation = pruneStampDedup(dedup.byConversation, params.conversationId);
  writeJsonAtomic(paths.stampDedup, dedup);

  return {
    stdout: {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: '',
            metadata: {
              user_markdown: userMarkdown,
            },
          },
        },
      ],
    },
    stamped: true,
    stampReason,
  };
}

/**
 * Synchronous, zero-network hook handler executed by Antigravity 2.0 hooks.json.
 * Guarantees fail-open exit 0 semantics across malformed stdin and unwritable state dirs.
 */
export function processHookPayload(
  rawStdin: string,
  options?: HookProbeOptions | string
): HookProbeResult {
  const startNs = process.hrtime.bigint();
  const opts: HookProbeOptions =
    typeof options === 'string' ? { overrideStateDir: options } : (options ?? {});
  let eventName: HookEventName | null = null;

  const elapsedUs = () => Math.max(0, Number((process.hrtime.bigint() - startNs) / 1000n));
  const fallbackResult = (): HookProbeResult => ({
    stdout: eventName === 'PreToolUse' ? { decision: 'allow' } : {},
    event: null,
    stamped: false,
    stampReason: null,
    hookDurationUs: elapsedUs(),
  });

  try {
    const trimmed = rawStdin.trim();
    if (!trimmed) {
      return fallbackResult();
    }
    const parsed = JSON.parse(trimmed) as HookStdinPayload;
    if (!isPlainRecord(parsed)) {
      return fallbackResult();
    }
    eventName = normalizeEventName(parsed as HookStdinPayload);
    if (!eventName) {
      return fallbackResult();
    }

    const typed = parsed as HookStdinPayload;
    const rawCid = typed.conversationId ?? typed.conversation_id;
    const conversationId = isValidUuid(rawCid) ? rawCid : 'unknown';
    const invocationNum = parseInvocationNum(typed.invocationNum ?? typed.invocation_num);
    const modelRaw = firstNonEmptyString(typed.model, typed.modelName, typed.model_name);
    const toolName = firstNonEmptyString(typed.toolName, typed.tool_name);
    const toolCallId = firstNonEmptyString(typed.toolCallId, typed.tool_call_id);
    const stopReason = firstNonEmptyString(typed.stopReason, typed.stop_reason);
    const toolInput = parseToolInput(typed.toolInput ?? typed.tool_input);
    const toolSummary = extractToolSummary(toolInput);
    const subagentRequest = extractSubagentRequest(toolName, toolInput);

    let initialModelMap: ModelMapFile | null = null;
    let modelDisplay: string | undefined;
    if (modelRaw) {
      const paths = getStatePaths(opts.overrideStateDir);
      initialModelMap = readJsonSafe<ModelMapFile | null>(paths.modelMap, null);
      modelDisplay = resolveModelFromMap(modelRaw, initialModelMap)?.label;
    }

    const ts =
      typeof opts.nowMs === 'number' && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
    const iso = new Date(ts).toISOString();

    const ringEvent: HookRingEvent = {
      ts,
      iso,
      event: eventName,
      conversationId,
      ...(invocationNum !== undefined ? { invocationNum } : {}),
      ...(modelRaw ? { modelRaw } : {}),
      ...(modelDisplay ? { modelDisplay } : {}),
      ...(toolName ? { toolName } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(toolSummary ? { toolSummary } : {}),
      ...(subagentRequest ? { subagentRequest } : {}),
      ...(stopReason ? { stopReason } : {}),
      hookDurationUs: elapsedUs(),
    };

    try {
      appendRingLine(ringEvent, opts.overrideStateDir);
    } catch {
      // Fail-open: never block Antigravity agent execution if state dir is unwritable
    }

    if (eventName === 'PreToolUse') {
      return {
        stdout: { decision: 'allow' },
        event: ringEvent,
        stamped: false,
        stampReason: null,
        hookDurationUs: elapsedUs(),
      };
    }

    if (eventName === 'Stop') {
      if (invocationNum === undefined) {
        try {
          advanceTurnEpochOnStop(opts.overrideStateDir, conversationId, iso);
        } catch {
          // Fail-open if stamp-dedup cannot be persisted
        }
      }
      return {
        stdout: {},
        event: ringEvent,
        stamped: false,
        stampReason: null,
        hookDurationUs: elapsedUs(),
      };
    }

    if (eventName === 'PostInvocation') {
      try {
        const stampOutcome = evaluatePostInvocationStamp({
          overrideStateDir: opts.overrideStateDir,
          conversationId,
          invocationNum,
          modelRaw,
          initialModelMap,
          nowIso: iso,
        });
        return {
          stdout: stampOutcome.stdout,
          event: ringEvent,
          stamped: stampOutcome.stamped,
          stampReason: stampOutcome.stampReason,
          hookDurationUs: elapsedUs(),
        };
      } catch {
        return {
          stdout: {},
          event: ringEvent,
          stamped: false,
          stampReason: null,
          hookDurationUs: elapsedUs(),
        };
      }
    }

    return {
      stdout: {},
      event: ringEvent,
      stamped: false,
      stampReason: null,
      hookDurationUs: elapsedUs(),
    };
  } catch {
    return fallbackResult();
  }
}

export function runHookCli(): void {
  let stdout: HookStdoutResponse = {};
  try {
    const stdinText = readFileSync(0, 'utf8');
    stdout = processHookPayload(stdinText).stdout;
  } catch {
    stdout = {};
  }
  process.stdout.write(`${JSON.stringify(stdout)}\n`);
  process.exitCode = 0;
}

const isHookEntrypoint =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module &&
  typeof require.main?.filename === 'string' &&
  /(?:^|[\\/])hook-probe\.(?:c?js|mjs|ts)$/i.test(require.main.filename);

if (isHookEntrypoint) {
  runHookCli();
}
