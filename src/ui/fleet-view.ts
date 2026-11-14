import {
  escapeHtml,
  formatDeltaQuotaPct,
  formatDurationCompact,
  formatPct,
  formatTokensCompact,
} from '../core/formatters';
import type {
  CascadeNodeView,
  FleetProjectGroup,
  FleetSnapshotResponse,
  FleetTreeSummary,
  LifecyclePhase,
  ModelTier,
  QuotaBucketView,
  QuotaBurnerEntry,
} from '../types/telemetry';

export interface FleetUiLocalState {
  expandedTreeIds: Set<string>;
  activeWorkspaceUris: string[];
  statusMessage: string | null;
  isLoading: boolean;
}

export interface FleetRenderBindings {
  onToggleTree(rootCascadeId: string): void;
  onJumpConversation(cid: string): void;
}

export interface FleetViewController {
  render(
    snapshot: FleetSnapshotResponse | null,
    uiState: FleetUiLocalState,
    snapshotReceivedAtMs: number
  ): void;
  tickTimers(nowMs: number, snapshotReceivedAtMs: number): void;
  showLoading(message?: string): void;
  showError(message: string): void;
  destroy(): void;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
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

function formatPhaseCompactLabel(phase: LifecyclePhase): string {
  switch (phase) {
    case 'PRE_FLIGHT':
      return 'Pre-flight';
    case 'THINKING':
      return 'Thinking';
    case 'STREAMING':
      return 'Streaming';
    case 'TOOL_RUNNING':
      return 'Tool';
    case 'BLOCKED_APPROVAL':
      return 'Approval';
    case 'ERROR_OR_QUOTA':
      return 'Error';
    case 'IDLE':
    default:
      return 'Idle';
  }
}

function normalizeWorkspaceUri(raw: string): string {
  return raw.trim().replace(/[\\/]+$/, '').toLowerCase();
}

function isProjectActiveWorkspace(
  projectUris: string[],
  activeWorkspaceUris: string[]
): boolean {
  if (projectUris.length === 0 || activeWorkspaceUris.length === 0) {
    return false;
  }
  const activeSet = new Set(activeWorkspaceUris.map(normalizeWorkspaceUri).filter(Boolean));
  return projectUris.some((uri) => activeSet.has(normalizeWorkspaceUri(uri)));
}

function clampProgressPct(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function computeLiveElapsedMs(
  serverElapsedMs: number,
  snapshotReceivedAtMs: number,
  nowMs: number
): number {
  const base = Number.isFinite(serverElapsedMs) && serverElapsedMs >= 0 ? serverElapsedMs : 0;
  const delta = Math.max(0, nowMs - snapshotReceivedAtMs);
  return base + delta;
}

function renderHeadlineHtml(snapshot: FleetSnapshotResponse): string {
  const { runningRoots, runningSubagents, totalRunningNodes, modelHistogram } =
    snapshot.activeHeadline;
  const isBusy = totalRunningNodes > 0;
  const headlineText = isBusy
    ? `🔥 活跃算力: ${runningRoots} 主会话 + ${runningSubagents} 子代理`
    : '💤 当前无运行中会话';
  const countPillTier: ModelTier = isBusy ? 'fast' : 'workhorse';

  const histogramHtml =
    modelHistogram.length > 0
      ? modelHistogram
          .map((item) => {
            const tier = sanitizeTier(item.tier);
            return `<span class="pulse-pill pulse-tier-${tier}" data-tier="${tier}"><span class="pulse-fleet-tier-dot" aria-hidden="true"></span><span class="pulse-btn-label">${escapeHtml(item.label)} ×${item.count}</span></span>`;
          })
          .join('')
      : '<span class="pulse-empty-note">暂无活跃模型分布</span>';

  return `
    <section class="pulse-hero pulse-fleet-headline" data-testid="fleet-headline">
      <div class="pulse-fleet-headline-top">
        <div class="pulse-fleet-headline-left">
          <h1 class="pulse-fleet-h1">Pulse Fleet</h1>
          <span class="pulse-phase-dot" data-phase="${isBusy ? 'streaming' : 'idle'}" aria-hidden="true"></span>
          <strong class="pulse-fleet-headline-text" data-testid="fleet-headline-summary">${escapeHtml(headlineText)}</strong>
        </div>
        <div class="pulse-fleet-headline-right tabular-nums">
          <span class="pulse-pill ${isBusy ? `pulse-tier-${countPillTier}` : ''}" ${isBusy ? `data-tier="${countPillTier}"` : ''} data-testid="fleet-total-active">${totalRunningNodes} active</span>
          <span class="pulse-topbar-status" data-testid="fleet-connection-status">${snapshot.hostConnected ? '● LS Live' : '○ Offline'}</span>
        </div>
      </div>
      <div class="pulse-fleet-histogram" data-testid="fleet-model-histogram">
        ${histogramHtml}
      </div>
    </section>
  `;
}

function renderDrawerNodeHtml(node: CascadeNodeView): string {
  const tier = sanitizeTier(node.servedModel.tier);
  const boundedDepth = Math.min(Math.max(0, node.depth), 3);
  const label =
    node.kind === 'swarm_member'
      ? node.swarmState?.memberName || node.role || node.title
      : node.role
        ? `${node.role} · ${node.title}`
        : node.title;
  const kindLabel =
    node.kind === 'root'
      ? 'Root'
      : node.kind === 'swarm_member'
        ? 'Swarm'
        : node.kind === 'workflow'
          ? 'Workflow'
          : 'Subagent';
  const canJump = UUID_RE.test(node.cascadeId);

  return `
    <li class="pulse-fleet-drawer-item" style="--pulse-depth: ${boundedDepth}">
      <div class="pulse-fleet-drawer-left">
        <span class="pulse-phase-dot" data-phase="${mapPhaseToDotAttr(node.phase)}" aria-hidden="true"></span>
        <span class="pulse-node-kind">${escapeHtml(kindLabel)}</span>
        <span class="pulse-fleet-drawer-title" title="${escapeHtml(label)}">${escapeHtml(label || node.cascadeId)}</span>
      </div>
      <div class="pulse-fleet-drawer-right">
        <span class="pulse-pill pulse-tier-${tier}" data-tier="${tier}" title="${escapeHtml(node.servedModel.displayName)}"><span class="pulse-btn-label">${escapeHtml(node.servedModel.displayName)}</span></span>
        ${
          canJump
            ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(node.cascadeId)}" title="Focus ${escapeHtml(label)}" aria-label="Focus ${escapeHtml(label)}">↗</button>`
            : ''
        }
      </div>
    </li>
  `;
}

function renderTreeCardHtml(
  tree: FleetTreeSummary,
  isExpanded: boolean,
  nowMs: number,
  snapshotReceivedAtMs: number
): string {
  const isRunning = tree.activeNodeCount > 0;
  const rootTier = sanitizeTier(tree.nodes[0]?.servedModel.tier);
  const canJumpRoot = UUID_RE.test(tree.rootCascadeId);
  const elapsedHtml = isRunning
    ? `<span class="pulse-live-timer tabular-nums" data-live-timer="true" data-running="true" data-server-elapsed-ms="${Math.max(0, Math.round(tree.elapsedMs))}">${escapeHtml(formatDurationCompact(computeLiveElapsedMs(tree.elapsedMs, snapshotReceivedAtMs, nowMs)))}</span>`
    : '<span class="pulse-empty-note">Idle</span>';

  const mixEntries = Object.entries(tree.modelMix ?? {});
  const mixHtml =
    mixEntries.length > 0
      ? mixEntries
          .map(
            ([label, count]) =>
              `<span class="pulse-fleet-mix-pill tabular-nums"><span class="pulse-btn-label">${escapeHtml(label)} ×${count}</span></span>`
          )
          .join('')
      : '<span class="pulse-empty-note">—</span>';

  const drawerHtml = isExpanded
    ? `<ul class="pulse-fleet-drawer" role="list" data-testid="fleet-tree-drawer">${tree.nodes
        .map((node) => renderDrawerNodeHtml(node))
        .join('')}</ul>`
    : '';

  return `
    <li class="pulse-fleet-tree-item">
      <article class="pulse-fleet-tree-card pulse-tier-${rootTier}" data-tier="${rootTier}" data-active="${isRunning ? 'true' : 'false'}" data-testid="fleet-tree-card" data-root-cid="${escapeHtml(tree.rootCascadeId)}">
        <div class="pulse-fleet-tree-row-1">
          <div class="pulse-fleet-tree-ident">
            <span class="pulse-phase-dot" data-phase="${mapPhaseToDotAttr(tree.rootPhase)}" aria-hidden="true"></span>
            <span class="pulse-fleet-tree-title" title="${escapeHtml(tree.rootTitle)}">${escapeHtml(tree.rootTitle || tree.rootCascadeId)}</span>
          </div>
          ${
            canJumpRoot
              ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(tree.rootCascadeId)}" title="Focus ${escapeHtml(tree.rootTitle)}" aria-label="Focus ${escapeHtml(tree.rootTitle)}">↗</button>`
              : ''
          }
        </div>
        <div class="pulse-fleet-tree-meta tabular-nums">
          <span class="pulse-node-kind">${escapeHtml(formatPhaseCompactLabel(tree.rootPhase))}</span>
          <span>${tree.activeNodeCount}/${tree.totalNodeCount} nodes</span>
          ${elapsedHtml}
          ${
            tree.treeDeltaQuota5hPct !== null
              ? `<span>Δ5h ${escapeHtml(formatDeltaQuotaPct(tree.treeDeltaQuota5hPct))}</span>`
              : ''
          }
        </div>
        <div class="pulse-fleet-tree-controls">
          <div class="pulse-fleet-mix-strip">${mixHtml}</div>
          <button
            type="button"
            class="pulse-btn-compact pulse-fleet-toggle-btn"
            data-action="toggle-tree"
            data-root-cid="${escapeHtml(tree.rootCascadeId)}"
            aria-expanded="${isExpanded ? 'true' : 'false'}"
          ><span class="pulse-btn-label">${isExpanded ? '▾' : '▸'} 节点 (${tree.nodes.length})</span></button>
        </div>
        ${drawerHtml}
      </article>
    </li>
  `;
}

function renderProjectGroupHtml(
  project: FleetProjectGroup,
  uiState: FleetUiLocalState,
  nowMs: number,
  snapshotReceivedAtMs: number
): string {
  const displayProjectName = project.projectName?.trim() || 'Workspace Unavailable';
  const isActiveWs = isProjectActiveWorkspace(
    project.workspaceUris,
    uiState.activeWorkspaceUris
  );
  const treesHtml =
    project.trees.length > 0
      ? `<ul class="pulse-fleet-tree-list" role="list">${project.trees
          .map((tree) =>
            renderTreeCardHtml(
              tree,
              uiState.expandedTreeIds.has(tree.rootCascadeId),
              nowMs,
              snapshotReceivedAtMs
            )
          )
          .join('')}</ul>`
      : '<p class="pulse-empty-note">暂无近期会话树。</p>';

  return `
    <article class="pulse-fleet-project-card" data-testid="fleet-project-card" data-project-key="${escapeHtml(project.projectKey)}">
      <div class="pulse-fleet-project-head">
        <div class="pulse-fleet-project-ident">
          <h3 class="pulse-project-title" title="${escapeHtml(displayProjectName)}">${escapeHtml(displayProjectName)}</h3>
          ${
            isActiveWs
              ? '<span class="pulse-pill pulse-tier-fast" data-tier="fast" data-testid="fleet-active-workspace-badge"><span class="pulse-btn-label">当前工作区</span></span>'
              : ''
          }
        </div>
        <span class="pulse-pill ${project.runningCount > 0 ? 'pulse-tier-workhorse' : ''} tabular-nums" ${project.runningCount > 0 ? 'data-tier="workhorse"' : ''}>${project.runningCount} running</span>
      </div>
      ${treesHtml}
    </article>
  `;
}

function renderBurnerRowHtml(entry: QuotaBurnerEntry): string {
  const burnerTier = sanitizeTier(entry.dominantTier);
  const consumedPct = Math.max(
    0,
    Number.isFinite(entry.consumed5hPct) ? entry.consumed5hPct : entry.delta5hPct
  );
  const canJump = UUID_RE.test(entry.rootCascadeId);
  const projectLabel = entry.projectName?.trim() || 'Workspace Unavailable';

  return `
    <li class="pulse-burner-row pulse-tier-${burnerTier}" data-tier="${burnerTier}" data-testid="fleet-burner-row" data-rank="${entry.rank}">
      <div class="pulse-burner-top">
        <div class="pulse-burner-ident">
          <span class="pulse-burner-rank tabular-nums">#${entry.rank}</span>
          <span class="pulse-phase-dot" data-phase="${entry.isRunning ? 'streaming' : 'idle'}" aria-hidden="true"></span>
          <span class="pulse-burner-title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title || entry.rootCascadeId)}</span>
        </div>
        ${
          canJump
            ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(entry.rootCascadeId)}" title="Focus ${escapeHtml(entry.title)}" aria-label="Focus ${escapeHtml(entry.title)}">↗</button>`
            : ''
        }
      </div>
      <div class="pulse-burner-meta tabular-nums">
        <span class="pulse-node-kind"><span class="pulse-btn-label">${escapeHtml(projectLabel)}</span></span>
        <span class="pulse-pill pulse-tier-${burnerTier}" data-tier="${burnerTier}" title="${escapeHtml(entry.dominantModel)}"><span class="pulse-btn-label">${escapeHtml(entry.dominantModel)}</span></span>
        <span class="pulse-burner-delta">${escapeHtml(formatDeltaQuotaPct(consumedPct))}</span>
        <span class="pulse-burner-tokens">${escapeHtml(formatTokensCompact(entry.totalTokens))} tok</span>
      </div>
    </li>
  `;
}

function renderFleetQuotaBucketHtml(label: string, bucket: QuotaBucketView | null): string {
  if (!bucket) {
    return `
      <div class="pulse-quota-card">
        <div class="pulse-health-meta">
          <span>${escapeHtml(label)}</span>
          <span class="tabular-nums">—</span>
        </div>
        <progress class="pulse-progress" data-level="normal" max="100" value="0" aria-label="${escapeHtml(label)}"></progress>
        <span class="pulse-empty-note">暂无配额数据</span>
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

