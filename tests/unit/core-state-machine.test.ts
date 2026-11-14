import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveCascadePhase, extractToolSummary } from '../../src/core/state-machine';
import type { HookRingEvent } from '../../src/types/telemetry';

const CID = '11111111-1111-4111-8111-111111111111';

describe('core/state-machine — 7-state lifecycle & Anti-Stale Reconciler (RTM-21)', () => {
  it('transitions cleanly across all 7 states: IDLE -> PRE_FLIGHT -> THINKING -> STREAMING -> TOOL_RUNNING -> BLOCKED_APPROVAL -> ERROR_OR_QUOTA -> IDLE', () => {
    const baseMs = Date.parse('2026-11-14T10:00:00.000Z');

    // 1. IDLE
    const idle = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_IDLE', lastModifiedTime: '2026-11-14T09:59:50.000Z' },
      nowMs: baseMs,
    });
    assert.equal(idle.phase, 'IDLE');
    assert.equal(idle.phaseElapsedMs, 0);

    // 2. PRE_FLIGHT (PreInvocation grace window <= 1500ms before LS flips to RUNNING)
    const preInvHook: HookRingEvent = {
      ts: baseMs + 200,
      iso: new Date(baseMs + 200).toISOString(),
      event: 'PreInvocation',
      conversationId: CID,
    };
    const preflight = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_IDLE', lastModifiedTime: '2026-11-14T09:59:50.000Z' },
      recentHookEvents: [preInvHook],
      nowMs: baseMs + 700,
    });
    assert.equal(preflight.phase, 'PRE_FLIGHT');
    assert.equal(preflight.phaseElapsedMs, 500);

    // 3. THINKING (RUNNING + CORTEX_STEP_STATUS_GENERATING without viewableAt)
    const thinking = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 2 },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_GENERATING',
          metadata: { createdAt: new Date(baseMs + 1000).toISOString() },
        },
      ],
      recentHookEvents: [preInvHook],
      nowMs: baseMs + 4500,
    });
    assert.equal(thinking.phase, 'THINKING');
    assert.equal(thinking.phaseElapsedMs, 3500);

    // 4. STREAMING (viewableAt present, no finishedGeneratingAt)
    const streaming = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 2 },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_GENERATING',
          metadata: {
            createdAt: new Date(baseMs + 1000).toISOString(),
            viewableAt: new Date(baseMs + 5000).toISOString(),
          },
        },
      ],
      latestGenMeta: {
        stepIndices: [1],
        chatModel: {
          streamingDuration: '2.0s',
          usage: { responseOutputTokens: '100' },
        },
      },
      nowMs: baseMs + 6000,
    });
    assert.equal(streaming.phase, 'STREAMING');
    assert.equal(streaming.phaseElapsedMs, 1000);
    assert.equal(streaming.streamingTokPerSec, 50);

    // 5. TOOL_RUNNING (T=0ms PreToolUse acceleration & LS step)
    const preToolHook: HookRingEvent = {
      ts: baseMs + 7000,
      iso: new Date(baseMs + 7000).toISOString(),
      event: 'PreToolUse',
      conversationId: CID,
      toolName: 'run_command',
      toolCallId: 'tc-1',
      toolSummary: 'npm test',
    };
    const toolRunning = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 3 },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_GENERATING',
          metadata: {
            createdAt: new Date(baseMs + 1000).toISOString(),
            viewableAt: new Date(baseMs + 5000).toISOString(),
            finishedGeneratingAt: new Date(baseMs + 6800).toISOString(),
          },
        },
      ],
      recentHookEvents: [preToolHook],
      nowMs: baseMs + 7500,
    });
    assert.equal(toolRunning.phase, 'TOOL_RUNNING');
    assert.equal(toolRunning.lastTool?.name, 'run_command');
    assert.equal(toolRunning.lastTool?.summary, 'npm test');
    assert.equal(toolRunning.phaseElapsedMs, 500);

    // Normal read-only tool running 10s must remain TOOL_RUNNING (no false BLOCKED_APPROVAL)
    const longReadTool = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 4 },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_RUNNING',
          metadata: {
            createdAt: new Date(baseMs + 7000).toISOString(),
            toolCall: {
              id: 'tc-ro',
              name: 'grep_search',
              argumentsJson: JSON.stringify({ Query: 'ReadOnlyLsClient' }),
            },
          },
        },
      ],
      nowMs: baseMs + 18_000,
    });
    assert.equal(longReadTool.phase, 'TOOL_RUNNING');
    assert.equal(longReadTool.lastTool?.summary, 'ReadOnlyLsClient');

    // 6. BLOCKED_APPROVAL (explicit waiting status AND SafeToAutoRun:false > 3000ms)
    const blockedByStatus = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 4 },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_WAITING',
          metadata: {
            createdAt: new Date(baseMs + 8000).toISOString(),
            toolCall: {
              id: 'tc-2',
              name: 'run_command',
              argumentsJson: JSON.stringify({ CommandLine: 'rm -rf tmp', SafeToAutoRun: false }),
            },
          },
        },
      ],
      nowMs: baseMs + 8200,
    });
    assert.equal(blockedByStatus.phase, 'BLOCKED_APPROVAL');

    const blockedByWait = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 4 },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_RUNNING',
          metadata: {
            createdAt: new Date(baseMs + 8000).toISOString(),
            toolCall: {
              id: 'tc-3',
              name: 'run_command',
              argumentsJson: JSON.stringify({ CommandLine: 'git push', SafeToAutoRun: false }),
            },
          },
        },
      ],
      nowMs: baseMs + 11_500,
    });
    assert.equal(blockedByWait.phase, 'BLOCKED_APPROVAL');

    // PostToolUse returns to THINKING
    const postToolHook: HookRingEvent = {
      ts: baseMs + 12_000,
      iso: new Date(baseMs + 12_000).toISOString(),
      event: 'PostToolUse',
      conversationId: CID,
      toolCallId: 'tc-3',
    };
    const backToThinking = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 5 },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_RUNNING',
          metadata: { createdAt: new Date(baseMs + 8000).toISOString() },
        },
      ],
      recentHookEvents: [postToolHook],
      nowMs: baseMs + 12_200,
    });
    assert.equal(backToThinking.phase, 'THINKING');

    // 7. ERROR_OR_QUOTA
    const quotaError = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        latestExecutorTerminationReason: 'RESOURCE_EXHAUSTED: 429 quota exceeded',
        lastModifiedTime: new Date(baseMs + 13_000).toISOString(),
      },
      nowMs: baseMs + 14_000,
    });
    assert.equal(quotaError.phase, 'ERROR_OR_QUOTA');

    // Recovery: fresh RUNNING turn clears historical termination reason
    const recovered = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: {
        status: 'CASCADE_RUN_STATUS_RUNNING',
        latestExecutorTerminationReason: 'RESOURCE_EXHAUSTED: 429 quota exceeded',
        stepCount: 6,
      },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_GENERATING',
          metadata: { createdAt: new Date(baseMs + 15_000).toISOString() },
        },
      ],
      nowMs: baseMs + 15_500,
    });
    assert.equal(recovered.phase, 'THINKING');
  });

  it('Anti-Stale Reconciler kills phantom THINKING/TOOL_RUNNING when LS status !== RUNNING', () => {
    const baseMs = Date.parse('2026-11-14T10:00:00.000Z');

    // Phantom THINKING must unconditionally converge to IDLE when LS says IDLE
    const reconciledThinking = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: new Date(baseMs).toISOString(),
      },
      prevNode: {
        phase: 'THINKING',
        phaseStartedAt: new Date(baseMs - 20_000).toISOString(),
        lastTool: null,
        stepCount: 5,
      },
      nowMs: baseMs + 500,
    });
    assert.equal(reconciledThinking.phase, 'IDLE');
    assert.equal(reconciledThinking.phaseElapsedMs, 0);

    // Phantom TOOL_RUNNING even with an old PreToolUse hook converges to IDLE
    const reconciledTool = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: {
        status: 'CASCADE_RUN_STATUS_DONE',
        lastModifiedTime: new Date(baseMs).toISOString(),
      },
      recentHookEvents: [
        {
          ts: baseMs - 500,
          iso: new Date(baseMs - 500).toISOString(),
          event: 'PreToolUse',
          conversationId: CID,
          toolName: 'run_command',
        },
      ],
      prevNode: {
        phase: 'TOOL_RUNNING',
        phaseStartedAt: new Date(baseMs - 500).toISOString(),
        lastTool: { name: 'run_command' },
        stepCount: 5,
      },
      nowMs: baseMs + 200,
    });
    assert.equal(reconciledTool.phase, 'IDLE');

    // Expired PreInvocation grace (>1500ms) also converges to IDLE
    const expiredGrace = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: {
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: new Date(baseMs - 5000).toISOString(),
      },
      recentHookEvents: [
        {
          ts: baseMs - 2000,
          iso: new Date(baseMs - 2000).toISOString(),
          event: 'PreInvocation',
          conversationId: CID,
        },
      ],
      prevNode: {
        phase: 'PRE_FLIGHT',
        phaseStartedAt: new Date(baseMs - 2000).toISOString(),
        lastTool: null,
        stepCount: 5,
      },
      nowMs: baseMs,
    });
    assert.equal(expiredGrace.phase, 'IDLE');
  });

  it('preserves active phaseStartedAt across polls and extracts partial JSON tool summaries safely', () => {
    const startIso = '2026-11-14T10:00:00.000Z';
    const baseMs = Date.parse(startIso);

    const sameTool = deriveCascadePhase({
      cascadeId: CID,
      lsConnected: true,
      summary: { status: 'CASCADE_RUN_STATUS_RUNNING', stepCount: 3 },
      tailSteps: [
        {
          status: 'CORTEX_STEP_STATUS_RUNNING',
          metadata: {
            createdAt: '2026-11-14T10:00:04.000Z',
            toolCall: { id: 'tc-1', name: 'run_command', argumentsJson: '{"CommandLine":"npm test"}' },
          },
        },
      ],
      prevNode: {
        phase: 'TOOL_RUNNING',
        phaseStartedAt: startIso,
        lastTool: { id: 'tc-1', name: 'run_command', startedAt: startIso },
        stepCount: 3,
      },
      nowMs: baseMs + 5000,
    });
    assert.equal(sameTool.phaseStartedAt, startIso);
    assert.equal(sameTool.phaseElapsedMs, 5000);

    // Partial streaming JSON extraction
    assert.equal(
      extractToolSummary({ name: 'view_file', argumentsJson: '{"AbsolutePath":"/tmp/foo.ts", "Start' }),
      undefined
    );
    assert.equal(
      extractToolSummary({ name: 'run_command', argumentsJson: '{"CommandLine":"ls -la", "Safe' }),
      'ls -la'
    );
  });
});
