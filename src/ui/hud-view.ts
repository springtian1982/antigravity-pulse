import {
  escapeHtml,
  formatDeltaQuotaPct,
  formatDurationCompact,
  formatPct,
  formatTokensCompact,
} from '../core/formatters';
import type {
  CascadeNodeView,
  EffortTier,
  HudSnapshotResponse,
  InlineStampMode,
  LifecyclePhase,
  ModelTier,
  QuotaBucketView,
} from '../types/telemetry';

export type HudTabId = 'overview' | 'timeline' | 'quota';

export interface HudUiLocalState {
  activeTab: HudTabId;
  expandedIdleGroup: boolean;
  openPopoverNodeId: string | null;
  isUpdatingConfig: boolean;
  statusMessage: string | null;
}

export interface HudRenderBindings {
  onTabChange(tab: HudTabId): void;
  onSetSortMode(mode: 'active-first' | 'topology-tree'): void;
  onToggleIdleGroup(): void;
  onJumpConversation(cid: string): void;
  onInspectNode(nodeId: string | null): void;
  onCycleStampMode(): void;
  onSetStampMode(mode: InlineStampMode): void;
}

export interface HudViewController {
  render(
    snapshot: HudSnapshotResponse | null,
    uiState: HudUiLocalState,
    snapshotReceivedAtMs: number
  ): void;
  tickTimers(nowMs: number, snapshotReceivedAtMs: number): void;
  showLoading(message?: string): void;
  showError(message: string): void;
  destroy(): void;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const TAB_ORDER: readonly HudTabId[] = ['overview', 'timeline', 'quota'];

const ACTIVE_PHASES = new Set<LifecyclePhase>([
  'PRE_FLIGHT',
  'THINKING',
  'STREAMING',
  'TOOL_RUNNING',
  'BLOCKED_APPROVAL',
]);

const PHASE_PRIORITY: Record<LifecyclePhase, number> = {
  BLOCKED_APPROVAL: 0,
  ERROR_OR_QUOTA: 1,
  TOOL_RUNNING: 2,
  STREAMING: 3,
  THINKING: 4,
  PRE_FLIGHT: 5,
  IDLE: 6,
};

const VALID_TIERS = new Set<ModelTier>(['apex', 'workhorse', 'fast', 'orchestrator', 'alert']);

function sanitizeTier(tier: string | undefined): ModelTier {
  return tier && VALID_TIERS.has(tier as ModelTier) ? (tier as ModelTier) : 'workhorse';
}

function mapPhaseToDotAttr(
  phase: LifecyclePhase
): 'idle' | 'pre_flight' | 'thinking' | 'streaming' | 'scanning' | 'waiting' | 'error' {
  switch (phase) {
    case 'PRE_FLIGHT':
      return 'pre_flight';
    case 'THINKING':
      return 'thinking';
    case 'STREAMING':
      return 'streaming';
    case 'TOOL_RUNNING':
      return 'scanning';
    case 'BLOCKED_APPROVAL':
      return 'waiting';
    case 'ERROR_OR_QUOTA':
      return 'error';
    case 'IDLE':
    default:
      return 'idle';
  }
}

function formatEffortTag(effort: EffortTier): string {
  switch (effort) {
    case 'xhigh':
      return 'XHIGH';
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    case 'low':
      return 'LOW';
    case 'flash':
      return 'FLASH';
    case 'auto':
      return 'AUTO';
    case 'unknown':
    default:
      return 'MODEL';
  }
}

function clampProgressPct(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function computeLivePhaseElapsed(
  serverElapsedMs: number,
  snapshotReceivedAtMs: number,
  nowMs: number
): number {
  const base = Number.isFinite(serverElapsedMs) && serverElapsedMs >= 0 ? serverElapsedMs : 0;
  const delta = Math.max(0, nowMs - snapshotReceivedAtMs);
  return base + delta;
}

function formatIdleAgeText(lastModifiedIso: string | null | undefined, nowMs: number): string {
  if (!lastModifiedIso) {
    return '上轮已结束';
  }
  const ts = Date.parse(lastModifiedIso);
  if (!Number.isFinite(ts)) {
    return '上轮已结束';
  }
  const ageMs = Math.max(0, nowMs - ts);
  return `上轮完成于 ${formatDurationCompact(ageMs)} 前`;
}

function formatHeroPhaseText(node: CascadeNodeView, nowMs: number, snapshotReceivedAtMs: number): {
  labelHtml: string;
  timerHtml: string;
} {
  const liveMs = computeLivePhaseElapsed(node.phaseElapsedMs, snapshotReceivedAtMs, nowMs);
  const timerAttrs =
    `data-live-timer="true" data-phase="${escapeHtml(node.phase)}" ` +
    `data-server-elapsed-ms="${Math.max(0, Math.round(node.phaseElapsedMs))}"`;

  switch (node.phase) {
    case 'PRE_FLIGHT':
      return {
        labelHtml: '<span class="pulse-hero-phase-label">Pre-flight</span>',
        timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`,
      };
    case 'THINKING':
      return {
        labelHtml: '<span class="pulse-hero-phase-label">Thinking</span>',
        timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`,
      };
    case 'STREAMING': {
      const rateText =
        node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec)
          ? ` · ${Math.round(node.streamingTokPerSec)} tok/s`
          : '';
      return {
        labelHtml: `<span class="pulse-hero-phase-label">Streaming${escapeHtml(rateText)}</span>`,
        timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`,
      };
    }
    case 'TOOL_RUNNING': {
      const toolName = node.lastTool?.name ? node.lastTool.name : 'tool';
      return {
        labelHtml: `<span class="pulse-hero-phase-label">Tool: ${escapeHtml(toolName)}</span>`,
        timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`,
      };
    }
    case 'BLOCKED_APPROVAL':
      return {
        labelHtml: '<span class="pulse-hero-phase-label">等待审批</span>',
        timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`,
      };
    case 'ERROR_OR_QUOTA':
      return {
        labelHtml: '<span class="pulse-hero-phase-label">Error / Quota</span>',
        timerHtml: '<span class="pulse-live-timer tabular-nums">⚠</span>',
      };
    case 'IDLE':
    default: {
      const lastMs = Date.parse(node.lastModifiedTime);
      const lastAttr = Number.isFinite(lastMs) ? `data-last-modified-ms="${lastMs}"` : '';
      return {
        labelHtml: '<span class="pulse-hero-phase-label">Idle</span>',
        timerHtml: `<span class="pulse-live-timer tabular-nums" data-idle-age="true" ${lastAttr}>${escapeHtml(formatIdleAgeText(node.lastModifiedTime, nowMs))}</span>`,
      };
    }
  }
}

function renderHeroHtml(
  snapshot: HudSnapshotResponse,
  nowMs: number,
  snapshotReceivedAtMs: number
): string {
  const activeNode = snapshot.activeNode;
  if (!activeNode) {
    const fallbackNote = snapshot.hostConnected ? '等待会话活动' : 'Language Server 未连接';
    return `
      <section class="pulse-hero pulse-hud-hero" data-testid="hud-hero">
        <div class="pulse-hero-phase-row">
          <div class="pulse-hero-phase-left">
            <span class="pulse-phase-dot" data-phase="idle"></span>
            <span class="pulse-hero-phase-label">Idle · 未检测到活跃会话</span>
          </div>
          <span class="pulse-empty-note">${escapeHtml(fallbackNote)}</span>
        </div>
        <div class="pulse-hero-model-row" data-testid="hero-nameplate">
          <div class="pulse-hero-model-left">
            <span class="pulse-hero-model-name">Model Pulse Ready</span>
          </div>
          <span class="pulse-hero-model-id">${escapeHtml(snapshot.config.inlineStampMode)}</span>
        </div>
      </section>
    `;
  }

  const parentCid =
    activeNode.parentCascadeId && UUID_RE.test(activeNode.parentCascadeId)
      ? activeNode.parentCascadeId
      : snapshot.breadcrumb.length > 1 && UUID_RE.test(snapshot.breadcrumb[0].cascadeId)
        ? snapshot.breadcrumb[0].cascadeId
        : null;
  const showBreadcrumb = Boolean(activeNode.parentCascadeId || snapshot.breadcrumb.length > 1);
  const breadcrumbText =
    snapshot.breadcrumb.length > 0
      ? snapshot.breadcrumb
          .map((item) => item.role || item.title)
          .filter(Boolean)
          .join(' › ')
      : `${activeNode.role ?? activeNode.title}`;

  const phaseParts = formatHeroPhaseText(activeNode, nowMs, snapshotReceivedAtMs);
  const showRouteArrow =
    activeNode.routingStatus === 'routed' ||
    activeNode.routingStatus === 'mismatch_or_fallback' ||
    (activeNode.requestedModel.displayName &&
      activeNode.requestedModel.displayName !== activeNode.servedModel.displayName);

  const nameplateText = showRouteArrow
    ? `${activeNode.requestedModel.displayName} ➔ ${activeNode.servedModel.displayName}`
    : activeNode.servedModel.displayName;

  const heroTier = sanitizeTier(activeNode.servedModel.tier);
  const rightAlertHtml =
    activeNode.retryCount > 0
      ? `<span class="pulse-pill pulse-tier-alert" data-tier="alert">⚠ Retried ×${activeNode.retryCount}</span>`
      : activeNode.routingStatus === 'mismatch_or_fallback'
        ? `<span class="pulse-pill pulse-tier-alert" data-tier="alert">⚠ Fallback ➔ ${escapeHtml(activeNode.servedModel.displayName)}</span>`
        : activeNode.routingStatus === 'matched'
          ? `<span class="pulse-hero-model-id" title="${escapeHtml(activeNode.servedModel.responseModel)}">✓ ${escapeHtml(activeNode.servedModel.responseModel)}</span>`
          : `<span class="pulse-hero-model-id" title="${escapeHtml(activeNode.servedModel.responseModel)}">${escapeHtml(activeNode.servedModel.responseModel)}</span>`;

  const ctx = activeNode.contextWindow;
  const ctxSummary =
    ctx.maxContextTokens > 0
      ? `${formatTokensCompact(ctx.estimatedTokensUsed)} / ${formatTokensCompact(ctx.maxContextTokens)}`
      : `${formatTokensCompact(ctx.estimatedTokensUsed)} / —`;
  const ctxPctText = ctx.maxContextTokens > 0 ? formatPct(ctx.pct, 1) : '—';

  return `
    <section class="pulse-hero pulse-hud-hero" data-testid="hud-hero">
      ${
        showBreadcrumb
          ? `<div class="pulse-breadcrumb-row" data-testid="hero-breadcrumb">
              <span class="pulse-breadcrumb-path" title="${escapeHtml(breadcrumbText)}">${escapeHtml(breadcrumbText)}</span>
              ${
                parentCid
                  ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(parentCid)}">← 父会话</button>`
                  : ''
              }
            </div>`
          : ''
      }
      <div class="pulse-hero-phase-row">
        <div class="pulse-hero-phase-left">
          <span class="pulse-phase-dot" data-phase="${mapPhaseToDotAttr(activeNode.phase)}"></span>
          ${phaseParts.labelHtml}
          ${phaseParts.timerHtml}
        </div>
        <span class="pulse-empty-note tabular-nums">Step ${activeNode.stepCount}</span>
      </div>
      <div class="pulse-hero-model-row" data-testid="hero-nameplate">
        <div class="pulse-hero-model-left">
          <strong class="pulse-hero-model-name" title="${escapeHtml(nameplateText)}">${escapeHtml(nameplateText)}</strong>
          <span class="pulse-pill pulse-tier-${heroTier}" data-tier="${heroTier}">${escapeHtml(formatEffortTag(activeNode.servedModel.effortTier))}</span>
        </div>
        ${rightAlertHtml}
      </div>
      <div class="pulse-hero-health-grid">
        <div class="pulse-health-cell">
          <div class="pulse-health-meta tabular-nums">
            <span>CTX ${escapeHtml(ctxSummary)}</span>
            <span>${escapeHtml(ctxPctText)}</span>
          </div>
          <progress class="pulse-progress" data-level="${escapeHtml(ctx.level)}" max="100" value="${clampProgressPct(ctx.pct).toFixed(1)}" aria-label="Context window usage"></progress>
        </div>
        <div class="pulse-health-cell">
          <div class="pulse-health-meta tabular-nums">
            <span>Cache Hit</span>
            <span>${escapeHtml(formatPct(activeNode.cacheHitPct, 1))}</span>
          </div>
          <progress class="pulse-progress" data-level="normal" max="100" value="${clampProgressPct(activeNode.cacheHitPct).toFixed(1)}" aria-label="Prompt cache hit ratio"></progress>
        </div>
      </div>
    </section>
  `;
}

function sortNodesForMode(
  nodes: CascadeNodeView[],
  sortMode: 'active-first' | 'topology-tree',
  activeCid: string | null
): CascadeNodeView[] {
  if (sortMode === 'topology-tree') {
    const byId = new Map<string, CascadeNodeView>();
    for (const node of nodes) {
      byId.set(node.cascadeId, node);
    }
    const childrenByParent = new Map<string, CascadeNodeView[]>();
    const roots: CascadeNodeView[] = [];
    for (const node of nodes) {
      if (node.parentCascadeId && byId.has(node.parentCascadeId)) {
        const list = childrenByParent.get(node.parentCascadeId) ?? [];
        list.push(node);
        childrenByParent.set(node.parentCascadeId, list);
      } else {
        roots.push(node);
      }
    }
    const sortSiblings = (list: CascadeNodeView[]) =>
      list.sort((a, b) => {
        if (a.spawnStepIndex !== null && b.spawnStepIndex !== null && a.spawnStepIndex !== b.spawnStepIndex) {
          return a.spawnStepIndex - b.spawnStepIndex;
        }
        return Date.parse(b.lastModifiedTime) - Date.parse(a.lastModifiedTime);
      });
    sortSiblings(roots);
    const ordered: CascadeNodeView[] = [];
    const visited = new Set<string>();
    const visit = (node: CascadeNodeView) => {
      if (visited.has(node.cascadeId)) {
        return;
      }
      visited.add(node.cascadeId);
      ordered.push(node);
      const children = sortSiblings([...(childrenByParent.get(node.cascadeId) ?? [])]);
      for (const child of children) {
        visit(child);
      }
    };
    for (const root of roots) {
      visit(root);
    }
    for (const node of nodes) {
      visit(node);
    }
    return ordered;
  }

  return [...nodes].sort((a, b) => {
    const pa = PHASE_PRIORITY[a.phase] ?? 9;
    const pb = PHASE_PRIORITY[b.phase] ?? 9;
    if (pa !== pb) {
      return pa - pb;
    }
    if (activeCid) {
      if (a.cascadeId === activeCid && b.cascadeId !== activeCid) return -1;
      if (b.cascadeId === activeCid && a.cascadeId !== activeCid) return 1;
    }
    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return Date.parse(b.lastModifiedTime) - Date.parse(a.lastModifiedTime);
  });
}

function formatNodeRow2Html(
  node: CascadeNodeView,
  nowMs: number,
  snapshotReceivedAtMs: number
): string {
  const liveMs = computeLivePhaseElapsed(node.phaseElapsedMs, snapshotReceivedAtMs, nowMs);
  const timerAttrs =
    `data-live-timer="true" data-phase="${escapeHtml(node.phase)}" ` +
    `data-server-elapsed-ms="${Math.max(0, Math.round(node.phaseElapsedMs))}"`;

  let actionSummary = '';
  if (node.phase === 'TOOL_RUNNING' && node.lastTool) {
    const summaryPart = node.lastTool.summary ? ` (${node.lastTool.summary})` : '';
    actionSummary = `🔧 ${escapeHtml(node.lastTool.name)}${escapeHtml(summaryPart)} · <span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`;
  } else if (node.phase === 'THINKING' || node.phase === 'PRE_FLIGHT') {
    const label = node.phase === 'PRE_FLIGHT' ? '🚀 Pre-flight' : '🧠 Thinking';
    actionSummary = `${label} · Step ${node.stepCount} · <span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`;
  } else if (node.phase === 'STREAMING') {
    const rate =
      node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec)
        ? ` · ${Math.round(node.streamingTokPerSec)} tok/s`
        : '';
    actionSummary = `🟢 Streaming${escapeHtml(rate)} · <span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`;
  } else if (node.phase === 'BLOCKED_APPROVAL') {
    const toolPart = node.lastTool?.name ? ` (${node.lastTool.name})` : '';
    actionSummary = `⏸️ 等待审批${escapeHtml(toolPart)} · <span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`;
  } else if (node.phase === 'ERROR_OR_QUOTA') {
    actionSummary = '⚠ Error / Quota';
  } else {
    actionSummary = `⚪ Idle · ${escapeHtml(formatIdleAgeText(node.lastModifiedTime, nowMs))}`;
  }

  const alertBadge =
    node.retryCount > 0
      ? `<span class="pulse-pill pulse-tier-alert" data-tier="alert">⚠ Retried ×${node.retryCount}</span>`
      : node.routingStatus === 'mismatch_or_fallback'
        ? '<span class="pulse-pill pulse-tier-alert" data-tier="alert">⚠ Fallback</span>'
        : '';

  return `
    <div class="pulse-node-row-2">
      <div class="pulse-node-action-text">${actionSummary}</div>
      ${alertBadge}
    </div>
  `;
}

function renderNodeCardHtml(
  node: CascadeNodeView,
  sortMode: 'active-first' | 'topology-tree',
  openPopoverNodeId: string | null,
  nowMs: number,
  snapshotReceivedAtMs: number
): string {
  const boundedDepth = sortMode === 'topology-tree' ? Math.min(Math.max(0, node.depth), 3) : 0;
  const isSelectedPopover = openPopoverNodeId === node.cascadeId;
  const nodeTier = sanitizeTier(node.servedModel.tier);
  const primaryName =
    node.kind === 'swarm_member'
      ? node.swarmState?.memberName || node.role || node.title
      : node.role
        ? `${node.role} · ${node.title}`
        : node.title;

  const kindPill =
    node.kind === 'swarm_member'
      ? 'Swarm'
      : node.kind === 'workflow'
        ? 'Workflow'
        : node.typeName || (node.kind === 'subagent' ? 'Subagent' : '');

  const totalIn = node.tokens.inputTokens + node.tokens.cacheReadTokens;
  const canJump = UUID_RE.test(node.cascadeId);

  return `
    <article class="pulse-node-card pulse-tier-${nodeTier}" data-tier="${nodeTier}" data-node-id="${escapeHtml(node.cascadeId)}" style="--pulse-depth: ${boundedDepth}">
      <div class="pulse-node-row-1">
        <div class="pulse-node-identity">
          <span class="pulse-phase-dot" data-phase="${mapPhaseToDotAttr(node.phase)}"></span>
          <span class="pulse-node-title" title="${escapeHtml(primaryName)}">${escapeHtml(primaryName)}</span>
          ${kindPill ? `<span class="pulse-node-kind">${escapeHtml(kindPill)}</span>` : ''}
        </div>
        <div class="pulse-node-actions">
          <button
            type="button"
            class="pulse-pill pulse-tier-${nodeTier} pulse-node-model-btn"
            data-tier="${nodeTier}"
            data-action="inspect-node"
            data-node-id="${escapeHtml(node.cascadeId)}"
            popovertarget="pulse-node-popover"
            popovertargetaction="show"
            aria-expanded="${isSelectedPopover ? 'true' : 'false'}"
            ${isSelectedPopover ? 'data-popover-anchor="true"' : ''}
            title="${escapeHtml(node.servedModel.displayName)}"
          ><span class="pulse-btn-label">${escapeHtml(node.servedModel.displayName)}</span></button>
          ${
            canJump
              ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(node.cascadeId)}" title="Switch to conversation" aria-label="Switch to conversation">↗</button>`
              : ''
          }
        </div>
      </div>
      ${formatNodeRow2Html(node, nowMs, snapshotReceivedAtMs)}
      <div class="pulse-node-row-3 tabular-nums">
        <span>Steps: ${node.stepCount}</span>
        <span>In ${escapeHtml(formatTokensCompact(totalIn))} (Cache ${escapeHtml(formatPct(node.cacheHitPct, 0))})</span>
        <span>Out ${escapeHtml(formatTokensCompact(node.tokens.outputTokens))} (Think ${escapeHtml(formatTokensCompact(node.tokens.thinkingOutputTokens))})</span>
        <span>ΔQuota ${escapeHtml(formatDeltaQuotaPct(node.deltaQuota5hPct))}</span>
      </div>
    </article>
  `;
}

function renderOverviewPanelHtml(
  snapshot: HudSnapshotResponse,
  uiState: HudUiLocalState,
  nowMs: number,
  snapshotReceivedAtMs: number
): string {
  const banner = snapshot.smartGovernanceBanner;
  const bannerTier: ModelTier =
    banner.gemini5hRemainingPct !== null && banner.gemini5hRemainingPct < 15
      ? 'alert'
      : 'orchestrator';
  const bannerHtml = banner.active
    ? `
      <aside class="pulse-banner pulse-tier-${bannerTier}" data-tier="${bannerTier}" role="status" data-testid="smart-governance-banner">
        <strong>⚠ 算力治理解析</strong> ·
        <span>${banner.heavyConcurrentCount} 个高配重节点并发</span> ·
        <span>5h 余量 ${escapeHtml(formatPct(banner.gemini5hRemainingPct, 1))}</span>
        ${
          banner.estimatedBurnPctPerMin !== null
            ? ` · <span>消耗速率 ${banner.estimatedBurnPctPerMin.toFixed(2)}%/min</span>`
            : ''
        }
        ${banner.message ? `<div>${escapeHtml(banner.message)}</div>` : ''}
      </aside>
    `
    : '';

  const sortMode = snapshot.config.hudSortMode;
  const activeOnly = snapshot.treeNodes.filter((n) => n.phase !== 'IDLE');
  const idleOnly = snapshot.treeNodes.filter((n) => n.phase === 'IDLE');

  const orderedActive = sortNodesForMode(activeOnly, sortMode, snapshot.activeConversationId);
  const orderedIdle = sortNodesForMode(idleOnly, sortMode, snapshot.activeConversationId);

  const activeCardsHtml =
    orderedActive.length > 0
      ? `<div class="pulse-matrix" data-sort-mode="${escapeHtml(sortMode)}">${orderedActive
          .map((n) =>
            renderNodeCardHtml(n, sortMode, uiState.openPopoverNodeId, nowMs, snapshotReceivedAtMs)
          )
          .join('')}</div>`
      : snapshot.treeNodes.length === 0
        ? '<p class="pulse-empty-note">当前无树节点快照。</p>'
        : '<p class="pulse-empty-note">当前无活跃中节点，树内会话处于空闲状态。</p>';

  const idleDrawerHtml =
    orderedIdle.length > 0
      ? `
        <div class="pulse-idle-drawer">
          <button
            type="button"
            class="pulse-btn-compact"
            data-action="toggle-idle-group"
            data-testid="idle-group-toggle"
            aria-expanded="${uiState.expandedIdleGroup ? 'true' : 'false'}"
          >已完成 / 空闲节点 (${orderedIdle.length}) ${uiState.expandedIdleGroup ? '▾' : '▸'}</button>
          ${
            uiState.expandedIdleGroup
              ? `<div class="pulse-matrix" data-sort-mode="${escapeHtml(sortMode)}" style="margin-top: 6px;">${orderedIdle
                  .map((n) =>
                    renderNodeCardHtml(
                      n,
                      sortMode,
                      uiState.openPopoverNodeId,
                      nowMs,
                      snapshotReceivedAtMs
                    )
                  )
                  .join('')}</div>`
              : ''
          }
        </div>
      `
      : '';

  const warningsHtml =
    !snapshot.hostConnected && snapshot.warnings.length > 0
      ? `<p class="pulse-empty-note">${escapeHtml(snapshot.warnings[0])}</p>`
      : '';

  const toastHtml = uiState.statusMessage
    ? `<p class="pulse-empty-note" role="status">${escapeHtml(uiState.statusMessage)}</p>`
    : '';

  return `
    ${bannerHtml}
    ${warningsHtml}
    ${toastHtml}
    <div class="pulse-section-head">
      <h2 class="pulse-section-title">Agent Matrix (${orderedActive.length} active / ${snapshot.treeNodes.length})</h2>
      <div class="pulse-topbar-controls" role="group" aria-label="Matrix sort mode" data-testid="sort-toggle-group">
        <button
          type="button"
          class="pulse-btn-compact"
          data-action="set-sort"
          data-sort="active-first"
          aria-pressed="${sortMode === 'active-first' ? 'true' : 'false'}"
        >活跃置顶</button>
        <button
          type="button"
          class="pulse-btn-compact"
          data-action="set-sort"
          data-sort="topology-tree"
          aria-pressed="${sortMode === 'topology-tree' ? 'true' : 'false'}"
        >拓扑缩进</button>
      </div>
    </div>
    ${activeCardsHtml}
    ${idleDrawerHtml}
  `;
}

function renderTimelinePlaceholderHtml(snapshot: HudSnapshotResponse): string {
  const active = snapshot.activeNode;
  const turnSummary = active ? `${active.turnCount} turns · ${active.stepCount} steps` : '0 turns';
  const ttft = active?.lastTtftMs !== null && active?.lastTtftMs !== undefined
    ? formatDurationCompact(active.lastTtftMs)
    : '—';
  const streaming = active?.lastStreamingMs !== null && active?.lastStreamingMs !== undefined
    ? formatDurationCompact(active.lastStreamingMs)
    : '—';

  return `
    <article class="pulse-quota-card" data-testid="timeline-placeholder">
      <strong>Timeline 调用轴 (Stage 2 Flame Axis 就绪中)</strong>
      <p class="pulse-empty-note">
        当前焦点会话：${escapeHtml(active?.title ?? '—')} (${escapeHtml(turnSummary)})
      </p>
      <p class="pulse-empty-note tabular-nums">
        最近一轮实测：TTFT ${escapeHtml(ttft)} · Streaming ${escapeHtml(streaming)} · Cache ${escapeHtml(formatPct(active?.cacheHitPct, 1))}
      </p>
      <p class="pulse-empty-note">
        Stage 2 将在此面板接入逐轮 TTFT vs Streaming 火焰图、Thinking Token 占比与模型路由跳变高亮。
      </p>
    </article>
  `;
}

function renderQuotaBucketCardHtml(label: string, bucket: QuotaBucketView | null): string {
  if (!bucket) {
    return `
      <div class="pulse-quota-card">
        <div class="pulse-health-meta">
          <span>${escapeHtml(label)}</span>
          <span class="tabular-nums">—</span>
        </div>
        <progress class="pulse-progress" data-level="normal" max="100" value="0" aria-label="${escapeHtml(label)}"></progress>
        <span class="pulse-empty-note">暂无宿主配额数据</span>
      </div>
    `;
  }
  const level =
    bucket.isLowAlert || bucket.remainingPct < 15
      ? 'critical_85'
      : bucket.remainingPct < 40
        ? 'warn_70'
        : 'normal';
  return `
    <div class="pulse-quota-card">
      <div class="pulse-health-meta">
        <span>${escapeHtml(label)}</span>
        <span class="tabular-nums ${bucket.isLowAlert ? 'pulse-quota-alert' : ''}">${escapeHtml(formatPct(bucket.remainingPct, 1))}</span>
      </div>
      <progress class="pulse-progress" data-level="${level}" max="100" value="${clampProgressPct(bucket.remainingPct).toFixed(1)}" aria-label="${escapeHtml(label)}"></progress>
      <div class="pulse-health-meta tabular-nums">
        <span>${escapeHtml(bucket.bucketId)}</span>
        <span>Reset: ${escapeHtml(bucket.resetInLabel)}</span>
      </div>
    </div>
  `;
}

function renderQuotaPanelHtml(snapshot: HudSnapshotResponse, uiState: HudUiLocalState): string {
  const q = snapshot.quota;
  const stampMode = snapshot.config.inlineStampMode;
  const burnText =
    q.burnRate5hPctPerMin !== null && Number.isFinite(q.burnRate5hPctPerMin)
      ? `${q.burnRate5hPctPerMin.toFixed(2)}%/min`
      : '—';

  return `
    <section class="pulse-quota-grid" data-testid="quota-tab-panel">
      ${renderQuotaBucketCardHtml('Gemini 5h', q.gemini5h)}
      ${renderQuotaBucketCardHtml('Gemini Weekly', q.geminiWeekly)}
      ${renderQuotaBucketCardHtml('Claude / 3P 5h', q.thirdParty5h)}
      ${renderQuotaBucketCardHtml('Claude / 3P Weekly', q.thirdPartyWeekly)}
      <div class="pulse-quota-card tabular-nums">
        <div class="pulse-health-meta">
          <span>本树 5h 净消耗 (ΔQuota)</span>
          <span>${escapeHtml(formatDeltaQuotaPct(q.treeNetDelta5hPct))}</span>
        </div>
        <div class="pulse-health-meta">
          <span>近期 5h 消耗速率</span>
          <span>${escapeHtml(burnText)}</span>
        </div>
      </div>
      <div class="pulse-quota-card">
        <div class="pulse-health-meta">
          <span>Inline Zero-Token Stamp 模式</span>
          <span>${uiState.isUpdatingConfig ? '保存中…' : escapeHtml(stampMode)}</span>
        </div>
        <div class="pulse-stamp-group" role="group" aria-label="Inline stamp mode">
          <button type="button" class="pulse-btn-compact" data-action="set-stamp" data-mode="smart" aria-pressed="${stampMode === 'smart' ? 'true' : 'false'}">smart</button>
          <button type="button" class="pulse-btn-compact" data-action="set-stamp" data-mode="every-turn" aria-pressed="${stampMode === 'every-turn' ? 'true' : 'false'}">every-turn</button>
          <button type="button" class="pulse-btn-compact" data-action="set-stamp" data-mode="off" aria-pressed="${stampMode === 'off' ? 'true' : 'false'}">off</button>
        </div>
      </div>
    </section>
  `;
}

function renderFuelBarHtml(snapshot: HudSnapshotResponse): string {
  const q = snapshot.quota;
  const g5Text = q.gemini5h
    ? `${formatPct(q.gemini5h.remainingPct, 1)} (${q.gemini5h.resetInLabel})`
    : '—';
  const gwText = q.geminiWeekly ? formatPct(q.geminiWeekly.remainingPct, 1) : '—';
  const tp5Text = q.thirdParty5h ? formatPct(q.thirdParty5h.remainingPct, 1) : '—';
  const g5Low = Boolean(q.gemini5h?.isLowAlert);

  return `
    <footer class="pulse-fuel-bar" data-testid="fuel-bar">
      <div class="pulse-fuel-lines tabular-nums">
        <div class="pulse-fuel-line">
          <span class="${g5Low ? 'pulse-quota-alert' : ''}" data-testid="fuel-gemini-5h">Gemini 5h: ${escapeHtml(g5Text)}</span>
          <span>· W: ${escapeHtml(gwText)}</span>
        </div>
        <div class="pulse-fuel-line">
          <span>Claude 5h: ${escapeHtml(tp5Text)}</span>
          <span>· 本树 ${escapeHtml(formatDeltaQuotaPct(q.treeNetDelta5hPct))}</span>
        </div>
      </div>
      <button
        type="button"
        class="pulse-btn-compact tabular-nums"
        data-action="cycle-stamp"
        data-testid="fuel-stamp-btn"
        title="Cycle inline stamp mode (smart / every-turn / off)"
      >Stamp: ${escapeHtml(snapshot.config.inlineStampMode)}</button>
    </footer>
  `;
}

function renderNodePopoverHtml(node: CascadeNodeView): string {
  return `
    <div class="pulse-popover-title">${escapeHtml(node.servedModel.displayName)}</div>
    <div class="pulse-popover-row">Requested: <code>${escapeHtml(node.requestedModel.raw || node.requestedModel.displayName)}</code> (${escapeHtml(node.requestedModel.source)})</div>
    <div class="pulse-popover-row">Model Enum: <code>${escapeHtml(node.servedModel.modelEnum || '—')}</code></div>
    <div class="pulse-popover-row">Response: <code>${escapeHtml(node.servedModel.responseModel || '—')}</code></div>
    <div class="pulse-popover-row">Routing: <code>${escapeHtml(node.routingStatus)}</code> · Retries: ${node.retryCount}</div>
    <div class="pulse-popover-row">TTFT: ${node.lastTtftMs !== null ? escapeHtml(formatDurationCompact(node.lastTtftMs)) : '—'} · Stream: ${node.lastStreamingMs !== null ? escapeHtml(formatDurationCompact(node.lastStreamingMs)) : '—'}</div>
  `;
}

export function createHudView(
  root: HTMLElement,
  bindings: HudRenderBindings
): HudViewController {
  root.innerHTML = `
    <div class="pulse-hud-shell">
      <header class="pulse-hud-header">
        <div class="pulse-topbar">
          <div role="tablist" aria-label="Model Pulse HUD views" class="pulse-tabs">
            <button role="tab" type="button" id="pulse-tab-overview" class="pulse-tab" data-tab="overview" aria-selected="true" tabindex="0">Overview 实时态</button>
            <button role="tab" type="button" id="pulse-tab-timeline" class="pulse-tab" data-tab="timeline" aria-selected="false" tabindex="-1">Timeline 调用轴</button>
            <button role="tab" type="button" id="pulse-tab-quota" class="pulse-tab" data-tab="quota" aria-selected="false" tabindex="-1">Quota 配额精算</button>
          </div>
          <div class="pulse-topbar-status tabular-nums" data-testid="connection-status">…</div>
        </div>
        <div data-slot="hero"></div>
      </header>
      <div class="pulse-hud-scroll">
        <section role="tabpanel" id="pulse-panel-overview" aria-labelledby="pulse-tab-overview" data-panel="overview"></section>
        <section role="tabpanel" id="pulse-panel-timeline" aria-labelledby="pulse-tab-timeline" data-panel="timeline" hidden></section>
        <section role="tabpanel" id="pulse-panel-quota" aria-labelledby="pulse-tab-quota" data-panel="quota" hidden></section>
      </div>
      <div data-slot="fuel"></div>
      <div id="pulse-node-popover" class="pulse-popover" popover="auto" role="tooltip"></div>
    </div>
  `;

  const tablistEl = root.querySelector<HTMLElement>('[role="tablist"]')!;
  const tabEls = new Map<HudTabId, HTMLButtonElement>();
  for (const tabId of TAB_ORDER) {
    const btn = root.querySelector<HTMLButtonElement>(`#pulse-tab-${tabId}`);
    if (btn) tabEls.set(tabId, btn);
  }
  const statusEl = root.querySelector<HTMLElement>('[data-testid="connection-status"]')!;
  const heroSlot = root.querySelector<HTMLElement>('[data-slot="hero"]')!;
  const overviewPanel = root.querySelector<HTMLElement>('#pulse-panel-overview')!;
  const timelinePanel = root.querySelector<HTMLElement>('#pulse-panel-timeline')!;
  const quotaPanel = root.querySelector<HTMLElement>('#pulse-panel-quota')!;
  const fuelSlot = root.querySelector<HTMLElement>('[data-slot="fuel"]')!;
  const popoverEl = root.querySelector<HTMLElement>('#pulse-node-popover')!;

