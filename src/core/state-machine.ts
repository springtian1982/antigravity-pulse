import type {
  GeneratorMetadataEntryRaw,
  SwarmMemberRaw,
  ToolCallRaw,
  TrajectoryStepRaw,
  TrajectorySummaryRaw,
} from '../types/rpc';
import type { CascadeNodeView, HookRingEvent, LifecyclePhase } from '../types/telemetry';
import { parseDurationMs, toIntToken } from './formatters';

export interface StateMachineInput {
  cascadeId: string;
  lsConnected: boolean;
  summary?: TrajectorySummaryRaw | null;
  tailSteps?: TrajectoryStepRaw[];
  latestGenMeta?: GeneratorMetadataEntryRaw | null;
  recentHookEvents?: HookRingEvent[];
  prevNode?: Pick<
    CascadeNodeView,
    'phase' | 'phaseStartedAt' | 'lastTool' | 'stepCount'
  > | null;
  swarmMember?: SwarmMemberRaw | null;
  nowMs?: number;
}

export interface StateMachineResult {
  phase: LifecyclePhase;
  phaseStartedAt: string | null;
  phaseElapsedMs: number;
  lastTool: CascadeNodeView['lastTool'];
  streamingTokPerSec: number | null;
}

const ERROR_REASON_RE = /RESOURCE_EXHAUSTED|429|QUOTA|ERROR|FAILED/i;
const STEP_ERROR_RE = /ERROR|FAILED/i;
const STEP_WAITING_RE = /WAITING|APPROVAL|PENDING_CONFIRM/i;
const PRE_FLIGHT_GRACE_MS = 1500;
const APPROVAL_WAIT_MS = 3000;

function parseValidMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function extractToolSummary(toolCall: ToolCallRaw | undefined): string | undefined {
  const rawArgs = toolCall?.argumentsJson;
  if (!rawArgs || typeof rawArgs !== 'string') {
    return undefined;
  }
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = Object.fromEntries(Object.entries(parsed));
      for (const key of [
        'ToolSummary',
        'Description',
        'CommandLine',
        'TargetFile',
        'AbsolutePath',
        'Path',
        'SearchPath',
        'Query',
        'query',
        'Role',
        'TaskName',
        'Url',
        'url',
      ]) {
        const val = record[key];
        if (typeof val === 'string' && val.trim()) {
          return val.trim().slice(0, 80);
        }
      }
    }
  } catch {
    // Partial JSON during active streaming: fall back to lightweight regex extraction
    const match = /"(?:CommandLine|TargetFile|Description|query|Query|Role)"\s*:\s*"([^"]{1,80})"/i.exec(
      trimmed
    );
    if (match?.[1]) {
      return match[1].trim().slice(0, 80);
    }
  }
  return undefined;
}

function isApprovalSignaled(
  step: TrajectoryStepRaw | undefined,
  hook: HookRingEvent | undefined
): boolean {
  if (step?.status && STEP_WAITING_RE.test(step.status)) {
    return true;
  }
  const rawArgs = step?.metadata?.toolCall?.argumentsJson;
  if (typeof rawArgs === 'string' && rawArgs.trim()) {
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const rec = Object.fromEntries(Object.entries(parsed));
        if (
          rec.SafeToAutoRun === false ||
          rec.safeToAutoRun === false ||
          rec.ask === true ||
          rec.force_ask === true ||
          rec.approvalRequired === true ||
          rec.waitForApproval === true
        ) {
          return true;
        }
      }
    } catch {
      if (/"(?:SafeToAutoRun|safeToAutoRun)"\s*:\s*false|"(?:ask|force_ask|approvalRequired)"\s*:\s*true/i.test(rawArgs)) {
        return true;
      }
    }
  }

  const hookSignals = `${hook?.toolSummary ?? ''} ${hook?.stopReason ?? ''}`;
  return /\b(?:ask|force_ask|approval_required|awaiting_approval)\b/i.test(hookSignals);
}

