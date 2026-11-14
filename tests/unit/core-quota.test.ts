import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeBurnRate5hPctPerMin,
  evaluateSmartGovernanceBanner,
  formatResetCountdown,
  normalizeQuotaSummary,
  updateCascadeQuotaBaselines,
} from '../../src/core/quota-calculator';
import { DEFAULT_PULSE_USER_CONFIG } from '../../src/state/config-store';
import type { QuotaCacheFile } from '../../src/state/state-dir';
import type { RetrieveUserQuotaSummaryResponse } from '../../src/types/rpc';
import type { CascadeNodeView, ModelTier } from '../../src/types/telemetry';

function makeQuotaRaw(
  gemini5hFrac: number,
  options?: {
    geminiWeeklyFrac?: number;
    thirdParty5hFrac?: number;
    thirdPartyWeeklyFrac?: number;
    resetTime?: string;
  }
): RetrieveUserQuotaSummaryResponse {
  return {
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
              remainingFraction: gemini5hFrac,
              resetTime: options?.resetTime ?? '2026-11-14T15:00:00Z',
            },
            {
              bucketId: 'gemini-weekly',
              displayName: 'Gemini Weekly',
              window: 'weekly',
              remainingFraction: options?.geminiWeeklyFrac ?? 0.965,
              resetTime: '2026-11-20T00:00:00Z',
            },
          ],
        },
        {
          groupId: '3p',
          displayName: 'Third-Party',
          buckets: [
            {
              bucketId: '3p-5h',
              displayName: 'Claude 5h',
              window: '5h',
              remainingFraction: options?.thirdParty5hFrac ?? 1.0,
              resetTime: null,
            },
            {
              bucketId: '3p-weekly',
              displayName: 'Claude Weekly',
              window: 'weekly',
              remainingFraction: options?.thirdPartyWeeklyFrac ?? 0.98,
              resetTime: null,
            },
          ],
        },
      ],
    },
  };
}

function makeNode(
  cascadeId: string,
  phase: CascadeNodeView['phase'],
  tier: ModelTier
): CascadeNodeView {
  return {
    cascadeId,
    rootCascadeId: 'root-1',
    parentCascadeId: cascadeId === 'root-1' ? null : 'root-1',
    kind: cascadeId === 'root-1' ? 'root' : 'subagent',
    title: cascadeId,
    role: null,
    typeName: null,
    depth: cascadeId === 'root-1' ? 0 : 1,
    status: phase === 'IDLE' ? 'CASCADE_RUN_STATUS_IDLE' : 'CASCADE_RUN_STATUS_RUNNING',
    phase,
    phaseStartedAt: null,
    phaseElapsedMs: 0,
    requestedModel: { raw: 'auto', displayName: 'Auto', modelId: 'auto', source: 'user' },
    servedModel: {
      responseModel: 'gemini-4-carbon',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier,
    },
    routingStatus: 'routed',
    retryCount: 0,
    lastTool: null,
    stepCount: 1,
    turnCount: 1,
    streamingTokPerSec: null,
    contextWindow: { estimatedTokensUsed: 1000, maxContextTokens: 256000, pct: 0.4, level: 'normal' },
    cacheHitPct: 0,
    tokens: {
      inputTokens: 1000,
      cacheReadTokens: 0,
      outputTokens: 100,
      thinkingOutputTokens: 0,
      responseOutputTokens: 100,
    },
    deltaQuota5hPct: null,
    lastTtftMs: null,
    lastStreamingMs: null,
    lastModifiedTime: '2026-11-14T10:00:00.000Z',
    spawnStepIndex: null,
    childrenIds: [],
  };
}

