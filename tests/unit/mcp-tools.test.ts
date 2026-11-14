import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  dispatchToolCall,
  SIDECAR_PILL_MARKDOWN,
} from '../../src/mcp/server';
import { loadConfig } from '../../src/state/config-store';
import { getStatePaths, type LiveSnapshotFile, writeJsonAtomic } from '../../src/state/state-dir';
import type {
  CascadeNodeView,
  ComputeBudgetAdvice,
  ModelTier,
  PulseUserConfig,
  QuotaSummaryView,
} from '../../src/types/telemetry';

const CID_1 = '11111111-1111-4111-8111-111111111111';
const CID_2 = '22222222-2222-4222-8222-222222222222';
const CID_3 = '33333333-3333-4333-8333-333333333333';
const CID_4 = '44444444-4444-4444-8444-444444444444';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'pulse-mcp-tools-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeNode(
  cascadeId: string,
  overrides: Partial<CascadeNodeView> = {}
): CascadeNodeView {
  return {
    cascadeId,
    rootCascadeId: CID_1,
    parentCascadeId: cascadeId === CID_1 ? null : CID_1,
    kind: cascadeId === CID_1 ? 'root' : 'subagent',
    title: `Cascade ${cascadeId.slice(0, 8)}`,
    role: cascadeId === CID_1 ? null : 'Worker',
    typeName: null,
    depth: cascadeId === CID_1 ? 0 : 1,
    status: 'CASCADE_RUN_STATUS_RUNNING',
    phase: 'THINKING',
    phaseStartedAt: '2026-11-14T10:00:00.000Z',
    phaseElapsedMs: 2_500,
    requestedModel: { raw: 'auto', displayName: 'Auto', modelId: 'auto', source: 'user' },
    servedModel: {
      responseModel: 'gemini-4-carbon',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier: 'apex' as ModelTier,
    },
    routingStatus: 'routed',
    retryCount: 0,
    lastTool: null,
    stepCount: 4,
    turnCount: 1,
    streamingTokPerSec: null,
    contextWindow: {
      estimatedTokensUsed: 32_000,
      maxContextTokens: 256_000,
      pct: 12.5,
      level: 'normal',
    },
    cacheHitPct: 75,
    tokens: {
      inputTokens: 2_000,
      cacheReadTokens: 6_000,
      outputTokens: 500,
      thinkingOutputTokens: 200,
      responseOutputTokens: 300,
    },
    deltaQuota5hPct: 0.05,
    lastTtftMs: 400,
    lastStreamingMs: 1_200,
    lastModifiedTime: '2026-11-14T10:00:05.000Z',
    spawnStepIndex: null,
    childrenIds: [],
    ...overrides,
  };
}

function makeQuota(gemini5hRemainingPct: number): QuotaSummaryView {
  const g5h = {
    bucketId: 'gemini-5h',
    displayName: 'Gemini 5h',
    window: '5h',
    remainingFraction: gemini5hRemainingPct / 100,
    remainingPct: gemini5hRemainingPct,
    resetTime: '2026-11-14T12:00:00.000Z',
    resetInSeconds: 7200,
    resetInLabel: '2h 0m',
    isLowAlert: gemini5hRemainingPct < 15,
  };
  const gWk = {
    bucketId: 'gemini-weekly',
    displayName: 'Gemini Weekly',
    window: 'weekly',
    remainingFraction: 0.9,
    remainingPct: 90.0,
    resetTime: '2026-11-20T00:00:00.000Z',
    resetInSeconds: 480000,
    resetInLabel: '5d 13h',
    isLowAlert: false,
  };
  return {
    fetchedAt: '2026-11-14T10:00:10.000Z',
    buckets: [g5h, gWk],
    gemini5h: g5h,
    geminiWeekly: gWk,
    thirdParty5h: null,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: 0.05,
    burnRate5hPctPerMin: 0.1,
  };
}