function inferSwarmFallbackPhase(member: SwarmMemberRaw | null | undefined): LifecyclePhase | null {
  if (!member) {
    return null;
  }
  if (member.killed || member.desired_state === 'killed' || member.desired_state === 'stopped') {
    return 'IDLE';
  }
  const raw = `${member.phase ?? ''} ${member.desired_state ?? ''}`.toLowerCase();
  if (!raw.trim()) {
    return null;
  }
  if (/error|quota|fail/.test(raw)) return 'ERROR_OR_QUOTA';
  if (/block|approv|wait/.test(raw)) return 'BLOCKED_APPROVAL';
  if (/stream/.test(raw)) return 'STREAMING';
  if (/think/.test(raw)) return 'THINKING';
  if (/tool/.test(raw)) return 'TOOL_RUNNING';
  if (/run|active|start|busy/.test(raw)) return 'PRE_FLIGHT';
  if (/idle|done|complete|sleep/.test(raw)) return 'IDLE';
  return null;
}

function computeProvisionalTokPerSec(
  latestGenMeta: GeneratorMetadataEntryRaw | null | undefined,
  stepCount: number
): number | null {
  const chatModel = latestGenMeta?.chatModel;
  if (!chatModel) {
    return null;
  }
  const indices = latestGenMeta.stepIndices ?? [];
  if (indices.length > 0 && stepCount > 0) {
    const maxIdx = Math.max(...indices);
    if (maxIdx < Math.max(0, stepCount - 4)) {
      return null;
    }
  }
  const streamMs = parseDurationMs(chatModel.streamingDuration);
  if (streamMs <= 0) {
    return null;
  }
  const responseOut = toIntToken(chatModel.usage?.responseOutputTokens);
  const totalOut = toIntToken(chatModel.usage?.outputTokens);
  const tokens = responseOut > 0 ? responseOut : totalOut;
  if (tokens <= 0) {
    return null;
  }
  return Math.round((tokens / (streamMs / 1000)) * 10) / 10;
}

function isActiveLifecyclePhase(phase: LifecyclePhase): boolean {
  return (
    phase === 'PRE_FLIGHT' ||
    phase === 'THINKING' ||
    phase === 'STREAMING' ||
    phase === 'TOOL_RUNNING' ||
    phase === 'BLOCKED_APPROVAL'
  );
}

