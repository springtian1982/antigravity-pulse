export const CANONICAL_HUD_URI = 'sidecar://antigravity-pulse/pulse_cockpit/hud';

export interface InlineTurnStampInput {
  modelDisplayName: string;
  responseModel?: string | null;
  requestedLabel?: string | null;
  routingStatus?: 'matched' | 'routed' | 'mismatch_or_fallback' | 'retrying' | 'unknown';
  modelSwitched?: boolean;
  retryCount?: number;
  ttftMs?: number | null;
  contextPct?: number | null;
  gemini5hRemainingPct?: number | null;
  stampContextTriggerPct?: number;
  quotaLowTriggerPct?: number;
}

/**
 * L-001: Protobuf int64 fields arrive as JSON strings (e.g., "19353").
 * Coerces unknown values to a finite non-negative integer.
 */
export function toIntToken(v: unknown): number {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v.trim())
        : 0;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

/**
 * L-002: inputTokens represents uncached tokens only; denominator must sum inputTokens + cacheReadTokens.
 */
export function computeCacheHitPct(inputTokens: number, cacheReadTokens: number): number {
  const safeIn = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const safeCache = Number.isFinite(cacheReadTokens) && cacheReadTokens > 0 ? cacheReadTokens : 0;
  const totalIn = safeIn + safeCache;
  return totalIn > 0 ? (safeCache / totalIn) * 100 : 0;
}

/**
 * L-003: Standard unretried invocations carry 1 entry in retryInfos.
 * Only length > 1 indicates actual retries.
 */
export function computeRetryCount(retryInfos: unknown[] | undefined | null): number {
  const len = Array.isArray(retryInfos) ? retryInfos.length : 0;
  return Math.max(0, len - 1);
}

const DURATION_SEGMENT_RE = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/gi;
const FULL_DURATION_RE = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/i;

export function parseDurationMs(raw: string | number | null | undefined): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
  }
  if (typeof raw !== 'string') {
    return 0;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('-')) {
    return 0;
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
  }
  if (!FULL_DURATION_RE.test(trimmed)) {
    return 0;
  }

  let totalMs = 0;
  DURATION_SEGMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null = DURATION_SEGMENT_RE.exec(trimmed);
  while (match !== null) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    switch (unit) {
      case 'h':
        totalMs += value * 3_600_000;
        break;
      case 'm':
        totalMs += value * 60_000;
        break;
      case 's':
        totalMs += value * 1_000;
        break;
      case 'ms':
        totalMs += value;
        break;
      case 'us':
      case 'µs':
        totalMs += value / 1_000;
        break;
      case 'ns':
        totalMs += value / 1_000_000;
        break;
      default:
        break;
    }
    match = DURATION_SEGMENT_RE.exec(trimmed);
  }
  return Number.isFinite(totalMs) && totalMs >= 0 ? Math.round(totalMs) : 0;
}

export function formatDurationCompact(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  const roundedMs = Math.round(safeMs);
  if (roundedMs < 1000) {
    return `${roundedMs}ms`;
  }
  if (safeMs < 60_000) {
    return `${(safeMs / 1000).toFixed(1)}s`;
  }
  if (safeMs < 3_600_000) {
    const mins = Math.floor(safeMs / 60_000);
    const secs = Math.floor((safeMs % 60_000) / 1000);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(safeMs / 3_600_000);
  const mins = Math.floor((safeMs % 3_600_000) / 60_000);
  return `${hours}h ${mins}m`;
}

export function formatTokensCompact(tokens: number): string {
  const safe = Number.isFinite(tokens) && tokens >= 0 ? tokens : 0;
  if (safe < 1000) {
    return `${Math.round(safe)}`;
  }
  if (safe < 100_000) {
    const formatted = (safe / 1000).toFixed(1).replace(/\.0$/, '');
    return `${formatted}k`;
  }
  if (safe < 1_000_000) {
    return `${Math.round(safe / 1000)}k`;
  }
  return `${(safe / 1_000_000).toFixed(2)}M`;
}

export function formatPct(pct: number | null | undefined, decimals = 1): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return '—';
  }
  return `${pct.toFixed(decimals)}%`;
}

export function formatDeltaQuotaPct(consumedPct: number | null | undefined): string {
  if (consumedPct === null || consumedPct === undefined || !Number.isFinite(consumedPct)) {
    return '—';
  }
  if (consumedPct <= 0) {
    return '0.00%';
  }
  const formatted = consumedPct.toFixed(2);
  return formatted === '0.00' ? '0.00%' : `-${formatted}%`;
}

export function escapeHtml(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeMarkdown(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  return str
    .replace(/\r?\n/g, ' ')
    .replace(/([\\`*_[\]<>|])/g, '\\$1')
    .trim();
}

function sanitizeInlineCode(raw: unknown): string {
  const str = raw === null || raw === undefined ? '' : String(raw);
  return str.replace(/\r?\n/g, ' ').replace(/`/g, "'").trim();
}

export function formatInlineTurnStamp(input: InlineTurnStampInput): string {
  const retryCount =
    typeof input.retryCount === 'number' && Number.isFinite(input.retryCount) && input.retryCount > 0
      ? Math.trunc(input.retryCount)
      : 0;
  const ctxTrigger = input.stampContextTriggerPct ?? 75;
  const quotaTrigger = input.quotaLowTriggerPct ?? 20;

  const isWarning =
    retryCount > 0 ||
    input.routingStatus === 'mismatch_or_fallback' ||
    (input.contextPct !== null &&
      input.contextPct !== undefined &&
      Number.isFinite(input.contextPct) &&
      input.contextPct > ctxTrigger) ||
    (input.gemini5hRemainingPct !== null &&
      input.gemini5hRemainingPct !== undefined &&
      Number.isFinite(input.gemini5hRemainingPct) &&
      input.gemini5hRemainingPct < quotaTrigger);

  const icon = isWarning ? '⚠' : input.modelSwitched ? '🔀' : '⚡';
  const safeDisplay = escapeMarkdown(input.modelDisplayName || 'Unknown Model');
  const parts: string[] = [`${icon} **${safeDisplay}**`];

  const safeResponse = sanitizeInlineCode(input.responseModel);
  if (safeResponse) {
    parts.push(`\`${safeResponse}\``);
  }

  if (
    (input.routingStatus === 'routed' || input.routingStatus === 'mismatch_or_fallback') &&
    input.requestedLabel
  ) {
    const safeRequested = escapeMarkdown(input.requestedLabel);
    if (safeRequested) {
      parts.push(`Routed from ${safeRequested}`);
    }
  }

  if (retryCount > 0) {
    parts.push(`Retried ×${retryCount}`);
  }

  if (input.ttftMs !== null && input.ttftMs !== undefined && Number.isFinite(input.ttftMs)) {
    parts.push(`TTFT ${formatDurationCompact(input.ttftMs)}`);
  }

  if (input.contextPct !== null && input.contextPct !== undefined && Number.isFinite(input.contextPct)) {
    const clampedCtx = Math.max(0, Math.round(input.contextPct));
    parts.push(`CTX ${clampedCtx}%`);
  }

  if (
    input.gemini5hRemainingPct !== null &&
    input.gemini5hRemainingPct !== undefined &&
    Number.isFinite(input.gemini5hRemainingPct)
  ) {
    parts.push(`5h 余量 ${input.gemini5hRemainingPct.toFixed(1)}%`);
  }

  parts.push(`[Model Pulse](${CANONICAL_HUD_URI})`);
  return parts.join(' · ');
}
