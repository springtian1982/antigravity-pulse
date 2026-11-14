import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compactModelLabel } from '../core/fleet-builder';
import {
  escapeHtml,
  formatDeltaQuotaPct,
  formatDurationCompact,
  formatPct,
  formatTokensCompact,
} from '../core/formatters';
import { getStatePaths, isValidUuid } from '../state/state-dir';
import type {
  CascadeNodeView,
  EffortTier,
  LifecyclePhase,
  ModelTier,
  QuotaBucketView,
  QuotaSummaryView,
  SmartGovernanceBanner,
} from '../types/telemetry';

export type CardThemeMode = 'auto' | 'light' | 'dark';

export interface StatusCardInput {
  conversationId: string | null;
  generatedAt: string;
  hostConnected: boolean;
  stale: boolean;
  staleAgeMs?: number | null;
  activeNode: CascadeNodeView | null;
  treeNodes: CascadeNodeView[];
  quota: QuotaSummaryView | null;
  smartGovernanceBanner?: SmartGovernanceBanner | null;
  warnings?: string[];
  theme?: CardThemeMode;
  includeTree?: boolean;
}

export interface PersistedStatusCard {
  safeConversationId: string;
  outputPath: string;
  fileUri: string;
  html: string;
}

const VALID_TIERS = new Set<ModelTier>(['apex', 'workhorse', 'fast', 'orchestrator', 'alert']);

function sanitizeTier(tier: string | null | undefined): ModelTier {
  return tier && VALID_TIERS.has(tier as ModelTier) ? (tier as ModelTier) : 'workhorse';
}

function clampPct(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatEffortBadge(effort: EffortTier): string {
  switch (effort) {
    case 'xhigh':
      return 'XH';
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MED';
    case 'low':
      return 'LOW';
    case 'flash':
      return 'FLASH';
    case 'auto':
      return 'AUTO';
    default:
      return '';
  }
}

function formatTierTag(tier: ModelTier): string {
  switch (tier) {
    case 'apex':
      return 'APEX';
    case 'workhorse':
      return 'WORKHORSE';
    case 'fast':
      return 'FAST';
    case 'orchestrator':
      return 'AUTO';
    case 'alert':
      return 'ALERT';
  }
}

function formatPhaseBadge(node: CascadeNodeView): { label: string; isActive: boolean; isAlert: boolean } {
  const dur = formatDurationCompact(node.phaseElapsedMs);
  switch (node.phase) {
    case 'THINKING':
      return { label: `THINKING ${dur}`, isActive: true, isAlert: false };
    case 'STREAMING': {
      const rate =
        node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec)
          ? ` ${Math.round(node.streamingTokPerSec)}t/s`
          : '';
      return { label: `STREAMING${rate} ${dur}`, isActive: true, isAlert: false };
    }
    case 'TOOL_RUNNING':
      return {
        label: `TOOL ${node.lastTool?.name ? node.lastTool.name : 'run'} ${dur}`,
        isActive: true,
        isAlert: false,
      };
    case 'PRE_FLIGHT':
      return { label: `PRE-FLIGHT ${dur}`, isActive: true, isAlert: false };
    case 'BLOCKED_APPROVAL':
      return { label: `BLOCKED ${dur}`, isActive: true, isAlert: true };
    case 'ERROR_OR_QUOTA':
      return { label: 'ERROR / QUOTA', isActive: false, isAlert: true };
    case 'IDLE':
    default:
      return { label: 'IDLE', isActive: false, isAlert: false };
  }
}

function formatShortPhase(phase: LifecyclePhase, elapsedMs: number): string {
  const dur = formatDurationCompact(elapsedMs);
  switch (phase) {
    case 'THINKING':
      return `THINK ${dur}`;
    case 'STREAMING':
      return `STREAM ${dur}`;
    case 'TOOL_RUNNING':
      return `TOOL ${dur}`;
    case 'PRE_FLIGHT':
      return `INIT ${dur}`;
    case 'BLOCKED_APPROVAL':
      return `WAIT ${dur}`;
    case 'ERROR_OR_QUOTA':
      return 'ERR';
    case 'IDLE':
    default:
      return 'IDLE';
  }
}

