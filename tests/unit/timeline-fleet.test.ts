import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  buildFleetSnapshot,
  compactModelLabel,
  ROLLING_5H_WINDOW_MS,
} from '../../src/core/fleet-builder';
import { buildModelCatalog, type ModelCatalog } from '../../src/core/model-catalog';
import {
  buildTimelineTurns,
  isOverthinkingTurn,
  OVERTHINKING_RATIO_THRESHOLD_PCT,
  OVERTHINKING_SHORT_RESPONSE_MAX_TOKENS,
} from '../../src/core/timeline-builder';
import { ReadOnlyLsClient } from '../../src/rpc/ls-client';
import { TelemetryEngine } from '../../src/sidecar/telemetry-engine';
import type { LiveSnapshotFile } from '../../src/state/state-dir';
import type {
  GeneratorMetadataEntryRaw,
  GetAllCascadeTrajectoriesResponse,
  GetCascadeModelConfigDataResponse,
  GetCascadeTrajectoryGeneratorMetadataResponse,
  GetCascadeTrajectoryStepsResponse,
  RetrieveUserQuotaSummaryResponse,
  TrajectorySummaryRaw,
} from '../../src/types/rpc';
import type {
  CascadeNodeView,
  FleetSnapshotResponse,
  ModelTier,
  PulseUserConfig,
  QuotaSummaryView,
  TimelineSnapshotResponse,
  UnchangedEtagResponse,
} from '../../src/types/telemetry';

const ROOT_CID = '11111111-1111-4111-8111-111111111111';
const SUB_CID = '22222222-2222-4222-8222-222222222222';
const SWARM_CID = '33333333-3333-4333-8333-333333333333';
const OTHER_ROOT_CID = '44444444-4444-4444-8444-444444444444';

function resolveRepoRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', '..'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'src'))) {
      return dir;
    }
  }
  return process.cwd();
}

function resolveSidecarLoader(): string {
  const explicit = process.env.ANTIGRAVITY_SIDECAR_LOADER?.trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  const canonical =
    '/home/springtian/.gemini/antigravity/lib/node_modules/sidecar_sdk/register_loader.js';
  if (existsSync(canonical)) {
    return canonical;
  }
  const agyBin = execFileSync('which', ['agy'], { encoding: 'utf8' }).trim();
  const derived = path.resolve(
    path.dirname(realpathSync(agyBin)),
    '..',
    'lib',
    'node_modules',
    'sidecar_sdk',
    'register_loader.js'
  );
  assert.ok(existsSync(derived), 'Missing sidecar_sdk/register_loader.js');
  return derived;
}

function makeCatalog(): ModelCatalog {
  return buildModelCatalog({
    defaultOverrideModelConfig: {
      modelOrAlias: { model: 'auto' },
      label: 'Auto',
      modelId: 'auto',
    },
    clientModelConfigs: [
      {
        modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
        modelId: 'gemini-4-carbon-high',
        label: 'Gemini 4 Carbon (High)',
      },
      {
        modelOrAlias: { model: 'MODEL_PLACEHOLDER_M418' },
        modelId: 'gemini-4-argon-medium',
        label: 'Gemini 4 Argon (Medium)',
      },
      {
        modelOrAlias: { model: 'MODEL_PLACEHOLDER_M667' },
        modelId: 'gemini-pro-orchestrator',
        label: 'Orchestrator (Carbon)',
      },
      {
        modelOrAlias: { model: 'flash' },
        modelId: 'gemini-3.8-flash',
        label: 'Gemini 3.8 Flash',
      },
    ],
  });
}

function makeNode(overrides: Partial<CascadeNodeView> = {}): CascadeNodeView {
  const cascadeId = overrides.cascadeId ?? ROOT_CID;
  return {
    cascadeId,
    rootCascadeId: overrides.rootCascadeId ?? cascadeId,
    parentCascadeId: overrides.parentCascadeId ?? null,
    kind: overrides.kind ?? 'root',
    title: overrides.title ?? 'Root Pipeline',
    role: overrides.role ?? null,
    typeName: overrides.typeName ?? null,
    depth: overrides.depth ?? 0,
    status: overrides.status ?? 'CASCADE_RUN_STATUS_IDLE',
    phase: overrides.phase ?? 'IDLE',
    phaseStartedAt: overrides.phaseStartedAt ?? '2026-11-14T10:00:00.000Z',
    phaseElapsedMs: overrides.phaseElapsedMs ?? 0,
    requestedModel: overrides.requestedModel ?? {
      raw: 'auto',
      displayName: 'Auto',
      modelId: 'auto',
      source: 'user',
    },
    servedModel: overrides.servedModel ?? {
      responseModel: 'gemini-4-carbon-high',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier: 'apex',
    },
    routingStatus: overrides.routingStatus ?? 'routed',
    retryCount: overrides.retryCount ?? 0,
    lastTool: overrides.lastTool ?? null,
    stepCount: overrides.stepCount ?? 4,
    turnCount: overrides.turnCount ?? 1,
    streamingTokPerSec: overrides.streamingTokPerSec ?? null,
    contextWindow: overrides.contextWindow ?? {
      estimatedTokensUsed: 32000,
      maxContextTokens: 256000,
      pct: 12.5,
      level: 'normal',
    },
    cacheHitPct: overrides.cacheHitPct ?? 80,
    tokens: overrides.tokens ?? {
      inputTokens: 1000,
      cacheReadTokens: 4000,
      outputTokens: 500,
      thinkingOutputTokens: 300,
      responseOutputTokens: 200,
    },
    deltaQuota5hPct: overrides.deltaQuota5hPct ?? null,
    lastTtftMs: overrides.lastTtftMs ?? 1200,
    lastStreamingMs: overrides.lastStreamingMs ?? 800,
    lastModifiedTime: overrides.lastModifiedTime ?? '2026-11-14T10:00:00.000Z',
    spawnStepIndex: overrides.spawnStepIndex ?? null,
    childrenIds: overrides.childrenIds ?? [],
  };
}

function makeEmptyQuota(fetchedAt = '2026-11-14T10:00:00.000Z'): QuotaSummaryView {
  return {
    fetchedAt,
    buckets: [
      {
        bucketId: 'gemini-5h',
        displayName: 'Gemini 5h',
        window: '5h',
        remainingFraction: 0.84,
        remainingPct: 84,
        resetTime: '2026-11-14T12:30:00.000Z',
        resetInSeconds: 9000,
        resetInLabel: '2h 30m',
        isLowAlert: false,
      },
    ],
    gemini5h: {
      bucketId: 'gemini-5h',
      displayName: 'Gemini 5h',
      window: '5h',
      remainingFraction: 0.84,
      remainingPct: 84,
      resetTime: '2026-11-14T12:30:00.000Z',
      resetInSeconds: 9000,
      resetInLabel: '2h 30m',
      isLowAlert: false,
    },
    geminiWeekly: null,
    thirdParty5h: null,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: null,
    burnRate5hPctPerMin: null,
  };
}

