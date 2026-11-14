import { compactModelLabel } from '../core/fleet-builder';
import {
  formatDeltaQuotaPct,
  formatDurationCompact,
  formatPct,
  formatTokensCompact,
} from '../core/formatters';
import { isValidUuid } from '../state/state-dir';
import type { CascadeNodeView, LifecyclePhase, ModelTier } from '../types/telemetry';
import {
  type CliLsEnv,
  type CliTelemetryView,
  loadCliTelemetry,
  sortTreeNodes,
} from './snapshot-reader';

export interface RenderTopFrameOptions {
  columns?: number;
  rows?: number;
  sortMode?: 'active-first' | 'topology-tree';
  scrollOffset?: number;
  noColor?: boolean;
  nowMs?: number;
}

export interface TopCommandOptions {
  intervalMs: number;
  once: boolean;
  conversationId?: string;
  sortMode?: 'active-first' | 'topology-tree';
  noColor: boolean;
  live: boolean;
  stateDir?: string;
  help?: boolean;
}

export interface TopIoOptions {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  stateDir?: string;
  lsEnv?: CliLsEnv;
  fetchFn?: typeof fetch;
  registerProcessSignals?: boolean;
}

const MIN_TOP_INTERVAL_MS = 250;
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  purple: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

const TIER_ANSI: Record<ModelTier, string> = {
  apex: ANSI.purple,
  workhorse: ANSI.blue,
  fast: ANSI.cyan,
  orchestrator: ANSI.yellow,
  alert: ANSI.red,
};

function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, '');
}

export function codePointDisplayWidth(cp: number): number {
  if (
    cp < 32 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    cp === 0xfeff
  ) {
    return 0;
  }

  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3040 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97c) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff01 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  ) {
    return 2;
  }

  return 1;
}

export function displayWidth(str: string): number {
  let width = 0;
  for (const ch of stripAnsi(str)) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) {
      width += codePointDisplayWidth(cp);
    }
  }
  return width;
}

function visibleLength(input: string): number {
  return displayWidth(input);
}

function truncatePlain(input: string, maxCols: number): string {
  if (maxCols <= 0) return '';
  const clean = input.replace(/[\r\n]+/g, ' ');
  if (displayWidth(clean) <= maxCols) return clean;
  if (maxCols === 1) return '…';

  const limit = maxCols - 1;
  let usedCols = 0;
  let out = '';
  for (const ch of clean) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const chWidth = codePointDisplayWidth(cp);
    if (chWidth > 0 && usedCols + chWidth > limit) {
      break;
    }
    out += ch;
    usedCols += chWidth;
  }
  return `${out}…`;
}

