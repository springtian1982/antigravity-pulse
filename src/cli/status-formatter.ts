import { existsSync, type FSWatcher, watch } from 'node:fs';
import { compactModelLabel } from '../core/fleet-builder';
import {
  formatDurationCompact,
  formatPct,
  formatTokensCompact,
} from '../core/formatters';
import { getStatePaths, isValidUuid } from '../state/state-dir';
import type {
  CascadeNodeView,
  FleetSnapshotResponse,
  ModelTier,
  QuotaSummaryView,
} from '../types/telemetry';
import {
  type CliLsEnv,
  type CliStatusClass,
  type CliTelemetryView,
  loadCliTelemetry,
} from './snapshot-reader';

export type StatusFormat = 'waybar' | 'tmux' | 'json' | 'text';

export interface WaybarPayload {
  text: string;
  tooltip: string;
  class: CliStatusClass;
  percentage: number;
}

export interface CliStatusJsonPayload {
  schemaVersion: 1;
  generatedAt: string;
  hostConnected: boolean;
  stale: boolean;
  staleAgeMs: number | null;
  statusClass: CliStatusClass;
  activeConversationId: string | null;
  activeNode: CascadeNodeView | null;
  activeSubagentCount: number;
  treeNodes: CascadeNodeView[];
  fleetHeadline: FleetSnapshotResponse['activeHeadline'] | null;
  quota: QuotaSummaryView | null;
  warnings: string[];
}

export interface StatusCommandOptions {
  format: StatusFormat;
  watch: boolean;
  intervalMs: number;
  conversationId?: string;
  live: boolean;
  stateDir?: string;
  help?: boolean;
}

export interface StatusIoOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  stateDir?: string;
  lsEnv?: CliLsEnv;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  registerProcessSignals?: boolean;
}

const VALID_FORMATS = new Set<StatusFormat>(['waybar', 'tmux', 'json', 'text']);
const WATCHED_FILES = new Set([
  'live-snapshot.json',
  'quota-cache.json',
  'config.json',
  'model-map.json',
]);
const WATCH_DEBOUNCE_MS = 50;
const MIN_WATCH_INTERVAL_MS = 200;

const TMUX_TIER_COLOR: Record<ModelTier, string> = {
  apex: '#8b7ec8',
  workhorse: '#4385be',
  fast: '#3aa99f',
  orchestrator: '#d0a215',
  alert: '#d14d41',
};

