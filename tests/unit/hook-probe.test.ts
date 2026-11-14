import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { processHookPayload } from '../../src/hook/hook-probe';
import { saveConfig, DEFAULT_PULSE_USER_CONFIG } from '../../src/state/config-store';
import {
  getStatePaths,
  writeJsonAtomic,
  type LiveSnapshotFile,
  type ModelMapFile,
  type QuotaCacheFile,
  type StampDedupFile,
} from '../../src/state/state-dir';
import type { CascadeNodeView, HookRingEvent, QuotaSummaryView } from '../../src/types/telemetry';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'pulse-hook-unit-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        // ignore if non-existent or unmodifiable
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeQuotaSummary(gemini5hPct: number | null): QuotaSummaryView {
  return {
    fetchedAt: '2026-11-14T10:00:00.000Z',
    buckets: [],
    gemini5h:
      gemini5hPct === null
        ? null
        : {
            bucketId: 'gemini-5h',
            displayName: 'Gemini 5h',
            window: '5h',
            remainingFraction: gemini5hPct / 100,
            remainingPct: gemini5hPct,
            resetTime: '2026-11-14T15:00:00.000Z',
            resetInSeconds: 7200,
            resetInLabel: '2h 0m',
            isLowAlert: gemini5hPct < 15,
          },
    geminiWeekly: null,
    thirdParty5h: null,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: null,
    burnRate5hPctPerMin: null,
  };
}

function makeCascadeNode(
  cascadeId: string,
  overrides: Partial<CascadeNodeView> = {}
): CascadeNodeView {
  return {
    cascadeId,
    rootCascadeId: cascadeId,
    parentCascadeId: null,
    kind: 'root',
    title: 'Test Cascade',
    role: null,
    typeName: null,
    depth: 0,
    status: 'CASCADE_RUN_STATUS_RUNNING',
    phase: 'THINKING',
    phaseStartedAt: '2026-11-14T10:00:00.000Z',
    phaseElapsedMs: 1200,
    requestedModel: {
      raw: 'MODEL_PLACEHOLDER_M427',
      displayName: 'Gemini 4 Carbon (High)',
      modelId: 'gemini-4-carbon-high',
      source: 'user',
    },
    servedModel: {
      responseModel: 'gemini-4-carbon',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier: 'apex',
    },
    routingStatus: 'matched',
    retryCount: 0,
    lastTool: null,
    stepCount: 4,
    turnCount: 1,
    streamingTokPerSec: null,
    contextWindow: {
      estimatedTokensUsed: 38_400,
      maxContextTokens: 256_000,
      pct: 15,
      level: 'normal',
    },
    cacheHitPct: 90,
    tokens: {
      inputTokens: 1000,
      cacheReadTokens: 9000,
      outputTokens: 500,
      thinkingOutputTokens: 300,
      responseOutputTokens: 200,
    },
    deltaQuota5hPct: 0.1,
    lastTtftMs: 12_100,
    lastStreamingMs: 3_200,
    lastModifiedTime: '2026-11-14T10:00:00.000Z',
    spawnStepIndex: null,
    childrenIds: [],
    ...overrides,
  };
}

function writeSnapshotFixture(
  stateDir: string,
  cascadeId: string,
  nodeOverrides: Partial<CascadeNodeView> = {},
  gemini5hPct: number | null = 84.3,
  updatedAt = '2026-11-14T10:00:00.000Z'
): void {
  const paths = getStatePaths(stateDir);
  const quota = makeQuotaSummary(gemini5hPct);
  const node = makeCascadeNode(cascadeId, nodeOverrides);
  const snapshot: LiveSnapshotFile = {
    schemaVersion: 1,
    updatedAt,
    hostConnected: true,
    activeConversationId: cascadeId,
    nodesByCascadeId: { [cascadeId]: node },
    fleet: {
      etag: 'abc123',
      generatedAt: updatedAt,
      hostConnected: true,
      activeHeadline: {
        runningRoots: 1,
        runningSubagents: 0,
        totalRunningNodes: 1,
        modelHistogram: [],
      },
      projects: [],
      topQuotaBurners: [],
      quota,
    },
    quota,
  };
  writeJsonAtomic(paths.liveSnapshot, snapshot);
}