function renderFleetFuelFooterHtml(snapshot: FleetSnapshotResponse): string {
  const q = snapshot.quota;
  const g5Text = q.gemini5h
    ? `${formatPct(q.gemini5h.remainingPct, 1)} (${q.gemini5h.resetInLabel})`
    : '—';
  const gwText = q.geminiWeekly ? formatPct(q.geminiWeekly.remainingPct, 1) : '—';
  const tp5Text = q.thirdParty5h
    ? `${formatPct(q.thirdParty5h.remainingPct, 1)} (${q.thirdParty5h.resetInLabel})`
    : '—';
  const g5Low = Boolean(q.gemini5h?.isLowAlert);

  return `
    <footer class="pulse-fuel-bar" data-testid="fleet-fuel-bar">
      <div class="pulse-fuel-lines tabular-nums">
        <div class="pulse-fuel-line">
          <span class="${g5Low ? 'pulse-quota-alert' : ''}">Gemini 5h: ${escapeHtml(g5Text)}</span>
          <span>· Weekly: ${escapeHtml(gwText)}</span>
        </div>
        <div class="pulse-fuel-line">
          <span>3P 5h: ${escapeHtml(tp5Text)}</span>
          <span>· Projects: ${snapshot.projects.length}</span>
        </div>
      </div>
    </footer>
  `;
}

