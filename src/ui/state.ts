import type {
  FleetSnapshotResponse,
  HudSnapshotResponse,
  InlineStampMode,
  LifecyclePhase,
  PulseUserConfig,
  TimelineSnapshotResponse,
  UnchangedEtagResponse,
} from '../types/telemetry';
import {
  createFleetView,
  type FleetUiLocalState,
  type FleetViewController,
} from './fleet-view';
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

type SidecarWindowWithFocus = NonNullable<Window['sidecar']> & {
  focusConversation?: (conversationId: string) => void;
};

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

function jumpToConversation(cid: string, onFallback: (msg: string) => void): void {
  if (!UUID_RE.test(cid)) {
    return;
  }
  const bridge = window.sidecar as SidecarWindowWithFocus | undefined;
  if (typeof bridge?.focusConversation === 'function') {
    bridge.focusConversation(cid);
    return;
  }
  if (typeof bridge?.ui?.toggleConversation === 'function') {
    bridge.ui.toggleConversation(cid);
    return;
  }
  onFallback(`宿主面板未挂载，无法切换至会话 ${cid.slice(0, 8)}`);
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

function computeFleetAdaptivePollMs(snapshot: FleetSnapshotResponse | null): number {
  if (!snapshot) {
    return 1500;
  }
  return snapshot.activeHeadline.totalRunningNodes > 0 ? 1000 : 2500;
}

function mountFleetUi(root: HTMLElement): () => void {
  let disposed = false;
  let paused = isDocumentInitiallyHidden();
  let lastSnapshot: FleetSnapshotResponse | null = null;
  let snapshotReceivedAtMs = Date.now();
  let currentEtag: string | null = null;
  let pollTimer: number | null = null;
  let stopwatchTimer: number | null = null;
  let inFlightAbort: AbortController | null = null;
  let requestSeq = 0;

  const uiState: FleetUiLocalState = {
    expandedTreeIds: new Set<string>(),
    activeWorkspaceUris: [],
    statusMessage: null,
    isLoading: true,
  };

  let view: FleetViewController;

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
    const delayMs = computeFleetAdaptivePollMs(lastSnapshot);
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
      if (currentEtag) {
        params.set('etag', currentEtag);
      }
      const query = params.toString();
      const response = await sidecarFetch(`/api/fleet${query ? `?${query}` : ''}`, {
        method: 'GET',
        signal: abortController.signal,
      });
      if (disposed || seq !== requestSeq) {
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as FleetSnapshotResponse | UnchangedEtagResponse;
      if (disposed || seq !== requestSeq) {
        return;
      }
      if ('unchanged' in payload && payload.unchanged === true) {
        currentEtag = payload.etag;
        uiState.isLoading = false;
        return;
      }
      lastSnapshot = payload;
      currentEtag = payload.etag;
      snapshotReceivedAtMs = Date.now();
      uiState.isLoading = false;
      uiState.statusMessage = null;
      renderCurrent();
    } catch (err) {
      if (abortController.signal.aborted || disposed || seq !== requestSeq) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      uiState.isLoading = false;
      if (!lastSnapshot) {
        view.showError(`无法读取 Fleet 状态：${msg}`);
      } else {
        uiState.statusMessage = `集群刷新暂不可用 (${msg})`;
        renderCurrent();
      }
    } finally {
      if (inFlightAbort === abortController) {
        inFlightAbort = null;
      }
      scheduleNextPoll();
    }
  };

  view = createFleetView(root, {
    onToggleTree(rootCascadeId) {
      if (uiState.expandedTreeIds.has(rootCascadeId)) {
        uiState.expandedTreeIds.delete(rootCascadeId);
      } else {
        uiState.expandedTreeIds.add(rootCascadeId);
      }
      renderCurrent();
    },
    onJumpConversation(cid) {
      jumpToConversation(cid, (fallbackMsg) => {
        uiState.statusMessage = fallbackMsg;
        renderCurrent();
      });
    },
  });

  if (typeof window.sidecar?.getWorkspaceUris === 'function') {
    void window.sidecar
      .getWorkspaceUris()
      .then((uris) => {
        if (!disposed && Array.isArray(uris)) {
          uiState.activeWorkspaceUris = uris;
          if (lastSnapshot) {
            renderCurrent();
          }
        }
      })
      .catch(() => {
        // Ignore host workspace lookup failure outside Antigravity iframe
      });
  }

  const unsubscribeWorkspace =
    typeof window.sidecar?.onWorkspaceChange === 'function'
      ? window.sidecar.onWorkspaceChange((uris) => {
          if (!disposed && Array.isArray(uris)) {
            uiState.activeWorkspaceUris = uris;
            if (lastSnapshot) {
              renderCurrent();
            }
          }
        })
      : null;

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
    unsubscribeWorkspace?.();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    view.destroy();
  };
}

