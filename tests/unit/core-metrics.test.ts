import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CANONICAL_HUD_URI,
  computeCacheHitPct,
  computeRetryCount,
  escapeHtml,
  escapeMarkdown,
  formatDeltaQuotaPct,
  formatDurationCompact,
  formatInlineTurnStamp,
  formatPct,
  formatTokensCompact,
  parseDurationMs,
  toIntToken,
} from '../../src/core/formatters';

describe('core/formatters — Int64 tokens, cache hit, retries & formatting', () => {
  it('L-001: coerces Int64 string and numeric tokens safely without NaN or string concatenation', () => {
    assert.equal(toIntToken('19353'), 19353);
    assert.equal(toIntToken(' 421 '), 421);
    assert.equal(toIntToken(19353 + 421), 19774);
    assert.equal(toIntToken(123.9), 123);
    assert.equal(toIntToken('0'), 0);
    assert.equal(toIntToken('-15'), 0);
    assert.equal(toIntToken(''), 0);
    assert.equal(toIntToken(null), 0);
    assert.equal(toIntToken(undefined), 0);
    assert.equal(toIntToken(Number.NaN), 0);
    assert.equal(toIntToken(Number.POSITIVE_INFINITY), 0);
    assert.equal(toIntToken('not-a-number'), 0);
  });

  it('L-002: computes cacheHitPct as cacheReadTokens / (inputTokens + cacheReadTokens) * 100', () => {
    assert.equal(computeCacheHitPct(1000, 9000), 90);
    assert.equal(computeCacheHitPct(0, 5000), 100);
    assert.equal(computeCacheHitPct(0, 0), 0);
    assert.equal(computeCacheHitPct(500, 500), 50);
    assert.equal(computeCacheHitPct(1000, 0), 0);
    assert.equal(computeCacheHitPct(-100, 500), 100);
  });

  it('L-003: treats retryInfos.length <= 1 as 0 retries and > 1 as (length - 1)', () => {
    assert.equal(computeRetryCount(undefined), 0);
    assert.equal(computeRetryCount(null), 0);
    assert.equal(computeRetryCount([]), 0);
    assert.equal(computeRetryCount([{ attempt: 1 }]), 0);
    assert.equal(computeRetryCount([{ attempt: 1 }, { attempt: 2 }]), 1);
    assert.equal(computeRetryCount([{ a: 1 }, { a: 2 }, { a: 3 }]), 2);
  });

  it('parses protobuf/Go duration strings and numbers into ms', () => {
    assert.equal(parseDurationMs('8.738093225s'), 8738);
    assert.equal(parseDurationMs('120ms'), 120);
    assert.equal(parseDurationMs('1m5.5s'), 65500);
    assert.equal(parseDurationMs('2h15m'), 8100000);
    assert.equal(parseDurationMs('12.13s'), 12130);
    assert.equal(parseDurationMs('500us'), 1);
    assert.equal(parseDurationMs(420), 420);
    assert.equal(parseDurationMs('-5s'), 0);
    assert.equal(parseDurationMs('invalid'), 0);
    assert.equal(parseDurationMs(''), 0);
    assert.equal(parseDurationMs(null), 0);
  });

  it('formats durations, tokens, percentages, and consumed delta quota sign conventions', () => {
    assert.equal(formatDurationCompact(450), '450ms');
    assert.equal(formatDurationCompact(12130), '12.1s');
    assert.equal(formatDurationCompact(65000), '1m 5s');
    assert.equal(formatDurationCompact(8100000), '2h 15m');

    assert.equal(formatTokensCompact(842), '842');
    assert.equal(formatTokensCompact(4200), '4.2k');
    assert.equal(formatTokensCompact(38800), '38.8k');
    assert.equal(formatTokensCompact(84000), '84k');
    assert.equal(formatTokensCompact(256000), '256k');
    assert.equal(formatTokensCompact(1_500_000), '1.50M');

    assert.equal(formatPct(null), '—');
    assert.equal(formatPct(undefined), '—');
    assert.equal(formatPct(Number.NaN), '—');
    assert.equal(formatPct(84.34), '84.3%');
    assert.equal(formatPct(100, 0), '100%');

    assert.equal(formatDeltaQuotaPct(null), '—');
    assert.equal(formatDeltaQuotaPct(undefined), '—');
    assert.equal(formatDeltaQuotaPct(0), '0.00%');
    assert.equal(formatDeltaQuotaPct(-0.2), '0.00%');
    assert.equal(formatDeltaQuotaPct(0.001), '0.00%');
    assert.equal(formatDeltaQuotaPct(0.41), '-0.41%');
    assert.equal(formatDeltaQuotaPct(1.68), '-1.68%');
  });

  it('RTM-27: escapes HTML & Markdown XSS injection vectors cleanly', () => {
    assert.equal(
      escapeHtml('<script>alert("xss\'&")</script>'),
      '&lt;script&gt;alert(&quot;xss&#39;&amp;&quot;)&lt;/script&gt;'
    );
    assert.equal(escapeHtml(null), '');

    const escapedMd = escapeMarkdown('[click](https://evil.test)<img src=x>');
    assert.equal(escapedMd.includes('\\[click\\]'), true);
    assert.equal(escapedMd.includes('\\<img'), true);
  });

  it('RTM-03 / D-002: formats inline turn stamps with dynamic icons, routing info, and canonical HUD URI', () => {
    assert.equal(CANONICAL_HUD_URI, 'sidecar://antigravity-pulse/pulse_cockpit/hud');

    const normal = formatInlineTurnStamp({
      modelDisplayName: 'Gemini 4 Carbon (High)',
      responseModel: 'gemini-4-carbon',
      routingStatus: 'matched',
      ttftMs: 12130,
      contextPct: 15.1,
      gemini5hRemainingPct: 84.3,
    });
    assert.equal(
      normal,
      '⚡ **Gemini 4 Carbon (High)** · `gemini-4-carbon` · TTFT 12.1s · CTX 15% · 5h 余量 84.3% · [Model Pulse](sidecar://antigravity-pulse/pulse_cockpit/hud)'
    );

    const switched = formatInlineTurnStamp({
      modelDisplayName: 'Gemini 4 Argon (Medium)',
      responseModel: 'gemini-4-argon',
      requestedLabel: 'Auto',
      routingStatus: 'routed',
      modelSwitched: true,
      ttftMs: 3200,
      contextPct: 22,
      gemini5hRemainingPct: 82.0,
    });
    assert.ok(switched.startsWith('🔀 **Gemini 4 Argon (Medium)**'));
    assert.ok(switched.includes('Routed from Auto'));
    assert.ok(switched.endsWith(`[Model Pulse](${CANONICAL_HUD_URI})`));

    const retried = formatInlineTurnStamp({
      modelDisplayName: 'Gemini 4 Carbon (High)',
      responseModel: 'gemini-4-carbon',
      routingStatus: 'retrying',
      retryCount: 2,
      contextPct: 30,
      gemini5hRemainingPct: 60,
    });
    assert.ok(retried.startsWith('⚠ **Gemini 4 Carbon (High)**'));
    assert.ok(retried.includes('Retried ×2'));

    const highCtx = formatInlineTurnStamp({
      modelDisplayName: 'Gemini 4 Carbon (High)',
      responseModel: 'gemini-4-carbon',
      contextPct: 76,
      gemini5hRemainingPct: 80,
    });
    assert.ok(highCtx.startsWith('⚠ '));

    const lowQuota = formatInlineTurnStamp({
      modelDisplayName: 'Gemini 4 Carbon (High)',
      responseModel: 'gemini-4-carbon',
      contextPct: 12,
      gemini5hRemainingPct: 19.9,
    });
    assert.ok(lowQuota.startsWith('⚠ '));

    const injectionSafe = formatInlineTurnStamp({
      modelDisplayName: '[Evil](https://bad)\n**bold**',
      responseModel: 'bad`model',
      requestedLabel: '<script>x</script>',
      routingStatus: 'mismatch_or_fallback',
    });
    assert.ok(injectionSafe.startsWith('⚠ '));
    assert.equal(injectionSafe.includes('\n'), false);
    assert.equal(injectionSafe.includes('\\[Evil\\]'), true);
    assert.equal(injectionSafe.includes('\\<script\\>'), true);
  });
});