export function createFleetView(
  root: HTMLElement,
  bindings: FleetRenderBindings
): FleetViewController {
  root.innerHTML = `
    <div class="pulse-fleet-shell" data-testid="fleet-shell">
      <div class="pulse-fleet-scroll" data-testid="fleet-scroll">
        <div class="pulse-fleet-grid" data-testid="fleet-grid"></div>
      </div>
      <div data-slot="fleet-fuel"></div>
    </div>
  `;

  const scrollEl = root.querySelector<HTMLElement>('.pulse-fleet-scroll')!;
  const gridEl = root.querySelector<HTMLElement>('.pulse-fleet-grid')!;
  const fuelSlot = root.querySelector<HTMLElement>('[data-slot="fleet-fuel"]')!;

  const onRootClick = (ev: MouseEvent) => {
    const actionEl = (ev.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!actionEl) {
      return;
    }
    const action = actionEl.getAttribute('data-action');
    if (action === 'toggle-tree') {
      const rootCid = actionEl.getAttribute('data-root-cid');
      if (rootCid) {
        bindings.onToggleTree(rootCid);
      }
      return;
    }
    if (action === 'jump-node') {
      const cid = actionEl.getAttribute('data-cid');
      if (cid) {
        bindings.onJumpConversation(cid);
      }
    }
  };

  root.addEventListener('click', onRootClick);

  return {
    render(snapshot, uiState, snapshotReceivedAtMs) {
      if (!snapshot) {
        gridEl.innerHTML = `
          <section class="pulse-hero pulse-fleet-headline" data-testid="fleet-headline">
            <h1 class="pulse-fleet-h1">Pulse Fleet</h1>
            <p class="pulse-empty-note">${uiState.isLoading ? '正在加载跨项目算力雷达…' : '暂无可用集群遥测数据。'}</p>
          </section>
        `;
        fuelSlot.innerHTML = '';
        return;
      }

      const prevScrollTop = scrollEl.scrollTop ?? 0;
      const nowMs = Date.now();
      const topBurners = snapshot.topQuotaBurners.slice(0, 5);

      const statusToastHtml = uiState.statusMessage
        ? `<p class="pulse-empty-note" role="status">${escapeHtml(uiState.statusMessage)}</p>`
        : '';

      const projectsHtml =
        snapshot.projects.length > 0
          ? snapshot.projects
              .map((proj) => renderProjectGroupHtml(proj, uiState, nowMs, snapshotReceivedAtMs))
              .join('')
          : '<div class="pulse-quota-card" data-testid="fleet-empty"><p class="pulse-empty-note">当前暂无活跃或近期 Cascade 会话树。</p></div>';

      const burnersHtml =
        topBurners.length > 0
          ? `<ol class="pulse-burner-list" data-testid="fleet-burner-list">${topBurners
              .map((entry) => renderBurnerRowHtml(entry))
              .join('')}</ol>`
          : '<div class="pulse-quota-card" data-testid="fleet-burners-empty"><p class="pulse-empty-note">5 小时窗口内暂无显著配额消耗记录</p></div>';

      gridEl.innerHTML = `
        ${renderHeadlineHtml(snapshot)}
        <section class="pulse-fleet-col-projects" data-testid="fleet-projects">
          <div class="pulse-section-head">
            <h2 class="pulse-section-title">Cross-Project Matrix (${snapshot.projects.length})</h2>
          </div>
          ${statusToastHtml}
          ${projectsHtml}
        </section>
        <div class="pulse-fleet-col-sidebar">
          <section class="pulse-fleet-burners" data-testid="fleet-burners">
            <div class="pulse-section-head">
              <h2 class="pulse-section-title">Top 5 Quota Burners</h2>
              <span class="pulse-empty-note">5h Window</span>
            </div>
            ${burnersHtml}
          </section>
          <section class="pulse-fleet-quota" data-testid="fleet-quota">
            <div class="pulse-section-head">
              <h2 class="pulse-section-title">Global Quota</h2>
            </div>
            <div class="pulse-fleet-quota-grid">
              ${renderFleetQuotaBucketHtml('Gemini 5h', snapshot.quota.gemini5h)}
              ${renderFleetQuotaBucketHtml('Gemini Weekly', snapshot.quota.geminiWeekly)}
              ${renderFleetQuotaBucketHtml('Claude / 3P 5h', snapshot.quota.thirdParty5h)}
              ${renderFleetQuotaBucketHtml('Claude / 3P Weekly', snapshot.quota.thirdPartyWeekly)}
            </div>
          </section>
        </div>
      `;

      fuelSlot.innerHTML = renderFleetFuelFooterHtml(snapshot);
      scrollEl.scrollTop = prevScrollTop;
    },

    tickTimers(nowMs, snapshotReceivedAtMs) {
      const timerNodes = root.querySelectorAll<HTMLElement>('[data-live-timer="true"]');
      for (const el of timerNodes) {
        if (el.getAttribute('data-running') !== 'true') {
          continue;
        }
        const serverMs = Number(el.getAttribute('data-server-elapsed-ms') ?? '0');
        const nextText = formatDurationCompact(
          computeLiveElapsedMs(serverMs, snapshotReceivedAtMs, nowMs)
        );
        if (el.textContent !== nextText) {
          el.textContent = nextText;
        }
      }
    },

    showLoading(message = '正在加载 Pulse Fleet 遥测侧车…') {
      gridEl.innerHTML = `
        <section class="pulse-hero pulse-fleet-headline" data-testid="fleet-headline">
          <h1 class="pulse-fleet-h1">Pulse Fleet</h1>
          <p class="pulse-empty-note">${escapeHtml(message)}</p>
        </section>
      `;
    },

    showError(message) {
      gridEl.innerHTML = `
        <section class="pulse-hero pulse-fleet-headline" data-testid="fleet-headline">
          <h1 class="pulse-fleet-h1">Pulse Fleet</h1>
          <aside class="pulse-banner pulse-tier-alert" data-tier="alert" role="alert">${escapeHtml(message)}</aside>
        </section>
      `;
    },

    destroy() {
      root.removeEventListener('click', onRootClick);
    },
  };
}
