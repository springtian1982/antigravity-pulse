import { escapeHtml } from '../core/formatters';
import type {
  HudSnapshotResponse,
  InlineStampMode,
  LifecyclePhase,
  PulseUserConfig,
  UnchangedEtagResponse,
} from '../types/telemetry';
import {
  createHudView,
  type HudTabId,
  type HudUiLocalState,
  type HudViewController,
} from './hud-view';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const STAMP_CYCLE: readonly InlineStampMode[] = ['smart', 'every-turn', 'off'];
const ACTIVE_PHASES = new Set<LifecyclePhase>([
  'PRE_FLIGHT',
  'THINKING',
  'STREAMING',
  'TOOL_RUNNING',
  'BLOCKED_APPROVAL',
]);

export type PulseViewMode = 'hud' | 'fleet';

export function resolvePulseViewMode(): PulseViewMode {
  const path = window.location.pathname;
  const search = new URLSearchParams(window.location.search);
  if (path === '/fleet' || path.startsWith('/fleet/') || search.get('view') === 'fleet') {
    return 'fleet';
  }
  return 'hud';
}

function resolveRequestedConversationId(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('conversationId')?.trim() ?? '';
  if (UUID_RE.test(fromQuery)) {
    return fromQuery;
  }
  const fromHost = window.sidecar?.conversationId?.trim() ?? '';
  if (UUID_RE.test(fromHost)) {
    return fromHost;
  }
  return null;
}

function isDocumentInitiallyHidden(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return true;
  }
  try {
    const entries = performance.getEntriesByType?.('visibility-state') as
      | Array<{ name?: string }>
      | undefined;
    if (entries && entries.length > 0 && entries[entries.length - 1]?.name === 'hidden') {
      return true;
    }
  } catch {
    // Ignore unsupported PerformanceVisibilityStateEntry implementations
  }
  return false;
}

async function sidecarFetch(url: string, init?: RequestInit): Promise<globalThis.Response> {
  if (window.sidecar && typeof window.sidecar.fetch === 'function') {
    return window.sidecar.fetch(url, init);
  }
  return window.fetch(url, init);
}

function computeAdaptivePollMs(snapshot: HudSnapshotResponse | null): number {
  if (!snapshot) {
    return 1500;
  }
  const hasRunning =
    (snapshot.activeNode && ACTIVE_PHASES.has(snapshot.activeNode.phase)) ||
    snapshot.treeNodes.some((node) => ACTIVE_PHASES.has(node.phase));
  return hasRunning ? 1000 : 2500;
}

function mountFleetPlaceholder(root: HTMLElement): () => void {
  const cid = resolveRequestedConversationId();
  root.innerHTML = `
    <div class="pulse-hud-shell">
      <section class="pulse-hero pulse-hud-hero" data-testid="fleet-placeholder" role="status">
        <div class="pulse-hero-phase-row">
          <div class="pulse-hero-phase-left">
            <span class="pulse-phase-dot" data-phase="idle"></span>
            <strong class="pulse-hero-phase-label">Pulse Fleet · 跨项目全局雷达</strong>
          </div>
          <span class="pulse-pill pulse-tier-orchestrator" data-tier="orchestrator">STAGE 2 SEAM</span>
        </div>
        <p class="pulse-empty-note">
          当前视图：/fleet${cid ? ` · Focus ${escapeHtml(cid.slice(0, 8))}` : ''}。
        </p>
        <p class="pulse-empty-note">
          Stage 2 将在此面板接入跨项目活跃 Cascade 汇总、模型分布直方图与 Top 5 配额消耗榜。
        </p>
      </section>
    </div>
  `;
  return () => {
    root.replaceChildren();
  };
}

