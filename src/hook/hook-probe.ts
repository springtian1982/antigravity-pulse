import { readFileSync } from 'node:fs';
import { appendRingLine, isValidUuid } from '../state/state-dir';
import type { HookEventName, HookStdinPayload, HookStdoutResponse } from '../types/rpc';
import type { HookRingEvent } from '../types/telemetry';

const KNOWN_HOOK_EVENTS = new Set<HookEventName>([
  'PreInvocation',
  'PostInvocation',
  'PreToolUse',
  'PostToolUse',
  'Stop',
]);

function normalizeEventName(payload: HookStdinPayload): HookEventName | null {
  const raw = payload.hookEventName ?? payload.hook_event_name;
  if (typeof raw === 'string' && KNOWN_HOOK_EVENTS.has(raw as HookEventName)) {
    return raw as HookEventName;
  }
  return null;
}

export function processHookPayload(
  rawStdin: string,
  overrideStateDir?: string
): HookStdoutResponse {
  const startNs = process.hrtime.bigint();
  let eventName: HookEventName | null = null;
  try {
    const trimmed = rawStdin.trim();
    if (!trimmed) {
      return {};
    }
    const parsed = JSON.parse(trimmed) as HookStdinPayload;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    eventName = normalizeEventName(parsed);
    if (!eventName) {
      return {};
    }

    const rawCid = parsed.conversationId ?? parsed.conversation_id;
    const conversationId = isValidUuid(rawCid) ? rawCid : 'unknown';
    const rawInvocationNum = parsed.invocationNum ?? parsed.invocation_num;
    const rawModel = parsed.model ?? parsed.modelName ?? parsed.model_name;
    const rawToolName = parsed.toolName ?? parsed.tool_name;
    const rawToolCallId = parsed.toolCallId ?? parsed.tool_call_id;
    const rawStopReason = parsed.stopReason ?? parsed.stop_reason;

    const durationUs = Number((process.hrtime.bigint() - startNs) / 1000n);
    const ringEvent: HookRingEvent = {
      ts: Date.now(),
      iso: new Date().toISOString(),
      event: eventName,
      conversationId,
      ...(typeof rawInvocationNum === 'number' && Number.isFinite(rawInvocationNum)
        ? { invocationNum: rawInvocationNum }
        : {}),
      ...(typeof rawModel === 'string' && rawModel ? { modelRaw: rawModel } : {}),
      ...(typeof rawToolName === 'string' && rawToolName ? { toolName: rawToolName } : {}),
      ...(typeof rawToolCallId === 'string' && rawToolCallId
        ? { toolCallId: rawToolCallId }
        : {}),
      ...(typeof rawStopReason === 'string' && rawStopReason
        ? { stopReason: rawStopReason }
        : {}),
      hookDurationUs: durationUs,
    };

    try {
      appendRingLine(ringEvent, overrideStateDir);
    } catch {
      // Fail-open: never block Antigravity agent execution if state dir is unwritable
    }

    return eventName === 'PreToolUse' ? { decision: 'allow' } : {};
  } catch {
    return eventName === 'PreToolUse' ? { decision: 'allow' } : {};
  }
}

export function runHookCli(): void {
  let response: HookStdoutResponse = {};
  try {
    const stdinText = readFileSync(0, 'utf8');
    response = processHookPayload(stdinText);
  } catch {
    response = {};
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exitCode = 0;
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  runHookCli();
}