function formatKindLabel(kind: CascadeNodeView['kind']): string {
  switch (kind) {
    case 'root':
      return 'Root';
    case 'subagent':
      return 'Subagent';
    case 'workflow':
      return 'Workflow';
    case 'swarm_member':
      return 'Swarm';
    default:
      return String(kind || 'Node');
  }
}

function formatBucketCell(
  label: string,
  bucket: QuotaBucketView | null | undefined,
  extraSub?: string
): string {
  const pct = bucket ? formatPct(bucket.remainingPct, 1) : '—';
  const reset = bucket?.resetInLabel ? escapeHtml(bucket.resetInLabel) : '—';
  const level =
    bucket && bucket.remainingPct < 15
      ? 'alert'
      : bucket && bucket.remainingPct < 25
        ? 'warn'
        : 'ok';
  const sub = extraSub ? escapeHtml(extraSub) : `reset ${reset}`;
  return [
    `<div class="fuel-cell" data-fuel-level="${level}">`,
    `  <span class="fuel-label">${escapeHtml(label)}</span>`,
    `  <span class="fuel-val tabular-nums">${escapeHtml(pct)}</span>`,
    `  <span class="fuel-sub tabular-nums">${sub}</span>`,
    `</div>`,
  ].join('\n');
}

function buildRoutingPill(node: CascadeNodeView): string {
  const req = node.requestedModel.displayName || node.requestedModel.raw || 'Unknown';
  const served = node.servedModel.displayName || node.servedModel.responseModel || 'Pending';
  const servedId = node.servedModel.responseModel || node.servedModel.modelEnum;
  const eff = formatEffortBadge(node.servedModel.effortTier);
  const tier = node.retryCount > 0 || node.routingStatus === 'mismatch_or_fallback'
    ? 'alert'
    : sanitizeTier(node.servedModel.tier);

  const sameLabel = req.trim().toLowerCase() === served.trim().toLowerCase();
  const routeText = sameLabel ? served : `${req} -> ${served}`;
  const suffix = eff ? ` [${eff}]` : '';
  const idBadge = servedId ? `<span class="mono-id">${escapeHtml(servedId)}</span>` : '';
  const retryBadge =
    node.retryCount > 0
      ? `<span class="pill" data-tier="alert">Retry ×${node.retryCount}</span>`
      : '';
  const mismatchBadge =
    node.routingStatus === 'mismatch_or_fallback'
      ? `<span class="pill" data-tier="alert">Fallback</span>`
      : '';

  return [
    `<div class="routing-row">`,
    `  <span class="pill" data-tier="${tier}">${escapeHtml(routeText + suffix)}</span>`,
    idBadge ? `  ${idBadge}` : '',
    retryBadge ? `  ${retryBadge}` : '',
    mismatchBadge ? `  ${mismatchBadge}` : '',
    `</div>`,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatCompactNodeModel(node: CascadeNodeView): string {
  const base = compactModelLabel(node.servedModel);
  const effort = formatEffortBadge(node.servedModel.effortTier);
  if (!effort) {
    return base;
  }
  if (/\((?:XH|H|M|L)\)$/i.test(base) || base.toLowerCase().includes(effort.toLowerCase())) {
    return base;
  }
  return `${base} · ${effort}`;
}

function renderNodeRow(node: CascadeNodeView, isFocused: boolean): string {
  const effectiveTier =
    node.retryCount > 0 || node.phase === 'ERROR_OR_QUOTA'
      ? 'alert'
      : sanitizeTier(node.servedModel.tier);
  const kindLabel = formatKindLabel(node.kind);
  const nodeName = node.role || node.title || node.cascadeId.slice(0, 8);
  const swarmSuffix = node.swarmState?.memberName ? ` (${node.swarmState.memberName})` : '';
  const modelDisplay = node.servedModel.displayName || node.servedModel.responseModel || 'Pending';
  const effort = formatEffortBadge(node.servedModel.effortTier);
  const fullModelText = effort ? `${modelDisplay} · ${effort}` : modelDisplay;
  const fullModelTitle = node.servedModel.responseModel
    ? `${fullModelText} [${node.servedModel.responseModel}]`
    : fullModelText;
  const compactModelText = formatCompactNodeModel(node);
  const phaseStr = formatShortPhase(node.phase, node.phaseElapsedMs);
  const ctxPct = formatPct(node.contextWindow.pct, 0);
  const deltaStr = formatDeltaQuotaPct(node.deltaQuota5hPct);

  const actionParts: string[] = [];
  if (node.lastTool?.name) {
    actionParts.push(node.lastTool.name);
  }
  if (node.lastTool?.summary) {
    actionParts.push(node.lastTool.summary);
  }
  const actionText = actionParts.length > 0 ? actionParts.join(': ') : node.phase === 'IDLE' ? 'Ready' : phaseStr;

  const indentPx = Math.min(24, Math.max(0, node.depth) * 8);
  const rowCls = isFocused ? 'tree-row is-focused' : 'tree-row';
  const phaseTier =
    node.phase === 'ERROR_OR_QUOTA' || node.phase === 'BLOCKED_APPROVAL'
      ? 'alert'
      : node.phase === 'IDLE'
        ? 'muted'
        : effectiveTier;

  const fallbackBadge =
    node.routingStatus === 'mismatch_or_fallback'
      ? `<span class="pill pill-xs" data-tier="alert">Fallback</span>`
      : '';
  const retryBadge =
    node.retryCount > 0
      ? `<span class="pill pill-xs" data-tier="alert">Retry ×${node.retryCount}</span>`
      : '';

  return [
    `<div class="${rowCls}">`,
    `  <div class="tree-row-main">`,
    `    <div class="node-cell" style="padding-left:${indentPx}px">`,
    `      <span class="kind-tag">${escapeHtml(kindLabel)}</span>`,
    `      <span class="node-name" title="${escapeHtml(nodeName + swarmSuffix)}">${escapeHtml(nodeName + swarmSuffix)}</span>`,
    `    </div>`,
    `    <div class="node-badges">`,
    `      <span class="pill pill-xs pill-model" data-tier="${effectiveTier}" title="${escapeHtml(fullModelTitle)}">${escapeHtml(compactModelText)}</span>`,
    fallbackBadge ? `      ${fallbackBadge}` : '',
    retryBadge ? `      ${retryBadge}` : '',
    `      <span class="phase-txt tabular-nums" data-phase-tier="${phaseTier}">${escapeHtml(phaseStr)}</span>`,
    `      <span class="node-metrics tabular-nums">CTX ${escapeHtml(ctxPct)} · Δ${escapeHtml(deltaStr)}</span>`,
    `    </div>`,
    `  </div>`,
    `  <div class="tree-row-sub" style="padding-left:${indentPx}px">`,
    `    <span class="sub-model" title="${escapeHtml(fullModelTitle)}">${escapeHtml(fullModelText)}</span>`,
    `    <span class="sub-action" title="${escapeHtml(actionText)}">${escapeHtml(actionText)}</span>`,
    `  </div>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join('\n');
}

const CARD_CSS = `
:root {
  color-scheme: light dark;
  --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  --paper: #fffcf0;
  --surface: #f2f0e5;
  --surface-alt: #e6e4d9;
  --border: #cecdc3;
  --ink: #100f0f;
  --muted: #6f6e69;
  --tier-apex: #5e409d;
  --tier-workhorse: #205ea6;
  --tier-fast: #24837b;
  --tier-orchestrator: #ad8301;
  --tier-alert: #af3029;
  --tier-apex-ink: #4b3182;
  --tier-workhorse-ink: #184b85;
  --tier-fast-ink: #19635d;
  --tier-orchestrator-ink: #5c4500;
  --tier-alert-ink: #8f241f;
  --tier-apex-bg: rgba(94, 64, 157, 0.1);
  --tier-workhorse-bg: rgba(32, 94, 166, 0.1);
  --tier-fast-bg: rgba(36, 131, 123, 0.1);
  --tier-orchestrator-bg: rgba(173, 131, 1, 0.12);
  --tier-alert-bg: rgba(175, 48, 41, 0.11);
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #100f0f;
    --surface: #1c1b1a;
    --surface-alt: #282726;
    --border: #403e3c;
    --ink: #cecdc3;
    --muted: #878580;
    --tier-apex: #8b7ec8;
    --tier-workhorse: #4385be;
    --tier-fast: #3aa99f;
    --tier-orchestrator: #d0a215;
    --tier-alert: #d14d41;
    --tier-apex-ink: #c2b9ea;
    --tier-workhorse-ink: #8cc0ec;
    --tier-fast-ink: #76d4cc;
    --tier-orchestrator-ink: #f3da8b;
    --tier-alert-ink: #f0958d;
    --tier-apex-bg: rgba(139, 126, 200, 0.16);
    --tier-workhorse-bg: rgba(67, 133, 190, 0.16);
    --tier-fast-bg: rgba(58, 169, 159, 0.16);
    --tier-orchestrator-bg: rgba(208, 162, 21, 0.16);
    --tier-alert-bg: rgba(209, 77, 65, 0.16);
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --paper: #fffcf0;
  --surface: #f2f0e5;
  --surface-alt: #e6e4d9;
  --border: #cecdc3;
  --ink: #100f0f;
  --muted: #6f6e69;
  --tier-apex: #5e409d;
  --tier-workhorse: #205ea6;
  --tier-fast: #24837b;
  --tier-orchestrator: #ad8301;
  --tier-alert: #af3029;
  --tier-apex-ink: #4b3182;
  --tier-workhorse-ink: #184b85;
  --tier-fast-ink: #19635d;
  --tier-orchestrator-ink: #5c4500;
  --tier-alert-ink: #8f241f;
  --tier-apex-bg: rgba(94, 64, 157, 0.1);
  --tier-workhorse-bg: rgba(32, 94, 166, 0.1);
  --tier-fast-bg: rgba(36, 131, 123, 0.1);
  --tier-orchestrator-bg: rgba(173, 131, 1, 0.12);
  --tier-alert-bg: rgba(175, 48, 41, 0.11);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #100f0f;
  --surface: #1c1b1a;
  --surface-alt: #282726;
  --border: #403e3c;
  --ink: #cecdc3;
  --muted: #878580;
  --tier-apex: #8b7ec8;
  --tier-workhorse: #4385be;
  --tier-fast: #3aa99f;
  --tier-orchestrator: #d0a215;
  --tier-alert: #d14d41;
  --tier-apex-ink: #c2b9ea;
  --tier-workhorse-ink: #8cc0ec;
  --tier-fast-ink: #76d4cc;
  --tier-orchestrator-ink: #f3da8b;
  --tier-alert-ink: #f0958d;
  --tier-apex-bg: rgba(139, 126, 200, 0.16);
  --tier-workhorse-bg: rgba(67, 133, 190, 0.16);
  --tier-fast-bg: rgba(58, 169, 159, 0.16);
  --tier-orchestrator-bg: rgba(208, 162, 21, 0.16);
  --tier-alert-bg: rgba(209, 77, 65, 0.16);
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.35;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
.tabular-nums { font-variant-numeric: tabular-nums; }
.card {
  width: 100%;
  max-width: 596px;
  margin: 0 auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 9px;
  min-width: 0;
}
.head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--tier-fast);
  flex-shrink: 0;
}
.dot[data-state="alert"] { background: var(--tier-alert); }
.dot[data-state="idle"] { background: var(--muted); }
.title {
  margin: 4px 0 4px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  word-break: break-word;
}
.routing-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.pill {
  display: inline-block;
  vertical-align: middle;
  line-height: 1.35;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--surface-alt);
  color: var(--ink);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill-xs { padding: 1px 6px; font-size: 10px; line-height: 1.3; }
.pill-model { max-width: 165px; }
.pill[data-tier="apex"] { border-color: var(--tier-apex); background: var(--tier-apex-bg); color: var(--tier-apex-ink); }
.pill[data-tier="workhorse"] { border-color: var(--tier-workhorse); background: var(--tier-workhorse-bg); color: var(--tier-workhorse-ink); }
.pill[data-tier="fast"] { border-color: var(--tier-fast); background: var(--tier-fast-bg); color: var(--tier-fast-ink); }
.pill[data-tier="orchestrator"] { border-color: var(--tier-orchestrator); background: var(--tier-orchestrator-bg); color: var(--tier-orchestrator-ink); }
.pill[data-tier="alert"] { border-color: var(--tier-alert); background: var(--tier-alert-bg); color: var(--tier-alert-ink); }
.mono-id {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted);
  word-break: break-all;
}
.bars-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 420px) {
  .bars-grid { grid-template-columns: minmax(0, 1fr); }
}
.bar-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  margin-bottom: 4px;
}
.bar-label { font-weight: 600; color: var(--ink); }
.bar-val { color: var(--muted); font-size: 10.5px; }
.bar-track {
  height: 6px;
  width: 100%;
  border-radius: 999px;
  background: var(--surface-alt);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--tier-fast);
}
.bar-fill[data-level="warn_70"] { background: var(--tier-orchestrator); }
.bar-fill[data-level="critical_85"] { background: var(--tier-alert); }
.bar-fill[data-kind="cache"] { background: var(--tier-workhorse); }
.fuel-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
@media (max-width: 460px) {
  .fuel-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.fuel-cell {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 7px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.fuel-cell[data-fuel-level="warn"] { border-color: var(--tier-orchestrator); }
.fuel-cell[data-fuel-level="alert"] { border-color: var(--tier-alert); }
.fuel-label { font-size: 10px; color: var(--muted); font-weight: 600; }
.fuel-val { font-size: 12px; font-weight: 700; color: var(--ink); }
.fuel-cell[data-fuel-level="alert"] .fuel-val { color: var(--tier-alert-ink); }
.fuel-sub { font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.banner {
  border-radius: 5px;
  padding: 6px 8px;
  font-size: 11px;
  border: 1px solid var(--tier-orchestrator);
  background: var(--tier-orchestrator-bg);
  color: var(--tier-orchestrator-ink);
  word-break: break-word;
}
.banner[data-level="alert"] {
  border-color: var(--tier-alert);
  background: var(--tier-alert-bg);
  color: var(--tier-alert-ink);
}
.tree-wrap { padding: 0; overflow: hidden; }
.tree-head {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}
.tree-list {
  display: flex;
  flex-direction: column;
}
.tree-row {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.tree-row:last-child { border-bottom: none; }
.tree-row.is-focused { background: var(--surface-alt); }
.tree-row-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.node-cell {
  flex: 1 1 130px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
}
.kind-tag {
  flex: 0 0 auto;
  font-size: 9.5px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  color: var(--muted);
}
.node-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.node-badges {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-left: auto;
  max-width: 100%;
}
.node-badges .pill { flex: 0 0 auto; }
.phase-txt {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 10.5px;
}
.node-metrics {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--muted);
}
.tree-row-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
  min-width: 0;
}
.sub-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-action {
  flex: 0 1 auto;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phase-txt[data-phase-tier="apex"] { color: var(--tier-apex-ink); font-weight: 600; }
.phase-txt[data-phase-tier="workhorse"] { color: var(--tier-workhorse-ink); font-weight: 600; }
.phase-txt[data-phase-tier="fast"] { color: var(--tier-fast-ink); font-weight: 600; }
.phase-txt[data-phase-tier="alert"] { color: var(--tier-alert-ink); font-weight: 600; }
.phase-txt[data-phase-tier="muted"] { color: var(--muted); }
.empty-msg { padding: 10px; font-size: 11px; color: var(--muted); text-align: center; }
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--muted);
  padding: 0 2px;
  flex-wrap: wrap;
}
`.trim();

export function buildStatusCardHtml(input: StatusCardInput): string {
  const theme: CardThemeMode =
    input.theme === 'light' || input.theme === 'dark' ? input.theme : 'auto';
  const includeTree = input.includeTree !== false;
  const active = input.activeNode;
  const nodes = Array.isArray(input.treeNodes) ? input.treeNodes : [];

  const titleText = active?.title || (input.hostConnected ? 'Active Cascade' : 'Model Pulse Offline');
  const cidLabel = input.conversationId || active?.cascadeId || 'global';
  const statusPill = active
    ? formatPhaseBadge(active)
    : input.hostConnected
      ? { label: 'NO ACTIVE CASCADE', isActive: false, isAlert: false }
      : { label: input.stale ? 'OFFLINE / STALE' : 'OFFLINE', isActive: false, isAlert: true };

  const dotState = statusPill.isAlert ? 'alert' : statusPill.isActive ? 'active' : 'idle';
  const statusTier: ModelTier = statusPill.isAlert
    ? 'alert'
    : active
      ? sanitizeTier(active.servedModel.tier)
      : 'workhorse';

  const ctxPct = clampPct(active?.contextWindow.pct ?? 0);
  const ctxLevel = active?.contextWindow.level ?? 'normal';
  const ctxLabel = active
    ? `${formatTokensCompact(active.contextWindow.estimatedTokensUsed)} / ${formatTokensCompact(active.contextWindow.maxContextTokens)} (${formatPct(ctxPct, 1)})`
    : '—';

  const cachePct = clampPct(active?.cacheHitPct ?? 0);
  const cacheLabel = active
    ? `${formatPct(cachePct, 1)} · In ${formatTokensCompact(active.tokens.inputTokens)} / Out ${formatTokensCompact(active.tokens.outputTokens)}`
    : '—';

  const g5h = input.quota?.gemini5h ?? null;
  const gWk = input.quota?.geminiWeekly ?? null;
  const p3 = input.quota?.thirdParty5h ?? null;
  const treeDelta = formatDeltaQuotaPct(input.quota?.treeNetDelta5hPct ?? null);
  const resetSub = g5h?.resetInLabel ? `reset ${g5h.resetInLabel}` : 'reset —';

  const headerHtml = [
    `<section class="panel">`,
    `  <div class="head-top">`,
    `    <span class="brand"><span class="dot" data-state="${dotState}"></span>Model Pulse</span>`,
    `    <span class="pill" data-tier="${statusTier}">${escapeHtml(statusPill.label)}</span>`,
    `  </div>`,
    `  <h1 class="title">${escapeHtml(titleText)}</h1>`,
    active ? `  ${buildRoutingPill(active)}` : `  <div class="mono-id">cid: ${escapeHtml(cidLabel)}</div>`,
    active ? `  <div class="mono-id" style="margin-top:4px">cid: ${escapeHtml(cidLabel)}</div>` : '',
    `</section>`,
  ]
    .filter(Boolean)
    .join('\n');

  const healthHtml = [
    `<section class="panel bars-grid">`,
    `  <div>`,
    `    <div class="bar-head"><span class="bar-label">CTX Window</span><span class="bar-val tabular-nums">${escapeHtml(ctxLabel)}</span></div>`,
    `    <div class="bar-track"><div class="bar-fill" data-level="${escapeHtml(ctxLevel)}" style="width:${ctxPct.toFixed(1)}%"></div></div>`,
    `  </div>`,
    `  <div>`,
    `    <div class="bar-head"><span class="bar-label">Cache Hit</span><span class="bar-val tabular-nums">${escapeHtml(cacheLabel)}</span></div>`,
    `    <div class="bar-track"><div class="bar-fill" data-kind="cache" style="width:${cachePct.toFixed(1)}%"></div></div>`,
    `  </div>`,
    `</section>`,
  ].join('\n');

  const fuelHtml = [
    `<section class="panel fuel-strip">`,
    formatBucketCell('Gemini 5h', g5h),
    formatBucketCell('Gemini Wk', gWk),
    formatBucketCell('3P 5h', p3),
    [
      `<div class="fuel-cell" data-fuel-level="ok">`,
      `  <span class="fuel-label">Tree ΔQuota</span>`,
      `  <span class="fuel-val tabular-nums">${escapeHtml(treeDelta)}</span>`,
      `  <span class="fuel-sub tabular-nums">${escapeHtml(resetSub)}</span>`,
      `</div>`,
    ].join('\n'),
    `</section>`,
  ].join('\n');

  const bannerList: string[] = [];
  if (input.smartGovernanceBanner?.active && input.smartGovernanceBanner.message) {
    bannerList.push(
      `<div class="banner" data-level="warn">${escapeHtml(input.smartGovernanceBanner.message)}</div>`
    );
  }
  for (const warn of input.warnings ?? []) {
    if (!warn) continue;
    const isCrit = /critical|< 15%|< 20%|offline|error/i.test(warn);
    bannerList.push(
      `<div class="banner" data-level="${isCrit ? 'alert' : 'warn'}">${escapeHtml(warn)}</div>`
    );
  }

  let treeHtml = '';
  if (includeTree) {
    const bodyHtml =
      nodes.length > 0
        ? [
            `<div class="tree-list">`,
            nodes.map((n) => renderNodeRow(n, n.cascadeId === active?.cascadeId)).join('\n'),
            `</div>`,
          ].join('\n')
        : `<div class="empty-msg">No active cascade nodes found in $PULSE_STATE_DIR. Start a session or open Model Pulse sidecar.</div>`;

    treeHtml = [
      `<section class="panel tree-wrap">`,
      `  <div class="tree-head"><span>Cascade Topology</span><span class="tabular-nums">${nodes.length} node${nodes.length === 1 ? '' : 's'}</span></div>`,
      bodyHtml,
      `</section>`,
    ].join('\n');
  }

  const connText = input.hostConnected
    ? input.stale
      ? 'Host: Stale'
      : 'Host: Live'
    : 'Host: Disconnected';

  const footerHtml = [
    `<footer class="foot tabular-nums">`,
    `  <span>${escapeHtml(connText)} · ${nodes.length} node${nodes.length === 1 ? '' : 's'}</span>`,
    `  <span>${escapeHtml(input.generatedAt)}</span>`,
    `</footer>`,
  ].join('\n');

  const colorSchemeMeta = theme === 'auto' ? 'light dark' : theme;

  return [
    `<!doctype html>`,
    `<html lang="en" data-theme="${theme}">`,
    `<head>`,
    `  <meta charset="utf-8">`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1">`,
    `  <meta name="color-scheme" content="${colorSchemeMeta}">`,
    `  <title>Model Pulse — ${escapeHtml(titleText)}</title>`,
    `  <style>${CARD_CSS}</style>`,
    `</head>`,
    `<body>`,
    `  <main class="card">`,
    headerHtml,
    healthHtml,
    fuelHtml,
    bannerList.join('\n'),
    treeHtml,
    footerHtml,
    `  </main>`,
    `</body>`,
    `</html>`,
    ``,
  ]
    .filter(Boolean)
    .join('\n');
}