function writeModelMapFixture(stateDir: string): void {
  const paths = getStatePaths(stateDir);
  const modelMap: ModelMapFile = {
    schemaVersion: 1,
    updatedAt: '2026-11-14T10:00:00.000Z',
    defaultModelEnum: 'MODEL_PLACEHOLDER_M427',
    modelsByEnum: {
      MODEL_PLACEHOLDER_M427: {
        modelEnum: 'MODEL_PLACEHOLDER_M427',
        modelId: 'gemini-4-carbon-high',
        label: 'Gemini 4 Carbon (High)',
        family: 'gemini',
        effortTier: 'high',
        tier: 'apex',
        isOrchestrator: false,
      },
      MODEL_PLACEHOLDER_M418: {
        modelEnum: 'MODEL_PLACEHOLDER_M418',
        modelId: 'gemini-4-argon-medium',
        label: 'Gemini 4 Argon (Medium)',
        family: 'gemini',
        effortTier: 'medium',
        tier: 'workhorse',
        isOrchestrator: false,
      },
    },
  };
  writeJsonAtomic(paths.modelMap, modelMap);
}

function readRingEvents(stateDir: string): HookRingEvent[] {
  const { eventsRing } = getStatePaths(stateDir);
  const text = readFileSync(eventsRing, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').map((line) => JSON.parse(line) as HookRingEvent);
}

function makeUuid(index: number): string {
  const hex = index.toString(16).padStart(12, '0');
  return `10000000-0000-4000-8000-${hex}`;
}

describe('hook-probe event parsing, stdout contract & ring append', () => {
  it('handles camelCase & snake_case events, UUID validation, invoke_subagent extraction, and toolSummary truncation', () => {
    const stateDir = makeTempDir();
    writeModelMapFixture(stateDir);
    const cid = '198d5aa0-44bb-4273-9a52-b83805a34a3a';

    // 1. PreToolUse with invoke_subagent (snake_case)
    const longTask = 'Analyze all TypeScript modules across src/core and verify cache hit invariants without touching disk';
    const preSubagent = processHookPayload(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        conversation_id: cid,
        invocation_num: 2,
        model_name: 'MODEL_PLACEHOLDER_M427',
        tool_name: 'invoke_subagent',
        tool_call_id: 'call-sub-1',
        tool_input: {
          Role: 'Core Auditor',
          subagent_type: 'self',
          Model: 'argon',
          Task: longTask,
        },
      }),
      { overrideStateDir: stateDir, nowMs: 1_700_000_000_100 }
    );
    assert.deepEqual(preSubagent.stdout, { decision: 'allow' });
    assert.equal(preSubagent.stamped, false);
    assert.ok(preSubagent.event);
    assert.equal(preSubagent.event.conversationId, cid);
    assert.equal(preSubagent.event.modelDisplay, 'Gemini 4 Carbon (High)');
    assert.deepEqual(preSubagent.event.subagentRequest, {
      role: 'Core Auditor',
      typeName: 'self',
      model: 'argon',
    });
    assert.ok(preSubagent.event.toolSummary && preSubagent.event.toolSummary.length <= 80);
    assert.ok(preSubagent.event.toolSummary.endsWith('...'));

    // 2. PreToolUse with PascalCase/camelCase invoke_subagent + run_command
    const preRun = processHookPayload(
      JSON.stringify({
        hookEventName: 'PreToolUse',
        conversationId: cid,
        toolName: 'run_command',
        toolCallId: 'call-cmd-1',
        toolInput: {
          ToolSummary: 'Unit test execution',
          CommandLine: 'npm test',
        },
      }),
      { overrideStateDir: stateDir, nowMs: 1_700_000_000_200 }
    );
    assert.deepEqual(preRun.stdout, { decision: 'allow' });
    assert.equal(preRun.event?.toolSummary, 'Unit test execution');
    assert.equal(preRun.event?.subagentRequest, undefined);

    // 3. PostToolUse, PreInvocation, Stop emit {}
    for (const ev of ['PostToolUse', 'PreInvocation', 'Stop'] as const) {
      const res = processHookPayload(
        JSON.stringify({
          hookEventName: ev,
          conversationId: cid,
          invocationNum: 2,
          stopReason: ev === 'Stop' ? 'NO_TOOL_CALL' : undefined,
        }),
        { overrideStateDir: stateDir }
      );
      assert.deepEqual(res.stdout, {});
    }

    // 4. Invalid / traversal conversationId coerces cleanly to 'unknown'
    const badCidRes = processHookPayload(
      JSON.stringify({
        hookEventName: 'PreToolUse',
        conversationId: '../../etc/passwd',
        toolName: 'read_file',
        toolInput: { TargetFile: '/tmp/foo.ts' },
      }),
      { overrideStateDir: stateDir }
    );
    assert.deepEqual(badCidRes.stdout, { decision: 'allow' });
    assert.equal(badCidRes.event?.conversationId, 'unknown');

    const ring = readRingEvents(stateDir);
    assert.equal(ring.length, 6);
    assert.equal(ring[0].event, 'PreToolUse');
    assert.equal(ring[0].subagentRequest?.role, 'Core Auditor');
    assert.equal(ring[5].conversationId, 'unknown');
  });
});