export function mountPulseUi(root: HTMLElement): () => void {
  const viewMode = resolvePulseViewMode();
  if (viewMode === 'fleet') {
    return mountFleetPlaceholder(root);
  }

  let disposed = false;
  let paused = isDocumentInitiallyHidden();
  let lastSnapshot: HudSnapshotResponse | null = null;
  let snapshotReceivedAtMs = Date.now();
  let currentEtag: string | null = null;
  let pollTimer: number | null = null;
  let stopwatchTimer: number | null = null;
  let inFlightAbort: AbortController | null = null;
  let requestSeq = 0;

  const uiState: HudUiLocalState = {
    activeTab: 'overview',
    expandedIdleGroup: false,
    openPopoverNodeId: null,
    isUpdatingConfig: false,
    statusMessage: null,
  };

  let view: HudViewController;

  const renderCurrent = () => {
    if (!disposed) {
      view.render(lastSnapshot, uiState, snapshotReceivedAtMs);
    }
  };

  const clearTimers = () => {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (stopwatchTimer !== null) {
      window.clearInterval(stopwatchTimer);
      stopwatchTimer = null;
    }
  };

  const scheduleNextPoll = () => {
    if (disposed || paused) {
      return;
    }
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
    }
    const delayMs = computeAdaptivePollMs(lastSnapshot);
    pollTimer = window.setTimeout(() => {
      void pollOnce();
    }, delayMs);
  };

  const startStopwatch = () => {
    if (disposed || paused || stopwatchTimer !== null) {
      return;
    }
    stopwatchTimer = window.setInterval(() => {
      if (!disposed && !paused && lastSnapshot) {
        view.tickTimers(Date.now(), snapshotReceivedAtMs);
      }
    }, 100);
  };

  const pollOnce = async () => {
    if (disposed || paused) {
      return;
    }
    if (inFlightAbort) {
      inFlightAbort.abort();
    }
    const abortController = new AbortController();
    inFlightAbort = abortController;
    const seq = ++requestSeq;

    try {
      const params = new URLSearchParams();
      const requestedCid = resolveRequestedConversationId();
      if (requestedCid) {
        params.set('conversationId', requestedCid);
      }
      if (currentEtag) {
        params.set('etag', currentEtag);
      }
      const query = params.toString();
      const response = await sidecarFetch(`/api/hud${query ? `?${query}` : ''}`, {
        method: 'GET',
        signal: abortController.signal,
      });
      if (disposed || seq !== requestSeq) {
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as HudSnapshotResponse | UnchangedEtagResponse;
      if (disposed || seq !== requestSeq) {
        return;
      }
      if ('unchanged' in payload && payload.unchanged === true) {
        currentEtag = payload.etag;
        return;
      }
      lastSnapshot = payload;
      currentEtag = payload.etag;
      snapshotReceivedAtMs = Date.now();
      uiState.statusMessage = null;
      renderCurrent();
    } catch (err) {
      if (abortController.signal.aborted || disposed) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (!lastSnapshot) {
        view.showError(`无法读取 HUD 状态：${msg}`);
      } else {
        uiState.statusMessage = `刷新暂不可用 (${msg})`;
        renderCurrent();
      }
    } finally {
      if (inFlightAbort === abortController) {
        inFlightAbort = null;
      }
      scheduleNextPoll();
    }
  };

  const applyConfigPatch = async (
    patch: Partial<Pick<PulseUserConfig, 'hudSortMode' | 'inlineStampMode' | 'timelineScope'>>
  ) => {
    if (disposed) {
      return;
    }
    const previousConfig = lastSnapshot ? { ...lastSnapshot.config } : null;
    if (lastSnapshot) {
      lastSnapshot = {
        ...lastSnapshot,
        config: {
          ...lastSnapshot.config,
          ...patch,
        },
      };
    }
    currentEtag = null;
    uiState.isUpdatingConfig = true;
    uiState.statusMessage = null;
    renderCurrent();

    try {
      const response = await sidecarFetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const updatedConfig = (await response.json()) as PulseUserConfig;
      if (disposed) {
        return;
      }
      if (lastSnapshot) {
        lastSnapshot = {
          ...lastSnapshot,
          config: updatedConfig,
        };
      }
      uiState.isUpdatingConfig = false;
      renderCurrent();
      void pollOnce();
    } catch (err) {
      if (disposed) {
        return;
      }
      if (lastSnapshot && previousConfig) {
        lastSnapshot = {
          ...lastSnapshot,
          config: previousConfig,
        };
      }
      uiState.isUpdatingConfig = false;
      uiState.statusMessage = `配置保存失败: ${err instanceof Error ? err.message : String(err)}`;
      renderCurrent();
    }
  };

  view = createHudView(root, {
    onTabChange(tab: HudTabId) {
      if (uiState.activeTab !== tab) {
        uiState.activeTab = tab;
        renderCurrent();
      }
    },
    onSetSortMode(mode) {
      if (lastSnapshot?.config.hudSortMode === mode) {
        return;
      }
      void applyConfigPatch({ hudSortMode: mode });
    },
    onToggleIdleGroup() {
      uiState.expandedIdleGroup = !uiState.expandedIdleGroup;
      renderCurrent();
    },
    onJumpConversation(cid) {
      if (!UUID_RE.test(cid)) {
        return;
      }
      if (typeof window.sidecar?.ui?.toggleConversation === 'function') {
        window.sidecar.ui.toggleConversation(cid);
      } else {
        uiState.statusMessage = `宿主面板未挂载，无法切换至会话 ${cid.slice(0, 8)}`;
        renderCurrent();
      }
    },
    onInspectNode(nodeId) {
      uiState.openPopoverNodeId = nodeId;
    },
    onCycleStampMode() {
      const currentMode = lastSnapshot?.config.inlineStampMode ?? 'smart';
      const idx = STAMP_CYCLE.indexOf(currentMode);
      const nextMode = STAMP_CYCLE[(idx + 1) % STAMP_CYCLE.length];
      void applyConfigPatch({ inlineStampMode: nextMode });
    },
    onSetStampMode(mode) {
      if (lastSnapshot?.config.inlineStampMode === mode) {
        return;
      }
      void applyConfigPatch({ inlineStampMode: mode });
    },
  });

  const onVisibilityChange = () => {
    const nowHidden = document.visibilityState === 'hidden';
    if (nowHidden) {
      paused = true;
      clearTimers();
      inFlightAbort?.abort();
      return;
    }
    if (paused) {
      paused = false;
      startStopwatch();
      void pollOnce();
    }
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  view.showLoading();

  if (!paused) {
    startStopwatch();
    void pollOnce();
  }

  return () => {
    disposed = true;
    clearTimers();
    inFlightAbort?.abort();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    view.destroy();
  };
}