function writeSnapshot(
  stateDir: string,
  options: {
    nowMs: number;
    activeCid?: string | null;
    nodes?: CascadeNodeView[];
    quotaPct?: number;
    hostConnected?: boolean;
  }
): void {
  const paths = getStatePaths(stateDir);
  const nodesByCascadeId: Record<string, CascadeNodeView> = {};
  for (const node of options.nodes ?? []) {
    nodesByCascadeId[node.cascadeId] = node;
  }
  const quota = makeQuota(options.quotaPct ?? 80);
  const generatedAt = new Date(options.nowMs).toISOString();
  const hostConnected = options.hostConnected ?? true;
  const snapshot: LiveSnapshotFile = {
    schemaVersion: 1,
    updatedAt: generatedAt,
    hostConnected,
    activeConversationId: options.activeCid ?? null,
    nodesByCascadeId,
    fleet: {
      etag: 'test-etag',
      generatedAt,
      hostConnected,
      activeHeadline: {
        runningRoots: 1,
        runningSubagents: Math.max(0, (options.nodes?.length ?? 1) - 1),
        totalRunningNodes: options.nodes?.length ?? 0,
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

function parseToolPayload<T>(res: { content: Array<{ text: string }> }): T {
  return JSON.parse(res.content[0].text) as T;
}

describe('mcp/server tools — compute budget, preferences, status cards & optional LS refresh', () => {
  it('RTM-14 & RTM-19: pulse_get_compute_budget enforces exact quota, Smart Governance, fanout, and context thresholds', async () => {
    const nowMs = Date.parse('2026-11-14T10:00:10.000Z');
    const stateDir = makeTempDir();
    const ctx = { stateDir, env: {}, nowMs: () => nowMs };

    // 1. Disconnected / missing snapshot -> inherit + warning
    const disconnectedRes = await dispatchToolCall('pulse_get_compute_budget', {}, undefined, ctx);
    assert.notEqual(disconnectedRes.isError, true);
    const disconnectedAdvice = parseToolPayload<ComputeBudgetAdvice>(disconnectedRes);
    assert.equal(disconnectedAdvice.recommendedSubagentModel, 'inherit');
    assert.ok(
      disconnectedAdvice.warnings.some((w) => w.includes('Live quota telemetry unavailable'))
    );
    assert.ok(
      disconnectedAdvice.warnings.some((w) => w.includes('Host telemetry disconnected'))
    );

    // 2. 24.9% (< 25%) -> flash
    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: [makeNode(CID_1)], quotaPct: 24.9 });
    const p249 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall('pulse_get_compute_budget', {}, undefined, ctx)
    );
    assert.equal(p249.recommendedSubagentModel, 'flash');

    // 3. 25.0% -> argon
    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: [makeNode(CID_1)], quotaPct: 25.0 });
    const p250 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall('pulse_get_compute_budget', {}, undefined, ctx)
    );
    assert.equal(p250.recommendedSubagentModel, 'argon');

    // 4. 44.9% -> argon
    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: [makeNode(CID_1)], quotaPct: 44.9 });
    const p449 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall('pulse_get_compute_budget', {}, undefined, ctx)
    );
    assert.equal(p449.recommendedSubagentModel, 'argon');

    // 5. 45.0% -> inherit
    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: [makeNode(CID_1)], quotaPct: 45.0 });
    const p450 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall('pulse_get_compute_budget', {}, undefined, ctx)
    );
    assert.equal(p450.recommendedSubagentModel, 'inherit');

    // 6. 3 running apex nodes & 39.0% (< 40%) -> flash
    const threeApex = [
      makeNode(CID_1, { childrenIds: [CID_2, CID_3] }),
      makeNode(CID_2, { rootCascadeId: CID_1, parentCascadeId: CID_1 }),
      makeNode(CID_3, { rootCascadeId: CID_1, parentCascadeId: CID_1 }),
    ];
    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: threeApex, quotaPct: 39.0 });
    const sg39 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall('pulse_get_compute_budget', {}, undefined, ctx)
    );
    assert.equal(sg39.recommendedSubagentModel, 'flash');

    // 7. 3 running apex nodes & 40.0% -> argon
    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: threeApex, quotaPct: 40.0 });
    const sg40 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall('pulse_get_compute_budget', {}, undefined, ctx)
    );
    assert.equal(sg40.recommendedSubagentModel, 'argon');

    // 8. taskKind='exploration' & 44.0% (< 45%) -> flash
    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: [makeNode(CID_1)], quotaPct: 44.0 });
    const explore44 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall(
        'pulse_get_compute_budget',
        { taskKind: 'exploration' },
        undefined,
        ctx
      )
    );
    assert.equal(explore44.recommendedSubagentModel, 'flash');

    // 9. plannedSubagentCount=4 & 54.0% (< 55%) -> flash; >= 55% -> inherit
    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: [makeNode(CID_1)], quotaPct: 54.0 });
    const fanout54 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall(
        'pulse_get_compute_budget',
        { plannedSubagentCount: 4 },
        undefined,
        ctx
      )
    );
    assert.equal(fanout54.recommendedSubagentModel, 'flash');

    writeSnapshot(stateDir, { nowMs, activeCid: CID_1, nodes: [makeNode(CID_1)], quotaPct: 55.0 });
    const fanout55 = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall(
        'pulse_get_compute_budget',
        { plannedSubagentCount: 4 },
        undefined,
        ctx
      )
    );
    assert.equal(fanout55.recommendedSubagentModel, 'inherit');

    // 10. Context window > 85% -> /compact warning
    writeSnapshot(stateDir, {
      nowMs,
      activeCid: CID_1,
      nodes: [
        makeNode(CID_1, {
          contextWindow: {
            estimatedTokensUsed: 224_000,
            maxContextTokens: 256_000,
            pct: 87.5,
            level: 'critical_85',
          },
        }),
      ],
      quotaPct: 80.0,
    });
    const highCtx = parseToolPayload<ComputeBudgetAdvice>(
      await dispatchToolCall('pulse_get_compute_budget', {}, undefined, ctx)
    );
    assert.equal(highCtx.contextWindowPct, 87.5);
    assert.ok(highCtx.warnings.some((w) => w.includes('/compact')));

    // Invalid parameters -> isError: true
    const badCid = await dispatchToolCall(
      'pulse_get_compute_budget',
      { conversationId: '../evil' },
      undefined,
      ctx
    );
    assert.equal(badCid.isError, true);

    const badCount = await dispatchToolCall(
      'pulse_get_compute_budget',
      { plannedSubagentCount: -1 },
      undefined,
      ctx
    );
    assert.equal(badCount.isError, true);

    const badTask = await dispatchToolCall(
      'pulse_get_compute_budget',
      { taskKind: 'hack' },
      undefined,
      ctx
    );
    assert.equal(badTask.isError, true);
  });

  it('pulse_set_preference atomically persists valid updates and rejects invalid fields without corruption', async () => {
    const stateDir = makeTempDir();
    const ctx = { stateDir, env: {} };

    const validRes = await dispatchToolCall(
      'pulse_set_preference',
      {
        inlineStampMode: 'every-turn',
        hudSortMode: 'topology-tree',
        timelineScope: 'tree',
        smartThresholds: { quotaLowTriggerPct: 30, heavyQuotaThresholdPct: 35 },
      },
      undefined,
      ctx
    );
    assert.notEqual(validRes.isError, true);
    const okPayload = parseToolPayload<{
      ok: boolean;
      config: PulseUserConfig;
      sidecarPill: string;
    }>(validRes);
    assert.equal(okPayload.ok, true);
    assert.equal(okPayload.sidecarPill, SIDECAR_PILL_MARKDOWN);
    assert.equal(okPayload.config.inlineStampMode, 'every-turn');
    assert.equal(okPayload.config.hudSortMode, 'topology-tree');
    assert.equal(okPayload.config.timelineScope, 'tree');
    assert.equal(okPayload.config.smartThresholds.quotaLowTriggerPct, 30);
    assert.equal(okPayload.config.smartThresholds.heavyQuotaThresholdPct, 35);

    const diskBefore = readFileSync(getStatePaths(stateDir).configPath, 'utf8');

    const badCalls = [
      {},
      { smartThresholds: {} },
      { unknownKey: 'x' },
      { version: 99 },
      { updatedAt: '2026-01-01T00:00:00Z' },
      { inlineStampMode: 'always' },
      { smartThresholds: { heavyConcurrentAlertCount: 101 } },
    ];

    for (const badArgs of badCalls) {
      const res = await dispatchToolCall('pulse_set_preference', badArgs, undefined, ctx);
      assert.equal(res.isError, true, `Expected error for args ${JSON.stringify(badArgs)}`);
    }

    // Config on disk remains completely intact after all rejected calls
    const diskAfter = readFileSync(getStatePaths(stateDir).configPath, 'utf8');
    assert.equal(diskAfter, diskBefore);
    assert.equal(loadConfig(stateDir).inlineStampMode, 'every-turn');
  });

  it('RTM-27: pulse_status_card enforces 4-tier conversationId resolution, rejects traversal, and creates HTML card', async () => {
    const nowMs = Date.parse('2026-11-14T10:00:10.000Z');
    const stateDir = makeTempDir();

    const n1 = makeNode(CID_1, { rootCascadeId: CID_1, title: 'Primary Root' });
    const n2 = makeNode(CID_2, { rootCascadeId: CID_2, parentCascadeId: null, kind: 'root', title: 'Meta Root' });
    const n3 = makeNode(CID_3, { rootCascadeId: CID_3, parentCascadeId: null, kind: 'root', title: 'Env Root' });
    const n4 = makeNode(CID_4, { rootCascadeId: CID_4, parentCascadeId: null, kind: 'root', title: 'Snap Root' });

    writeSnapshot(stateDir, {
      nowMs,
      activeCid: CID_4,
      nodes: [n1, n2, n3, n4],
      quotaPct: 68.5,
    });

    // Tier 1: args.conversationId overrides _meta, env, and snapshot
    const r1 = parseToolPayload<{
      ok: boolean;
      conversationId: string;
      outputPath: string;
      fileUri: string;
      embedTag: string;
      sidecarPill: string;
      summary: string;
      hostConnected: boolean;
      stale: boolean;
      nodeCount: number;
    }>(
      await dispatchToolCall(
        'pulse_status_card',
        { conversationId: CID_1, theme: 'light' },
        { 'antigravity.google/conversation_id': CID_2 },
        { stateDir, env: { ANTIGRAVITY_CONVERSATION_ID: CID_3 }, nowMs: () => nowMs }
      )
    );
    assert.equal(r1.ok, true);
    assert.equal(r1.conversationId, CID_1);
    assert.equal(r1.sidecarPill, SIDECAR_PILL_MARKDOWN);
    assert.equal(r1.embedTag, `<agent-embed src="${r1.fileUri}"></agent-embed>`);
    assert.equal(r1.hostConnected, true);
    assert.equal(r1.stale, false);
    assert.equal(r1.nodeCount, 1);
    assert.ok(r1.outputPath.startsWith(path.join(stateDir, 'cards')));
    assert.equal(existsSync(r1.outputPath), true);
    assert.ok(readFileSync(r1.outputPath, 'utf8').includes('data-theme="light"'));

    // Tier 2: _meta overrides env and snapshot
    const r2 = parseToolPayload<{ conversationId: string }>(
      await dispatchToolCall(
        'pulse_status_card',
        {},
        { 'antigravity.google/conversation_id': CID_2 },
        { stateDir, env: { ANTIGRAVITY_CONVERSATION_ID: CID_3 }, nowMs: () => nowMs + 1 }
      )
    );
    assert.equal(r2.conversationId, CID_2);

    // Tier 3: env overrides snapshot
    const r3 = parseToolPayload<{ conversationId: string }>(
      await dispatchToolCall(
        'pulse_status_card',
        {},
        undefined,
        { stateDir, env: { ANTIGRAVITY_CONVERSATION_ID: CID_3 }, nowMs: () => nowMs + 2 }
      )
    );
    assert.equal(r3.conversationId, CID_3);

    // Tier 4: snapshot fallback
    const r4 = parseToolPayload<{ conversationId: string }>(
      await dispatchToolCall(
        'pulse_status_card',
        {},
        undefined,
        { stateDir, env: {}, nowMs: () => nowMs + 3 }
      )
    );
    assert.equal(r4.conversationId, CID_4);

    // Invalid UUID / traversal attempt -> isError: true and NO new card created
    const countBefore = readdirSync(path.join(stateDir, 'cards')).length;
    const badRes = await dispatchToolCall(
      'pulse_status_card',
      { conversationId: '../evil' },
      undefined,
      { stateDir, env: {}, nowMs: () => nowMs + 4 }
    );
    assert.equal(badRes.isError, true);
    assert.equal(readdirSync(path.join(stateDir, 'cards')).length, countBefore);
  });

  it('uses optional read-only LS RPC refresh with L-004 RUNNING-only stepOffset when LS env vars exist', async () => {
    const nowMs = Date.parse('2026-11-14T10:00:10.000Z');
    const stateDir = makeTempDir();
    const csrf = 'test-csrf-token-mcp';
    const rpcCalls: Array<{ method: string; body: Record<string, unknown> }> = [];

    const server = http.createServer((req, res) => {
      if (req.headers['x-codeium-csrf-token'] !== csrf) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      const method = (req.url || '').split('/').pop() || '';
      let raw = '';
      req.on('data', (c) => {
        raw += c.toString('utf8');
      });
      req.on('end', () => {
        const body = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
        rpcCalls.push({ method, body });

        if (method === 'GetCascadeModelConfigData') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              defaultOverrideModelConfig: { modelOrAlias: { model: 'auto' } },
              clientModelConfigs: [
                {
                  label: 'Gemini 4 Carbon (High)',
                  modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
                },
              ],
            })
          );
          return;
        }

        if (method === 'RetrieveUserQuotaSummary') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              response: {
                groups: [
                  {
                    groupId: 'gemini',
                    displayName: 'Gemini',
                    buckets: [
                      {
                        bucketId: 'gemini-5h',
                        displayName: 'Gemini 5h',
                        window: '5h',
                        remainingFraction: 0.242,
                        resetTime: '2026-11-14T12:00:00.000Z',
                      },
                    ],
                  },
                ],
              },
            })
          );
          return;
        }

        if (method === 'GetAllCascadeTrajectories') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              trajectorySummaries: {
                [CID_1]: {
                  summary: 'Live Running Root',
                  status: 'CASCADE_RUN_STATUS_RUNNING',
                  stepCount: 9,
                  lastModifiedTime: new Date(nowMs - 500).toISOString(),
                  requestedModel: { model: 'MODEL_PLACEHOLDER_M427' },
                },
                [CID_2]: {
                  summary: 'Idle Root',
                  status: 'CASCADE_RUN_STATUS_IDLE',
                  stepCount: 6,
                  lastModifiedTime: new Date(nowMs - 20_000).toISOString(),
                  requestedModel: { model: 'MODEL_PLACEHOLDER_M427' },
                },
              },
            })
          );
          return;
        }

        if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              generatorMetadata: [
                {
                  stepIndices: [1],
                  chatModel: {
                    model: 'MODEL_PLACEHOLDER_M427',
                    modelDisplayName: 'Gemini 4 Carbon (High)',
                    responseModel: 'gemini-4-carbon',
                    retryInfos: [{ attempt: 1 }],
                    usage: { inputTokens: '1200', cacheReadTokens: '4800', outputTokens: '300' },
                    chatStartMetadata: {
                      contextWindowMetadata: {
                        estimatedTokensUsed: '20000',
                        maxContextTokens: '256000',
                      },
                    },
                  },
                },
              ],
            })
          );
          return;
        }

        if (method === 'GetCascadeTrajectorySteps') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              steps: [
                {
                  type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                  status: 'CORTEX_STEP_STATUS_RUNNING',
                },
              ],
            })
          );
          return;
        }

        res.writeHead(404);
        res.end('{}');
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const addr = server.address();
      assert.ok(addr && typeof addr !== 'string');
      const lsAddress = `127.0.0.1:${addr.port}`;

      const res = await dispatchToolCall(
        'pulse_get_compute_budget',
        { conversationId: CID_1 },
        undefined,
        {
          stateDir,
          antigravityDataDir: stateDir,
          env: {
            ANTIGRAVITY_LS_ADDRESS: lsAddress,
            ANTIGRAVITY_CSRF_TOKEN: csrf,
          },
          nowMs: () => nowMs,
        }
      );

      assert.notEqual(res.isError, true);
      const advice = parseToolPayload<ComputeBudgetAdvice>(res);
      assert.equal(advice.recommendedSubagentModel, 'flash');
      assert.equal(advice.quota.gemini5hRemainingPct, 24.2);
      assert.equal(advice.activeModel?.displayName, 'Gemini 4 Carbon (High)');

      // L-004 & read-only enforcement
      assert.equal(
        rpcCalls.some((c) => c.method === 'GetCascadeTrajectory'),
        false,
        'Must NEVER call GetCascadeTrajectory'
      );
      const stepsCalls = rpcCalls.filter((c) => c.method === 'GetCascadeTrajectorySteps');
      assert.equal(stepsCalls.length, 1);
      assert.equal(stepsCalls[0].body.cascadeId, CID_1);
      assert.equal(stepsCalls[0].body.stepOffset, 5);
      assert.equal(stepsCalls[0].body.disableRehydration, true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