describe('hook-probe PostInvocation inline stamp modes & smart triggers (RTM-03, RTM-17)', () => {
  it('suppresses all stamps in off mode', () => {
    const stateDir = makeTempDir();
    const cid = makeUuid(1);
    saveConfig({ ...DEFAULT_PULSE_USER_CONFIG, inlineStampMode: 'off' }, stateDir);
    writeSnapshotFixture(stateDir, cid, { retryCount: 2, contextWindow: { estimatedTokensUsed: 200_000, maxContextTokens: 256_000, pct: 80, level: 'warn_70' } }, 10.5);

    const res = processHookPayload(
      JSON.stringify({
        hookEventName: 'PostInvocation',
        conversationId: cid,
        invocationNum: 1,
        model: 'MODEL_PLACEHOLDER_M427',
      }),
      { overrideStateDir: stateDir }
    );
    assert.deepEqual(res.stdout, {});
    assert.equal(res.stamped, false);
  });

  it('stamps every distinct turn in every-turn mode (with and without invocationNum) and deduplicates same-turn repeats', () => {
    const stateDir = makeTempDir();
    const cid = makeUuid(2);
    saveConfig({ ...DEFAULT_PULSE_USER_CONFIG, inlineStampMode: 'every-turn' }, stateDir);
    writeSnapshotFixture(stateDir, cid);

    // With explicit invocationNum
    const t1 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 1 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(t1.stamped, true);
    assert.ok('injectSteps' in t1.stdout);
    assert.equal(t1.stdout.injectSteps[0].systemMessage.systemMessage, '');
    assert.ok(
      t1.stdout.injectSteps[0].systemMessage.metadata.user_markdown.includes(
        'sidecar://antigravity-pulse/pulse_cockpit/hud'
      )
    );

    // Duplicate same invocationNum -> skipped
    const t1Dup = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 1 }),
      { overrideStateDir: stateDir }
    );
    assert.deepEqual(t1Dup.stdout, {});
    assert.equal(t1Dup.stamped, false);

    // Next invocationNum -> stamps again
    const t2 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 2 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(t2.stamped, true);

    // Without invocationNum: Stop advances turnEpoch cleanly across turns
    const cidNoNum = makeUuid(3);
    writeSnapshotFixture(stateDir, cidNoNum);
    processHookPayload(JSON.stringify({ hookEventName: 'PreInvocation', conversationId: cidNoNum }), {
      overrideStateDir: stateDir,
    });
    const noNum1 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cidNoNum }),
      { overrideStateDir: stateDir }
    );
    assert.equal(noNum1.stamped, true);

    const noNum1Dup = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cidNoNum }),
      { overrideStateDir: stateDir }
    );
    assert.equal(noNum1Dup.stamped, false);

    const stopRes = processHookPayload(
      JSON.stringify({ hookEventName: 'Stop', conversationId: cidNoNum }),
      { overrideStateDir: stateDir }
    );
    assert.deepEqual(stopRes.stdout, {});

    processHookPayload(JSON.stringify({ hookEventName: 'PreInvocation', conversationId: cidNoNum }), {
      overrideStateDir: stateDir,
    });
    const noNum2 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cidNoNum }),
      { overrideStateDir: stateDir }
    );
    assert.equal(noNum2.stamped, true);
  });

  it('advances turnEpoch monotonically when mixing numbered invocations with unnumbered Stop & PostInvocation ([Minor 4] regression)', () => {
    const stateDir = makeTempDir();
    const cid = makeUuid(13);
    saveConfig({ ...DEFAULT_PULSE_USER_CONFIG, inlineStampMode: 'every-turn' }, stateDir);
    writeSnapshotFixture(stateDir, cid);

    const t1 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 1 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(t1.stamped, true);

    const t2 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 2 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(t2.stamped, true);

    const stopNoNum = processHookPayload(
      JSON.stringify({ hookEventName: 'Stop', conversationId: cid }),
      { overrideStateDir: stateDir }
    );
    assert.deepEqual(stopNoNum.stdout, {});

    // Turn 3 without invocationNum must advance beyond lastInvocationNum: 2 -> epoch 3 and stamp cleanly
    const t3 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid }),
      { overrideStateDir: stateDir }
    );
    assert.equal(t3.stamped, true);
    assert.ok('injectSteps' in t3.stdout);

    // Same-turn duplicate in Turn 3 without invocationNum must still dedup
    const t3Dup = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid }),
      { overrideStateDir: stateDir }
    );
    assert.equal(t3Dup.stamped, false);
    assert.deepEqual(t3Dup.stdout, {});
  });

  it('evaluates all 5 smart triggers accurately without spamming steady turns', () => {
    const stateDir = makeTempDir();
    const cid = makeUuid(4);
    writeModelMapFixture(stateDir);
    writeSnapshotFixture(stateDir, cid, {}, 84.3, '2026-11-14T10:00:00.000Z');

    // Trigger 1: Turn 1 ("出生证明") in single-turn toolless flow
    processHookPayload(
      JSON.stringify({ hookEventName: 'PreInvocation', conversationId: cid, invocationNum: 1 }),
      { overrideStateDir: stateDir }
    );
    const turn1 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 1 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn1.stamped, true);
    assert.equal(turn1.stampReason, 'turn_1');
    assert.ok('injectSteps' in turn1.stdout);
    const md1 = turn1.stdout.injectSteps[0].systemMessage.metadata.user_markdown;
    assert.equal(turn1.stdout.injectSteps[0].systemMessage.systemMessage, '');
    assert.ok(md1.startsWith('⚡'));
    assert.ok(md1.includes('Gemini 4 Carbon (High)'));
    assert.ok(md1.includes('sidecar://antigravity-pulse/pulse_cockpit/hud'));

    // Multi-step duplicate in Turn 1 -> deduped
    const turn1Dup = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 1 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn1Dup.stamped, false);
    assert.deepEqual(turn1Dup.stdout, {});

    processHookPayload(
      JSON.stringify({ hookEventName: 'Stop', conversationId: cid, invocationNum: 1 }),
      { overrideStateDir: stateDir }
    );

    // Steady Turn 2 -> silent {}
    const turn2 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 2 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn2.stamped, false);
    assert.deepEqual(turn2.stdout, {});

    // Trigger 2: Served model changed -> stamps with 🔀
    writeSnapshotFixture(
      stateDir,
      cid,
      {
        requestedModel: {
          raw: 'MODEL_PLACEHOLDER_M418',
          displayName: 'Gemini 4 Argon (Medium)',
          modelId: 'gemini-4-argon-medium',
          source: 'user',
        },
        servedModel: {
          responseModel: 'gemini-4-argon',
          displayName: 'Gemini 4 Argon (Medium)',
          modelEnum: 'MODEL_PLACEHOLDER_M418',
          family: 'gemini',
          effortTier: 'medium',
          tier: 'workhorse',
        },
      },
      83.5,
      '2026-11-14T10:01:00.000Z'
    );
    const turn3 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 3 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn3.stamped, true);
    assert.equal(turn3.stampReason, 'model_changed');
    assert.ok('injectSteps' in turn3.stdout);
    assert.ok(turn3.stdout.injectSteps[0].systemMessage.metadata.user_markdown.startsWith('🔀'));

    // Steady Turn 4 on same new model -> silent {}
    const turn4 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 4 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn4.stamped, false);

    // Trigger 3a: Retry > 0 -> stamps with ⚠ & Retried ×2
    writeSnapshotFixture(
      stateDir,
      cid,
      {
        servedModel: {
          responseModel: 'gemini-4-argon',
          displayName: 'Gemini 4 Argon (Medium)',
          modelEnum: 'MODEL_PLACEHOLDER_M418',
          family: 'gemini',
          effortTier: 'medium',
          tier: 'workhorse',
        },
        routingStatus: 'retrying',
        retryCount: 2,
      },
      83.0,
      '2026-11-14T10:02:00.000Z'
    );
    const turn5 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 5 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn5.stamped, true);
    assert.equal(turn5.stampReason, 'retry_or_fallback');
    assert.ok('injectSteps' in turn5.stdout);
    const md5 = turn5.stdout.injectSteps[0].systemMessage.metadata.user_markdown;
    assert.ok(md5.startsWith('⚠'));
    assert.ok(md5.includes('Retried ×2'));

    // Trigger 3b: mismatch_or_fallback -> stamps with ⚠ & Routed from
    writeSnapshotFixture(
      stateDir,
      cid,
      {
        requestedModel: {
          raw: 'MODEL_PLACEHOLDER_M427',
          displayName: 'Gemini 4 Carbon (High)',
          modelId: 'gemini-4-carbon-high',
          source: 'user',
        },
        servedModel: {
          responseModel: 'gemini-4-argon',
          displayName: 'Gemini 4 Argon (Medium)',
          modelEnum: 'MODEL_PLACEHOLDER_M418',
          family: 'gemini',
          effortTier: 'medium',
          tier: 'workhorse',
        },
        routingStatus: 'mismatch_or_fallback',
        retryCount: 0,
      },
      82.0,
      '2026-11-14T10:03:00.000Z'
    );
    const turn6 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 6 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn6.stamped, true);
    assert.equal(turn6.stampReason, 'retry_or_fallback');
    assert.ok('injectSteps' in turn6.stdout);
    const md6 = turn6.stdout.injectSteps[0].systemMessage.metadata.user_markdown;
    assert.ok(md6.startsWith('⚠'));
    assert.ok(md6.includes('Routed from Gemini 4 Carbon (High)'));

    // Trigger 4: CTX > 75% crossing (once; does not re-spam at 78%)
    writeSnapshotFixture(
      stateDir,
      cid,
      {
        servedModel: {
          responseModel: 'gemini-4-argon',
          displayName: 'Gemini 4 Argon (Medium)',
          modelEnum: 'MODEL_PLACEHOLDER_M418',
          family: 'gemini',
          effortTier: 'medium',
          tier: 'workhorse',
        },
        contextWindow: {
          estimatedTokensUsed: 196_000,
          maxContextTokens: 256_000,
          pct: 76.5,
          level: 'warn_70',
        },
      },
      81.0,
      '2026-11-14T10:04:00.000Z'
    );
    const turn7 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 7 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn7.stamped, true);
    assert.equal(turn7.stampReason, 'context_high');
    assert.ok('injectSteps' in turn7.stdout);
    assert.ok(turn7.stdout.injectSteps[0].systemMessage.metadata.user_markdown.startsWith('⚠'));

    writeSnapshotFixture(
      stateDir,
      cid,
      {
        servedModel: {
          responseModel: 'gemini-4-argon',
          displayName: 'Gemini 4 Argon (Medium)',
          modelEnum: 'MODEL_PLACEHOLDER_M418',
          family: 'gemini',
          effortTier: 'medium',
          tier: 'workhorse',
        },
        contextWindow: {
          estimatedTokensUsed: 201_000,
          maxContextTokens: 256_000,
          pct: 78.5,
          level: 'warn_70',
        },
      },
      80.5,
      '2026-11-14T10:05:00.000Z'
    );
    const turn8 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 8 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn8.stamped, false);

    // Trigger 5: 5h Quota < 20% via newer quota-cache.json (once; does not re-spam at 18%)
    const paths = getStatePaths(stateDir);
    const quotaCacheLow: QuotaCacheFile = {
      schemaVersion: 1,
      updatedAt: '2026-11-14T10:06:00.000Z',
      quota: makeQuotaSummary(19.2),
      cascadeBaselines: {},
    };
    writeJsonAtomic(paths.quotaCache, quotaCacheLow);
    const turn9 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 9 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn9.stamped, true);
    assert.equal(turn9.stampReason, 'quota_low');
    assert.ok('injectSteps' in turn9.stdout);
    const md9 = turn9.stdout.injectSteps[0].systemMessage.metadata.user_markdown;
    assert.ok(md9.startsWith('⚠'));
    assert.ok(md9.includes('19.2%'));

    const quotaCacheLower: QuotaCacheFile = {
      schemaVersion: 1,
      updatedAt: '2026-11-14T10:07:00.000Z',
      quota: makeQuotaSummary(17.8),
      cascadeBaselines: {},
    };
    writeJsonAtomic(paths.quotaCache, quotaCacheLower);
    const turn10 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 10 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn10.stamped, false);

    // Recovery + re-crossing: /compact drops CTX to 25% & quota resets to 95%, then crossing again re-alerts
    writeSnapshotFixture(
      stateDir,
      cid,
      {
        servedModel: {
          responseModel: 'gemini-4-argon',
          displayName: 'Gemini 4 Argon (Medium)',
          modelEnum: 'MODEL_PLACEHOLDER_M418',
          family: 'gemini',
          effortTier: 'medium',
          tier: 'workhorse',
        },
        contextWindow: {
          estimatedTokensUsed: 64_000,
          maxContextTokens: 256_000,
          pct: 25,
          level: 'normal',
        },
      },
      95.0,
      '2026-11-14T10:08:00.000Z'
    );
    writeJsonAtomic(paths.quotaCache, {
      schemaVersion: 1,
      updatedAt: '2026-11-14T10:08:00.000Z',
      quota: makeQuotaSummary(95.0),
      cascadeBaselines: {},
    });
    const turn11 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 11 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn11.stamped, false);

    writeSnapshotFixture(
      stateDir,
      cid,
      {
        servedModel: {
          responseModel: 'gemini-4-argon',
          displayName: 'Gemini 4 Argon (Medium)',
          modelEnum: 'MODEL_PLACEHOLDER_M418',
          family: 'gemini',
          effortTier: 'medium',
          tier: 'workhorse',
        },
        contextWindow: {
          estimatedTokensUsed: 200_000,
          maxContextTokens: 256_000,
          pct: 78.1,
          level: 'warn_70',
        },
      },
      95.0,
      '2026-11-14T10:09:00.000Z'
    );
    const turn12 = processHookPayload(
      JSON.stringify({ hookEventName: 'PostInvocation', conversationId: cid, invocationNum: 12 }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn12.stamped, true);
    assert.equal(turn12.stampReason, 'context_high');
  });

  it('does not false-trigger model_changed when Turn 1 used model-map fallback and Turn 2 receives live-snapshot for the same modelEnum', () => {
    const stateDir = makeTempDir();
    const cid = makeUuid(12);
    writeModelMapFixture(stateDir);

    const turn1 = processHookPayload(
      JSON.stringify({
        hookEventName: 'PostInvocation',
        conversationId: cid,
        invocationNum: 1,
        model: 'MODEL_PLACEHOLDER_M427',
      }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn1.stamped, true);
    assert.equal(turn1.stampReason, 'turn_1');

    writeSnapshotFixture(stateDir, cid);
    const turn2 = processHookPayload(
      JSON.stringify({
        hookEventName: 'PostInvocation',
        conversationId: cid,
        invocationNum: 2,
        model: 'MODEL_PLACEHOLDER_M427',
      }),
      { overrideStateDir: stateDir }
    );
    assert.equal(turn2.stamped, false);
  });

  it('prunes stamp-dedup.json LRU entries above 200 keys while preserving newest entries', () => {
    const stateDir = makeTempDir();
    const paths = getStatePaths(stateDir);
    const initial: StampDedupFile = { schemaVersion: 1, byConversation: {} };
    const baseMs = Date.parse('2026-11-14T00:00:00.000Z');

    for (let i = 1; i <= 205; i += 1) {
      initial.byConversation[makeUuid(i)] = {
        lastInvocationNum: 1,
        lastServedModel: 'gemini-4-carbon',
        lastTurnStamped: true,
        lastContextAlertPct: 10,
        lastQuotaAlerted: false,
        updatedAt: new Date(baseMs + i * 1000).toISOString(),
      };
    }
    writeJsonAtomic(paths.stampDedup, initial);

    const newCid = makeUuid(999);
    const res = processHookPayload(
      JSON.stringify({
        hookEventName: 'PostInvocation',
        conversationId: newCid,
        invocationNum: 1,
        model: 'gemini-4-carbon',
      }),
      { overrideStateDir: stateDir, nowMs: baseMs + 500_000 }
    );
    assert.equal(res.stamped, true);

    const updated = JSON.parse(readFileSync(paths.stampDedup, 'utf8')) as StampDedupFile;
    const keys = Object.keys(updated.byConversation);
    assert.equal(keys.length, 200);
    assert.ok(keys.includes(newCid), 'Newly stamped conversation must be retained');
    for (let oldIdx = 1; oldIdx <= 6; oldIdx += 1) {
      assert.equal(
        keys.includes(makeUuid(oldIdx)),
        false,
        `Oldest entry ${oldIdx} should be evicted`
      );
    }
    assert.equal(keys.includes(makeUuid(205)), true, 'Recent entry 205 should be retained');
  });
});