describe('core/timeline-builder — RTM-07, RTM-15, L-001..L-003', () => {
  it('enforces L-001 int64 string tokens, L-002 cache hit denominator, L-003 retry baseline, and durations', () => {
    const catalog = makeCatalog();
    const nodesByCascadeId = {
      [ROOT_CID]: makeNode({ cascadeId: ROOT_CID, title: 'Main Cascade' }),
    };

    const entries: GeneratorMetadataEntryRaw[] = [
      {
        stepIndices: [1, 2],
        chatModel: {
          model: 'MODEL_PLACEHOLDER_M427',
          modelDisplayName: 'Gemini 4 Carbon (High)',
          responseModel: 'gemini-4-carbon-high',
          timeToFirstToken: '12.13s',
          streamingDuration: '8.13s',
          retryInfos: [{ attempt: 1 }], // L-003 baseline === 1 -> 0 retries
          chatStartMetadata: {
            createdAt: '2026-11-14T10:00:00.000Z',
            contextWindowMetadata: {
              estimatedTokensUsed: '64000',
              maxContextTokens: '256000',
            },
          },
          customMetadata: {
            model_enum: 'MODEL_PLACEHOLDER_M667',
          },
          usage: {
            inputTokens: '1000',
            cacheReadTokens: '9000',
            outputTokens: '19774',
            thinkingOutputTokens: '19353',
            // responseOutputTokens intentionally omitted -> 19774 - 19353 = 421
            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
          },
        },
      },
      {
        stepIndices: [5, 6],
        chatModel: {
          model: 'MODEL_PLACEHOLDER_M418',
          modelDisplayName: 'Gemini 4 Argon (Medium)',
          responseModel: 'gemini-4-argon-medium',
          timeToFirstToken: '1.5s',
          streamingDuration: '2.5s',
          retryInfos: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }], // L-003 -> 2 retries
          createdAt: '2026-11-14T10:01:00.000Z',
          usage: {
            inputTokens: '0',
            cacheReadTokens: '5000',
            outputTokens: '1000',
            thinkingOutputTokens: '400',
            responseOutputTokens: '600',
          },
        },
      },
      {
        stepIndices: [9],
        chatModel: {
          model: 'flash',
          modelDisplayName: 'Gemini 3.8 Flash',
          responseModel: 'gemini-3.8-flash',
          timeToFirstToken: '200ms',
          streamingDuration: '300ms',
          retryInfos: [], // L-003 empty -> 0 retries
          timestamp: '2026-11-14T10:02:00.000Z',
          usage: {
            inputTokens: '0',
            cacheReadTokens: '0',
            outputTokens: '0',
            thinkingOutputTokens: '0',
          },
        },
      },
    ];

    const res = buildTimelineTurns({
      activeConversationId: ROOT_CID,
      scope: 'conversation',
      nodesByCascadeId,
      generatorMetadataByCascade: { [ROOT_CID]: entries },
      modelCatalog: catalog,
      turnDeltaQuotaByKey: { [`${ROOT_CID}:1`]: 0.42 },
    });

    assert.equal(res.rootCascadeId, ROOT_CID);
    assert.equal(res.scope, 'conversation');
    assert.equal(res.turns.length, 3);

    // Reverse-chronological order: Turn #3, #2, #1
    assert.deepEqual(
      res.turns.map((t) => t.turnIndex),
      [3, 2, 1]
    );

    const t1 = res.turns[2];
    assert.equal(t1.ttftMs, 12130);
    assert.equal(t1.streamingMs, 8130);
    assert.equal(t1.totalMs, 20260);
    assert.equal(t1.inputTokens, 1000);
    assert.equal(t1.cacheReadTokens, 9000);
    assert.equal(t1.cacheHitPct, 90);
    assert.equal(t1.outputTokens, 19774);
    assert.equal(t1.thinkingOutputTokens, 19353);
    assert.equal(t1.responseOutputTokens, 421);
    assert.equal(t1.retryCount, 0);
    assert.equal(t1.contextUsedTokens, 64000);
    assert.equal(t1.contextMaxTokens, 256000);
    assert.equal(t1.contextPct, 25);
    assert.equal(t1.requestedLabel, 'Orchestrator (Carbon)');
    assert.equal(t1.deltaQuota5hPct, 0.42);
    assert.equal(t1.apiProvider, 'API_PROVIDER_GOOGLE_GEMINI');
    assert.equal(t1.routingChangedFromPrevTurn, false);
    assert.equal(isOverthinkingTurn(t1), true);

    const t2 = res.turns[1];
    assert.equal(t2.cacheHitPct, 100);
    assert.equal(t2.retryCount, 2);
    assert.equal(t2.routingChangedFromPrevTurn, true); // Carbon -> Argon
    assert.equal(isOverthinkingTurn(t2), false);

    const t3 = res.turns[0];
    assert.equal(t3.cacheHitPct, 0);
    assert.equal(t3.thinkingRatioPct, 0);
    assert.equal(t3.retryCount, 0);
    assert.equal(t3.totalMs, 500);
    assert.equal(t3.routingChangedFromPrevTurn, true); // Argon -> Flash
    assert.equal(isOverthinkingTurn(t3), false);
  });

  it('enforces exact isOverthinkingTurn boundary conditions', () => {
    assert.equal(OVERTHINKING_RATIO_THRESHOLD_PCT, 75);
    assert.equal(OVERTHINKING_SHORT_RESPONSE_MAX_TOKENS, 500);

    // 74.9% -> false
    assert.equal(
      isOverthinkingTurn({
        outputTokens: 1000,
        thinkingRatioPct: 74.9,
        responseOutputTokens: 200,
        tier: 'apex',
      }),
      false
    );
    // 75.0% with short response (<= 500) -> true even on workhorse
    assert.equal(
      isOverthinkingTurn({
        outputTokens: 2000,
        thinkingRatioPct: 75,
        responseOutputTokens: 500,
        tier: 'workhorse',
      }),
      true
    );
    // 75.0% with >500 response on non-apex -> false
    assert.equal(
      isOverthinkingTurn({
        outputTokens: 2100,
        thinkingRatioPct: 75.5,
        responseOutputTokens: 501,
        tier: 'workhorse',
      }),
      false
    );
    // 75.0% with >500 response on apex -> true
    assert.equal(
      isOverthinkingTurn({
        outputTokens: 5000,
        thinkingRatioPct: 75,
        responseOutputTokens: 1250,
        tier: 'apex',
      }),
      true
    );
    // 0 output tokens -> false
    assert.equal(
      isOverthinkingTurn({
        outputTokens: 0,
        thinkingRatioPct: 100,
        responseOutputTokens: 0,
        tier: 'apex',
      }),
      false
    );
  });

  it('computes per-cascade routingChangedFromPrevTurn chronologically in tree scope without false positives', () => {
    const catalog = makeCatalog();
    const nodesByCascadeId = {
      [ROOT_CID]: makeNode({
        cascadeId: ROOT_CID,
        rootCascadeId: ROOT_CID,
        title: 'Root Orchestrator',
        depth: 0,
      }),
      [SUB_CID]: makeNode({
        cascadeId: SUB_CID,
        rootCascadeId: ROOT_CID,
        parentCascadeId: ROOT_CID,
        kind: 'subagent',
        title: 'Explorer Subagent',
        role: 'Explorer',
        depth: 1,
        spawnStepIndex: 2,
      }),
    };

    const generatorMetadataByCascade: Record<string, GeneratorMetadataEntryRaw[]> = {
      [ROOT_CID]: [
        {
          stepIndices: [1],
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M427',
            responseModel: 'gemini-4-carbon-high',
            timeToFirstToken: '2s',
            streamingDuration: '1s',
            chatStartMetadata: { createdAt: '2026-11-14T10:00:01.000Z' },
          },
        },
        {
          stepIndices: [4],
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M427',
            responseModel: 'gemini-4-carbon-high',
            timeToFirstToken: '2s',
            streamingDuration: '1s',
            chatStartMetadata: { createdAt: '2026-11-14T10:00:05.000Z' },
          },
        },
        {
          stepIndices: [8],
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M418',
            responseModel: 'gemini-4-argon-medium',
            timeToFirstToken: '1s',
            streamingDuration: '1s',
            chatStartMetadata: { createdAt: '2026-11-14T10:00:09.000Z' },
          },
        },
      ],
      [SUB_CID]: [
        {
          stepIndices: [1],
          chatModel: {
            model: 'flash',
            responseModel: 'gemini-3.8-flash',
            timeToFirstToken: '0.5s',
            streamingDuration: '0.5s',
            chatStartMetadata: { createdAt: '2026-11-14T10:00:03.000Z' },
          },
        },
      ],
    };

    // Tree scope includes both Root and Subagent interleaved chronologically
    const treeRes = buildTimelineTurns({
      activeConversationId: SUB_CID,
      scope: 'tree',
      nodesByCascadeId,
      generatorMetadataByCascade,
      modelCatalog: catalog,
    });
    assert.equal(treeRes.rootCascadeId, ROOT_CID);
    assert.equal(treeRes.turns.length, 4);
    assert.deepEqual(
      treeRes.turns.map((t) => [t.turnIndex, t.cascadeId, t.responseModel, t.routingChangedFromPrevTurn]),
      [
        [4, ROOT_CID, 'gemini-4-argon-medium', true],
        [3, ROOT_CID, 'gemini-4-carbon-high', false], // NOT falsely shifted by interleaved Subagent Flash turn!
        [2, SUB_CID, 'gemini-3.8-flash', false],
        [1, ROOT_CID, 'gemini-4-carbon-high', false],
      ]
    );

    // Conversation scope filters strictly to activeConversationId
    const convRes = buildTimelineTurns({
      activeConversationId: SUB_CID,
      scope: 'conversation',
      nodesByCascadeId,
      generatorMetadataByCascade,
      modelCatalog: catalog,
    });
    assert.equal(convRes.rootCascadeId, ROOT_CID);
    assert.equal(convRes.turns.length, 1);
    assert.equal(convRes.turns[0].cascadeId, SUB_CID);
    assert.equal(convRes.turns[0].turnIndex, 1);
  });

  it('handles missing timestamps via deterministic fallback ordering and handles empty metadata cleanly', () => {
    const catalog = makeCatalog();
    const emptyRes = buildTimelineTurns({
      activeConversationId: '',
      scope: 'tree',
      nodesByCascadeId: {},
      generatorMetadataByCascade: {},
      modelCatalog: catalog,
    });
    assert.equal(emptyRes.rootCascadeId, null);
    assert.deepEqual(emptyRes.turns, []);

    const missingMeta = buildTimelineTurns({
      activeConversationId: ROOT_CID,
      scope: 'tree',
      nodesByCascadeId: { [ROOT_CID]: makeNode() },
      generatorMetadataByCascade: { [ROOT_CID]: [{}] },
      modelCatalog: catalog,
    });
    assert.deepEqual(missingMeta.turns, []);

    const fallbackOrdered = buildTimelineTurns({
      activeConversationId: ROOT_CID,
      scope: 'tree',
      nodesByCascadeId: {
        [ROOT_CID]: makeNode({
          cascadeId: ROOT_CID,
          lastModifiedTime: '2026-11-14T10:00:05.000Z',
        }),
        [SUB_CID]: makeNode({
          cascadeId: SUB_CID,
          rootCascadeId: ROOT_CID,
          parentCascadeId: ROOT_CID,
          kind: 'subagent',
          role: 'Verifier',
          depth: 1,
          spawnStepIndex: 2,
          lastModifiedTime: '2026-11-14T10:00:10.000Z',
        }),
      },
      generatorMetadataByCascade: {
        [ROOT_CID]: [
          { stepIndices: [6], chatModel: { responseModel: 'gemini-4-argon-medium' } },
          { stepIndices: [1], chatModel: { responseModel: 'gemini-4-carbon-high' } },
        ],
        [SUB_CID]: [{ stepIndices: [1], chatModel: { responseModel: 'gemini-3.8-flash' } }],
      },
      modelCatalog: catalog,
    });
    assert.deepEqual(
      fallbackOrdered.turns.map((t) => [t.turnIndex, t.cascadeId, t.stepIndices[0]]),
      [
        [3, SUB_CID, 1],
        [2, ROOT_CID, 6],
        [1, ROOT_CID, 1],
      ]
    );
  });
});