export function deriveCascadePhase(input: StateMachineInput): StateMachineResult {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const steps = input.tailSteps ?? [];
  const latestStep = steps.length > 0 ? steps[steps.length - 1] : undefined;

  const cascadeHooks = (input.recentHookEvents ?? [])
    .filter((ev) => ev.conversationId === input.cascadeId)
    .sort((a, b) => a.ts - b.ts);
  const latestHook = cascadeHooks.length > 0 ? cascadeHooks[cascadeHooks.length - 1] : undefined;
  const latestPreToolHook = [...cascadeHooks]
    .reverse()
    .find((ev) => ev.event === 'PreToolUse');

  const status = input.summary?.status ?? '';
  const isLsRunning = status === 'CASCADE_RUN_STATUS_RUNNING';
  const hasErrorReason = ERROR_REASON_RE.test(
    input.summary?.latestExecutorTerminationReason ?? ''
  );
  const latestStepIsError = STEP_ERROR_RE.test(latestStep?.status ?? '');

  const stepTimestamps = [
    parseValidMs(latestStep?.metadata?.finishedGeneratingAt),
    parseValidMs(latestStep?.metadata?.viewableAt),
    parseValidMs(latestStep?.metadata?.createdAt),
  ].filter((t): t is number => t !== null);
  const latestStepMs = stepTimestamps.length > 0 ? Math.max(...stepTimestamps) : 0;
  const summaryModifiedMs = parseValidMs(input.summary?.lastModifiedTime) ?? 0;

  let phase: LifecyclePhase = 'IDLE';
  let lastTool: CascadeNodeView['lastTool'] = input.prevNode?.lastTool ?? null;
  let streamingTokPerSec: number | null = null;
  let candidateStartIso: string | null = null;

  if (input.lsConnected && !isLsRunning) {
    if (hasErrorReason || latestStepIsError) {
      phase = 'ERROR_OR_QUOTA';
      candidateStartIso = input.summary?.lastModifiedTime ?? null;
    } else {
      // Anti-Stale Reconciler: only allow <=1500ms PreInvocation grace when no Stop arrived after it
      const withinPreFlightGrace =
        latestHook?.event === 'PreInvocation' &&
        nowMs - latestHook.ts <= PRE_FLIGHT_GRACE_MS &&
        latestHook.ts >= summaryModifiedMs &&
        (!input.prevNode ||
          input.prevNode.phase === 'IDLE' ||
          input.prevNode.phase === 'PRE_FLIGHT');

      if (withinPreFlightGrace && latestHook) {
        phase = 'PRE_FLIGHT';
        candidateStartIso = latestHook.iso;
      } else {
        phase = 'IDLE';
        candidateStartIso = input.summary?.lastModifiedTime ?? null;
      }
    }
  } else if (isLsRunning) {
    // Active RUNNING cascade: fuse tail steps with newer T=0ms Hook events
    const isActionableHook =
      latestHook &&
      latestHook.ts > latestStepMs &&
      (latestHook.event === 'Stop' ||
        latestHook.event === 'PreToolUse' ||
        latestHook.event === 'PostToolUse' ||
        latestHook.event === 'PreInvocation');

    if (latestStepIsError && !isActionableHook) {
      phase = 'ERROR_OR_QUOTA';
      candidateStartIso = latestStep?.metadata?.createdAt ?? nowIso;
    } else if (isActionableHook && latestHook) {
      if (latestHook.event === 'Stop') {
        phase = 'IDLE';
        candidateStartIso = latestHook.iso;
      } else if (latestHook.event === 'PreToolUse') {
        lastTool = {
          ...(latestHook.toolCallId ? { id: latestHook.toolCallId } : {}),
          name: latestHook.toolName || 'tool',
          ...(latestHook.toolSummary ? { summary: latestHook.toolSummary } : {}),
          startedAt: latestHook.iso,
        };
        const toolWaitMs = Math.max(0, nowMs - latestHook.ts);
        if (
          isApprovalSignaled(latestStep, latestHook) &&
          (toolWaitMs > APPROVAL_WAIT_MS ||
            STEP_WAITING_RE.test(latestStep?.status ?? '') ||
            /force_ask|approval_required/i.test(latestHook.stopReason ?? ''))
        ) {
          phase = 'BLOCKED_APPROVAL';
        } else {
          phase = 'TOOL_RUNNING';
        }
        candidateStartIso = latestHook.iso;
      } else if (latestHook.event === 'PostToolUse') {
        phase = 'THINKING';
        candidateStartIso = latestHook.iso;
      } else if (latestHook.event === 'PreInvocation') {
        if (latestStep?.status === 'CORTEX_STEP_STATUS_GENERATING') {
          if (latestStep.metadata?.viewableAt && !latestStep.metadata?.finishedGeneratingAt) {
            phase = 'STREAMING';
            candidateStartIso = latestStep.metadata.viewableAt;
            streamingTokPerSec = computeProvisionalTokPerSec(
              input.latestGenMeta,
              input.summary?.stepCount ?? 0
            );
          } else {
            phase = 'THINKING';
            candidateStartIso = latestStep.metadata?.createdAt ?? latestHook.iso;
          }
        } else {
          phase = 'PRE_FLIGHT';
          candidateStartIso = latestHook.iso;
        }
      }
    } else if (latestStep) {
      if (latestStep.status === 'CORTEX_STEP_STATUS_GENERATING') {
        if (latestStep.metadata?.viewableAt && !latestStep.metadata?.finishedGeneratingAt) {
          phase = 'STREAMING';
          candidateStartIso = latestStep.metadata.viewableAt;
          streamingTokPerSec = computeProvisionalTokPerSec(
            input.latestGenMeta,
            input.summary?.stepCount ?? 0
          );
        } else {
          phase = 'THINKING';
          candidateStartIso = latestStep.metadata?.createdAt ?? nowIso;
        }
      } else if (STEP_WAITING_RE.test(latestStep.status ?? '')) {
        if (latestStep.metadata?.toolCall) {
          const summary = extractToolSummary(latestStep.metadata.toolCall);
          lastTool = {
            ...(latestStep.metadata.toolCall.id ? { id: latestStep.metadata.toolCall.id } : {}),
            name: latestStep.metadata.toolCall.name || 'tool',
            ...(summary ? { summary } : {}),
            ...(latestStep.metadata.createdAt ? { startedAt: latestStep.metadata.createdAt } : {}),
          };
        }
        phase = 'BLOCKED_APPROVAL';
        candidateStartIso = latestStep.metadata?.createdAt ?? nowIso;
      } else if (
        latestStep.status === 'CORTEX_STEP_STATUS_RUNNING' &&
        latestStep.metadata?.toolCall
      ) {
        const tc = latestStep.metadata.toolCall;
        const summary = extractToolSummary(tc);
        const startedAt =
          latestStep.metadata?.createdAt ??
          latestPreToolHook?.iso ??
          input.prevNode?.lastTool?.startedAt ??
          nowIso;
        lastTool = {
          ...(tc.id ? { id: tc.id } : {}),
          name: tc.name || 'tool',
          ...(summary ? { summary } : {}),
          startedAt,
        };
        const startMs = parseValidMs(startedAt) ?? nowMs;
        const approvalSignal = isApprovalSignaled(latestStep, latestPreToolHook);
        if (approvalSignal && nowMs - startMs > APPROVAL_WAIT_MS) {
          phase = 'BLOCKED_APPROVAL';
        } else {
          phase = 'TOOL_RUNNING';
        }
        candidateStartIso = startedAt;
      } else {
        phase = 'THINKING';
        candidateStartIso = latestStep.metadata?.createdAt ?? nowIso;
      }
    } else if (
      input.prevNode &&
      isActiveLifecyclePhase(input.prevNode.phase)
    ) {
      phase = input.prevNode.phase;
      candidateStartIso = input.prevNode.phaseStartedAt ?? nowIso;
    } else {
      phase = 'PRE_FLIGHT';
      candidateStartIso = input.summary?.lastModifiedTime ?? nowIso;
    }
  } else {
    // LS disconnected / unbacked synthetic node (e.g. hook-only or swarm_member without trajectory)
    const swarmPhase = inferSwarmFallbackPhase(input.swarmMember);
    if (swarmPhase) {
      phase = swarmPhase;
      candidateStartIso = input.summary?.lastModifiedTime ?? nowIso;
    } else if (latestHook) {
      switch (latestHook.event) {
        case 'PreInvocation':
          phase = 'PRE_FLIGHT';
          candidateStartIso = latestHook.iso;
          break;
        case 'PreToolUse':
          lastTool = {
            ...(latestHook.toolCallId ? { id: latestHook.toolCallId } : {}),
            name: latestHook.toolName || 'tool',
            ...(latestHook.toolSummary ? { summary: latestHook.toolSummary } : {}),
            startedAt: latestHook.iso,
          };
          phase = 'TOOL_RUNNING';
          candidateStartIso = latestHook.iso;
          break;
        case 'PostToolUse':
          phase = 'THINKING';
          candidateStartIso = latestHook.iso;
          break;
        case 'Stop':
          phase = 'IDLE';
          candidateStartIso = latestHook.iso;
          break;
        default:
          phase = input.prevNode?.phase ?? 'IDLE';
          candidateStartIso = input.prevNode?.phaseStartedAt ?? null;
          break;
      }
    } else if (hasErrorReason) {
      phase = 'ERROR_OR_QUOTA';
      candidateStartIso = input.summary?.lastModifiedTime ?? null;
    } else {
      phase = 'IDLE';
      candidateStartIso = input.summary?.lastModifiedTime ?? null;
    }
  }

  let phaseStartedAt = candidateStartIso;
  if (isActiveLifecyclePhase(phase)) {
    const samePhase = input.prevNode?.phase === phase;
    const sameTool =
      phase !== 'TOOL_RUNNING' ||
      ((!lastTool?.id || lastTool.id === input.prevNode?.lastTool?.id) &&
        lastTool?.name === input.prevNode?.lastTool?.name);
    if (samePhase && sameTool && input.prevNode?.phaseStartedAt) {
      phaseStartedAt = input.prevNode.phaseStartedAt;
    } else if (!phaseStartedAt) {
      phaseStartedAt = nowIso;
    }
  }

  const startedMs = parseValidMs(phaseStartedAt);
  const phaseElapsedMs =
    isActiveLifecyclePhase(phase) && startedMs !== null
      ? Math.max(0, nowMs - startedMs)
      : 0;

  return {
    phase,
    phaseStartedAt,
    phaseElapsedMs,
    lastTool,
    streamingTokPerSec,
  };
}