describe('core/quota-calculator — 8-decimal delta, reset, non-overcounting & governance banner', () => {
  it('formats reset countdowns cleanly across seconds, hours, days, and reset state', () => {
    const now = Date.parse('2026-11-14T10:00:00Z');
    assert.deepEqual(formatResetCountdown('2026-11-14T09:55:00Z', now), {
      resetInSeconds: 0,
      resetInLabel: '0m',
    });
    assert.deepEqual(formatResetCountdown('2026-11-14T10:45:00Z', now), {
      resetInSeconds: 2700,
      resetInLabel: '45m',
    });
    assert.deepEqual(formatResetCountdown('2026-11-14T12:21:00Z', now), {
      resetInSeconds: 8460,
      resetInLabel: '2h 21m',
    });
    assert.deepEqual(formatResetCountdown('2026-11-15T12:00:00Z', now), {
      resetInSeconds: 93600,
      resetInLabel: '1d 2h',
    });
    assert.deepEqual(formatResetCountdown(null, now), {
      resetInSeconds: null,
      resetInLabel: '—',
    });
  });

  it('RTM-05: preserves 8-decimal remainingFraction precision & computes exact single-cascade delta', () => {
    const t1 = '2026-11-14T10:00:00.000Z';
    const res1 = normalizeQuotaSummary(
      makeQuotaRaw(0.84972906),
      null,
      ['cid-1'],
      t1,
      [],
      [{ cascadeId: 'cid-1', isRunning: true }]
    );
    assert.equal(res1.quota.gemini5h?.remainingFraction, 0.84972906);
    assert.equal(res1.quota.gemini5h?.isLowAlert, false);
    assert.equal(res1.quota.geminiWeekly?.remainingFraction, 0.965);
    assert.equal(res1.quota.thirdParty5h?.remainingFraction, 1);
    assert.equal(res1.quota.thirdPartyWeekly?.remainingFraction, 0.98);
    assert.equal(res1.quota.treeNetDelta5hPct, 0);

    const cache1: QuotaCacheFile = {
      schemaVersion: 1,
      updatedAt: t1,
      quota: res1.quota,
      cascadeBaselines: res1.cascadeBaselines,
    };

    const t2 = '2026-11-14T10:01:00.000Z';
    const res2 = normalizeQuotaSummary(
      makeQuotaRaw(0.84324217),
      cache1,
      ['cid-1'],
      t2,
      [
        { tsMs: Date.parse(t1), remainingFraction: 0.84972906 },
        { tsMs: Date.parse(t2), remainingFraction: 0.84324217 },
      ],
      [{ cascadeId: 'cid-1', isRunning: true, stepCountIncremented: true }]
    );

    // (0.84972906 - 0.84324217) * 100 = 0.648689%
    assert.equal(res2.cascadeBaselines['cid-1'].delta5hPct, 0.648689);
    assert.equal(res2.quota.treeNetDelta5hPct, 0.648689);
    assert.ok(res2.quota.burnRate5hPctPerMin !== null);
    assert.ok(Math.abs(res2.quota.burnRate5hPctPerMin - 0.648689) < 1e-6);
  });

  it('prevents N-times over-counting across concurrent sibling subagents and weights by tokenDelta', () => {
    const initial = updateCascadeQuotaBaselines({
      prevBaselines: {},
      prevGlobal5hFraction: null,
      currGlobal5hFraction: 0.80,
      activeCascades: [
        { cascadeId: 'root', isRunning: true },
        { cascadeId: 'sub-a', isRunning: true },
        { cascadeId: 'sub-b', isRunning: true },
        { cascadeId: 'idle-c', isRunning: false },
      ],
      nowIso: '2026-11-14T10:00:00.000Z',
    });

    // Global bucket dropped 3.0% (0.80 -> 0.77). Root consumed 1000 tok, sub-a 2000 tok, sub-b 3000 tok; idle-c is idle.
    const weighted = updateCascadeQuotaBaselines({
      prevBaselines: initial,
      prevGlobal5hFraction: 0.80,
      currGlobal5hFraction: 0.77,
      activeCascades: [
        { cascadeId: 'root', isRunning: true, tokenDelta: 1000 },
        { cascadeId: 'sub-a', isRunning: true, tokenDelta: 2000 },
        { cascadeId: 'sub-b', isRunning: true, tokenDelta: 3000 },
        { cascadeId: 'idle-c', isRunning: false, tokenDelta: 0 },
      ],
      nowIso: '2026-11-14T10:01:00.000Z',
    });

    assert.equal(weighted.root.delta5hPct, 0.5);
    assert.equal(weighted['sub-a'].delta5hPct, 1);
    assert.equal(weighted['sub-b'].delta5hPct, 1.5);
    assert.equal(weighted['idle-c'].delta5hPct, 0);
    assert.equal(
      weighted.root.delta5hPct + weighted['sub-a'].delta5hPct + weighted['sub-b'].delta5hPct,
      3
    );

    // Even split fallback when tokenDelta is absent
    const even = updateCascadeQuotaBaselines({
      prevBaselines: initial,
      prevGlobal5hFraction: 0.80,
      currGlobal5hFraction: 0.74, // 6.0% drop across 3 active nodes
      activeCascades: [
        { cascadeId: 'root', isRunning: true },
        { cascadeId: 'sub-a', isRunning: true },
        { cascadeId: 'sub-b', isRunning: true },
      ],
      nowIso: '2026-11-14T10:02:00.000Z',
    });
    assert.equal(even.root.delta5hPct, 2);
    assert.equal(even['sub-a'].delta5hPct, 2);
    assert.equal(even['sub-b'].delta5hPct, 2);
  });

  it('handles 5h rolling window reset without wiping accumulated delta5hPct', () => {
    const prev = {
      'cid-1': {
        firstSeenAt: '2026-11-14T08:00:00Z',
        baseline5hFraction: 0.50,
        last5hFraction: 0.14,
        delta5hPct: 12.5,
      },
    };
    const afterReset = updateCascadeQuotaBaselines({
      prevBaselines: prev,
      prevGlobal5hFraction: 0.14,
      currGlobal5hFraction: 0.99,
      activeCascades: [{ cascadeId: 'cid-1', isRunning: true }],
      nowIso: '2026-11-14T10:00:00Z',
    });

    assert.equal(afterReset['cid-1'].baseline5hFraction, 0.99);
    assert.equal(afterReset['cid-1'].last5hFraction, 0.99);
    assert.equal(afterReset['cid-1'].delta5hPct, 12.5);
  });

  it('RTM-16: flags isLowAlert strictly below 15% and guards burn-rate minimum window', () => {
    const lowRes = normalizeQuotaSummary(makeQuotaRaw(0.149), null, [], '2026-11-14T10:00:00Z');
    assert.equal(lowRes.quota.gemini5h?.isLowAlert, true);

    const edgeRes = normalizeQuotaSummary(makeQuotaRaw(0.15), null, [], '2026-11-14T10:00:00Z');
    assert.equal(edgeRes.quota.gemini5h?.isLowAlert, false);

    assert.equal(
      computeBurnRate5hPctPerMin([
        { tsMs: 1000, remainingFraction: 0.9 },
        { tsMs: 6000, remainingFraction: 0.89 }, // < 10s elapsed
      ]),
      null
    );
    assert.equal(
      computeBurnRate5hPctPerMin([
        { tsMs: 0, remainingFraction: 0.8 },
        { tsMs: 60_000, remainingFraction: 0.8 }, // 0 drop
      ]),
      null
    );
  });

  it('RTM-14: evaluates Smart Governance Banner truth table strictly (2 vs 3 apex nodes, 39.9% vs 40.0%)', () => {
    const twoApex = [
      makeNode('root-1', 'THINKING', 'apex'),
      makeNode('sub-1', 'STREAMING', 'apex'),
      makeNode('sub-2', 'THINKING', 'fast'),
    ];
    assert.equal(
      evaluateSmartGovernanceBanner(twoApex, 35, 1.2, DEFAULT_PULSE_USER_CONFIG).active,
      false
    );

    const threeApex = [
      makeNode('root-1', 'THINKING', 'apex'),
      makeNode('sub-1', 'STREAMING', 'apex'),
      makeNode('sub-2', 'TOOL_RUNNING', 'apex'),
    ];
    assert.equal(
      evaluateSmartGovernanceBanner(threeApex, 40.0, 1.2, DEFAULT_PULSE_USER_CONFIG).active,
      false
    );

    const triggered = evaluateSmartGovernanceBanner(
      threeApex,
      39.9,
      1.2,
      DEFAULT_PULSE_USER_CONFIG
    );
    assert.equal(triggered.active, true);
    assert.equal(triggered.heavyConcurrentCount, 3);
    assert.ok(triggered.message?.includes('3'));

    // Idle or ERROR_OR_QUOTA apex nodes do not count as active heavy concurrency
    const mixedStates = [
      makeNode('root-1', 'THINKING', 'apex'),
      makeNode('sub-1', 'IDLE', 'apex'),
      makeNode('sub-2', 'ERROR_OR_QUOTA', 'apex'),
      makeNode('sub-3', 'STREAMING', 'apex'),
    ];
    assert.equal(
      evaluateSmartGovernanceBanner(mixedStates, 20, 1.2, DEFAULT_PULSE_USER_CONFIG).active,
      false
    );
  });
});