describe('core/fleet-builder — RTM-18 cross-project aggregation & Top 5 burners', () => {
  it('compacts model display names across Gemini, Claude, and OpenAI variants', () => {
    const mk = (displayName: string, tier: ModelTier = 'workhorse') => ({
      responseModel: displayName.toLowerCase(),
      displayName,
      modelEnum: displayName,
      family: 'gemini' as const,
      effortTier: 'medium' as const,
      tier,
    });
    assert.equal(compactModelLabel(mk('Gemini 4 Carbon (High)', 'apex')), 'Carbon(H)');
    assert.equal(compactModelLabel(mk('Gemini 4 Argon (Medium)', 'workhorse')), 'Argon(M)');
    assert.equal(compactModelLabel(mk('Gemini 4 Hydrogen (XHigh)', 'apex')), 'Hydrogen(XH)');
    assert.equal(compactModelLabel(mk('Gemini 3.8 Flash', 'fast')), 'Flash');
    assert.equal(compactModelLabel(mk('Claude Opus 5.5 (High)', 'apex')), 'Opus(H)');
    assert.equal(compactModelLabel(mk('Claude Sonnet 5.5', 'workhorse')), 'Sonnet');
    assert.equal(compactModelLabel(mk('Gemini 4 Argon (Low)', 'fast')), 'Argon(L)');
    assert.equal(compactModelLabel(mk('OpenAI o3 (High)', 'apex')), 'o3(H)');
  });

  it('returns clean empty-state fleet snapshot when zero cascades exist', () => {
    const nowMs = Date.parse('2026-11-14T12:00:00.000Z');
    const empty = buildFleetSnapshot({
      nowMs,
      hostConnected: false,
      trajectories: {},
      nodesByCascadeId: {},
      quota: makeEmptyQuota(),
      cascadeBaselines: {},
    });

    assert.equal(empty.hostConnected, false);
    assert.deepEqual(empty.activeHeadline, {
      runningRoots: 0,
      runningSubagents: 0,
      totalRunningNodes: 0,
      modelHistogram: [],
    });
    assert.deepEqual(empty.projects, []);
    assert.deepEqual(empty.topQuotaBurners, []);
  });

  it('computes activeHeadline histogram, active-first project grouping, Workspace Unavailable fallback, and Top 5 burners', () => {
    const nowMs = Date.parse('2026-11-14T12:00:00.000Z');
    const recentIso = new Date(nowMs - 30 * 60_000).toISOString();
    const olderRecentIso = new Date(nowMs - 90 * 60_000).toISOString();
    const expiredIso = new Date(nowMs - ROLLING_5H_WINDOW_MS - 60_000).toISOString();

    const trajectories: Record<string, TrajectorySummaryRaw> = {};
    const nodesByCascadeId: Record<string, CascadeNodeView> = {};
    const cascadeBaselines: Record<
      string,
      { firstSeenAt: string; baseline5hFraction: number | null; last5hFraction: number | null; delta5hPct: number }
    > = {};

    // Project 1 (active): antigravity-pulse with 1 running root + 2 running subagents
    const p1Root = 'aaaaaaaa-0001-4000-8000-000000000001';
    const p1Sub1 = 'aaaaaaaa-0001-4000-8000-000000000002';
    const p1Sub2 = 'aaaaaaaa-0001-4000-8000-000000000003';
    trajectories[p1Root] = {
      trajectoryId: p1Root,
      status: 'CASCADE_RUN_STATUS_RUNNING',
      lastModifiedTime: recentIso,
      workspaces: [{ workspaceFolderAbsoluteUri: 'file:///home/dev/antigravity-pulse/' }],
    };
    nodesByCascadeId[p1Root] = makeNode({
      cascadeId: p1Root,
      rootCascadeId: p1Root,
      kind: 'root',
      title: 'Pulse Root',
      status: 'CASCADE_RUN_STATUS_RUNNING',
      phase: 'THINKING',
      phaseStartedAt: new Date(nowMs - 12_000).toISOString(),
      servedModel: {
        responseModel: 'gemini-4-carbon-high',
        displayName: 'Gemini 4 Carbon (High)',
        modelEnum: 'MODEL_PLACEHOLDER_M427',
        family: 'gemini',
        effortTier: 'high',
        tier: 'apex',
      },
      tokens: {
        inputTokens: 10_000,
        cacheReadTokens: 40_000,
        outputTokens: 2_000,
        thinkingOutputTokens: 1_500,
        responseOutputTokens: 500,
      },
      lastModifiedTime: recentIso,
    });
    nodesByCascadeId[p1Sub1] = makeNode({
      cascadeId: p1Sub1,
      rootCascadeId: p1Root,
      parentCascadeId: p1Root,
      kind: 'subagent',
      title: 'Sub Alpha',
      role: 'Explorer',
      depth: 1,
      status: 'CASCADE_RUN_STATUS_RUNNING',
      phase: 'TOOL_RUNNING',
      phaseStartedAt: new Date(nowMs - 20_000).toISOString(),
      servedModel: {
        responseModel: 'gemini-4-argon-medium',
        displayName: 'Gemini 4 Argon (Medium)',
        modelEnum: 'MODEL_PLACEHOLDER_M418',
        family: 'gemini',
        effortTier: 'medium',
        tier: 'workhorse',
      },
      tokens: {
        inputTokens: 5_000,
        cacheReadTokens: 15_000,
        outputTokens: 1_000,
        thinkingOutputTokens: 400,
        responseOutputTokens: 600,
      },
      lastModifiedTime: recentIso,
    });
    nodesByCascadeId[p1Sub2] = makeNode({
      cascadeId: p1Sub2,
      rootCascadeId: p1Root,
      parentCascadeId: p1Root,
      kind: 'swarm_member',
      title: 'Sub Beta',
      role: 'Verifier',
      depth: 1,
      status: 'CASCADE_RUN_STATUS_RUNNING',
      phase: 'STREAMING',
      phaseStartedAt: new Date(nowMs - 5_000).toISOString(),
      servedModel: {
        responseModel: 'gemini-4-argon-medium',
        displayName: 'Gemini 4 Argon (Medium)',
        modelEnum: 'MODEL_PLACEHOLDER_M418',
        family: 'gemini',
        effortTier: 'medium',
        tier: 'workhorse',
      },
      tokens: {
        inputTokens: 2_000,
        cacheReadTokens: 8_000,
        outputTokens: 500,
        thinkingOutputTokens: 100,
        responseOutputTokens: 400,
      },
      lastModifiedTime: recentIso,
    });
    cascadeBaselines[p1Root] = {
      firstSeenAt: recentIso,
      baseline5hFraction: 0.9,
      last5hFraction: 0.87,
      delta5hPct: 1.5,
    };
    cascadeBaselines[p1Sub1] = {
      firstSeenAt: recentIso,
      baseline5hFraction: 0.9,
      last5hFraction: 0.87,
      delta5hPct: 1.0,
    };

    // Project 2 (active, Windows URI): payments-ledger with 1 running root (Carbon)
    const p2Root = 'bbbbbbbb-0002-4000-8000-000000000001';
    trajectories[p2Root] = {
      trajectoryId: p2Root,
      status: 'CASCADE_RUN_STATUS_RUNNING',
      lastModifiedTime: olderRecentIso,
      workspaces: [{ workspaceFolderAbsoluteUri: 'file:///C:/Users/dev/payments-ledger/' }],
    };
    nodesByCascadeId[p2Root] = makeNode({
      cascadeId: p2Root,
      rootCascadeId: p2Root,
      kind: 'root',
      title: 'Ledger Audit',
      status: 'CASCADE_RUN_STATUS_RUNNING',
      phase: 'THINKING',
      phaseStartedAt: new Date(nowMs - 8_000).toISOString(),
      servedModel: {
        responseModel: 'gemini-4-carbon-high',
        displayName: 'Gemini 4 Carbon (High)',
        modelEnum: 'MODEL_PLACEHOLDER_M427',
        family: 'gemini',
        effortTier: 'high',
        tier: 'apex',
      },
      tokens: {
        inputTokens: 20_000,
        cacheReadTokens: 80_000,
        outputTokens: 4_000,
        thinkingOutputTokens: 3_000,
        responseOutputTokens: 1_000,
      },
      lastModifiedTime: olderRecentIso,
    });
    cascadeBaselines[p2Root] = {
      firstSeenAt: olderRecentIso,
      baseline5hFraction: 0.95,
      last5hFraction: 0.905,
      delta5hPct: 4.5,
    };

    // Project 3 (idle, computedName-only fallback) + 4 more recent idle burners to test Top 5 cap & tie-breaking
    for (let i = 1; i <= 4; i += 1) {
      const cid = `cccccccc-000${i}-4000-8000-00000000000${i}`;
      trajectories[cid] = {
        trajectoryId: cid,
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: recentIso,
        workspaces: i <= 2 ? [{ repository: { computedName: 'nebula-compiler' } }] : undefined,
      };
      nodesByCascadeId[cid] = makeNode({
        cascadeId: cid,
        rootCascadeId: cid,
        kind: 'root',
        title: `Idle Burner ${i}`,
        status: 'CASCADE_RUN_STATUS_IDLE',
        phase: 'IDLE',
        servedModel: {
          responseModel: 'claude-opus-5.5-high',
          displayName: 'Claude Opus 5.5 (High)',
          modelEnum: 'claude-opus-5.5-high',
          family: 'claude',
          effortTier: 'high',
          tier: 'apex',
        },
        tokens: {
          inputTokens: 1_000 * i,
          cacheReadTokens: 2_000,
          outputTokens: 300,
          thinkingOutputTokens: 100,
          responseOutputTokens: 200,
        },
        lastModifiedTime: recentIso,
      });
      cascadeBaselines[cid] = {
        firstSeenAt: recentIso,
        baseline5hFraction: 0.9,
        last5hFraction: 0.89,
        delta5hPct: i === 4 ? 3.2 : 0.5 * i,
      };
    }

    // Expired idle tree (>5h old with 0 delta) -> excluded from projects and topQuotaBurners
    const expiredCid = 'dddddddd-0009-4000-8000-000000000009';
    trajectories[expiredCid] = {
      trajectoryId: expiredCid,
      status: 'CASCADE_RUN_STATUS_IDLE',
      lastModifiedTime: expiredIso,
      workspaces: [{ workspaceFolderAbsoluteUri: 'file:///home/dev/stale-project' }],
    };
    nodesByCascadeId[expiredCid] = makeNode({
      cascadeId: expiredCid,
      rootCascadeId: expiredCid,
      title: 'Very Old Tree',
      status: 'CASCADE_RUN_STATUS_IDLE',
      phase: 'IDLE',
      lastModifiedTime: expiredIso,
      tokens: {
        inputTokens: 500,
        cacheReadTokens: 0,
        outputTokens: 50,
        thinkingOutputTokens: 0,
        responseOutputTokens: 50,
      },
    });

    const fleet = buildFleetSnapshot({
      nowMs,
      hostConnected: true,
      trajectories,
      nodesByCascadeId,
      quota: makeEmptyQuota(),
      cascadeBaselines,
    });

    // Active headline: 2 running roots + 2 running subagents = 4 total
    assert.equal(fleet.activeHeadline.runningRoots, 2);
    assert.equal(fleet.activeHeadline.runningSubagents, 2);
    assert.equal(fleet.activeHeadline.totalRunningNodes, 4);
    // Count tie (2 Argon(M) vs 2 Carbon(H)) broken alphabetically ascending -> Argon(M) before Carbon(H)
    assert.deepEqual(fleet.activeHeadline.modelHistogram, [
      { label: 'Argon(M)', tier: 'workhorse', count: 2 },
      { label: 'Carbon(H)', tier: 'apex', count: 2 },
    ]);

    // Active-first project sort: antigravity-pulse (3 running) -> payments-ledger (1 running) -> idle projects
    assert.equal(fleet.projects.length, 4);
    assert.equal(fleet.projects[0].projectName, 'antigravity-pulse');
    assert.equal(fleet.projects[0].runningCount, 3);
    assert.equal(fleet.projects[0].trees[0].elapsedMs, 20_000);
    assert.equal(fleet.projects[0].trees[0].treeDeltaQuota5hPct, 2.5);
    assert.deepEqual(fleet.projects[0].trees[0].modelMix, {
      'Argon(M)': 2,
      'Carbon(H)': 1,
    });
    assert.equal(fleet.projects[1].projectName, 'payments-ledger');
    assert.equal(fleet.projects[1].runningCount, 1);

    const projectNames = fleet.projects.map((p) => p.projectName);
    assert.ok(projectNames.includes('nebula-compiler'));
    assert.ok(projectNames.includes('Workspace Unavailable'));
    assert.equal(projectNames.includes('stale-project'), false);

    // Top 5 Quota Burners: capped at 5, sorted desc by delta5hPct
    assert.equal(fleet.topQuotaBurners.length, 5);
    assert.deepEqual(
      fleet.topQuotaBurners.map((b) => [b.rank, b.rootCascadeId, b.delta5hPct]),
      [
        [1, p2Root, 4.5],
        [2, 'cccccccc-0004-4000-8000-000000000004', 3.2],
        [3, p1Root, 2.5],
        [4, 'cccccccc-0003-4000-8000-000000000003', 1.5],
        [5, 'cccccccc-0002-4000-8000-000000000002', 1.0],
      ]
    );
    assert.equal(fleet.topQuotaBurners[0].consumed5hPct, 4.5);
    assert.equal(fleet.topQuotaBurners[0].dominantModel, 'Carbon(H)');
    assert.equal(fleet.topQuotaBurners[0].isRunning, true);
    assert.equal(fleet.topQuotaBurners[1].isRunning, false);

    // FleetTreeSummary nodes sorted active-first, then depth asc, then title asc
    assert.deepEqual(
      fleet.projects[0].trees[0].nodes.map((n) => n.cascadeId),
      [p1Root, p1Sub1, p1Sub2]
    );
  });

  it('enforces maxIdleTreesPerProject cap and topQuotaBurners totalTokens tie-breaker', () => {
    const nowMs = Date.parse('2026-11-14T12:00:00.000Z');
    const trajectories: Record<string, TrajectorySummaryRaw> = {};
    const nodesByCascadeId: Record<string, CascadeNodeView> = {};
    const cascadeBaselines: Record<
      string,
      { firstSeenAt: string; baseline5hFraction: number | null; last5hFraction: number | null; delta5hPct: number }
    > = {};

    for (let i = 1; i <= 7; i += 1) {
      const cid = `eeeeeeee-000${i}-4000-8000-00000000000${i}`;
      const modIso = new Date(nowMs - i * 60_000).toISOString();
      trajectories[cid] = {
        trajectoryId: cid,
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: modIso,
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///home/dev/mono-repo' }],
      };
      nodesByCascadeId[cid] = makeNode({
        cascadeId: cid,
        rootCascadeId: cid,
        title: `Idle Tree ${i}`,
        status: 'CASCADE_RUN_STATUS_IDLE',
        phase: 'IDLE',
        tokens: {
          inputTokens: 1_000 * i,
          cacheReadTokens: 0,
          outputTokens: 100,
          thinkingOutputTokens: 0,
          responseOutputTokens: 100,
        },
        lastModifiedTime: modIso,
      });
      // Equal delta5hPct (1.0) across all 7 so tie-breaker uses totalTokens desc
      cascadeBaselines[cid] = {
        firstSeenAt: modIso,
        baseline5hFraction: 0.9,
        last5hFraction: 0.89,
        delta5hPct: 1.0,
      };
    }

    const fleet = buildFleetSnapshot({
      nowMs,
      hostConnected: true,
      trajectories,
      nodesByCascadeId,
      quota: makeEmptyQuota(),
      cascadeBaselines,
      maxIdleTreesPerProject: 5,
    });

    assert.equal(fleet.projects.length, 1);
    assert.equal(fleet.projects[0].trees.length, 5);
    assert.equal(fleet.projects[0].trees[0].rootTitle, 'Idle Tree 1'); // Most recent first

    // Top 5 tie-breaker orders highest totalTokens first (7 -> 6 -> 5 -> 4 -> 3)
    assert.deepEqual(
      fleet.topQuotaBurners.map((b) => b.title),
      ['Idle Tree 7', 'Idle Tree 6', 'Idle Tree 5', 'Idle Tree 4', 'Idle Tree 3']
    );
  });
});