  let lastSnapshot: HudSnapshotResponse | null = null;
  let lastActiveNodeId: string | null = null;
  let closeTimer: number | null = null;

  const clearCloseTimer = () => {
    if (closeTimer !== null) {
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }
  };

  const clearAnchorAttr = () => {
    const prev = root.querySelector<HTMLElement>('[data-popover-anchor="true"]');
    if (prev) {
      prev.removeAttribute('data-popover-anchor');
    }
  };

  const closePopover = () => {
    clearCloseTimer();
    clearAnchorAttr();
    popoverEl.style.removeProperty('position');
    popoverEl.style.removeProperty('left');
    popoverEl.style.removeProperty('top');
    popoverEl.style.removeProperty('right');
    popoverEl.style.removeProperty('bottom');
    const api = popoverEl as HTMLElement & { hidePopover?: () => void };
    if (typeof api.hidePopover === 'function') {
      try {
        if (popoverEl.matches(':popover-open')) {
          api.hidePopover();
        }
      } catch {
        // Ignore if not open
      }
    }
    popoverEl.removeAttribute('data-open');
    if (lastActiveNodeId !== null) {
      lastActiveNodeId = null;
      bindings.onInspectNode(null);
    }
  };

  const clampPopoverBounds = (anchorBtn: HTMLElement) => {
    window.requestAnimationFrame(() => {
      const rect = popoverEl.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 360;
      const vh = window.innerHeight || document.documentElement.clientHeight || 820;
      const anchorRect = anchorBtn.getBoundingClientRect();

      const outOfBounds =
        rect.width === 0 ||
        rect.right > vw - 8 ||
        rect.left < 8 ||
        rect.bottom > vh - 8 ||
        rect.top < 4;
      if (!outOfBounds) {
        return;
      }

      const maxWidth = Math.max(160, Math.min(312, vw - 16));
      const estWidth = rect.width > 0 ? Math.min(rect.width, maxWidth) : maxWidth;
      const estHeight = rect.height > 0 ? rect.height : 120;
      const clampedLeft = Math.max(8, Math.min(vw - estWidth - 8, anchorRect.right - estWidth));
      const fitsBelow = anchorRect.bottom + 6 + estHeight <= vh - 8;
      const clampedTop = fitsBelow
        ? anchorRect.bottom + 6
        : Math.max(8, anchorRect.top - estHeight - 6);

      popoverEl.style.position = 'fixed';
      popoverEl.style.left = `${Math.round(clampedLeft)}px`;
      popoverEl.style.top = `${Math.round(clampedTop)}px`;
      popoverEl.style.right = 'auto';
      popoverEl.style.bottom = 'auto';
    });
  };