function sanitizeSingleLine(raw: string): string {
  return raw.replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeTmuxText(raw: string): string {
  return sanitizeSingleLine(raw).replace(/[#[\]]/g, '');
}

function formatWaybarText(view: CliTelemetryView): string {
  const pct5h = view.quota?.gemini5h
    ? Math.round(view.quota.gemini5h.remainingPct)
    : null;

  if (view.statusClass === 'disconnected') {
    return pct5h !== null ? `⚠ Pulse: Offline · ${pct5h}%` : '⚠ Pulse: Offline';
  }

  const node = view.activeNode;
  if (!node) {
    return pct5h !== null ? `⚪ Pulse: Ready · ${pct5h}%` : '⚪ Pulse: Ready';
  }

  const shortModel = sanitizeSingleLine(compactModelLabel(node.servedModel));
  const sub = view.activeSubagentCount > 0 ? ` +${view.activeSubagentCount} sub` : '';
  const pctSuffix = pct5h !== null ? ` · ${pct5h}%` : '';

  if (node.retryCount > 0 || node.routingStatus === 'retrying') {
    return `⚠ Retry ×${Math.max(1, node.retryCount)} · ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === 'ERROR_OR_QUOTA') {
    return `⚠ Error · ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.routingStatus === 'mismatch_or_fallback') {
    return `⚠ Fallback · ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === 'BLOCKED_APPROVAL') {
    return `⏸️ Blocked · ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === 'TOOL_RUNNING') {
    const toolName = sanitizeSingleLine(node.lastTool?.name || 'tool');
    return `🔧 Tool: ${toolName} · ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === 'STREAMING') {
    return `⚡ ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === 'THINKING' || node.phase === 'PRE_FLIGHT') {
    return `🧠 ${shortModel}${sub}${pctSuffix}`;
  }
  return `⚪ ${shortModel}${sub}${pctSuffix}`;
}

export function formatStatusWaybar(view: CliTelemetryView): WaybarPayload {
  const rawPct = view.quota?.gemini5h?.remainingPct;
  const percentage =
    typeof rawPct === 'number' && Number.isFinite(rawPct)
      ? Math.max(0, Math.min(100, Math.round(rawPct)))
      : 0;

  const lines: string[] = [];
  const node = view.activeNode;

  if (node) {
    lines.push(
      `${sanitizeSingleLine(node.title)} | ${sanitizeSingleLine(node.requestedModel.displayName)} ➔ ${sanitizeSingleLine(node.servedModel.displayName)} (${node.servedModel.effortTier})`
    );
    const phaseParts = [`Phase: ${node.phase}`];
    if (node.phaseElapsedMs > 0 && node.phase !== 'IDLE') {
      phaseParts.push(formatDurationCompact(node.phaseElapsedMs));
    }
    if (node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec)) {
      phaseParts.push(`${node.streamingTokPerSec.toFixed(1)} tok/s`);
    }
    if (node.lastTool) {
      const summary = node.lastTool.summary
        ? ` (${sanitizeSingleLine(node.lastTool.summary)})`
        : '';
      phaseParts.push(`Tool: ${sanitizeSingleLine(node.lastTool.name)}${summary}`);
    }
    lines.push(phaseParts.join(' · '));

    const ctxUsed = formatTokensCompact(node.contextWindow.estimatedTokensUsed);
    const ctxMax =
      node.contextWindow.maxContextTokens > 0
        ? formatTokensCompact(node.contextWindow.maxContextTokens)
        : '—';
    const ctxPct =
      node.contextWindow.maxContextTokens > 0
        ? formatPct(node.contextWindow.pct, 1)
        : '—';
    lines.push(
      `CTX: ${ctxUsed}/${ctxMax} (${ctxPct}) | Cache Hit: ${formatPct(node.cacheHitPct, 1)}`
    );

    const subnodes = view.treeNodes.filter((n) => n.cascadeId !== node.cascadeId && n.kind !== 'root');
    if (subnodes.length > 0) {
      lines.push('Subagents:');
      for (const sub of subnodes.slice(0, 6)) {
        const label = sanitizeSingleLine(sub.role || sub.title);
        lines.push(`  - ${label} | ${sanitizeSingleLine(sub.servedModel.displayName)} | ${sub.phase}`);
      }
    }
  } else {
    lines.push(`Model Pulse: No active conversation (${view.stateDir})`);
  }

  const g5h = view.quota?.gemini5h;
  const gWk = view.quota?.geminiWeekly;
  const tp5h = view.quota?.thirdParty5h;
  lines.push(
    `Gemini 5h: ${formatPct(g5h?.remainingPct, 1)} (reset ${g5h?.resetInLabel ?? '—'}) | Weekly: ${formatPct(gWk?.remainingPct, 1)} | 3P 5h: ${formatPct(tp5h?.remainingPct, 1)}`
  );

  if (view.stale || !view.hostConnected) {
    const ageLabel =
      view.staleAgeMs !== null
        ? `${formatDurationCompact(view.staleAgeMs)} ago`
        : 'no live snapshot';
    lines.push(`Stale: ${ageLabel}${view.snapshotUpdatedAt ? ` (${view.snapshotUpdatedAt})` : ''}`);
  }

  return {
    text: formatWaybarText(view),
    tooltip: lines.join('\n'),
    class: view.statusClass,
    percentage,
  };
}

export function formatStatusTmux(view: CliTelemetryView): string {
  if (view.statusClass === 'disconnected') {
    return '#[fg=#878580]Pulse: offline#[default]';
  }

  const node = view.activeNode;
  const g5h = view.quota?.gemini5h;
  const quotaStr = g5h ? `5h:${Math.round(g5h.remainingPct)}%` : '5h:—';

  if (!node) {
    return `#[fg=#878580]⚪ Pulse: idle#[default] #[fg=#cecdc3]${quotaStr}#[default]`;
  }

  let icon = '⚪';
  switch (node.phase) {
    case 'PRE_FLIGHT':
    case 'THINKING':
      icon = '🧠';
      break;
    case 'STREAMING':
      icon = '⚡';
      break;
    case 'TOOL_RUNNING':
      icon = '🔧';
      break;
    case 'BLOCKED_APPROVAL':
      icon = '⏸️';
      break;
    case 'ERROR_OR_QUOTA':
      icon = '⚠';
      break;
    case 'IDLE':
    default:
      icon = '⚪';
      break;
  }

  const tierColor = TMUX_TIER_COLOR[node.servedModel.tier] ?? '#4385be';
  const shortModel = sanitizeTmuxText(compactModelLabel(node.servedModel));
  const parts: string[] = [`#[fg=${tierColor},bold]${icon} ${shortModel}#[default]`];

  if (view.activeSubagentCount > 0) {
    parts.push(`#[fg=#3aa99f]+${view.activeSubagentCount}sub#[default]`);
  }

  if (view.statusClass === 'alert') {
    const alertLabel =
      node.retryCount > 0
        ? `⚠Retry×${node.retryCount}`
        : node.routingStatus === 'mismatch_or_fallback'
          ? '⚠Fallback'
          : node.phase === 'ERROR_OR_QUOTA'
            ? '⚠Error'
            : node.contextWindow.level === 'critical_85'
              ? `⚠CTX:${Math.round(node.contextWindow.pct)}%`
              : `⚠${quotaStr}`;
    parts.push(`#[fg=#d14d41,bold]${alertLabel}#[default]`);
    if (!alertLabel.includes('5h:')) {
      parts.push(`#[fg=#cecdc3]${quotaStr}#[default]`);
    }
  } else if (view.statusClass === 'warning') {
    const warnLabel =
      node.phase === 'BLOCKED_APPROVAL'
        ? '⏸Blocked'
        : node.contextWindow.level === 'warn_70'
          ? `CTX:${Math.round(node.contextWindow.pct)}%`
          : quotaStr;
    parts.push(`#[fg=#d0a215,bold]${warnLabel}#[default]`);
    if (!warnLabel.includes('5h:')) {
      parts.push(`#[fg=#cecdc3]${quotaStr}#[default]`);
    }
  } else if (view.statusClass === 'idle') {
    parts.push(`#[fg=#878580]${quotaStr}#[default]`);
  } else {
    parts.push(`#[fg=#cecdc3]${quotaStr}#[default]`);
  }

  return parts.join(' ');
}

export function buildStatusJsonPayload(view: CliTelemetryView): CliStatusJsonPayload {
  return {
    schemaVersion: 1,
    generatedAt: view.generatedAt,
    hostConnected: view.hostConnected,
    stale: view.stale,
    staleAgeMs: view.staleAgeMs,
    statusClass: view.statusClass,
    activeConversationId: view.activeConversationId,
    activeNode: view.activeNode,
    activeSubagentCount: view.activeSubagentCount,
    treeNodes: view.treeNodes,
    fleetHeadline: view.fleetHeadline,
    quota: view.quota,
    warnings: view.warnings,
  };
}

export function formatStatusJson(view: CliTelemetryView, pretty = true): string {
  const payload = buildStatusJsonPayload(view);
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

export function formatStatusText(view: CliTelemetryView): string {
  const g5h = view.quota?.gemini5h;
  if (view.statusClass === 'disconnected') {
    const age =
      view.staleAgeMs !== null
        ? ` (stale ${formatDurationCompact(view.staleAgeMs)})`
        : '';
    const cached = g5h
      ? ` | Cached Gemini 5h: ${formatPct(g5h.remainingPct, 1)} (${g5h.resetInLabel})`
      : '';
    return `[Model Pulse] OFFLINE${age}${cached}`;
  }

  const node = view.activeNode;
  if (!node) {
    const quotaText = g5h
      ? `Gemini 5h: ${formatPct(g5h.remainingPct, 1)} (${g5h.resetInLabel})`
      : 'Gemini 5h: —';
    return `[Model Pulse] IDLE | No active conversation | ${quotaText}`;
  }

  let phaseLabel: string = node.phase;
  if (node.phase === 'STREAMING' && node.streamingTokPerSec !== null) {
    phaseLabel = `${node.phase} ${node.streamingTokPerSec.toFixed(1)}t/s`;
  } else if (node.phase !== 'IDLE' && node.phase !== 'ERROR_OR_QUOTA' && node.phaseElapsedMs > 0) {
    phaseLabel = `${node.phase} ${formatDurationCompact(node.phaseElapsedMs)}`;
  }

  const modelIdTag = node.servedModel.responseModel || node.servedModel.modelEnum;
  const ctxText =
    node.contextWindow.maxContextTokens > 0
      ? formatPct(node.contextWindow.pct, 1)
      : '—';
  const quotaText = g5h
    ? `${formatPct(g5h.remainingPct, 1)} (${g5h.resetInLabel})`
    : '—';

  return (
    `[Model Pulse] ${phaseLabel} | ${sanitizeSingleLine(node.servedModel.displayName)} [${sanitizeSingleLine(modelIdTag)}] | ` +
    `Subagents: ${view.activeSubagentCount} active | CTX ${ctxText} | Cache ${formatPct(node.cacheHitPct, 1)} | Gemini 5h: ${quotaText}`
  );
}

export function formatStatusOutput(
  view: CliTelemetryView,
  format: StatusFormat,
  options: { watch?: boolean } = {}
): string {
  switch (format) {
    case 'waybar':
      return JSON.stringify(formatStatusWaybar(view));
    case 'tmux':
      return formatStatusTmux(view);
    case 'json':
      return formatStatusJson(view, !options.watch);
    case 'text':
    default:
      return formatStatusText(view);
  }
}

function buildWatchDedupSignature(
  view: CliTelemetryView,
  formatted: string,
  format: StatusFormat
): string {
  if (format !== 'json') {
    return formatted;
  }
  const payload = buildStatusJsonPayload(view);
  return JSON.stringify({
    ...payload,
    generatedAt: '',
    staleAgeMs: payload.stale ? 'stale' : 'fresh',
  });
}

export function parseStatusArgs(args: string[]): StatusCommandOptions {
  const opts: StatusCommandOptions = {
    format: 'text',
    watch: false,
    intervalMs: 1000,
    live: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--watch' || arg === '-w') {
      opts.watch = true;
      continue;
    }
    if (arg === '--live') {
      opts.live = true;
      continue;
    }
    if (arg === '--format' || arg.startsWith('--format=')) {
      const val = arg === '--format' ? args[++i] : arg.slice('--format='.length);
      if (!val || !VALID_FORMATS.has(val as StatusFormat)) {
        throw new Error(`Invalid --format "${val ?? ''}". Expected waybar | tmux | json | text.`);
      }
      opts.format = val as StatusFormat;
      continue;
    }
    if (arg === '--interval' || arg.startsWith('--interval=')) {
      const raw = arg === '--interval' ? args[++i] : arg.slice('--interval='.length);
      const parsed = Number(raw);
      if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --interval "${raw ?? ''}". Expected positive milliseconds.`);
      }
      opts.intervalMs = Math.max(MIN_WATCH_INTERVAL_MS, Math.trunc(parsed));
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
    if (arg === '--state-dir' || arg.startsWith('--state-dir=')) {
      const dir = arg === '--state-dir' ? args[++i] : arg.slice('--state-dir='.length);
      if (!dir) {
        throw new Error('Missing path after --state-dir.');
      }
      opts.stateDir = dir;
      continue;
    }
    throw new Error(`Unknown status option: ${arg}`);
  }

  return opts;
}

export function getStatusHelpText(): string {
  return [
    'Usage: agy-pulse status [options]',
    '',
    'Options:',
    '  --format <waybar|tmux|json|text>  Output format (default: text)',
    '  --watch                           Stream deduplicated updates on state changes',
    '  --interval <ms>                   Poll fallback interval in ms (default: 1000, min: 200)',
    '  --conversation <uuid>             Target conversation UUID',
    '  --live                            Force live read-only LS RPC refresh if env vars exist',
    '  -h, --help                        Show this help message',
    '',
  ].join('\n');
}

export async function runStatusCommand(
  args: string[],
  io: StatusIoOptions = {}
): Promise<number> {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  let opts: StatusCommandOptions;
  try {
    opts = parseStatusArgs(args);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    stderr.write(getStatusHelpText());
    return 2;
  }

  if (opts.help) {
    stdout.write(getStatusHelpText());
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

  if (!opts.watch) {
    const view = await loadOnce();
    const out = formatStatusOutput(view, opts.format, { watch: false });
    stdout.write(`${out}\n`);
    return 0;
  }

  const paths = getStatePaths(effectiveStateDir);
  let lastEmittedSig: string | null = null;
  let closed = false;
  let watcher: FSWatcher | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;
  let inFlight = false;
  let pendingRefresh = false;

  const emitIfChanged = async () => {
    if (closed) return;
    if (inFlight) {
      pendingRefresh = true;
      return;
    }
    inFlight = true;
    try {
      const view = await loadOnce();
      if (closed) return;
      const line = formatStatusOutput(view, opts.format, { watch: true });
      const sig = buildWatchDedupSignature(view, line, opts.format);
      if (sig !== lastEmittedSig) {
        lastEmittedSig = sig;
        stdout.write(`${line}\n`);
      }
      if (!watcher && existsSync(paths.stateDir)) {
        attachWatcher();
      }
    } catch {
      // Non-fatal in watch mode; keep streaming on next tick
    } finally {
      inFlight = false;
      if (pendingRefresh && !closed) {
        pendingRefresh = false;
        void emitIfChanged();
      }
    }
  };

  let onFinish: (() => void) | null = null;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
      watcher = null;
    }
    if (io.registerProcessSignals !== false) {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
    }
    io.signal?.removeEventListener('abort', handleSignal);
    stdout.off('error', handleStdoutError);
    onFinish?.();
  };

  const handleSignal = () => {
    cleanup();
  };

  const handleStdoutError = (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      cleanup();
    }
  };

  const scheduleDebouncedEmit = () => {
    if (closed) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void emitIfChanged();
    }, WATCH_DEBOUNCE_MS);
  };

  const attachWatcher = () => {
    if (closed || watcher || !existsSync(paths.stateDir)) {
      return;
    }
    try {
      watcher = watch(paths.stateDir, { persistent: true }, (_eventType, filename) => {
        const name = filename ? String(filename) : '';
        if (name && !WATCHED_FILES.has(name)) {
          return;
        }
        scheduleDebouncedEmit();
      });
      watcher.on('error', () => {
        try {
          watcher?.close();
        } catch {
          // ignore
        }
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  };

  if (io.signal?.aborted) {
    return 0;
  }

  await emitIfChanged();
  attachWatcher();

  return await new Promise<number>((resolve) => {
    onFinish = () => resolve(0);
    pollTimer = setInterval(() => {
      void emitIfChanged();
    }, opts.intervalMs);

    if (io.registerProcessSignals !== false) {
      process.on('SIGINT', handleSignal);
      process.on('SIGTERM', handleSignal);
    }
    io.signal?.addEventListener('abort', handleSignal, { once: true });
    stdout.on('error', handleStdoutError);
  });
}