function tryChmod(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(targetPath, mode);
  } catch {
    // Ignore on non-POSIX filesystems
  }
}

export function resolveSafeCardConversationSegment(conversationId: string | null | undefined): string {
  if (conversationId === null || conversationId === undefined) {
    return 'global';
  }
  const trimmed = conversationId.trim();
  if (!trimmed || trimmed === 'global') {
    return 'global';
  }
  if (!isValidUuid(trimmed)) {
    throw new RangeError('Invalid conversationId: expected 36-character UUID');
  }
  return trimmed;
}

export function writeStatusCardFile(
  input: StatusCardInput,
  options: { stateDir?: string; timestampMs?: number } = {}
): PersistedStatusCard {
  const safeCid = resolveSafeCardConversationSegment(input.conversationId);
  const paths = getStatePaths(options.stateDir);
  const cardsDir = path.join(paths.stateDir, 'cards');
  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
  tryChmod(paths.stateDir, 0o700);
  mkdirSync(cardsDir, { recursive: true, mode: 0o700 });
  tryChmod(cardsDir, 0o700);

  const ts =
    typeof options.timestampMs === 'number' && Number.isFinite(options.timestampMs)
      ? Math.trunc(options.timestampMs)
      : Date.now();
  const fileName = `${safeCid}-${ts}.html`;
  const outputPath = path.join(cardsDir, fileName);
  const resolvedCardsDir = path.resolve(cardsDir);
  const resolvedOut = path.resolve(outputPath);
  if (!resolvedOut.startsWith(`${resolvedCardsDir}${path.sep}`)) {
    throw new RangeError('Refusing to write status card outside $PULSE_STATE_DIR/cards');
  }

  const html = buildStatusCardHtml(input);
  const tmpPath = `${outputPath}.${process.pid}.${ts}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmpPath, html, { encoding: 'utf8', mode: 0o600 });
    tryChmod(tmpPath, 0o600);
    renameSync(tmpPath, outputPath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }

  return {
    safeConversationId: safeCid,
    outputPath,
    fileUri: pathToFileURL(outputPath).href,
    html,
  };
}