describe('hook-probe fault isolation & zero-network invariants (L-006, RTM-24)', () => {
  it('auto-creates missing stateDir, fails open on corrupt JSON & unwritable stateDir, and performs zero fetch calls', () => {
    const origFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('fetch forbidden inside hook-probe');
    }) as typeof fetch;

    try {
      // 1. Missing nested stateDir under writable temp parent -> auto-creates & stamps Turn 1
      const parent = makeTempDir();
      const missingDir = path.join(parent, 'auto-created-state');
      assert.equal(existsSync(missingDir), false);
      const createdRes = processHookPayload(
        JSON.stringify({
          hookEventName: 'PostInvocation',
          conversationId: makeUuid(50),
          invocationNum: 1,
          model: 'gemini-4-carbon',
        }),
        { overrideStateDir: missingDir }
      );
      assert.equal(existsSync(missingDir), true);
      if (process.platform !== 'win32') {
        assert.equal(statSync(missingDir).mode & 0o777, 0o700);
      }
      assert.equal(createdRes.stamped, true);

      // 2. Corrupt JSON, empty stdin, unknown event -> {}
      for (const badInput of ['', '   ', '{not-json', '["array"]', JSON.stringify({ hookEventName: 'UnknownEvent' })]) {
        const res = processHookPayload(badInput, { overrideStateDir: missingDir });
        assert.deepEqual(res.stdout, {});
      }

      // 3. Unwritable stateDir (blocked by regular file) -> PreToolUse allows, others {}
      const blockingFile = path.join(parent, 'blocking-file');
      writeFileSync(blockingFile, 'not-a-directory', 'utf8');
      const blockedStateDir = path.join(blockingFile, 'child-state');

      const blockedPreTool = processHookPayload(
        JSON.stringify({
          hookEventName: 'PreToolUse',
          conversationId: makeUuid(51),
          toolName: 'run_command',
        }),
        { overrideStateDir: blockedStateDir }
      );
      assert.deepEqual(blockedPreTool.stdout, { decision: 'allow' });

      for (const ev of ['PostToolUse', 'Stop', 'PreInvocation', 'PostInvocation'] as const) {
        const blockedRes = processHookPayload(
          JSON.stringify({
            hookEventName: ev,
            conversationId: makeUuid(51),
          }),
          { overrideStateDir: blockedStateDir }
        );
        assert.deepEqual(blockedRes.stdout, {});
      }

      assert.equal(fetchCalls, 0, 'hook-probe must never invoke fetch()');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