describe('sidecar/telemetry-engine & server — /api/timeline, /api/fleet, live-snapshot.json & 34B ETag', () => {
  const cleanupDirs: string[] = [];

  after(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupMockLs() {
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    let quotaFraction = 0.85;
    let rootStepCount = 10;
    let rootStatus = 'CASCADE_RUN_STATUS_RUNNING';
    const nowIso = new Date().toISOString();

    const trajectories: Record<string, TrajectorySummaryRaw> = {
      [ROOT_CID]: {
        trajectoryId: ROOT_CID,
        status: rootStatus,
        stepCount: rootStepCount,
        summary: 'Root Pipeline',
        lastModifiedTime: nowIso,
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///home/dev/antigravity-pulse' }],
      },
      [SUB_CID]: {
        trajectoryId: SUB_CID,
        status: 'CASCADE_RUN_STATUS_IDLE',
        stepCount: 4,
        summary: 'Explorer Child',
        lastModifiedTime: nowIso,
      },
      [OTHER_ROOT_CID]: {
        trajectoryId: OTHER_ROOT_CID,
        status: 'CASCADE_RUN_STATUS_IDLE',
        stepCount: 3,
        summary: 'Ledger Task',
        lastModifiedTime: nowIso,
        workspaces: [{ workspaceFolderAbsoluteUri: 'file:///home/dev/payments-ledger' }],
      },
    };

    const genMetaByCid: Record<string, GeneratorMetadataEntryRaw[]> = {
      [ROOT_CID]: [
        {
          stepIndices: [1, 2],
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M427',
            modelDisplayName: 'Gemini 4 Carbon (High)',
            responseModel: 'gemini-4-carbon-high',
            timeToFirstToken: '3.2s',
            streamingDuration: '1.8s',
            retryInfos: [{}],
            chatStartMetadata: {
              createdAt: new Date(Date.now() - 40_000).toISOString(),
              contextWindowMetadata: { estimatedTokensUsed: '40960', maxContextTokens: '256000' },
            },
            customMetadata: { model_enum: 'auto' },
            usage: {
              inputTokens: '2000',
              cacheReadTokens: '8000',
              outputTokens: '500',
              thinkingOutputTokens: '400',
              responseOutputTokens: '100',
            },
          },
        },
      ],
      [SUB_CID]: [
        {
          stepIndices: [1],
          chatModel: {
            model: 'flash',
            modelDisplayName: 'Gemini 3.8 Flash',
            responseModel: 'gemini-3.8-flash',
            timeToFirstToken: '0.4s',
            streamingDuration: '0.6s',
            retryInfos: [{}],
            chatStartMetadata: { createdAt: new Date(Date.now() - 25_000).toISOString() },
            customMetadata: {
              parent_cascade_id: ROOT_CID,
              root_cascade_id: ROOT_CID,
              model_enum: 'flash',
            },
            usage: {
              inputTokens: '500',
              cacheReadTokens: '4500',
              outputTokens: '200',
              thinkingOutputTokens: '50',
              responseOutputTokens: '150',
            },
          },
        },
      ],
      [OTHER_ROOT_CID]: [
        {
          stepIndices: [1],
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M418',
            modelDisplayName: 'Gemini 4 Argon (Medium)',
            responseModel: 'gemini-4-argon-medium',
            timeToFirstToken: '1.1s',
            streamingDuration: '1.0s',
            retryInfos: [{}],
            usage: {
              inputTokens: '1000',
              cacheReadTokens: '1000',
              outputTokens: '300',
              thinkingOutputTokens: '100',
              responseOutputTokens: '200',
            },
          },
        },
      ],
    };

    const modelConfig: GetCascadeModelConfigDataResponse = {
      defaultOverrideModelConfig: {
        modelOrAlias: { model: 'auto' },
        label: 'Auto',
        modelId: 'auto',
      },
      clientModelConfigs: [
        {
          modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
          modelId: 'gemini-4-carbon-high',
          label: 'Gemini 4 Carbon (High)',
        },
        {
          modelOrAlias: { model: 'MODEL_PLACEHOLDER_M418' },
          modelId: 'gemini-4-argon-medium',
          label: 'Gemini 4 Argon (Medium)',
        },
        {
          modelOrAlias: { model: 'flash' },
          modelId: 'gemini-3.8-flash',
          label: 'Gemini 3.8 Flash',
        },
      ],
    };

    const csrf = 's2a-unit-csrf';
    const server = http.createServer((req, res) => {
      if (req.headers['x-codeium-csrf-token'] !== csrf) {
        res.writeHead(401);
        res.end();
        return;
      }
      const method = (req.url || '').split('/').pop() || '';
      let rawBody = '';
      req.on('data', (c) => {
        rawBody += c;
      });
      req.on('end', () => {
        const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        calls.push({ method, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (method === 'GetCascadeModelConfigData') {
          res.end(JSON.stringify(modelConfig));
          return;
        }
        if (method === 'RetrieveUserQuotaSummary') {
          const resp: RetrieveUserQuotaSummaryResponse = {
            response: {
              groups: [
                {
                  groupId: 'gemini',
                  buckets: [
                    {
                      bucketId: 'gemini-5h',
                      displayName: 'Gemini 5h',
                      window: '5h',
                      remainingFraction: quotaFraction,
                      resetTime: new Date(Date.now() + 7200_000).toISOString(),
                    },
                  ],
                },
              ],
            },
          };
          res.end(JSON.stringify(resp));
          return;
        }
        if (method === 'GetAllCascadeTrajectories') {
          trajectories[ROOT_CID].stepCount = rootStepCount;
          trajectories[ROOT_CID].status = rootStatus;
          const resp: GetAllCascadeTrajectoriesResponse = { trajectorySummaries: trajectories };
          res.end(JSON.stringify(resp));
          return;
        }
        if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
          const cid = String(body.cascadeId ?? '');
          const resp: GetCascadeTrajectoryGeneratorMetadataResponse = {
            generatorMetadata: genMetaByCid[cid] ?? [],
          };
          res.end(JSON.stringify(resp));
          return;
        }
        if (method === 'GetCascadeTrajectorySteps') {
          const resp: GetCascadeTrajectoryStepsResponse = {
            steps: [{ type: 'CORTEX_STEP_TYPE_MODEL', status: 'CORTEX_STEP_STATUS_GENERATING' }],
          };
          res.end(JSON.stringify(resp));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    return {
      calls,
      csrf,
      setQuota(v: number) {
        quotaFraction = v;
      },
      bumpRootTurn() {
        rootStepCount += 2;
        genMetaByCid[ROOT_CID].push({
          stepIndices: [11, 12],
          chatModel: {
            model: 'MODEL_PLACEHOLDER_M418',
            modelDisplayName: 'Gemini 4 Argon (Medium)',
            responseModel: 'gemini-4-argon-medium',
            timeToFirstToken: '1.0s',
            streamingDuration: '1.2s',
            retryInfos: [{}, {}], // 1 retry
            chatStartMetadata: { createdAt: new Date(Date.now() - 1_000).toISOString() },
            customMetadata: { model_enum: 'auto' },
            usage: {
              inputTokens: '3000',
              cacheReadTokens: '7000',
              outputTokens: '400',
              thinkingOutputTokens: '100',
              responseOutputTokens: '300',
            },
          },
        });
      },
      setRootIdle() {
        rootStatus = 'CASCADE_RUN_STATUS_IDLE';
      },
      async start(): Promise<string> {
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        assert.ok(addr && typeof addr === 'object');
        return `http://127.0.0.1:${addr.port}`;
      },
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('TelemetryEngine populates live-snapshot.json.fleet, config.timelineScope fallback, 34B ETags, and incremental RPCs', async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-s2a-engine-'));
    cleanupDirs.push(tmpRoot);
    const stateDir = path.join(tmpRoot, 'state');
    const agyDir = path.join(tmpRoot, 'agy');
    mkdirSync(path.join(agyDir, 'brain'), { recursive: true });

    const mockLs = setupMockLs();
    const lsUrl = await mockLs.start();
    const lsClient = new ReadOnlyLsClient({ address: lsUrl, csrfToken: mockLs.csrf });
    const engine = new TelemetryEngine({
      lsClient,
      stateDir,
      antigravityDataDir: agyDir,
    });

    try {
      const t0 = Date.now();
      await engine.refreshOnce(t0);

      // Zero GetCascadeTrajectory; Steps ONLY for RUNNING ROOT_CID with L-004 stepOffset
      assert.equal(mockLs.calls.some((c) => c.method === 'GetCascadeTrajectory'), false);
      const stepCalls1 = mockLs.calls.filter((c) => c.method === 'GetCascadeTrajectorySteps');
      assert.equal(stepCalls1.length, 1);
      assert.equal(stepCalls1[0].body.cascadeId, ROOT_CID);
      assert.equal(typeof stepCalls1[0].body.stepOffset, 'number');
      assert.equal(stepCalls1[0].body.disableRehydration, true);
      assert.equal('startIndex' in stepCalls1[0].body, false);

      // Cycle 2 with unchanged stepCount -> ZERO GeneratorMetadata calls
      mockLs.calls.length = 0;
      await engine.refreshOnce(t0 + 400);
      assert.equal(
        mockLs.calls.filter((c) => c.method === 'GetCascadeTrajectoryGeneratorMetadata').length,
        0
      );

      // Cycle 3: root advances & quota drops -> per-turn delta & fleet Top Burners update
      mockLs.calls.length = 0;
      mockLs.bumpRootTurn();
      mockLs.setQuota(0.82);
      await engine.refreshOnce(t0 + 1000);
      assert.equal(
        mockLs.calls.filter((c) => c.method === 'GetCascadeTrajectoryGeneratorMetadata').length,
        1
      );

      // Default config timelineScope is 'tree' -> omitted scope includes ROOT_CID + SUB_CID
      const tlTree = engine.getTimelineSnapshot(ROOT_CID) as TimelineSnapshotResponse;
      assert.equal(tlTree.scope, 'tree');
      assert.equal(tlTree.turns.length, 3);
      assert.equal(tlTree.turns[0].routingChangedFromPrevTurn, true); // Carbon -> Argon
      assert.equal(tlTree.turns[0].retryCount, 1);
      assert.ok(tlTree.turns[0].deltaQuota5hPct !== null && tlTree.turns[0].deltaQuota5hPct > 0);

      // Exact 34-byte ETag cache hit on timeline
      const tlUnchanged = engine.getTimelineSnapshot(
        ROOT_CID,
        undefined,
        tlTree.etag
      ) as UnchangedEtagResponse;
      assert.deepEqual(tlUnchanged, { unchanged: true, etag: tlTree.etag });
      assert.equal(Buffer.byteLength(JSON.stringify(tlUnchanged), 'utf8'), 34);

      // Updating config.timelineScope to 'conversation' takes effect when scope is omitted
      engine.updateConfig({ timelineScope: 'conversation' });
      const tlConv = engine.getTimelineSnapshot(ROOT_CID) as TimelineSnapshotResponse;
      assert.equal(tlConv.scope, 'conversation');
      assert.equal(tlConv.turns.length, 2);

      // Fleet snapshot populated + exact 34-byte ETag hit even while ROOT_CID is RUNNING
      const fleet1 = engine.getFleetSnapshot() as FleetSnapshotResponse;
      assert.equal(fleet1.activeHeadline.runningRoots, 1);
      assert.equal(fleet1.projects.length, 2);
      assert.ok(fleet1.topQuotaBurners.length >= 1 && fleet1.topQuotaBurners.length <= 5);
      assert.ok(fleet1.topQuotaBurners[0].consumed5hPct > 0);

      const fleetHit = engine.getFleetSnapshot(fleet1.etag) as UnchangedEtagResponse;
      assert.deepEqual(fleetHit, { unchanged: true, etag: fleet1.etag });
      assert.equal(Buffer.byteLength(JSON.stringify(fleetHit), 'utf8'), 34);

      // live-snapshot.json contains populated fleet (for Stage 3 CLI/MCP)
      const liveSnapshot = JSON.parse(
        readFileSync(path.join(stateDir, 'live-snapshot.json'), 'utf8')
      ) as LiveSnapshotFile;
      assert.equal(liveSnapshot.fleet.projects.length, 2);
      assert.equal(liveSnapshot.fleet.activeHeadline.runningRoots, 1);
      assert.ok(liveSnapshot.fleet.topQuotaBurners.length >= 1);
    } finally {
      engine.stop();
      await mockLs.close();
    }
  });

  it('real SidecarApp server.ts enforces HTTP 400 validation (L-007), config timelineScope fallback, and 34B ETags on /api/timeline & /api/fleet', async () => {
    const repoRoot = resolveRepoRoot();
    const loaderPath = resolveSidecarLoader();
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-s2a-srv-'));
    cleanupDirs.push(tmpRoot);

    const stateDir = path.join(tmpRoot, 'state');
    const agyDir = path.join(tmpRoot, 'agy');
    mkdirSync(path.join(agyDir, 'brain'), { recursive: true });
    const tmpServerMjs = path.join(tmpRoot, 'server.mjs');
    const esbuildMain = path.join(repoRoot, 'node_modules', 'esbuild', 'lib', 'main.js');

    execFileSync(
      process.execPath,
      [
        '-e',
        "const esbuild = require(process.argv[1]); esbuild.buildSync({ entryPoints: [process.argv[2]], outfile: process.argv[3], bundle: true, platform: 'node', target: 'node20', format: 'esm', external: ['sidecar_sdk'] });",
        esbuildMain,
        path.join(repoRoot, 'src', 'sidecar', 'server.ts'),
        tmpServerMjs,
      ],
      { cwd: repoRoot }
    );

    const mockLs = setupMockLs();
    const lsUrl = await mockLs.start();
    const uiToken = 's2a-ui-token';

    // Pre-seed config.json with timelineScope: 'conversation' to verify omitted ?scope uses config
    mkdirSync(stateDir, { recursive: true });
    const seedCfg: PulseUserConfig = {
      version: 1,
      inlineStampMode: 'smart',
      hudSortMode: 'active-first',
      timelineScope: 'conversation',
      smartThresholds: {
        contextWarnPct: 70,
        contextCriticalPct: 85,
        stampContextTriggerPct: 75,
        quotaLowTriggerPct: 20,
        heavyConcurrentAlertCount: 3,
        heavyQuotaThresholdPct: 40,
      },
      pollIntervalsMs: { active: 1000, idle: 3000, quota: 30000, modelConfig: 30000 },
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify(seedCfg), 'utf8');

    const child = spawn(process.execPath, ['--import', loaderPath, tmpServerMjs], {
      env: {
        ...process.env,
        ANTIGRAVITY_LS_ADDRESS: lsUrl,
        ANTIGRAVITY_CSRF_TOKEN: mockLs.csrf,
        ANTIGRAVITY_SIDECAR_WEB_PORT: '0',
        ANTIGRAVITY_SIDECAR_UI_TOKEN: uiToken,
        ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
        ANTIGRAVITY_DATA_DIR: agyDir,
        ANTIGRAVITY_CONVERSATION_ID: ROOT_CID,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      const baseUrl = await new Promise<string>((resolve, reject) => {
        let out = '';
        let err = '';
        const timer = setTimeout(() => {
          reject(new Error(`Sidecar server startup timeout. stdout=${out} stderr=${err}`));
        }, 5000);
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
          const m = /listening on (127\.0\.0\.1:\d+)/i.exec(out);
          if (m?.[1]) {
            clearTimeout(timer);
            resolve(`http://${m[1]}`);
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          err += chunk.toString('utf8');
        });
        child.on('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`Server exited prematurely (${code}): ${err}`));
        });
      });

      // Wait until telemetry engine initial refresh populates nodes
      const deadline = Date.now() + 4000;
      let readyFleet: FleetSnapshotResponse | null = null;
      while (Date.now() < deadline) {
        const res = await fetch(`${baseUrl}/api/fleet`);
        if (res.status === 200) {
          const json = (await res.json()) as FleetSnapshotResponse;
          if (json.projects.length > 0) {
            readyFleet = json;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      assert.ok(readyFleet, 'Expected /api/fleet to populate projects from mock LS');

      // 400 Validation on /api/timeline (L-007 Response, not 500)
      const badUuid = await fetch(`${baseUrl}/api/timeline?conversationId=not-a-uuid`);
      assert.equal(badUuid.status, 400);
      assert.match(badUuid.headers.get('content-type') ?? '', /^application\/json/i);

      const badScope = await fetch(`${baseUrl}/api/timeline?scope=invalid`);
      assert.equal(badScope.status, 400);
      assert.match(badScope.headers.get('content-type') ?? '', /^application\/json/i);

      const emptyScope = await fetch(`${baseUrl}/api/timeline?scope=`);
      assert.equal(emptyScope.status, 400);

      // Omitted scope honors config.json.timelineScope ('conversation') -> 1 turn on ROOT_CID
      const tlOmitted = (await (await fetch(`${baseUrl}/api/timeline`)).json()) as TimelineSnapshotResponse;
      assert.equal(tlOmitted.scope, 'conversation');
      assert.equal(tlOmitted.turns.length, 1);

      // Explicit ?scope=tree overrides config -> 2 turns (ROOT_CID + SUB_CID)
      const tlTreeRes = await fetch(`${baseUrl}/api/timeline?scope=tree`);
      assert.equal(tlTreeRes.status, 200);
      const tlTree = (await tlTreeRes.json()) as TimelineSnapshotResponse;
      assert.equal(tlTree.scope, 'tree');
      assert.equal(tlTree.turns.length, 2);

      // 34-byte ETag cache hit on /api/timeline
      const tlHitRes = await fetch(
        `${baseUrl}/api/timeline?scope=tree&etag=${encodeURIComponent(tlTree.etag)}`
      );
      assert.equal(tlHitRes.status, 200);
      const tlHitRaw = await tlHitRes.text();
      assert.equal(Buffer.byteLength(tlHitRaw, 'utf8'), 34);
      assert.deepEqual(JSON.parse(tlHitRaw), { unchanged: true, etag: tlTree.etag });

      // 34-byte ETag cache hit on /api/fleet
      const fleetHitRes = await fetch(
        `${baseUrl}/api/fleet?etag=${encodeURIComponent(readyFleet.etag)}`
      );
      assert.equal(fleetHitRes.status, 200);
      const fleetHitRaw = await fleetHitRes.text();
      assert.equal(Buffer.byteLength(fleetHitRaw, 'utf8'), 34);
      assert.deepEqual(JSON.parse(fleetHitRaw), { unchanged: true, etag: readyFleet.etag });

      // POST /api/config updates timelineScope & reflects on omitted ?scope
      const cfgPatchRes = await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sidecar-token': uiToken,
        },
        body: JSON.stringify({ timelineScope: 'tree' }),
      });
      assert.equal(cfgPatchRes.status, 200);
      const tlAfterCfg = (await (
        await fetch(`${baseUrl}/api/timeline`)
      ).json()) as TimelineSnapshotResponse;
      assert.equal(tlAfterCfg.scope, 'tree');
      assert.equal(tlAfterCfg.turns.length, 2);
    } finally {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 1500);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      await mockLs.close();
    }
  });

  it('caps cold-boot GetCascadeTrajectoryGeneratorMetadata concurrency at <= 6 parallel RPCs (RTM-25)', async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-s2a-conc-'));
    cleanupDirs.push(tmpRoot);
    const stateDir = path.join(tmpRoot, 'state');
    const agyDir = path.join(tmpRoot, 'agy');
    mkdirSync(path.join(agyDir, 'brain'), { recursive: true });

    const summaries: Record<string, TrajectorySummaryRaw> = {};
    for (let i = 1; i <= 14; i += 1) {
      const hex = i.toString(16).padStart(2, '0');
      const cid = `55555555-5555-4555-8555-5555555555${hex}`;
      summaries[cid] = {
        trajectoryId: cid,
        status: 'CASCADE_RUN_STATUS_IDLE',
        stepCount: 2,
        summary: `Cascade ${i}`,
        lastModifiedTime: new Date().toISOString(),
      };
    }

    let inFlightMeta = 0;
    let maxInFlightMeta = 0;
    let totalMetaCalls = 0;

    const fakeClient = {
      isConfigured: () => true,
      async getCascadeModelConfigData() {
        return { clientModelConfigs: [] };
      },
      async retrieveUserQuotaSummary() {
        return { response: { groups: [] } };
      },
      async getAllCascadeTrajectories() {
        return { trajectorySummaries: summaries };
      },
      async getCascadeTrajectoryGeneratorMetadata() {
        totalMetaCalls += 1;
        inFlightMeta += 1;
        if (inFlightMeta > maxInFlightMeta) {
          maxInFlightMeta = inFlightMeta;
        }
        await new Promise((r) => setTimeout(r, 15));
        inFlightMeta -= 1;
        return { generatorMetadata: [] };
      },
      async getCascadeTrajectorySteps() {
        throw new Error('Must not call GetCascadeTrajectorySteps for IDLE cascades');
      },
    };

    const engine = new TelemetryEngine({
      lsClient: fakeClient,
      stateDir,
      antigravityDataDir: agyDir,
    });

    try {
      await engine.refreshOnce();
      assert.equal(totalMetaCalls, 14);
      assert.ok(maxInFlightMeta >= 2 && maxInFlightMeta <= 6, `maxInFlightMeta=${maxInFlightMeta}`);
    } finally {
      engine.stop();
    }
  });
});