  const openPopoverForButton = (btn: HTMLElement) => {
    clearCloseTimer();
    const nodeId = btn.getAttribute('data-node-id');
    if (!nodeId || !lastSnapshot) {
      return;
    }
    const node = lastSnapshot.treeNodes.find((n) => n.cascadeId === nodeId);
    if (!node) {
      return;
    }

    popoverEl.style.removeProperty('position');
    popoverEl.style.removeProperty('left');
    popoverEl.style.removeProperty('top');
    popoverEl.style.removeProperty('right');
    popoverEl.style.removeProperty('bottom');

    clearAnchorAttr();
    btn.setAttribute('data-popover-anchor', 'true');
    lastActiveNodeId = nodeId;
    bindings.onInspectNode(nodeId);
    popoverEl.innerHTML = renderNodePopoverHtml(node);

    const api = popoverEl as HTMLElement & { showPopover?: () => void };
    if (typeof api.showPopover === 'function') {
      try {
        if (!popoverEl.matches(':popover-open')) {
          api.showPopover();
        }
      } catch {
        popoverEl.setAttribute('data-open', 'true');
      }
    } else {
      popoverEl.setAttribute('data-open', 'true');
    }

    clampPopoverBounds(btn);
  };

  const schedulePopoverClose = () => {
    clearCloseTimer();
    closeTimer = window.setTimeout(() => {
      closePopover();
    }, 120);
  };