export function mountPulseUi(root: HTMLElement): () => void {
  const viewMode = resolvePulseViewMode();
  if (viewMode === 'fleet') {
    return mountFleetUi(root);
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

  let timelineEtag: string | null = null;
  let timelinePollTimer: number | null = null;
  let timelineAbort: AbortController | null = null;
  let timelineEpoch = 0;
  let lastTimelineCid: string | null = null;

  const uiState: HudUiLocalState = {
    activeTab: 'overview',
    expandedIdleGroup: false,
    openPopoverNodeId: null,
    isUpdatingConfig: false,
    statusMessage: null,
    timelineScope: null,
    timelineSnapshot: null,
    timelineLoading: false,
    timelineError: null,
  };

  let view: HudViewController;

  const renderCurrent = () => {
    if (!disposed) {
      view.render(lastSnapshot, uiState, snapshotReceivedAtMs);
    }
  };

  const clearTimelineTimerAndAbort = () => {
    if (timelinePollTimer !== null) {
      window.clearTimeout(timelinePollTimer);
      timelinePollTimer = null;
    }
    if (timelineAbort) {
      timelineAbort.abort();
      timelineAbort = null;
    }
    timelineEpoch += 1;
  };

  const clearTimers = () => {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (timelinePollTimer !== null) {
      window.clearTimeout(timelinePollTimer);
      timelinePollTimer = null;
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

  const scheduleNextTimelinePoll = () => {
    if (disposed || paused || uiState.activeTab !== 'timeline') {
      return;
    }
    if (timelinePollTimer !== null) {
      window.clearTimeout(timelinePollTimer);
    }
    const delayMs = computeAdaptivePollMs(lastSnapshot);
    timelinePollTimer = window.setTimeout(() => {
      void pollTimelineOnce();
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

  const resolveEffectiveTimelineCid = (): string | null => {
    return resolveRequestedConversationId() ?? lastSnapshot?.activeConversationId ?? null;
  };

  const resolveEffectiveTimelineScope = (): 'conversation' | 'tree' | null => {
    return uiState.timelineScope ?? lastSnapshot?.config.timelineScope ?? null;
  };

  const pollTimelineOnce = async () => {
    if (disposed || paused || uiState.activeTab !== 'timeline') {
      return;
    }
    if (timelineAbort) {
      timelineAbort.abort();
    }
    if (timelinePollTimer !== null) {
      window.clearTimeout(timelinePollTimer);
      timelinePollTimer = null;
    }
    const abortController = new AbortController();
    timelineAbort = abortController;
    const epoch = ++timelineEpoch;

    const effectiveCid = resolveEffectiveTimelineCid();
    const effectiveScope = resolveEffectiveTimelineScope();
    lastTimelineCid = effectiveCid;

    try {
      const params = new URLSearchParams();
      if (effectiveCid) {
        params.set('conversationId', effectiveCid);
      }
      if (effectiveScope) {
        params.set('scope', effectiveScope);
      }
      if (timelineEtag) {
        params.set('etag', timelineEtag);
      }
      const query = params.toString();
      const response = await sidecarFetch(`/api/timeline${query ? `?${query}` : ''}`, {
        method: 'GET',
        signal: abortController.signal,
      });
      if (disposed || epoch !== timelineEpoch || uiState.activeTab !== 'timeline') {
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as TimelineSnapshotResponse | UnchangedEtagResponse;
      if (disposed || epoch !== timelineEpoch || uiState.activeTab !== 'timeline') {
        return;
      }
      if ('unchanged' in payload && payload.unchanged === true) {
        timelineEtag = payload.etag;
        if (uiState.timelineLoading) {
          uiState.timelineLoading = false;
          renderCurrent();
        }
        return;
      }
      uiState.timelineSnapshot = payload;
      timelineEtag = payload.etag;
      uiState.timelineLoading = false;
      uiState.timelineError = null;
      if (!uiState.timelineScope) {
        uiState.timelineScope = payload.scope;
      }
      renderCurrent();
    } catch (err) {
      if (
        abortController.signal.aborted ||
        disposed ||
        epoch !== timelineEpoch ||
        uiState.activeTab !== 'timeline'
      ) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      uiState.timelineLoading = false;
      uiState.timelineError = `无法读取调用时间轴 (${msg})`;
      renderCurrent();
    } finally {
      if (timelineAbort === abortController) {
        timelineAbort = null;
      }
      scheduleNextTimelinePoll();
    }
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

      if (uiState.activeTab === 'timeline') {
        const nextTimelineCid = resolveEffectiveTimelineCid();
        if (nextTimelineCid !== lastTimelineCid) {
          timelineEtag = null;
          uiState.timelineLoading = true;
          void pollTimelineOnce();
        }
      }
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

  const applyTimelineScope = async (nextScope: 'conversation' | 'tree') => {
    if (disposed) {
      return;
    }
    const currentEffective = uiState.timelineScope ?? lastSnapshot?.config.timelineScope ?? 'tree';
    if (currentEffective === nextScope && uiState.timelineSnapshot?.scope === nextScope) {
      return;
    }
    uiState.timelineScope = nextScope;
    if (lastSnapshot) {
      lastSnapshot = {
        ...lastSnapshot,
        config: {
          ...lastSnapshot.config,
          timelineScope: nextScope,
        },
      };
    }
    timelineEtag = null;
    currentEtag = null;
    uiState.timelineLoading = true;
    uiState.timelineError = null;
    renderCurrent();

    if (uiState.activeTab === 'timeline' && !paused) {
      void pollTimelineOnce();
    }

    try {
      const response = await sidecarFetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timelineScope: nextScope }),
      });
      if (!disposed && response.ok) {
        const updatedConfig = (await response.json()) as PulseUserConfig;
        if (!disposed && lastSnapshot) {
          lastSnapshot = {
            ...lastSnapshot,
            config: updatedConfig,
          };
          renderCurrent();
        }
      }
    } catch {
      // Keep local scope toggle responsive in standalone browser preview without token
    }
  };

  view = createHudView(root, {
    onTabChange(tab: HudTabId) {
      if (uiState.activeTab !== tab) {
        uiState.activeTab = tab;
        if (tab === 'timeline') {
          timelineEtag = null;
          uiState.timelineLoading = true;
          uiState.timelineError = null;
          renderCurrent();
          if (!paused) {
            void pollTimelineOnce();
          }
        } else {
          clearTimelineTimerAndAbort();
          renderCurrent();
        }
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
      jumpToConversation(cid, (fallbackMsg) => {
        uiState.statusMessage = fallbackMsg;
        renderCurrent();
      });
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
    onSetTimelineScope(scope) {
      void applyTimelineScope(scope);
    },
  });

  const onVisibilityChange = () => {
    const nowHidden = document.visibilityState === 'hidden';
    if (nowHidden) {
      paused = true;
      clearTimers();
      inFlightAbort?.abort();
      timelineAbort?.abort();
      return;
    }
    if (paused) {
      paused = false;
      startStopwatch();
      void pollOnce();
      if (uiState.activeTab === 'timeline') {
        void pollTimelineOnce();
      }
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
    clearTimelineTimerAndAbort();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    view.destroy();
  };
}