function truncateAnsi(input: string, maxCols: number): string {
  if (maxCols <= 0) return '';
  const clean = input.replace(/[\r\n]+/g, ' ');
  if (visibleLength(clean) <= maxCols) return clean;

  const hasAnsi = stripAnsi(clean) !== clean;
  if (maxCols === 1) {
    return hasAnsi ? `…${ANSI.reset}` : '…';
  }

  const limit = maxCols - 1;
  const sgrPattern = /\x1b\[[0-9;]*m/g;
  let usedCols = 0;
  let out = '';
  let lastIndex = 0;
  let truncated = false;

  const appendPlainSlice = (segment: string): boolean => {
    for (const ch of segment) {
      const cp = ch.codePointAt(0);
      if (cp === undefined) continue;
      const chWidth = codePointDisplayWidth(cp);
      if (chWidth > 0 && usedCols + chWidth > limit) {
        return false;
      }
      out += ch;
      usedCols += chWidth;
    }
    return true;
  };

  for (const match of clean.matchAll(sgrPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      if (!appendPlainSlice(clean.slice(lastIndex, matchIndex))) {
        truncated = true;
        break;
      }
    }
    out += match[0];
    lastIndex = matchIndex + match[0].length;
  }

  if (!truncated && lastIndex < clean.length) {
    if (!appendPlainSlice(clean.slice(lastIndex))) {
      truncated = true;
    }
  }

  if (!truncated) {
    return clean;
  }
  return hasAnsi ? `${out}…${ANSI.reset}` : `${out}…`;
}

function parsePositiveEnvInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function padRightVisible(input: string, width: number): string {
  const truncated = truncateAnsi(input, width);
  const pad = Math.max(0, width - visibleLength(truncated));
  return `${truncated}${' '.repeat(pad)}`;
}

function padLeftVisible(input: string, width: number): string {
  const truncated = truncateAnsi(input, width);
  const pad = Math.max(0, width - visibleLength(truncated));
  return `${' '.repeat(pad)}${truncated}`;
}

function paint(text: string, code: string, noColor: boolean): string {
  if (noColor || !code) return text;
  return `${code}${text}${ANSI.reset}`;
}

function renderBar(
  pct: number | null | undefined,
  barWidth: number,
  noColor: boolean,
  tone: 'normal' | 'warn' | 'alert' = 'normal'
): string {
  const safePct =
    typeof pct === 'number' && Number.isFinite(pct)
      ? Math.max(0, Math.min(100, pct))
      : 0;
  const filled =
    pct === null || pct === undefined || !Number.isFinite(pct)
      ? 0
      : Math.round((safePct / 100) * barWidth);
  const empty = Math.max(0, barWidth - filled);
  const rawBar = `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
  const color =
    tone === 'alert' ? ANSI.red : tone === 'warn' ? ANSI.yellow : ANSI.cyan;
  return `[${paint(rawBar, color, noColor)}]`;
}

function formatCompactPhase(node: CascadeNodeView): { plain: string; color: string } {
  const dur = node.phaseElapsedMs > 0 ? formatDurationCompact(node.phaseElapsedMs) : '';
  switch (node.phase as LifecyclePhase) {
    case 'THINKING':
      return { plain: dur ? `THINK ${dur}` : 'THINK', color: ANSI.purple };
    case 'STREAMING': {
      const rate =
        node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec)
          ? `${node.streamingTokPerSec.toFixed(0)}t/s`
          : dur;
      return { plain: rate ? `STRM ${rate}` : 'STRM', color: ANSI.cyan };
    }
    case 'TOOL_RUNNING':
      return { plain: dur ? `TOOL ${dur}` : 'TOOL', color: ANSI.blue };
    case 'BLOCKED_APPROVAL':
      return { plain: dur ? `WAIT ${dur}` : 'WAIT', color: ANSI.yellow };
    case 'PRE_FLIGHT':
      return { plain: dur ? `PREP ${dur}` : 'PREP', color: ANSI.yellow };
    case 'ERROR_OR_QUOTA':
      return { plain: 'ERR', color: ANSI.red };
    case 'IDLE':
    default:
      return { plain: 'IDLE', color: ANSI.gray };
  }
}

function formatTierTag(tier: ModelTier): string {
  switch (tier) {
    case 'apex':
      return 'APEX';
    case 'workhorse':
      return 'WORK';
    case 'fast':
      return 'FAST';
    case 'orchestrator':
      return 'AUTO';
    case 'alert':
      return 'ALRT';
    default:
      return 'MODL';
  }
}

function buildEmptyStateLines(
  stateDir: string,
  columns: number,
  bodyRows: number,
  noColor: boolean
): string[] {
  const innerWidth = Math.min(columns - 4, 72);
  const msg1 = truncatePlain(
    `No active Antigravity telemetry snapshot found in ${stateDir}.`,
    innerWidth - 4
  );
  const msg2 = truncatePlain(
    'Open Model Pulse sidecar or start a conversation.',
    innerWidth - 4
  );
  const topBorder = `┌${'─'.repeat(innerWidth - 2)}┐`;
  const bottomBorder = `└${'─'.repeat(innerWidth - 2)}┘`;
  const line1 = `│ ${padRightVisible(msg1, innerWidth - 4)} │`;
  const line2 = `│ ${padRightVisible(msg2, innerWidth - 4)} │`;
  const boxLines = [topBorder, line1, line2, bottomBorder].map((l) => {
    const leftPad = Math.max(0, Math.floor((columns - innerWidth) / 2));
    return `${' '.repeat(leftPad)}${paint(l, ANSI.gray, noColor)}`;
  });

  const out: string[] = [];
  const topSpace = Math.max(0, Math.floor((bodyRows - boxLines.length) / 2));
  for (let i = 0; i < topSpace; i += 1) {
    out.push('');
  }
  out.push(...boxLines);
  while (out.length < bodyRows) {
    out.push('');
  }
  return out.slice(0, bodyRows);
}

/**
 * Pure ANSI terminal frame renderer for `agy-pulse top`.
 */
export function renderTopFrame(
  view: CliTelemetryView,
  opts: RenderTopFrameOptions = {}
): string {
  const columns = Math.max(
    60,
    Math.floor(
      opts.columns ??
        process.stdout.columns ??
        parsePositiveEnvInt(process.env.COLUMNS) ??
        100
    )
  );
  const rows = Math.max(
    16,
    Math.floor(
      opts.rows ??
        process.stdout.rows ??
        parsePositiveEnvInt(process.env.LINES) ??
        24
    )
  );
  const noColor = opts.noColor ?? Boolean(process.env.NO_COLOR);
  const sortMode = opts.sortMode ?? view.config.hudSortMode;
  const barWidth = columns >= 100 ? 14 : 10;

  // 1. Header section
  const timeTag = view.generatedAt.includes('T')
    ? view.generatedAt.slice(11, 19) + 'Z'
    : view.generatedAt;
  let statusBadge: string;
  if (!view.hostConnected) {
    statusBadge = paint('[OFFLINE]', `${ANSI.bold}${ANSI.red}`, noColor);
  } else if (view.stale) {
    const age =
      view.staleAgeMs !== null ? ` ${formatDurationCompact(view.staleAgeMs)}` : '';
    statusBadge = paint(`[STALE${age}]`, `${ANSI.bold}${ANSI.yellow}`, noColor);
  } else {
    statusBadge = paint('[LIVE]', `${ANSI.bold}${ANSI.green}`, noColor);
  }

  const titlePart = paint('Model Pulse — agy-pulse top', ANSI.bold, noColor);
  const headerLine = truncateAnsi(
    `${titlePart}  ${statusBadge}  ${paint(timeTag, ANSI.gray, noColor)}`,
    columns
  );

  let focusLine: string;
  if (view.activeNode) {
    const node = view.activeNode;
    const breadcrumbPlain =
      view.breadcrumb.length > 0
        ? view.breadcrumb.map((b) => b.role || b.title).filter(Boolean).join(' › ')
        : node.title;
    const reqName = node.requestedModel.displayName || node.requestedModel.raw;
    const srvName = node.servedModel.displayName || node.servedModel.responseModel;
    const routeText =
      reqName && reqName !== srvName ? `${reqName} ➔ ${srvName}` : srvName;
    const tierColor = TIER_ANSI[node.servedModel.tier] ?? ANSI.blue;
    const modelBadge = paint(
      `${routeText} [${node.servedModel.effortTier.toUpperCase()}]`,
      `${ANSI.bold}${tierColor}`,
      noColor
    );
    const retryTag =
      node.retryCount > 0
        ? ` ${paint(`[Retry ×${node.retryCount}]`, `${ANSI.bold}${ANSI.red}`, noColor)}`
        : node.routingStatus === 'mismatch_or_fallback'
          ? ` ${paint('[Fallback]', `${ANSI.bold}${ANSI.red}`, noColor)}`
          : '';
    const maxCrumb = Math.max(16, Math.floor(columns * 0.35));
    focusLine = truncateAnsi(
      `Focus: ${truncatePlain(breadcrumbPlain, maxCrumb)} | ${modelBadge}${retryTag}`,
      columns
    );
  } else {
    focusLine = truncateAnsi(
      `Focus: ${paint(`No active conversation (${view.stateDir})`, ANSI.gray, noColor)}`,
      columns
    );
  }

  // 2. Quota & Health section
  const g5h = view.quota?.gemini5h;
  const gWk = view.quota?.geminiWeekly;
  const tp5h = view.quota?.thirdParty5h;

  const g5hPct = g5h?.remainingPct ?? null;
  const g5hTone: 'normal' | 'warn' | 'alert' =
    g5hPct !== null && g5hPct < 15
      ? 'alert'
      : g5hPct !== null && g5hPct < 25
        ? 'warn'
        : 'normal';
  const g5hLine = truncateAnsi(
    `Gemini 5h: ${renderBar(g5hPct, barWidth, noColor, g5hTone)} ${formatPct(g5hPct, 1)} (reset ${g5h?.resetInLabel ?? '—'})  ΔTree ${formatDeltaQuotaPct(view.quota?.treeNetDelta5hPct)}`,
    columns
  );

  const gWkPct = gWk?.remainingPct ?? null;
  const tp5hPct = tp5h?.remainingPct ?? null;
  const wkLine = truncateAnsi(
    `Gemini Wk: ${renderBar(gWkPct, barWidth, noColor)} ${formatPct(gWkPct, 1)}  |  3P 5h: ${renderBar(tp5hPct, barWidth, noColor)} ${formatPct(tp5hPct, 1)}`,
    columns
  );

  const activeCtx = view.activeNode?.contextWindow;
  const ctxTone: 'normal' | 'warn' | 'alert' =
    activeCtx?.level === 'critical_85'
      ? 'alert'
      : activeCtx?.level === 'warn_70'
        ? 'warn'
        : 'normal';
  const ctxPct =
    activeCtx && activeCtx.maxContextTokens > 0 ? activeCtx.pct : null;
  const ctxDetail = activeCtx
    ? activeCtx.maxContextTokens > 0
      ? ` (${formatTokensCompact(activeCtx.estimatedTokensUsed)}/${formatTokensCompact(activeCtx.maxContextTokens)})`
      : ` (${formatTokensCompact(activeCtx.estimatedTokensUsed)}/—)`
    : '';
  const cacheText = view.activeNode ? formatPct(view.activeNode.cacheHitPct, 1) : '—';
  const ctxLine = truncateAnsi(
    `Context  : ${renderBar(ctxPct, barWidth, noColor, ctxTone)} ${formatPct(ctxPct, 1)}${ctxDetail}  |  Cache Hit: ${cacheText}`,
    columns
  );

  const chromeTop: string[] = [headerLine, focusLine, g5hLine, wkLine, ctxLine];

  if (view.smartGovernanceBanner.active) {
    const bannerMsg =
      `⚡ SMART GOVERNANCE: ${view.smartGovernanceBanner.heavyConcurrentCount} Apex active @ ` +
      `${formatPct(view.smartGovernanceBanner.gemini5hRemainingPct, 1)} 5h — ` +
      'consider Argon/Flash for exploration subagents';
    chromeTop.push(
      paint(truncatePlain(bannerMsg, columns), `${ANSI.bold}${ANSI.yellow}`, noColor)
    );
  }

  const sep = paint('─'.repeat(columns), ANSI.gray, noColor);
  chromeTop.push(sep);

  // Column widths
  const phaseW = 10;
  const ctxW = 5;
  const cacheW = 6;
  const deltaW = 7;
  const remainingW = Math.max(36, columns - (phaseW + ctxW + cacheW + deltaW + 6));
  const nodeW = Math.max(14, Math.floor(remainingW * 0.3));
  const modelW = Math.max(18, Math.floor(remainingW * 0.42));
  const toolW = Math.max(10, remainingW - nodeW - modelW);

  const tableHeader = paint(
    [
      padRightVisible('PHASE', phaseW),
      padRightVisible('NODE / ROLE', nodeW),
      padRightVisible('SERVED MODEL [TIER]', modelW),
      padLeftVisible('CTX%', ctxW),
      padLeftVisible('CACHE%', cacheW),
      padLeftVisible('ΔQUOTA', deltaW),
      padRightVisible('LAST TOOL / ACTION', toolW),
    ].join(' '),
    ANSI.bold,
    noColor
  );
  chromeTop.push(tableHeader);

  const sortedNodes = sortTreeNodes(
    view.treeNodes,
    sortMode,
    view.activeNode?.cascadeId ?? null
  );

  const footerChromeCount = 2; // bottom separator + keybar
  const bodyRows = Math.max(3, rows - chromeTop.length - footerChromeCount);
  const maxOffset = Math.max(0, sortedNodes.length - bodyRows);
  const clampedOffset = Math.min(Math.max(0, Math.floor(opts.scrollOffset ?? 0)), maxOffset);

  let bodyLines: string[];
  if (sortedNodes.length === 0) {
    bodyLines = buildEmptyStateLines(view.stateDir, columns, bodyRows, noColor);
  } else {
    const visibleSlice = sortedNodes.slice(clampedOffset, clampedOffset + bodyRows);
    bodyLines = visibleSlice.map((node) => {
      const isFocused = view.activeNode?.cascadeId === node.cascadeId;
      const phaseInfo = formatCompactPhase(node);
      const phaseCell = padRightVisible(
        paint(truncatePlain(phaseInfo.plain, phaseW), phaseInfo.color, noColor),
        phaseW
      );

      const indent =
        sortMode === 'topology-tree' && node.depth > 0
          ? `${' '.repeat(Math.min(node.depth, 3) * 2)}└ `
          : '';
      const focusMarker = isFocused ? '▸ ' : '  ';
      const rawLabel = node.role || node.title || node.cascadeId.slice(0, 8);
      const nodePlain = `${focusMarker}${indent}${rawLabel}`;
      const nodeCell = padRightVisible(
        isFocused ? paint(truncatePlain(nodePlain, nodeW), ANSI.bold, noColor) : truncatePlain(nodePlain, nodeW),
        nodeW
      );

      const tierTag = formatTierTag(node.servedModel.tier);
      const modelDisplay =
        modelW >= 28 ? node.servedModel.displayName : compactModelLabel(node.servedModel);
      const modelPlain = `${modelDisplay} [${tierTag}]`;
      const modelColor =
        node.retryCount > 0 || node.routingStatus === 'mismatch_or_fallback'
          ? ANSI.red
          : TIER_ANSI[node.servedModel.tier] ?? ANSI.blue;
      const modelCell = padRightVisible(
        paint(truncatePlain(modelPlain, modelW), modelColor, noColor),
        modelW
      );

      const ctxStr =
        node.contextWindow.maxContextTokens > 0
          ? `${node.contextWindow.pct.toFixed(0)}%`
          : '—';
      const ctxColored =
        node.contextWindow.level === 'critical_85'
          ? paint(ctxStr, ANSI.red, noColor)
          : node.contextWindow.level === 'warn_70'
            ? paint(ctxStr, ANSI.yellow, noColor)
            : ctxStr;
      const ctxCell = padLeftVisible(ctxColored, ctxW);

      const cacheCell = padLeftVisible(formatPct(node.cacheHitPct, 1), cacheW);
      const deltaCell = padLeftVisible(formatDeltaQuotaPct(node.deltaQuota5hPct), deltaW);

      const toolText = node.lastTool
        ? `${node.lastTool.name}${node.lastTool.summary ? `: ${node.lastTool.summary}` : ''}`
        : '—';
      const toolCell = padRightVisible(truncatePlain(toolText, toolW), toolW);

      return [phaseCell, nodeCell, modelCell, ctxCell, cacheCell, deltaCell, toolCell].join(' ');
    });
    while (bodyLines.length < bodyRows) {
      bodyLines.push('');
    }
  }

  const footerText = truncatePlain(
    `[q] Quit  [r] Refresh  [s] Sort: ${sortMode}  [↑/↓] Scroll (${clampedOffset}/${maxOffset})`,
    columns
  );
  const footerLine = paint(footerText, ANSI.gray, noColor);

  return [...chromeTop, ...bodyLines, sep, footerLine].join('\n');
}

export function parseTopArgs(args: string[]): TopCommandOptions {
  const opts: TopCommandOptions = {
    intervalMs: 1000,
    once: false,
    noColor: Boolean(process.env.NO_COLOR),
    live: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--once') {
      opts.once = true;
      continue;
    }
    if (arg === '--no-color') {
      opts.noColor = true;
      continue;
    }
    if (arg === '--live') {
      opts.live = true;
      continue;
    }
    if (arg === '--interval' || arg.startsWith('--interval=')) {
      const raw = arg === '--interval' ? args[++i] : arg.slice('--interval='.length);
      const parsed = Number(raw);
      if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --interval "${raw ?? ''}". Expected positive milliseconds.`);
      }
      opts.intervalMs = Math.max(MIN_TOP_INTERVAL_MS, Math.trunc(parsed));
      continue;
    }
    if (arg === '--conversation' || arg.startsWith('--conversation=')) {
      const cid = arg === '--conversation' ? args[++i] : arg.slice('--conversation='.length);
      if (!cid || !isValidUuid(cid)) {
        throw new Error(`Invalid --conversation "${cid ?? ''}". Expected 36-character UUID.`);
      }
      opts.conversationId = cid;
      continue;
    }
    if (arg === '--sort' || arg.startsWith('--sort=')) {
      const mode = arg === '--sort' ? args[++i] : arg.slice('--sort='.length);
      if (mode !== 'active-first' && mode !== 'topology-tree') {
        throw new Error(
          `Invalid --sort "${mode ?? ''}". Expected active-first | topology-tree.`
        );
      }
      opts.sortMode = mode;
      continue;
    }
    if (arg === '--state-dir' || arg.startsWith('--state-dir=')) {
      const dir = arg === '--state-dir' ? args[++i] : arg.slice('--state-dir='.length);
      if (!dir) {
        throw new Error('Missing path after --state-dir.');
      }
      opts.stateDir = dir;
      continue;
    }
    throw new Error(`Unknown top option: ${arg}`);
  }

  return opts;
}