  const onTablistClick = (ev: MouseEvent) => {
    const target = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>('[role="tab"]');
    const tabId = target?.getAttribute('data-tab') as HudTabId | null;
    if (tabId && TAB_ORDER.includes(tabId)) {
      bindings.onTabChange(tabId);
    }
  };

  const onTablistKeyDown = (ev: KeyboardEvent) => {
    const currentBtn = (ev.target as HTMLElement | null)?.closest<HTMLButtonElement>('[role="tab"]');
    const currentId = currentBtn?.getAttribute('data-tab') as HudTabId | null;
    if (!currentId) {
      return;
    }
    const currentIndex = TAB_ORDER.indexOf(currentId);
    if (currentIndex === -1) {
      return;
    }

    let nextIndex = -1;
    if (ev.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    } else if (ev.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    } else if (ev.key === 'Home') {
      nextIndex = 0;
    } else if (ev.key === 'End') {
      nextIndex = TAB_ORDER.length - 1;
    }
    if (nextIndex === -1) {
      return;
    }

    ev.preventDefault();
    const nextId = TAB_ORDER[nextIndex];
    const nextBtn = tabEls.get(nextId);
    if (nextBtn) {
      nextBtn.focus();
      nextBtn.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    bindings.onTabChange(nextId);
  };

  const onRootClick = (ev: MouseEvent) => {
    const actionEl = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!actionEl) {
      return;
    }
    const action = actionEl.getAttribute('data-action');
    switch (action) {
      case 'set-sort': {
        const sort = actionEl.getAttribute('data-sort');
        if (sort === 'active-first' || sort === 'topology-tree') {
          bindings.onSetSortMode(sort);
        }
        break;
      }
      case 'toggle-idle-group':
        bindings.onToggleIdleGroup();
        break;
      case 'jump-node': {
        const cid = actionEl.getAttribute('data-cid');
        if (cid) {
          bindings.onJumpConversation(cid);
        }
        break;
      }
      case 'inspect-node':
        openPopoverForButton(actionEl);
        break;
      case 'cycle-stamp':
        bindings.onCycleStampMode();
        break;
      case 'set-stamp': {
        const mode = actionEl.getAttribute('data-mode') as InlineStampMode | null;
        if (mode === 'smart' || mode === 'every-turn' || mode === 'off') {
          bindings.onSetStampMode(mode);
        }
        break;
      }
      default:
        break;
    }
  };

