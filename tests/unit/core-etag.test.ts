import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeDeterministicEtag,
  computeHudSemanticEtag,
  isEtagMatch,
  makeUnchangedResponse,
} from '../../src/core/etag';
import { DEFAULT_PULSE_USER_CONFIG } from '../../src/state/config-store';
import type { CascadeNodeView } from '../../src/types/telemetry';

function makeSampleNode(phaseElapsedMs: number, stepCount = 3): CascadeNodeView {
  return {
    cascadeId: '11111111-1111-4111-8111-111111111111',
    rootCascadeId: '11111111-1111-4111-8111-111111111111',
    parentCascadeId: null,
    kind: 'root',
    title: 'Sample Cascade',
    role: null,
    typeName: null,
    depth: 0,
    status: 'CASCADE_RUN_STATUS_RUNNING',
    phase: 'THINKING',
    phaseStartedAt: '2026-11-14T10:00:00.000Z',
    phaseElapsedMs,
    requestedModel: { raw: 'auto', displayName: 'Auto', modelId: 'auto', source: 'user' },
    servedModel: {
      responseModel: 'gemini-4-carbon',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier: 'apex',
    },
    routingStatus: 'routed',
    retryCount: 0,
    lastTool: null,
    stepCount,
    turnCount: 1,
    streamingTokPerSec: null,
    contextWindow: { estimatedTokensUsed: 1000, maxContextTokens: 256000, pct: 0.39, level: 'normal' },
    cacheHitPct: 50,
    tokens: {
      inputTokens: 1000,
      cacheReadTokens: 1000,
      outputTokens: 200,
      thinkingOutputTokens: 150,
      responseOutputTokens: 50,
    },
    deltaQuota5hPct: 0.12,
    lastTtftMs: 1200,
    lastStreamingMs: 800,
    lastModifiedTime: '2026-11-14T10:00:00.000Z',
    spawnStepIndex: null,
    childrenIds: [],
  };
}

describe('core/etag — deterministic canonical hashing, volatile clock exclusion & 34B hit (RTM-25)', () => {
  it('computes identical 6-char base64url ETags regardless of object key order', () => {
    const a = { z: 1, a: { d: 4, b: [1, { y: 2, x: 1 }], u: undefined } };
    const b = { a: { b: [1, { x: 1, y: 2 }], d: 4 }, z: 1 };

    const etagA = computeDeterministicEtag(a);
    const etagB = computeDeterministicEtag(b);

    assert.equal(etagA, etagB);
    assert.equal(etagA.length, 6);
    assert.match(etagA, /^[A-Za-z0-9_-]{6}$/);
  });

  it('produces an exact 34-byte JSON response for UnchangedEtagResponse', () => {
    const etag = computeDeterministicEtag({ hello: 'pulse' });
    const unchanged = makeUnchangedResponse(etag);
    const serialized = JSON.stringify(unchanged);

    assert.deepEqual(unchanged, { unchanged: true, etag });
    assert.equal(Buffer.byteLength(serialized, 'utf8'), 34);
  });

  it('matches ETags cleanly with whitespace trimming and rejects empty/mismatch', () => {
    const etag = computeDeterministicEtag({ id: 1 });
    assert.equal(isEtagMatch(etag, etag), true);
    assert.equal(isEtagMatch(` ${etag} `, etag), true);
    assert.equal(isEtagMatch('', etag), false);
    assert.equal(isEtagMatch(null, etag), false);
    assert.equal(isEtagMatch(undefined, etag), false);
    assert.equal(isEtagMatch('other1', etag), false);
  });

  it('excludes volatile phaseElapsedMs ticks while invalidating on semantic changes', () => {
    const baseSnapshot = {
      hostConnected: true,
      activeConversationId: '11111111-1111-4111-8111-111111111111',
      rootCascadeId: '11111111-1111-4111-8111-111111111111',
      breadcrumb: [{ cascadeId: '11111111-1111-4111-8111-111111111111', title: 'Sample Cascade', role: null }],
      activeNode: makeSampleNode(1000, 3),
      treeNodes: [makeSampleNode(1000, 3)],
      smartGovernanceBanner: {
        active: false,
        heavyConcurrentCount: 1,
        gemini5hRemainingPct: 84,
        estimatedBurnPctPerMin: null,
        message: null,
      },
      quota: {
        fetchedAt: '2026-11-14T10:00:00.000Z',
        buckets: [],
        gemini5h: null,
        geminiWeekly: null,
        thirdParty5h: null,
        thirdPartyWeekly: null,
        treeNetDelta5hPct: 0.12,
        burnRate5hPctPerMin: null,
      },
      config: DEFAULT_PULSE_USER_CONFIG,
      warnings: [],
    };

    const etag1 = computeHudSemanticEtag(baseSnapshot);
    const etagAfterTick = computeHudSemanticEtag({
      ...baseSnapshot,
      activeNode: makeSampleNode(18_400, 3),
      treeNodes: [makeSampleNode(18_400, 3)],
    });
    assert.equal(etag1, etagAfterTick);

    const etagAfterStep = computeHudSemanticEtag({
      ...baseSnapshot,
      activeNode: makeSampleNode(18_400, 4),
      treeNodes: [makeSampleNode(18_400, 4)],
    });
    assert.notEqual(etag1, etagAfterStep);
  });
});