export function getTopHelpText(): string {
  return [
    'Usage: agy-pulse top [options]',
    '',
    'Options:',
    '  --interval <ms>                    Refresh interval in ms (default: 1000, min: 250)',
    '  --once                             Render a single frame and exit 0 (no alt-screen)',
    '  --conversation <uuid>              Target conversation UUID',
    '  --sort <active-first|topology-tree> Override sort order for this session',
    '  --no-color                         Disable ANSI colors (also respects NO_COLOR)',
    '  --live                             Force live read-only LS RPC refresh if env vars exist',
    '  -h, --help                         Show this help message',
    '',
  ].join('\n');
}

export async function runTopCommand(
  args: string[],
  io: TopIoOptions = {}
): Promise<number> {
  const stdout = (io.stdout ?? process.stdout) as NodeJS.WriteStream;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;

  let opts: TopCommandOptions;
  try {
    opts = parseTopArgs(args);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(getTopHelpText());
    return 2;
  }

  if (opts.help) {
    stdout.write(getTopHelpText());
    return 0;
  }

  const effectiveStateDir = opts.stateDir ?? io.stateDir;
  const loadOnce = () =>
    loadCliTelemetry({
      conversationId: opts.conversationId,
      live: opts.live,
      stateDir: effectiveStateDir,
      lsEnv: io.lsEnv,
      fetchFn: io.fetchFn,
    });

  if (opts.once || !stdout.isTTY) {
    const view = await loadOnce();
    const frame = renderTopFrame(view, {
      columns: stdout.columns ?? parsePositiveEnvInt(process.env.COLUMNS) ?? 100,
      rows: stdout.rows ?? parsePositiveEnvInt(process.env.LINES) ?? 24,
      sortMode: opts.sortMode ?? view.config.hudSortMode,
      noColor: opts.noColor,
    });
    stdout.write(`${frame}\n`);
    return 0;
  }

  let currentView = await loadOnce();
  let currentSortMode: 'active-first' | 'topology-tree' =
    opts.sortMode ?? currentView.config.hudSortMode;
  let scrollOffset = 0;
  let cleaned = false;
  let refreshInFlight = false;
  let timer: NodeJS.Timeout | null = null;
  let resolveExit: (() => void) | null = null;

  const draw = () => {
    if (cleaned) return;
    const maxOff = Math.max(0, currentView.treeNodes.length - 3);
    scrollOffset = Math.min(Math.max(0, scrollOffset), maxOff);
    const frame = renderTopFrame(currentView, {
      columns: stdout.columns ?? parsePositiveEnvInt(process.env.COLUMNS) ?? 100,
      rows: stdout.rows ?? parsePositiveEnvInt(process.env.LINES) ?? 24,
      sortMode: currentSortMode,
      scrollOffset,
      noColor: opts.noColor,
    });
    stdout.write(`\x1b[H\x1b[2J${frame}`);
  };

  const refreshAndDraw = async () => {
    if (cleaned || refreshInFlight) return;
    refreshInFlight = true;
    try {
      currentView = await loadOnce();
      draw();
    } catch {
      // Keep rendering existing frame on transient reload failure
    } finally {
      refreshInFlight = false;
    }
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    stdin.off('data', onData);
    stdout.off('resize', onResize);
    stdout.off('error', onStdoutError);
    if (io.registerProcessSignals !== false) {
      process.off('SIGWINCH', onResize);
      process.off('SIGINT', onExitSignal);
      process.off('SIGTERM', onExitSignal);
    }
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      try {
        stdin.setRawMode(false);
      } catch {
        // Ignore raw mode restore errors
      }
    }
    try {
      stdin.pause();
    } catch {
      // Ignore pause errors
    }
    try {
      stdout.write('\x1b[?25h\x1b[?1049l');
    } catch {
      // Ignore terminal restore errors
    }
    resolveExit?.();
  };

  const onResize = () => draw();
  const onExitSignal = () => cleanup();
  const onStdoutError = (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      cleanup();
    }
  };

  const onData = (chunk: Buffer | string) => {
    const key = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (key === 'q' || key === 'Q' || key === '\u0003') {
      cleanup();
      return;
    }
    if (key === 'r' || key === 'R') {
      void refreshAndDraw();
      return;
    }
    if (key === 's' || key === 'S') {
      currentSortMode =
        currentSortMode === 'active-first' ? 'topology-tree' : 'active-first';
      draw();
      return;
    }
    if (key === 'j' || key === '\x1b[B') {
      scrollOffset += 1;
      draw();
      return;
    }
    if (key === 'k' || key === '\x1b[A') {
      scrollOffset = Math.max(0, scrollOffset - 1);
      draw();
    }
  };

  try {
    stdout.write('\x1b[?1049h\x1b[?25l');
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
    }
    stdin.resume();
    draw();

    await new Promise<void>((resolve) => {
      resolveExit = resolve;
      stdin.on('data', onData);
      stdout.on('resize', onResize);
      stdout.on('error', onStdoutError);
      if (io.registerProcessSignals !== false) {
        process.on('SIGWINCH', onResize);
        process.on('SIGINT', onExitSignal);
        process.on('SIGTERM', onExitSignal);
      }
      timer = setInterval(() => {
        void refreshAndDraw();
      }, opts.intervalMs);
    });
  } finally {
    cleanup();
  }

  return 0;
}