  const onRootMouseOver = (ev: MouseEvent) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-action="inspect-node"]');
    if (btn) {
      openPopoverForButton(btn);
      return;
    }
    if ((ev.target as HTMLElement | null)?.closest('#pulse-node-popover')) {
      clearCloseTimer();
    }
  };

  const onRootMouseOut = (ev: MouseEvent) => {
    const fromBtn = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-action="inspect-node"]');
    const fromPopover = (ev.target as HTMLElement | null)?.closest<HTMLElement>('#pulse-node-popover');
    if (!fromBtn && !fromPopover) {
      return;
    }
    const related = ev.relatedTarget as HTMLElement | null;
    if (related?.closest('[data-action="inspect-node"]') || related?.closest('#pulse-node-popover')) {
      return;
    }
    schedulePopoverClose();
  };

  const onRootFocusIn = (ev: FocusEvent) => {
    const btn = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-action="inspect-node"]');
    if (btn) {
      openPopoverForButton(btn);
    }
  };

  const onRootFocusOut = (ev: FocusEvent) => {
    const fromBtn = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-action="inspect-node"]');
    if (!fromBtn) {
      return;
    }
    const nextFocus = ev.relatedTarget as HTMLElement | null;
    if (nextFocus?.closest('[data-action="inspect-node"]') || nextFocus?.closest('#pulse-node-popover')) {
      return;
    }
    schedulePopoverClose();
  };

  const onPopoverToggle = (ev: Event) => {
    const toggleEv = ev as ToggleEvent;
    if (toggleEv.newState === 'closed') {
      clearAnchorAttr();
      if (lastActiveNodeId !== null) {
        lastActiveNodeId = null;
        bindings.onInspectNode(null);
      }
    }
  };

  const onRootKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && lastActiveNodeId !== null) {
      closePopover();
    }
  };

  tablistEl.addEventListener('click', onTablistClick);
  tablistEl.addEventListener('keydown', onTablistKeyDown);
  root.addEventListener('click', onRootClick);
  root.addEventListener('mouseover', onRootMouseOver);
  root.addEventListener('mouseout', onRootMouseOut);
  root.addEventListener('focusin', onRootFocusIn);
  root.addEventListener('focusout', onRootFocusOut);
  root.addEventListener('keydown', onRootKeyDown);
  popoverEl.addEventListener('toggle', onPopoverToggle);

  const syncTabs = (activeTab: HudTabId) => {
    for (const tabId of TAB_ORDER) {
      const btn = tabEls.get(tabId);
      const selected = tabId === activeTab;
      if (btn) {
        btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        btn.tabIndex = selected ? 0 : -1;
      }
    }
    overviewPanel.hidden = activeTab !== 'overview';
    timelinePanel.hidden = activeTab !== 'timeline';
    quotaPanel.hidden = activeTab !== 'quota';
  };

  return {
    render(snapshot, uiState, snapshotReceivedAtMs) {
      lastSnapshot = snapshot;
      lastActiveNodeId = uiState.openPopoverNodeId;
      syncTabs(uiState.activeTab);

      if (!snapshot) {
        statusEl.textContent = 'Connecting';
        heroSlot.innerHTML = '';
        overviewPanel.innerHTML = '<p class="pulse-empty-note">正在连接 Model Pulse Sidecar…</p>';
        fuelSlot.innerHTML = '';
        return;
      }

      const nowMs = Date.now();
      statusEl.textContent = snapshot.hostConnected ? '● Live' : '○ Offline';
      heroSlot.innerHTML = renderHeroHtml(snapshot, nowMs, snapshotReceivedAtMs);
      overviewPanel.innerHTML = renderOverviewPanelHtml(
        snapshot,
        uiState,
        nowMs,
        snapshotReceivedAtMs
      );
      timelinePanel.innerHTML = renderTimelinePlaceholderHtml(snapshot);
      quotaPanel.innerHTML = renderQuotaPanelHtml(snapshot, uiState);
      fuelSlot.innerHTML = renderFuelBarHtml(snapshot);

      if (uiState.openPopoverNodeId) {
        const node = snapshot.treeNodes.find((n) => n.cascadeId === uiState.openPopoverNodeId);
        if (node) {
          popoverEl.innerHTML = renderNodePopoverHtml(node);
        } else {
          closePopover();
        }
      }
    },

    tickTimers(nowMs, snapshotReceivedAtMs) {
      const timerNodes = root.querySelectorAll<HTMLElement>('[data-live-timer="true"]');
      for (const el of timerNodes) {
        const phase = el.getAttribute('data-phase') as LifecyclePhase | null;
        if (!phase || !ACTIVE_PHASES.has(phase)) {
          continue;
        }
        const serverMs = Number(el.getAttribute('data-server-elapsed-ms') ?? '0');
        const nextText = formatDurationCompact(
          computeLivePhaseElapsed(serverMs, snapshotReceivedAtMs, nowMs)
        );
        if (el.textContent !== nextText) {
          el.textContent = nextText;
        }
      }

      const idleNodes = root.querySelectorAll<HTMLElement>('[data-idle-age="true"]');
      for (const el of idleNodes) {
        const lastMs = Number(el.getAttribute('data-last-modified-ms') ?? '');
        if (!Number.isFinite(lastMs) || lastMs <= 0) {
          continue;
        }
        const nextText = `上轮完成于 ${formatDurationCompact(Math.max(0, nowMs - lastMs))} 前`;
        if (el.textContent !== nextText) {
          el.textContent = nextText;
        }
      }
    },

    showLoading(message = '正在连接 Model Pulse Sidecar…') {
      statusEl.textContent = 'Connecting';
      overviewPanel.innerHTML = `<p class="pulse-empty-note">${escapeHtml(message)}</p>`;
    },

    showError(message) {
      statusEl.textContent = 'Error';
      overviewPanel.innerHTML = `<aside class="pulse-banner pulse-tier-alert" data-tier="alert" role="alert">${escapeHtml(message)}</aside>`;
    },

    destroy() {
      clearCloseTimer();
      tablistEl.removeEventListener('click', onTablistClick);
      tablistEl.removeEventListener('keydown', onTablistKeyDown);
      root.removeEventListener('click', onRootClick);
      root.removeEventListener('mouseover', onRootMouseOver);
      root.removeEventListener('mouseout', onRootMouseOut);
      root.removeEventListener('focusin', onRootFocusIn);
      root.removeEventListener('focusout', onRootFocusOut);
      root.removeEventListener('keydown', onRootKeyDown);
      popoverEl.removeEventListener('toggle', onPopoverToggle);
    },
  };
}
