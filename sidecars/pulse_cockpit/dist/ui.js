/* SPDX-License-Identifier: MIT | Copyright (c) 2026 springtian <springtian@gmail.com> */
"use strict";
(() => {
  // src/core/formatters.ts
  function formatDurationCompact(ms) {
    const safeMs = Number.isFinite(ms) && ms >= 0 ? ms : 0;
    const roundedMs = Math.round(safeMs);
    if (roundedMs < 1e3) {
      return `${roundedMs}ms`;
    }
    if (safeMs < 6e4) {
      return `${(safeMs / 1e3).toFixed(1)}s`;
    }
    if (safeMs < 36e5) {
      const mins2 = Math.floor(safeMs / 6e4);
      const secs = Math.floor(safeMs % 6e4 / 1e3);
      return `${mins2}m ${secs}s`;
    }
    const hours = Math.floor(safeMs / 36e5);
    const mins = Math.floor(safeMs % 36e5 / 6e4);
    return `${hours}h ${mins}m`;
  }
  function formatTokensCompact(tokens) {
    const safe = Number.isFinite(tokens) && tokens >= 0 ? tokens : 0;
    if (safe < 1e3) {
      return `${Math.round(safe)}`;
    }
    if (safe < 1e5) {
      const formatted = (safe / 1e3).toFixed(1).replace(/\.0$/, "");
      return `${formatted}k`;
    }
    if (safe < 1e6) {
      return `${Math.round(safe / 1e3)}k`;
    }
    return `${(safe / 1e6).toFixed(2)}M`;
  }
  function formatPct(pct, decimals = 1) {
    if (pct === null || pct === void 0 || !Number.isFinite(pct)) {
      return "\u2014";
    }
    return `${pct.toFixed(decimals)}%`;
  }
  function formatDeltaQuotaPct(consumedPct) {
    if (consumedPct === null || consumedPct === void 0 || !Number.isFinite(consumedPct)) {
      return "\u2014";
    }
    if (consumedPct <= 0) {
      return "0.00%";
    }
    const formatted = consumedPct.toFixed(2);
    return formatted === "0.00" ? "0.00%" : `-${formatted}%`;
  }
  function escapeHtml(raw) {
    const str = raw === null || raw === void 0 ? "" : String(raw);
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // src/ui/fleet-view.ts
  var UUID_RE = /^[0-9a-f-]{36}$/i;
  var VALID_TIERS = /* @__PURE__ */ new Set(["apex", "workhorse", "fast", "orchestrator", "alert"]);
  function sanitizeTier(tier) {
    return tier && VALID_TIERS.has(tier) ? tier : "workhorse";
  }
  function mapPhaseToDotAttr(phase) {
    switch (phase) {
      case "PRE_FLIGHT":
        return "pre_flight";
      case "THINKING":
        return "thinking";
      case "STREAMING":
        return "streaming";
      case "TOOL_RUNNING":
        return "scanning";
      case "BLOCKED_APPROVAL":
        return "waiting";
      case "ERROR_OR_QUOTA":
        return "error";
      case "IDLE":
      default:
        return "idle";
    }
  }
  function formatPhaseCompactLabel(phase) {
    switch (phase) {
      case "PRE_FLIGHT":
        return "Pre-flight";
      case "THINKING":
        return "Thinking";
      case "STREAMING":
        return "Streaming";
      case "TOOL_RUNNING":
        return "Tool";
      case "BLOCKED_APPROVAL":
        return "Approval";
      case "ERROR_OR_QUOTA":
        return "Error";
      case "IDLE":
      default:
        return "Idle";
    }
  }
  function normalizeWorkspaceUri(raw) {
    return raw.trim().replace(/[\\/]+$/, "").toLowerCase();
  }
  function isProjectActiveWorkspace(projectUris, activeWorkspaceUris) {
    if (projectUris.length === 0 || activeWorkspaceUris.length === 0) {
      return false;
    }
    const activeSet = new Set(activeWorkspaceUris.map(normalizeWorkspaceUri).filter(Boolean));
    return projectUris.some((uri) => activeSet.has(normalizeWorkspaceUri(uri)));
  }
  function clampProgressPct(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(100, value));
  }
  function computeLiveElapsedMs(serverElapsedMs, snapshotReceivedAtMs, nowMs) {
    const base = Number.isFinite(serverElapsedMs) && serverElapsedMs >= 0 ? serverElapsedMs : 0;
    const delta = Math.max(0, nowMs - snapshotReceivedAtMs);
    return base + delta;
  }
  function renderHeadlineHtml(snapshot) {
    const { runningRoots, runningSubagents, totalRunningNodes, modelHistogram } = snapshot.activeHeadline;
    const isBusy = totalRunningNodes > 0;
    const headlineText = isBusy ? `\u{1F525} \u6D3B\u8DC3\u7B97\u529B: ${runningRoots} \u4E3B\u4F1A\u8BDD + ${runningSubagents} \u5B50\u4EE3\u7406` : "\u{1F4A4} \u5F53\u524D\u65E0\u8FD0\u884C\u4E2D\u4F1A\u8BDD";
    const countPillTier = isBusy ? "fast" : "workhorse";
    const histogramHtml = modelHistogram.length > 0 ? modelHistogram.map((item) => {
      const tier = sanitizeTier(item.tier);
      return `<span class="pulse-pill pulse-tier-${tier}" data-tier="${tier}"><span class="pulse-fleet-tier-dot" aria-hidden="true"></span><span class="pulse-btn-label">${escapeHtml(item.label)} \xD7${item.count}</span></span>`;
    }).join("") : '<span class="pulse-empty-note">\u6682\u65E0\u6D3B\u8DC3\u6A21\u578B\u5206\u5E03</span>';
    return `
    <section class="pulse-hero pulse-fleet-headline" data-testid="fleet-headline">
      <div class="pulse-fleet-headline-top">
        <div class="pulse-fleet-headline-left">
          <h1 class="pulse-fleet-h1">Pulse Fleet</h1>
          <span class="pulse-phase-dot" data-phase="${isBusy ? "streaming" : "idle"}" aria-hidden="true"></span>
          <strong class="pulse-fleet-headline-text" data-testid="fleet-headline-summary">${escapeHtml(headlineText)}</strong>
        </div>
        <div class="pulse-fleet-headline-right tabular-nums">
          <span class="pulse-pill ${isBusy ? `pulse-tier-${countPillTier}` : ""}" ${isBusy ? `data-tier="${countPillTier}"` : ""} data-testid="fleet-total-active">${totalRunningNodes} active</span>
          <span class="pulse-topbar-status" data-testid="fleet-connection-status">${snapshot.hostConnected ? "\u25CF LS Live" : "\u25CB Offline"}</span>
        </div>
      </div>
      <div class="pulse-fleet-histogram" data-testid="fleet-model-histogram">
        ${histogramHtml}
      </div>
    </section>
  `;
  }
  function renderDrawerNodeHtml(node) {
    const tier = sanitizeTier(node.servedModel.tier);
    const boundedDepth = Math.min(Math.max(0, node.depth), 3);
    const label = node.kind === "swarm_member" ? node.swarmState?.memberName || node.role || node.title : node.role ? `${node.role} \xB7 ${node.title}` : node.title;
    const kindLabel = node.kind === "root" ? "Root" : node.kind === "swarm_member" ? "Swarm" : node.kind === "workflow" ? "Workflow" : "Subagent";
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
        ${canJump ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(node.cascadeId)}" title="Focus ${escapeHtml(label)}" aria-label="Focus ${escapeHtml(label)}">\u2197</button>` : ""}
      </div>
    </li>
  `;
  }
  function renderTreeCardHtml(tree, isExpanded, nowMs, snapshotReceivedAtMs) {
    const isRunning = tree.activeNodeCount > 0;
    const rootTier = sanitizeTier(tree.nodes[0]?.servedModel.tier);
    const canJumpRoot = UUID_RE.test(tree.rootCascadeId);
    const elapsedHtml = isRunning ? `<span class="pulse-live-timer tabular-nums" data-live-timer="true" data-running="true" data-server-elapsed-ms="${Math.max(0, Math.round(tree.elapsedMs))}">${escapeHtml(formatDurationCompact(computeLiveElapsedMs(tree.elapsedMs, snapshotReceivedAtMs, nowMs)))}</span>` : '<span class="pulse-empty-note">Idle</span>';
    const mixEntries = Object.entries(tree.modelMix ?? {});
    const mixHtml = mixEntries.length > 0 ? mixEntries.map(
      ([label, count]) => `<span class="pulse-fleet-mix-pill tabular-nums"><span class="pulse-btn-label">${escapeHtml(label)} \xD7${count}</span></span>`
    ).join("") : '<span class="pulse-empty-note">\u2014</span>';
    const drawerHtml = isExpanded ? `<ul class="pulse-fleet-drawer" role="list" data-testid="fleet-tree-drawer">${tree.nodes.map((node) => renderDrawerNodeHtml(node)).join("")}</ul>` : "";
    return `
    <li class="pulse-fleet-tree-item">
      <article class="pulse-fleet-tree-card pulse-tier-${rootTier}" data-tier="${rootTier}" data-active="${isRunning ? "true" : "false"}" data-testid="fleet-tree-card" data-root-cid="${escapeHtml(tree.rootCascadeId)}">
        <div class="pulse-fleet-tree-row-1">
          <div class="pulse-fleet-tree-ident">
            <span class="pulse-phase-dot" data-phase="${mapPhaseToDotAttr(tree.rootPhase)}" aria-hidden="true"></span>
            <span class="pulse-fleet-tree-title" title="${escapeHtml(tree.rootTitle)}">${escapeHtml(tree.rootTitle || tree.rootCascadeId)}</span>
          </div>
          ${canJumpRoot ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(tree.rootCascadeId)}" title="Focus ${escapeHtml(tree.rootTitle)}" aria-label="Focus ${escapeHtml(tree.rootTitle)}">\u2197</button>` : ""}
        </div>
        <div class="pulse-fleet-tree-meta tabular-nums">
          <span class="pulse-node-kind">${escapeHtml(formatPhaseCompactLabel(tree.rootPhase))}</span>
          <span>${tree.activeNodeCount}/${tree.totalNodeCount} nodes</span>
          ${elapsedHtml}
          ${tree.treeDeltaQuota5hPct !== null ? `<span>\u03945h ${escapeHtml(formatDeltaQuotaPct(tree.treeDeltaQuota5hPct))}</span>` : ""}
        </div>
        <div class="pulse-fleet-tree-controls">
          <div class="pulse-fleet-mix-strip">${mixHtml}</div>
          <button
            type="button"
            class="pulse-btn-compact pulse-fleet-toggle-btn"
            data-action="toggle-tree"
            data-root-cid="${escapeHtml(tree.rootCascadeId)}"
            aria-expanded="${isExpanded ? "true" : "false"}"
          ><span class="pulse-btn-label">${isExpanded ? "\u25BE" : "\u25B8"} \u8282\u70B9 (${tree.nodes.length})</span></button>
        </div>
        ${drawerHtml}
      </article>
    </li>
  `;
  }
  function renderProjectGroupHtml(project, uiState, nowMs, snapshotReceivedAtMs) {
    const displayProjectName = project.projectName?.trim() || "Workspace Unavailable";
    const isActiveWs = isProjectActiveWorkspace(
      project.workspaceUris,
      uiState.activeWorkspaceUris
    );
    const treesHtml = project.trees.length > 0 ? `<ul class="pulse-fleet-tree-list" role="list">${project.trees.map(
      (tree) => renderTreeCardHtml(
        tree,
        uiState.expandedTreeIds.has(tree.rootCascadeId),
        nowMs,
        snapshotReceivedAtMs
      )
    ).join("")}</ul>` : '<p class="pulse-empty-note">\u6682\u65E0\u8FD1\u671F\u4F1A\u8BDD\u6811\u3002</p>';
    return `
    <article class="pulse-fleet-project-card" data-testid="fleet-project-card" data-project-key="${escapeHtml(project.projectKey)}">
      <div class="pulse-fleet-project-head">
        <div class="pulse-fleet-project-ident">
          <h3 class="pulse-project-title" title="${escapeHtml(displayProjectName)}">${escapeHtml(displayProjectName)}</h3>
          ${isActiveWs ? '<span class="pulse-pill pulse-tier-fast" data-tier="fast" data-testid="fleet-active-workspace-badge"><span class="pulse-btn-label">\u5F53\u524D\u5DE5\u4F5C\u533A</span></span>' : ""}
        </div>
        <span class="pulse-pill ${project.runningCount > 0 ? "pulse-tier-workhorse" : ""} tabular-nums" ${project.runningCount > 0 ? 'data-tier="workhorse"' : ""}>${project.runningCount} running</span>
      </div>
      ${treesHtml}
    </article>
  `;
  }
  function renderBurnerRowHtml(entry) {
    const burnerTier = sanitizeTier(entry.dominantTier);
    const consumedPct = Math.max(
      0,
      Number.isFinite(entry.consumed5hPct) ? entry.consumed5hPct : entry.delta5hPct
    );
    const canJump = UUID_RE.test(entry.rootCascadeId);
    const projectLabel = entry.projectName?.trim() || "Workspace Unavailable";
    return `
    <li class="pulse-burner-row pulse-tier-${burnerTier}" data-tier="${burnerTier}" data-testid="fleet-burner-row" data-rank="${entry.rank}">
      <div class="pulse-burner-top">
        <div class="pulse-burner-ident">
          <span class="pulse-burner-rank tabular-nums">#${entry.rank}</span>
          <span class="pulse-phase-dot" data-phase="${entry.isRunning ? "streaming" : "idle"}" aria-hidden="true"></span>
          <span class="pulse-burner-title" title="${escapeHtml(entry.title)}">${escapeHtml(entry.title || entry.rootCascadeId)}</span>
        </div>
        ${canJump ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(entry.rootCascadeId)}" title="Focus ${escapeHtml(entry.title)}" aria-label="Focus ${escapeHtml(entry.title)}">\u2197</button>` : ""}
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
  function renderFleetQuotaBucketHtml(label, bucket) {
    if (!bucket) {
      return `
      <div class="pulse-quota-card">
        <div class="pulse-health-meta">
          <span>${escapeHtml(label)}</span>
          <span class="tabular-nums">\u2014</span>
        </div>
        <progress class="pulse-progress" data-level="normal" max="100" value="0" aria-label="${escapeHtml(label)}"></progress>
        <span class="pulse-empty-note">\u6682\u65E0\u914D\u989D\u6570\u636E</span>
      </div>
    `;
    }
    const level = bucket.isLowAlert || bucket.remainingPct < 15 ? "critical_85" : bucket.remainingPct < 40 ? "warn_70" : "normal";
    return `
    <div class="pulse-quota-card">
      <div class="pulse-health-meta">
        <span>${escapeHtml(label)}</span>
        <span class="tabular-nums ${bucket.isLowAlert ? "pulse-quota-alert" : ""}">${escapeHtml(formatPct(bucket.remainingPct, 1))}</span>
      </div>
      <progress class="pulse-progress" data-level="${level}" max="100" value="${clampProgressPct(bucket.remainingPct).toFixed(1)}" aria-label="${escapeHtml(label)}"></progress>
      <div class="pulse-health-meta tabular-nums">
        <span>${escapeHtml(bucket.bucketId)}</span>
        <span>Reset: ${escapeHtml(bucket.resetInLabel)}</span>
      </div>
    </div>
  `;
  }
  function renderFleetFuelFooterHtml(snapshot) {
    const q = snapshot.quota;
    const g5Text = q.gemini5h ? `${formatPct(q.gemini5h.remainingPct, 1)} (${q.gemini5h.resetInLabel})` : "\u2014";
    const gwText = q.geminiWeekly ? formatPct(q.geminiWeekly.remainingPct, 1) : "\u2014";
    const tp5Text = q.thirdParty5h ? `${formatPct(q.thirdParty5h.remainingPct, 1)} (${q.thirdParty5h.resetInLabel})` : "\u2014";
    const g5Low = Boolean(q.gemini5h?.isLowAlert);
    return `
    <footer class="pulse-fuel-bar" data-testid="fleet-fuel-bar">
      <div class="pulse-fuel-lines tabular-nums">
        <div class="pulse-fuel-line">
          <span class="${g5Low ? "pulse-quota-alert" : ""}">Gemini 5h: ${escapeHtml(g5Text)}</span>
          <span>\xB7 Weekly: ${escapeHtml(gwText)}</span>
        </div>
        <div class="pulse-fuel-line">
          <span>3P 5h: ${escapeHtml(tp5Text)}</span>
          <span>\xB7 Projects: ${snapshot.projects.length}</span>
        </div>
      </div>
    </footer>
  `;
  }
  function createFleetView(root, bindings) {
    root.innerHTML = `
    <div class="pulse-fleet-shell" data-testid="fleet-shell">
      <div class="pulse-fleet-scroll" data-testid="fleet-scroll">
        <div class="pulse-fleet-grid" data-testid="fleet-grid"></div>
      </div>
      <div data-slot="fleet-fuel"></div>
    </div>
  `;
    const scrollEl = root.querySelector(".pulse-fleet-scroll");
    const gridEl = root.querySelector(".pulse-fleet-grid");
    const fuelSlot = root.querySelector('[data-slot="fleet-fuel"]');
    const onRootClick = (ev) => {
      const actionEl = ev.target?.closest("[data-action]");
      if (!actionEl) {
        return;
      }
      const action = actionEl.getAttribute("data-action");
      if (action === "toggle-tree") {
        const rootCid = actionEl.getAttribute("data-root-cid");
        if (rootCid) {
          bindings.onToggleTree(rootCid);
        }
        return;
      }
      if (action === "jump-node") {
        const cid = actionEl.getAttribute("data-cid");
        if (cid) {
          bindings.onJumpConversation(cid);
        }
      }
    };
    root.addEventListener("click", onRootClick);
    return {
      render(snapshot, uiState, snapshotReceivedAtMs) {
        if (!snapshot) {
          gridEl.innerHTML = `
          <section class="pulse-hero pulse-fleet-headline" data-testid="fleet-headline">
            <h1 class="pulse-fleet-h1">Pulse Fleet</h1>
            <p class="pulse-empty-note">${uiState.isLoading ? "\u6B63\u5728\u52A0\u8F7D\u8DE8\u9879\u76EE\u7B97\u529B\u96F7\u8FBE\u2026" : "\u6682\u65E0\u53EF\u7528\u96C6\u7FA4\u9065\u6D4B\u6570\u636E\u3002"}</p>
          </section>
        `;
          fuelSlot.innerHTML = "";
          return;
        }
        const prevScrollTop = scrollEl.scrollTop ?? 0;
        const nowMs = Date.now();
        const topBurners = snapshot.topQuotaBurners.slice(0, 5);
        const statusToastHtml = uiState.statusMessage ? `<p class="pulse-empty-note" role="status">${escapeHtml(uiState.statusMessage)}</p>` : "";
        const projectsHtml = snapshot.projects.length > 0 ? snapshot.projects.map((proj) => renderProjectGroupHtml(proj, uiState, nowMs, snapshotReceivedAtMs)).join("") : '<div class="pulse-quota-card" data-testid="fleet-empty"><p class="pulse-empty-note">\u5F53\u524D\u6682\u65E0\u6D3B\u8DC3\u6216\u8FD1\u671F Cascade \u4F1A\u8BDD\u6811\u3002</p></div>';
        const burnersHtml = topBurners.length > 0 ? `<ol class="pulse-burner-list" data-testid="fleet-burner-list">${topBurners.map((entry) => renderBurnerRowHtml(entry)).join("")}</ol>` : '<div class="pulse-quota-card" data-testid="fleet-burners-empty"><p class="pulse-empty-note">5 \u5C0F\u65F6\u7A97\u53E3\u5185\u6682\u65E0\u663E\u8457\u914D\u989D\u6D88\u8017\u8BB0\u5F55</p></div>';
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
              ${renderFleetQuotaBucketHtml("Gemini 5h", snapshot.quota.gemini5h)}
              ${renderFleetQuotaBucketHtml("Gemini Weekly", snapshot.quota.geminiWeekly)}
              ${renderFleetQuotaBucketHtml("Claude / 3P 5h", snapshot.quota.thirdParty5h)}
              ${renderFleetQuotaBucketHtml("Claude / 3P Weekly", snapshot.quota.thirdPartyWeekly)}
            </div>
          </section>
        </div>
      `;
        fuelSlot.innerHTML = renderFleetFuelFooterHtml(snapshot);
        scrollEl.scrollTop = prevScrollTop;
      },
      tickTimers(nowMs, snapshotReceivedAtMs) {
        const timerNodes = root.querySelectorAll('[data-live-timer="true"]');
        for (const el of timerNodes) {
          if (el.getAttribute("data-running") !== "true") {
            continue;
          }
          const serverMs = Number(el.getAttribute("data-server-elapsed-ms") ?? "0");
          const nextText = formatDurationCompact(
            computeLiveElapsedMs(serverMs, snapshotReceivedAtMs, nowMs)
          );
          if (el.textContent !== nextText) {
            el.textContent = nextText;
          }
        }
      },
      showLoading(message = "\u6B63\u5728\u52A0\u8F7D Pulse Fleet \u9065\u6D4B\u4FA7\u8F66\u2026") {
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
        root.removeEventListener("click", onRootClick);
      }
    };
  }

  // src/core/timeline-builder.ts
  var OVERTHINKING_RATIO_THRESHOLD_PCT = 75;
  var OVERTHINKING_SHORT_RESPONSE_MAX_TOKENS = 500;
  function isOverthinkingTurn(turn) {
    return turn.outputTokens > 0 && turn.thinkingRatioPct >= OVERTHINKING_RATIO_THRESHOLD_PCT && (turn.responseOutputTokens <= OVERTHINKING_SHORT_RESPONSE_MAX_TOKENS || turn.tier === "apex");
  }

  // src/ui/hud-view.ts
  var UUID_RE2 = /^[0-9a-f-]{36}$/i;
  var TAB_ORDER = ["overview", "timeline", "quota"];
  var ACTIVE_PHASES = /* @__PURE__ */ new Set([
    "PRE_FLIGHT",
    "THINKING",
    "STREAMING",
    "TOOL_RUNNING",
    "BLOCKED_APPROVAL"
  ]);
  var PHASE_PRIORITY = {
    BLOCKED_APPROVAL: 0,
    ERROR_OR_QUOTA: 1,
    TOOL_RUNNING: 2,
    STREAMING: 3,
    THINKING: 4,
    PRE_FLIGHT: 5,
    IDLE: 6
  };
  var VALID_TIERS2 = /* @__PURE__ */ new Set(["apex", "workhorse", "fast", "orchestrator", "alert"]);
  function sanitizeTier2(tier) {
    return tier && VALID_TIERS2.has(tier) ? tier : "workhorse";
  }
  function mapPhaseToDotAttr2(phase) {
    switch (phase) {
      case "PRE_FLIGHT":
        return "pre_flight";
      case "THINKING":
        return "thinking";
      case "STREAMING":
        return "streaming";
      case "TOOL_RUNNING":
        return "scanning";
      case "BLOCKED_APPROVAL":
        return "waiting";
      case "ERROR_OR_QUOTA":
        return "error";
      case "IDLE":
      default:
        return "idle";
    }
  }
  function formatEffortTag(effort) {
    switch (effort) {
      case "xhigh":
        return "XHIGH";
      case "high":
        return "HIGH";
      case "medium":
        return "MEDIUM";
      case "low":
        return "LOW";
      case "flash":
        return "FLASH";
      case "auto":
        return "AUTO";
      case "unknown":
      default:
        return "MODEL";
    }
  }
  function clampProgressPct2(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.min(100, value));
  }
  function computeLivePhaseElapsed(serverElapsedMs, snapshotReceivedAtMs, nowMs) {
    const base = Number.isFinite(serverElapsedMs) && serverElapsedMs >= 0 ? serverElapsedMs : 0;
    const delta = Math.max(0, nowMs - snapshotReceivedAtMs);
    return base + delta;
  }
  function formatIdleAgeText(lastModifiedIso, nowMs) {
    if (!lastModifiedIso) {
      return "\u4E0A\u8F6E\u5DF2\u7ED3\u675F";
    }
    const ts = Date.parse(lastModifiedIso);
    if (!Number.isFinite(ts)) {
      return "\u4E0A\u8F6E\u5DF2\u7ED3\u675F";
    }
    const ageMs = Math.max(0, nowMs - ts);
    return `\u4E0A\u8F6E\u5B8C\u6210\u4E8E ${formatDurationCompact(ageMs)} \u524D`;
  }
  function formatHeroPhaseText(node, nowMs, snapshotReceivedAtMs) {
    const liveMs = computeLivePhaseElapsed(node.phaseElapsedMs, snapshotReceivedAtMs, nowMs);
    const timerAttrs = `data-live-timer="true" data-phase="${escapeHtml(node.phase)}" data-server-elapsed-ms="${Math.max(0, Math.round(node.phaseElapsedMs))}"`;
    switch (node.phase) {
      case "PRE_FLIGHT":
        return {
          labelHtml: '<span class="pulse-hero-phase-label">Pre-flight</span>',
          timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`
        };
      case "THINKING":
        return {
          labelHtml: '<span class="pulse-hero-phase-label">Thinking</span>',
          timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`
        };
      case "STREAMING": {
        const rateText = node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec) ? ` \xB7 ${Math.round(node.streamingTokPerSec)} tok/s` : "";
        return {
          labelHtml: `<span class="pulse-hero-phase-label">Streaming${escapeHtml(rateText)}</span>`,
          timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`
        };
      }
      case "TOOL_RUNNING": {
        const toolName = node.lastTool?.name ? node.lastTool.name : "tool";
        return {
          labelHtml: `<span class="pulse-hero-phase-label">Tool: ${escapeHtml(toolName)}</span>`,
          timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`
        };
      }
      case "BLOCKED_APPROVAL":
        return {
          labelHtml: '<span class="pulse-hero-phase-label">\u7B49\u5F85\u5BA1\u6279</span>',
          timerHtml: `<span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`
        };
      case "ERROR_OR_QUOTA":
        return {
          labelHtml: '<span class="pulse-hero-phase-label">Error / Quota</span>',
          timerHtml: '<span class="pulse-live-timer tabular-nums">\u26A0</span>'
        };
      case "IDLE":
      default: {
        const lastMs = Date.parse(node.lastModifiedTime);
        const lastAttr = Number.isFinite(lastMs) ? `data-last-modified-ms="${lastMs}"` : "";
        return {
          labelHtml: '<span class="pulse-hero-phase-label">Idle</span>',
          timerHtml: `<span class="pulse-live-timer tabular-nums" data-idle-age="true" ${lastAttr}>${escapeHtml(formatIdleAgeText(node.lastModifiedTime, nowMs))}</span>`
        };
      }
    }
  }
  function renderHeroHtml(snapshot, nowMs, snapshotReceivedAtMs) {
    const activeNode = snapshot.activeNode;
    if (!activeNode) {
      const fallbackNote = snapshot.hostConnected ? "\u7B49\u5F85\u4F1A\u8BDD\u6D3B\u52A8" : "Language Server \u672A\u8FDE\u63A5";
      return `
      <section class="pulse-hero pulse-hud-hero" data-testid="hud-hero">
        <div class="pulse-hero-phase-row">
          <div class="pulse-hero-phase-left">
            <span class="pulse-phase-dot" data-phase="idle"></span>
            <span class="pulse-hero-phase-label">Idle \xB7 \u672A\u68C0\u6D4B\u5230\u6D3B\u8DC3\u4F1A\u8BDD</span>
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
    const parentCid = activeNode.parentCascadeId && UUID_RE2.test(activeNode.parentCascadeId) ? activeNode.parentCascadeId : snapshot.breadcrumb.length > 1 && UUID_RE2.test(snapshot.breadcrumb[0].cascadeId) ? snapshot.breadcrumb[0].cascadeId : null;
    const showBreadcrumb = Boolean(activeNode.parentCascadeId || snapshot.breadcrumb.length > 1);
    const breadcrumbText = snapshot.breadcrumb.length > 0 ? snapshot.breadcrumb.map((item) => item.role || item.title).filter(Boolean).join(" \u203A ") : `${activeNode.role ?? activeNode.title}`;
    const phaseParts = formatHeroPhaseText(activeNode, nowMs, snapshotReceivedAtMs);
    const showRouteArrow = activeNode.routingStatus === "routed" || activeNode.routingStatus === "mismatch_or_fallback" || activeNode.requestedModel.displayName && activeNode.requestedModel.displayName !== activeNode.servedModel.displayName;
    const nameplateText = showRouteArrow ? `${activeNode.requestedModel.displayName} \u2794 ${activeNode.servedModel.displayName}` : activeNode.servedModel.displayName;
    const heroTier = sanitizeTier2(activeNode.servedModel.tier);
    const rightAlertHtml = activeNode.retryCount > 0 ? `<span class="pulse-pill pulse-tier-alert" data-tier="alert">\u26A0 Retried \xD7${activeNode.retryCount}</span>` : activeNode.routingStatus === "mismatch_or_fallback" ? `<span class="pulse-pill pulse-tier-alert" data-tier="alert">\u26A0 Fallback \u2794 ${escapeHtml(activeNode.servedModel.displayName)}</span>` : activeNode.routingStatus === "matched" ? `<span class="pulse-hero-model-id" title="${escapeHtml(activeNode.servedModel.responseModel)}">\u2713 ${escapeHtml(activeNode.servedModel.responseModel)}</span>` : `<span class="pulse-hero-model-id" title="${escapeHtml(activeNode.servedModel.responseModel)}">${escapeHtml(activeNode.servedModel.responseModel)}</span>`;
    const ctx = activeNode.contextWindow;
    const ctxSummary = ctx.maxContextTokens > 0 ? `${formatTokensCompact(ctx.estimatedTokensUsed)} / ${formatTokensCompact(ctx.maxContextTokens)}` : `${formatTokensCompact(ctx.estimatedTokensUsed)} / \u2014`;
    const ctxPctText = ctx.maxContextTokens > 0 ? formatPct(ctx.pct, 1) : "\u2014";
    return `
    <section class="pulse-hero pulse-hud-hero" data-testid="hud-hero">
      ${showBreadcrumb ? `<div class="pulse-breadcrumb-row" data-testid="hero-breadcrumb">
              <span class="pulse-breadcrumb-path" title="${escapeHtml(breadcrumbText)}">${escapeHtml(breadcrumbText)}</span>
              ${parentCid ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(parentCid)}">\u2190 \u7236\u4F1A\u8BDD</button>` : ""}
            </div>` : ""}
      <div class="pulse-hero-phase-row">
        <div class="pulse-hero-phase-left">
          <span class="pulse-phase-dot" data-phase="${mapPhaseToDotAttr2(activeNode.phase)}"></span>
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
          <progress class="pulse-progress" data-level="${escapeHtml(ctx.level)}" max="100" value="${clampProgressPct2(ctx.pct).toFixed(1)}" aria-label="Context window usage"></progress>
        </div>
        <div class="pulse-health-cell">
          <div class="pulse-health-meta tabular-nums">
            <span>Cache Hit</span>
            <span>${escapeHtml(formatPct(activeNode.cacheHitPct, 1))}</span>
          </div>
          <progress class="pulse-progress" data-level="normal" max="100" value="${clampProgressPct2(activeNode.cacheHitPct).toFixed(1)}" aria-label="Prompt cache hit ratio"></progress>
        </div>
      </div>
    </section>
  `;
  }
  function sortNodesForMode(nodes, sortMode, activeCid) {
    if (sortMode === "topology-tree") {
      const byId = /* @__PURE__ */ new Map();
      for (const node of nodes) {
        byId.set(node.cascadeId, node);
      }
      const childrenByParent = /* @__PURE__ */ new Map();
      const roots = [];
      for (const node of nodes) {
        if (node.parentCascadeId && byId.has(node.parentCascadeId)) {
          const list = childrenByParent.get(node.parentCascadeId) ?? [];
          list.push(node);
          childrenByParent.set(node.parentCascadeId, list);
        } else {
          roots.push(node);
        }
      }
      const sortSiblings = (list) => list.sort((a, b) => {
        if (a.spawnStepIndex !== null && b.spawnStepIndex !== null && a.spawnStepIndex !== b.spawnStepIndex) {
          return a.spawnStepIndex - b.spawnStepIndex;
        }
        return Date.parse(b.lastModifiedTime) - Date.parse(a.lastModifiedTime);
      });
      sortSiblings(roots);
      const ordered = [];
      const visited = /* @__PURE__ */ new Set();
      const visit = (node) => {
        if (visited.has(node.cascadeId)) {
          return;
        }
        visited.add(node.cascadeId);
        ordered.push(node);
        const children = sortSiblings([...childrenByParent.get(node.cascadeId) ?? []]);
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
  function formatNodeRow2Html(node, nowMs, snapshotReceivedAtMs) {
    const liveMs = computeLivePhaseElapsed(node.phaseElapsedMs, snapshotReceivedAtMs, nowMs);
    const timerAttrs = `data-live-timer="true" data-phase="${escapeHtml(node.phase)}" data-server-elapsed-ms="${Math.max(0, Math.round(node.phaseElapsedMs))}"`;
    let actionSummary = "";
    if (node.phase === "TOOL_RUNNING" && node.lastTool) {
      const summaryPart = node.lastTool.summary ? ` (${node.lastTool.summary})` : "";
      actionSummary = `\u{1F527} ${escapeHtml(node.lastTool.name)}${escapeHtml(summaryPart)} \xB7 <span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`;
    } else if (node.phase === "THINKING" || node.phase === "PRE_FLIGHT") {
      const label = node.phase === "PRE_FLIGHT" ? "\u{1F680} Pre-flight" : "\u{1F9E0} Thinking";
      actionSummary = `${label} \xB7 Step ${node.stepCount} \xB7 <span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`;
    } else if (node.phase === "STREAMING") {
      const rate = node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec) ? ` \xB7 ${Math.round(node.streamingTokPerSec)} tok/s` : "";
      actionSummary = `\u{1F7E2} Streaming${escapeHtml(rate)} \xB7 <span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`;
    } else if (node.phase === "BLOCKED_APPROVAL") {
      const toolPart = node.lastTool?.name ? ` (${node.lastTool.name})` : "";
      actionSummary = `\u23F8\uFE0F \u7B49\u5F85\u5BA1\u6279${escapeHtml(toolPart)} \xB7 <span class="pulse-live-timer tabular-nums" ${timerAttrs}>${escapeHtml(formatDurationCompact(liveMs))}</span>`;
    } else if (node.phase === "ERROR_OR_QUOTA") {
      actionSummary = "\u26A0 Error / Quota";
    } else {
      actionSummary = `\u26AA Idle \xB7 ${escapeHtml(formatIdleAgeText(node.lastModifiedTime, nowMs))}`;
    }
    const alertBadge = node.retryCount > 0 ? `<span class="pulse-pill pulse-tier-alert" data-tier="alert">\u26A0 Retried \xD7${node.retryCount}</span>` : node.routingStatus === "mismatch_or_fallback" ? '<span class="pulse-pill pulse-tier-alert" data-tier="alert">\u26A0 Fallback</span>' : "";
    return `
    <div class="pulse-node-row-2">
      <div class="pulse-node-action-text">${actionSummary}</div>
      ${alertBadge}
    </div>
  `;
  }
  function renderNodeCardHtml(node, sortMode, openPopoverNodeId, nowMs, snapshotReceivedAtMs) {
    const boundedDepth = sortMode === "topology-tree" ? Math.min(Math.max(0, node.depth), 3) : 0;
    const isSelectedPopover = openPopoverNodeId === node.cascadeId;
    const nodeTier = sanitizeTier2(node.servedModel.tier);
    const primaryName = node.kind === "swarm_member" ? node.swarmState?.memberName || node.role || node.title : node.role ? `${node.role} \xB7 ${node.title}` : node.title;
    const kindPill = node.kind === "swarm_member" ? "Swarm" : node.kind === "workflow" ? "Workflow" : node.typeName || (node.kind === "subagent" ? "Subagent" : "");
    const totalIn = node.tokens.inputTokens + node.tokens.cacheReadTokens;
    const canJump = UUID_RE2.test(node.cascadeId);
    return `
    <article class="pulse-node-card pulse-tier-${nodeTier}" data-tier="${nodeTier}" data-node-id="${escapeHtml(node.cascadeId)}" style="--pulse-depth: ${boundedDepth}">
      <div class="pulse-node-row-1">
        <div class="pulse-node-identity">
          <span class="pulse-phase-dot" data-phase="${mapPhaseToDotAttr2(node.phase)}"></span>
          <span class="pulse-node-title" title="${escapeHtml(primaryName)}">${escapeHtml(primaryName)}</span>
          ${kindPill ? `<span class="pulse-node-kind">${escapeHtml(kindPill)}</span>` : ""}
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
            aria-expanded="${isSelectedPopover ? "true" : "false"}"
            ${isSelectedPopover ? 'data-popover-anchor="true"' : ""}
            title="${escapeHtml(node.servedModel.displayName)}"
          ><span class="pulse-btn-label">${escapeHtml(node.servedModel.displayName)}</span></button>
          ${canJump ? `<button type="button" class="pulse-btn-compact" data-action="jump-node" data-cid="${escapeHtml(node.cascadeId)}" title="Switch to conversation" aria-label="Switch to conversation">\u2197</button>` : ""}
        </div>
      </div>
      ${formatNodeRow2Html(node, nowMs, snapshotReceivedAtMs)}
      <div class="pulse-node-row-3 tabular-nums">
        <span>Steps: ${node.stepCount}</span>
        <span>In ${escapeHtml(formatTokensCompact(totalIn))} (Cache ${escapeHtml(formatPct(node.cacheHitPct, 0))})</span>
        <span>Out ${escapeHtml(formatTokensCompact(node.tokens.outputTokens))} (Think ${escapeHtml(formatTokensCompact(node.tokens.thinkingOutputTokens))})</span>
        <span>\u0394Quota ${escapeHtml(formatDeltaQuotaPct(node.deltaQuota5hPct))}</span>
      </div>
    </article>
  `;
  }
  function renderOverviewPanelHtml(snapshot, uiState, nowMs, snapshotReceivedAtMs) {
    const banner = snapshot.smartGovernanceBanner;
    const bannerTier = banner.gemini5hRemainingPct !== null && banner.gemini5hRemainingPct < 15 ? "alert" : "orchestrator";
    const bannerHtml = banner.active ? `
      <aside class="pulse-banner pulse-tier-${bannerTier}" data-tier="${bannerTier}" role="status" data-testid="smart-governance-banner">
        <strong>\u26A0 \u7B97\u529B\u6CBB\u7406\u89E3\u6790</strong> \xB7
        <span>${banner.heavyConcurrentCount} \u4E2A\u9AD8\u914D\u91CD\u8282\u70B9\u5E76\u53D1</span> \xB7
        <span>5h \u4F59\u91CF ${escapeHtml(formatPct(banner.gemini5hRemainingPct, 1))}</span>
        ${banner.estimatedBurnPctPerMin !== null ? ` \xB7 <span>\u6D88\u8017\u901F\u7387 ${banner.estimatedBurnPctPerMin.toFixed(2)}%/min</span>` : ""}
        ${banner.message ? `<div>${escapeHtml(banner.message)}</div>` : ""}
      </aside>
    ` : "";
    const sortMode = snapshot.config.hudSortMode;
    const activeOnly = snapshot.treeNodes.filter((n) => n.phase !== "IDLE");
    const idleOnly = snapshot.treeNodes.filter((n) => n.phase === "IDLE");
    const orderedActive = sortNodesForMode(activeOnly, sortMode, snapshot.activeConversationId);
    const orderedIdle = sortNodesForMode(idleOnly, sortMode, snapshot.activeConversationId);
    const activeCardsHtml = orderedActive.length > 0 ? `<div class="pulse-matrix" data-sort-mode="${escapeHtml(sortMode)}">${orderedActive.map(
      (n) => renderNodeCardHtml(n, sortMode, uiState.openPopoverNodeId, nowMs, snapshotReceivedAtMs)
    ).join("")}</div>` : snapshot.treeNodes.length === 0 ? '<p class="pulse-empty-note">\u5F53\u524D\u65E0\u6811\u8282\u70B9\u5FEB\u7167\u3002</p>' : '<p class="pulse-empty-note">\u5F53\u524D\u65E0\u6D3B\u8DC3\u4E2D\u8282\u70B9\uFF0C\u6811\u5185\u4F1A\u8BDD\u5904\u4E8E\u7A7A\u95F2\u72B6\u6001\u3002</p>';
    const idleDrawerHtml = orderedIdle.length > 0 ? `
        <div class="pulse-idle-drawer">
          <button
            type="button"
            class="pulse-btn-compact"
            data-action="toggle-idle-group"
            data-testid="idle-group-toggle"
            aria-expanded="${uiState.expandedIdleGroup ? "true" : "false"}"
          >\u5DF2\u5B8C\u6210 / \u7A7A\u95F2\u8282\u70B9 (${orderedIdle.length}) ${uiState.expandedIdleGroup ? "\u25BE" : "\u25B8"}</button>
          ${uiState.expandedIdleGroup ? `<div class="pulse-matrix" data-sort-mode="${escapeHtml(sortMode)}" style="margin-top: 6px;">${orderedIdle.map(
      (n) => renderNodeCardHtml(
        n,
        sortMode,
        uiState.openPopoverNodeId,
        nowMs,
        snapshotReceivedAtMs
      )
    ).join("")}</div>` : ""}
        </div>
      ` : "";
    const warningsHtml = !snapshot.hostConnected && snapshot.warnings.length > 0 ? `<p class="pulse-empty-note">${escapeHtml(snapshot.warnings[0])}</p>` : "";
    const toastHtml = uiState.statusMessage ? `<p class="pulse-empty-note" role="status">${escapeHtml(uiState.statusMessage)}</p>` : "";
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
          aria-pressed="${sortMode === "active-first" ? "true" : "false"}"
        >\u6D3B\u8DC3\u7F6E\u9876</button>
        <button
          type="button"
          class="pulse-btn-compact"
          data-action="set-sort"
          data-sort="topology-tree"
          aria-pressed="${sortMode === "topology-tree" ? "true" : "false"}"
        >\u62D3\u6251\u7F29\u8FDB</button>
      </div>
    </div>
    ${activeCardsHtml}
    ${idleDrawerHtml}
  `;
  }
  function formatStepRangeLabel(stepIndices) {
    if (!Array.isArray(stepIndices) || stepIndices.length === 0) {
      return "Steps \u2014";
    }
    const finite = stepIndices.filter((n) => typeof n === "number" && Number.isFinite(n));
    if (finite.length === 0) {
      return "Steps \u2014";
    }
    const minStep = Math.min(...finite);
    const maxStep = Math.max(...finite);
    return minStep === maxStep ? `Step ${minStep}` : `Steps ${minStep}\u2013${maxStep}`;
  }
  function renderTimelineTurnCardHtml(turn, maxTurnMs, effectiveScope, activeConversationId) {
    const turnTier = sanitizeTier2(turn.tier);
    const stepLabel = formatStepRangeLabel(turn.stepIndices);
    const ttftMs = Math.max(0, Number.isFinite(turn.ttftMs) ? turn.ttftMs : 0);
    const streamingMs = Math.max(0, Number.isFinite(turn.streamingMs) ? turn.streamingMs : 0);
    const totalMs = Math.max(
      0,
      Number.isFinite(turn.totalMs) && turn.totalMs > 0 ? turn.totalMs : ttftMs + streamingMs
    );
    const denomMs = Math.max(1, ttftMs + streamingMs, totalMs);
    const trackPct = totalMs > 0 ? Math.max(4, Math.min(100, totalMs / maxTurnMs * 100)) : 0;
    const ttftPct = totalMs > 0 ? Math.max(0, Math.min(100, ttftMs / denomMs * 100)) : 0;
    const streamPct = totalMs > 0 ? Math.max(0, Math.min(100 - ttftPct, streamingMs / denomMs * 100)) : 0;
    const tokPerSec = streamingMs > 0 && turn.outputTokens > 0 ? Math.round(turn.outputTokens * 1e3 / streamingMs) : null;
    const showNodeChip = effectiveScope === "tree" && Boolean(turn.cascadeId) && turn.cascadeId !== activeConversationId;
    const nodeChipLabel = turn.role || turn.cascadeTitle || turn.cascadeId.slice(0, 8);
    const nodeChipHtml = showNodeChip ? UUID_RE2.test(turn.cascadeId) ? `<button type="button" class="pulse-btn-compact pulse-timeline-node-chip" data-action="jump-node" data-cid="${escapeHtml(turn.cascadeId)}" title="Switch to ${escapeHtml(nodeChipLabel)}" aria-label="Switch to ${escapeHtml(nodeChipLabel)}"><span class="pulse-btn-label">${escapeHtml(nodeChipLabel)}</span></button>` : `<span class="pulse-node-kind"><span class="pulse-btn-label">${escapeHtml(nodeChipLabel)}</span></span>` : "";
    const modelLabel = turn.servedModelDisplayName || turn.responseModel || "Unknown Model";
    const modelTooltip = turn.responseModel && turn.responseModel !== modelLabel ? `${modelLabel} (${turn.responseModel})` : modelLabel;
    const hasRouteShift = Boolean(turn.routingChangedFromPrevTurn);
    const requestedLabel = turn.requestedLabel || "";
    const isAutoRouted = !hasRouteShift && /auto|orchestrator/i.test(requestedLabel);
    const routeBadgeHtml = hasRouteShift ? `<span class="pulse-pill pulse-tier-orchestrator pulse-timeline-shift-pill" data-tier="orchestrator" data-testid="timeline-route-shift" title="${escapeHtml(`${requestedLabel || "Prev"} \u2794 ${modelLabel}`)}"><span class="pulse-btn-label">\u26A1 ${escapeHtml(requestedLabel || "Prev")} \u2794 ${escapeHtml(modelLabel)}</span></span>` : isAutoRouted ? `<span class="pulse-pill pulse-tier-orchestrator pulse-timeline-auto-pill" data-tier="orchestrator" title="${escapeHtml(`${requestedLabel} \u2794 ${modelLabel}`)}"><span class="pulse-btn-label">${escapeHtml(requestedLabel)} \u2794 ${escapeHtml(modelLabel)}</span></span>` : "";
    const retryBadgeHtml = turn.retryCount > 0 ? `<span class="pulse-pill pulse-tier-alert" data-tier="alert" data-testid="timeline-retry-badge">\u26A0 Retried \xD7${turn.retryCount}</span>` : "";
    const overthinkingBadgeHtml = isOverthinkingTurn(turn) ? `<span class="pulse-pill pulse-tier-orchestrator" data-tier="orchestrator" data-testid="timeline-overthinking-badge">\u{1F4A1} Overthinking</span>` : "";
    const totalIn = turn.inputTokens + turn.cacheReadTokens;
    const ctxText = turn.contextMaxTokens > 0 ? `${Math.round(turn.contextPct)}%` : "\u2014";
    const deltaText = formatDeltaQuotaPct(turn.deltaQuota5hPct);
    return `
    <li class="pulse-timeline-item">
      <article class="pulse-timeline-card pulse-tier-${turnTier}" data-tier="${turnTier}" data-testid="timeline-turn-card" data-turn-index="${turn.turnIndex}">
        <div class="pulse-timeline-turn-head">
          <div class="pulse-timeline-turn-left">
            <span class="pulse-timeline-turn-id tabular-nums">Turn #${turn.turnIndex}</span>
            <span class="pulse-timeline-steps tabular-nums">${escapeHtml(stepLabel)}</span>
            ${nodeChipHtml}
          </div>
          <div class="pulse-timeline-badges">
            <span class="pulse-pill pulse-tier-${turnTier}" data-tier="${turnTier}" title="${escapeHtml(modelTooltip)}"><span class="pulse-btn-label">${escapeHtml(modelLabel)}</span></span>
            ${routeBadgeHtml}
            ${retryBadgeHtml}
            ${overthinkingBadgeHtml}
          </div>
        </div>
        <div class="pulse-timeline-flame-wrap">
          <div
            class="pulse-timeline-bar"
            role="img"
            aria-label="Turn ${turn.turnIndex} flame: TTFT ${escapeHtml(formatDurationCompact(ttftMs))}, Streaming ${escapeHtml(formatDurationCompact(streamingMs))}, Total ${escapeHtml(formatDurationCompact(totalMs))}"
          >
            <div class="pulse-timeline-bar-fill" style="width: ${trackPct.toFixed(1)}%;">
              <span class="pulse-timeline-seg pulse-timeline-seg-ttft" data-segment="ttft" style="width: ${ttftPct.toFixed(1)}%;"></span>
              <span class="pulse-timeline-seg pulse-timeline-seg-stream" data-segment="stream" style="width: ${streamPct.toFixed(1)}%;"></span>
            </div>
          </div>
          <div class="pulse-timeline-timing-row tabular-nums">
            <span>TTFT <strong>${escapeHtml(formatDurationCompact(ttftMs))}</strong></span>
            <span>Stream <strong>${escapeHtml(formatDurationCompact(streamingMs))}</strong>${tokPerSec !== null ? ` \xB7 ${tokPerSec} tok/s` : ""}</span>
            <span class="pulse-timeline-total">\u03A3 <strong>${escapeHtml(formatDurationCompact(totalMs))}</strong></span>
          </div>
        </div>
        <div class="pulse-timeline-meta-row tabular-nums">
          <span>Think ${escapeHtml(formatTokensCompact(turn.thinkingOutputTokens))} / ${escapeHtml(formatTokensCompact(turn.outputTokens))} (${Math.round(turn.thinkingRatioPct)}%)</span>
          <span>In ${escapeHtml(formatTokensCompact(totalIn))} \xB7 Cache ${escapeHtml(formatPct(turn.cacheHitPct, 1))}</span>
          <span>CTX ${escapeHtml(ctxText)}</span>
          <span>\u03945h ${escapeHtml(deltaText)}</span>
        </div>
      </article>
    </li>
  `;
  }
  function renderTimelinePanelHtml(snapshot, uiState) {
    const effectiveScope = uiState.timelineScope ?? uiState.timelineSnapshot?.scope ?? snapshot.config.timelineScope ?? "tree";
    const timelineSnap = uiState.timelineSnapshot;
    const turns = timelineSnap?.turns ?? [];
    const maxTurnMs = Math.max(
      1,
      ...turns.map(
        (t) => Number.isFinite(t.totalMs) && t.totalMs > 0 ? t.totalMs : t.ttftMs + t.streamingMs
      )
    );
    const errorBannerHtml = uiState.timelineError ? `<aside class="pulse-banner pulse-tier-alert" data-tier="alert" role="alert">${escapeHtml(uiState.timelineError)}</aside>` : "";
    const bodyHtml = uiState.timelineLoading && !timelineSnap ? '<div class="pulse-quota-card" data-testid="timeline-loading"><p class="pulse-empty-note">\u6B63\u5728\u52A0\u8F7D\u9010\u8F6E\u8C03\u7528\u706B\u7130\u8F74\u2026</p></div>' : turns.length === 0 ? `<div class="pulse-quota-card" data-testid="timeline-empty"><p class="pulse-empty-note">\u5F53\u524D${effectiveScope === "tree" ? "\u4F1A\u8BDD\u6811" : "\u4F1A\u8BDD"}\u6682\u65E0\u53EF\u5C55\u793A\u7684\u6A21\u578B\u8C03\u7528\u8F6E\u6B21\u3002</p></div>` : `<ol class="pulse-timeline-list" data-testid="timeline-turns">${turns.map(
      (t) => renderTimelineTurnCardHtml(
        t,
        maxTurnMs,
        effectiveScope,
        snapshot.activeConversationId
      )
    ).join("")}</ol>`;
    return `
    <div class="pulse-timeline-panel" data-testid="timeline-tab-panel">
      <div class="pulse-section-head pulse-timeline-header">
        <div class="pulse-topbar-controls" role="group" aria-label="Timeline scope" data-testid="timeline-scope-group">
          <button
            type="button"
            class="pulse-btn-compact"
            data-action="set-timeline-scope"
            data-scope="conversation"
            data-testid="timeline-scope-conversation"
            aria-pressed="${effectiveScope === "conversation" ? "true" : "false"}"
          ><span class="pulse-btn-label">\u5F53\u524D\u4F1A\u8BDD</span></button>
          <button
            type="button"
            class="pulse-btn-compact"
            data-action="set-timeline-scope"
            data-scope="tree"
            data-testid="timeline-scope-tree"
            aria-pressed="${effectiveScope === "tree" ? "true" : "false"}"
          ><span class="pulse-btn-label">\u6574\u68F5\u4F1A\u8BDD\u6811</span></button>
        </div>
        <span class="pulse-section-title tabular-nums" data-testid="timeline-turn-count">${turns.length} turns</span>
      </div>
      <div class="pulse-timeline-legend tabular-nums" aria-label="Flame bar legend">
        <span class="pulse-legend-item"><span class="pulse-legend-swatch" data-segment="ttft" aria-hidden="true"></span>TTFT</span>
        <span class="pulse-legend-item"><span class="pulse-legend-swatch" data-segment="stream" aria-hidden="true"></span>Streaming</span>
        <span class="pulse-timeline-legend-note">${uiState.timelineLoading ? "\u540C\u6B65\u4E2D\u2026" : "\u6700\u65B0\u8C03\u7528\u7F6E\u9876"}</span>
      </div>
      ${errorBannerHtml}
      ${bodyHtml}
    </div>
  `;
  }
  function renderQuotaBucketCardHtml(label, bucket) {
    if (!bucket) {
      return `
      <div class="pulse-quota-card">
        <div class="pulse-health-meta">
          <span>${escapeHtml(label)}</span>
          <span class="tabular-nums">\u2014</span>
        </div>
        <progress class="pulse-progress" data-level="normal" max="100" value="0" aria-label="${escapeHtml(label)}"></progress>
        <span class="pulse-empty-note">\u6682\u65E0\u5BBF\u4E3B\u914D\u989D\u6570\u636E</span>
      </div>
    `;
    }
    const level = bucket.isLowAlert || bucket.remainingPct < 15 ? "critical_85" : bucket.remainingPct < 40 ? "warn_70" : "normal";
    return `
    <div class="pulse-quota-card">
      <div class="pulse-health-meta">
        <span>${escapeHtml(label)}</span>
        <span class="tabular-nums ${bucket.isLowAlert ? "pulse-quota-alert" : ""}">${escapeHtml(formatPct(bucket.remainingPct, 1))}</span>
      </div>
      <progress class="pulse-progress" data-level="${level}" max="100" value="${clampProgressPct2(bucket.remainingPct).toFixed(1)}" aria-label="${escapeHtml(label)}"></progress>
      <div class="pulse-health-meta tabular-nums">
        <span>${escapeHtml(bucket.bucketId)}</span>
        <span>Reset: ${escapeHtml(bucket.resetInLabel)}</span>
      </div>
    </div>
  `;
  }
  function renderQuotaPanelHtml(snapshot, uiState) {
    const q = snapshot.quota;
    const stampMode = snapshot.config.inlineStampMode;
    const burnText = q.burnRate5hPctPerMin !== null && Number.isFinite(q.burnRate5hPctPerMin) ? `${q.burnRate5hPctPerMin.toFixed(2)}%/min` : "\u2014";
    return `
    <section class="pulse-quota-grid" data-testid="quota-tab-panel">
      ${renderQuotaBucketCardHtml("Gemini 5h", q.gemini5h)}
      ${renderQuotaBucketCardHtml("Gemini Weekly", q.geminiWeekly)}
      ${renderQuotaBucketCardHtml("Claude / 3P 5h", q.thirdParty5h)}
      ${renderQuotaBucketCardHtml("Claude / 3P Weekly", q.thirdPartyWeekly)}
      <div class="pulse-quota-card tabular-nums">
        <div class="pulse-health-meta">
          <span>\u672C\u6811 5h \u51C0\u6D88\u8017 (\u0394Quota)</span>
          <span>${escapeHtml(formatDeltaQuotaPct(q.treeNetDelta5hPct))}</span>
        </div>
        <div class="pulse-health-meta">
          <span>\u8FD1\u671F 5h \u6D88\u8017\u901F\u7387</span>
          <span>${escapeHtml(burnText)}</span>
        </div>
      </div>
      <div class="pulse-quota-card">
        <div class="pulse-health-meta">
          <span>Inline Zero-Token Stamp \u6A21\u5F0F</span>
          <span>${uiState.isUpdatingConfig ? "\u4FDD\u5B58\u4E2D\u2026" : escapeHtml(stampMode)}</span>
        </div>
        <div class="pulse-stamp-group" role="group" aria-label="Inline stamp mode">
          <button type="button" class="pulse-btn-compact" data-action="set-stamp" data-mode="smart" aria-pressed="${stampMode === "smart" ? "true" : "false"}">smart</button>
          <button type="button" class="pulse-btn-compact" data-action="set-stamp" data-mode="every-turn" aria-pressed="${stampMode === "every-turn" ? "true" : "false"}">every-turn</button>
          <button type="button" class="pulse-btn-compact" data-action="set-stamp" data-mode="off" aria-pressed="${stampMode === "off" ? "true" : "false"}">off</button>
        </div>
      </div>
    </section>
  `;
  }
  function renderFuelBarHtml(snapshot) {
    const q = snapshot.quota;
    const g5Text = q.gemini5h ? `${formatPct(q.gemini5h.remainingPct, 1)} (${q.gemini5h.resetInLabel})` : "\u2014";
    const gwText = q.geminiWeekly ? formatPct(q.geminiWeekly.remainingPct, 1) : "\u2014";
    const tp5Text = q.thirdParty5h ? formatPct(q.thirdParty5h.remainingPct, 1) : "\u2014";
    const g5Low = Boolean(q.gemini5h?.isLowAlert);
    return `
    <footer class="pulse-fuel-bar" data-testid="fuel-bar">
      <div class="pulse-fuel-lines tabular-nums">
        <div class="pulse-fuel-line">
          <span class="${g5Low ? "pulse-quota-alert" : ""}" data-testid="fuel-gemini-5h">Gemini 5h: ${escapeHtml(g5Text)}</span>
          <span>\xB7 W: ${escapeHtml(gwText)}</span>
        </div>
        <div class="pulse-fuel-line">
          <span>Claude 5h: ${escapeHtml(tp5Text)}</span>
          <span>\xB7 \u672C\u6811 ${escapeHtml(formatDeltaQuotaPct(q.treeNetDelta5hPct))}</span>
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
  function renderNodePopoverHtml(node) {
    return `
    <div class="pulse-popover-title">${escapeHtml(node.servedModel.displayName)}</div>
    <div class="pulse-popover-row">Requested: <code>${escapeHtml(node.requestedModel.raw || node.requestedModel.displayName)}</code> (${escapeHtml(node.requestedModel.source)})</div>
    <div class="pulse-popover-row">Model Enum: <code>${escapeHtml(node.servedModel.modelEnum || "\u2014")}</code></div>
    <div class="pulse-popover-row">Response: <code>${escapeHtml(node.servedModel.responseModel || "\u2014")}</code></div>
    <div class="pulse-popover-row">Routing: <code>${escapeHtml(node.routingStatus)}</code> \xB7 Retries: ${node.retryCount}</div>
    <div class="pulse-popover-row">TTFT: ${node.lastTtftMs !== null ? escapeHtml(formatDurationCompact(node.lastTtftMs)) : "\u2014"} \xB7 Stream: ${node.lastStreamingMs !== null ? escapeHtml(formatDurationCompact(node.lastStreamingMs)) : "\u2014"}</div>
  `;
  }
  function createHudView(root, bindings) {
    root.innerHTML = `
    <div class="pulse-hud-shell">
      <header class="pulse-hud-header">
        <div class="pulse-topbar">
          <div role="tablist" aria-label="Model Pulse HUD views" class="pulse-tabs">
            <button role="tab" type="button" id="pulse-tab-overview" class="pulse-tab" data-tab="overview" aria-selected="true" tabindex="0">Overview \u5B9E\u65F6\u6001</button>
            <button role="tab" type="button" id="pulse-tab-timeline" class="pulse-tab" data-tab="timeline" aria-selected="false" tabindex="-1">Timeline \u8C03\u7528\u8F74</button>
            <button role="tab" type="button" id="pulse-tab-quota" class="pulse-tab" data-tab="quota" aria-selected="false" tabindex="-1">Quota \u914D\u989D\u7CBE\u7B97</button>
          </div>
          <div class="pulse-topbar-status tabular-nums" data-testid="connection-status">\u2026</div>
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
    const tablistEl = root.querySelector('[role="tablist"]');
    const tabEls = /* @__PURE__ */ new Map();
    for (const tabId of TAB_ORDER) {
      const btn = root.querySelector(`#pulse-tab-${tabId}`);
      if (btn) tabEls.set(tabId, btn);
    }
    const statusEl = root.querySelector('[data-testid="connection-status"]');
    const heroSlot = root.querySelector('[data-slot="hero"]');
    const overviewPanel = root.querySelector("#pulse-panel-overview");
    const timelinePanel = root.querySelector("#pulse-panel-timeline");
    const quotaPanel = root.querySelector("#pulse-panel-quota");
    const fuelSlot = root.querySelector('[data-slot="fuel"]');
    const popoverEl = root.querySelector("#pulse-node-popover");
    const scrollEl = root.querySelector(".pulse-hud-scroll");
    let lastSnapshot = null;
    let lastActiveNodeId = null;
    let lastRenderedTab = "overview";
    let closeTimer = null;
    const clearCloseTimer = () => {
      if (closeTimer !== null) {
        window.clearTimeout(closeTimer);
        closeTimer = null;
      }
    };
    const clearAnchorAttr = () => {
      const prev = root.querySelector('[data-popover-anchor="true"]');
      if (prev) {
        prev.removeAttribute("data-popover-anchor");
      }
    };
    const closePopover = () => {
      clearCloseTimer();
      clearAnchorAttr();
      popoverEl.style.removeProperty("position");
      popoverEl.style.removeProperty("left");
      popoverEl.style.removeProperty("top");
      popoverEl.style.removeProperty("right");
      popoverEl.style.removeProperty("bottom");
      const api = popoverEl;
      if (typeof api.hidePopover === "function") {
        try {
          if (popoverEl.matches(":popover-open")) {
            api.hidePopover();
          }
        } catch {
        }
      }
      popoverEl.removeAttribute("data-open");
      if (lastActiveNodeId !== null) {
        lastActiveNodeId = null;
        bindings.onInspectNode(null);
      }
    };
    const clampPopoverBounds = (anchorBtn) => {
      window.requestAnimationFrame(() => {
        const rect = popoverEl.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth || 360;
        const vh = window.innerHeight || document.documentElement.clientHeight || 820;
        const anchorRect = anchorBtn.getBoundingClientRect();
        const outOfBounds = rect.width === 0 || rect.right > vw - 8 || rect.left < 8 || rect.bottom > vh - 8 || rect.top < 4;
        if (!outOfBounds) {
          return;
        }
        const maxWidth = Math.max(160, Math.min(312, vw - 16));
        const estWidth = rect.width > 0 ? Math.min(rect.width, maxWidth) : maxWidth;
        const estHeight = rect.height > 0 ? rect.height : 120;
        const clampedLeft = Math.max(8, Math.min(vw - estWidth - 8, anchorRect.right - estWidth));
        const fitsBelow = anchorRect.bottom + 6 + estHeight <= vh - 8;
        const clampedTop = fitsBelow ? anchorRect.bottom + 6 : Math.max(8, anchorRect.top - estHeight - 6);
        popoverEl.style.position = "fixed";
        popoverEl.style.left = `${Math.round(clampedLeft)}px`;
        popoverEl.style.top = `${Math.round(clampedTop)}px`;
        popoverEl.style.right = "auto";
        popoverEl.style.bottom = "auto";
      });
    };
    const openPopoverForButton = (btn) => {
      clearCloseTimer();
      const nodeId = btn.getAttribute("data-node-id");
      if (!nodeId || !lastSnapshot) {
        return;
      }
      const node = lastSnapshot.treeNodes.find((n) => n.cascadeId === nodeId);
      if (!node) {
        return;
      }
      popoverEl.style.removeProperty("position");
      popoverEl.style.removeProperty("left");
      popoverEl.style.removeProperty("top");
      popoverEl.style.removeProperty("right");
      popoverEl.style.removeProperty("bottom");
      clearAnchorAttr();
      btn.setAttribute("data-popover-anchor", "true");
      lastActiveNodeId = nodeId;
      bindings.onInspectNode(nodeId);
      popoverEl.innerHTML = renderNodePopoverHtml(node);
      const api = popoverEl;
      if (typeof api.showPopover === "function") {
        try {
          if (!popoverEl.matches(":popover-open")) {
            api.showPopover();
          }
        } catch {
          popoverEl.setAttribute("data-open", "true");
        }
      } else {
        popoverEl.setAttribute("data-open", "true");
      }
      clampPopoverBounds(btn);
    };
    const schedulePopoverClose = () => {
      clearCloseTimer();
      closeTimer = window.setTimeout(() => {
        closePopover();
      }, 120);
    };
    const onTablistClick = (ev) => {
      const target = ev.target?.closest('[role="tab"]');
      const tabId = target?.getAttribute("data-tab");
      if (tabId && TAB_ORDER.includes(tabId)) {
        bindings.onTabChange(tabId);
      }
    };
    const onTablistKeyDown = (ev) => {
      const currentBtn = ev.target?.closest('[role="tab"]');
      const currentId = currentBtn?.getAttribute("data-tab");
      if (!currentId) {
        return;
      }
      const currentIndex = TAB_ORDER.indexOf(currentId);
      if (currentIndex === -1) {
        return;
      }
      let nextIndex = -1;
      if (ev.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % TAB_ORDER.length;
      } else if (ev.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
      } else if (ev.key === "Home") {
        nextIndex = 0;
      } else if (ev.key === "End") {
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
        nextBtn.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
      bindings.onTabChange(nextId);
    };
    const onRootClick = (ev) => {
      const actionEl = ev.target?.closest("[data-action]");
      if (!actionEl) {
        return;
      }
      const action = actionEl.getAttribute("data-action");
      switch (action) {
        case "set-sort": {
          const sort = actionEl.getAttribute("data-sort");
          if (sort === "active-first" || sort === "topology-tree") {
            bindings.onSetSortMode(sort);
          }
          break;
        }
        case "toggle-idle-group":
          bindings.onToggleIdleGroup();
          break;
        case "jump-node": {
          const cid = actionEl.getAttribute("data-cid");
          if (cid) {
            bindings.onJumpConversation(cid);
          }
          break;
        }
        case "inspect-node":
          openPopoverForButton(actionEl);
          break;
        case "cycle-stamp":
          bindings.onCycleStampMode();
          break;
        case "set-stamp": {
          const mode = actionEl.getAttribute("data-mode");
          if (mode === "smart" || mode === "every-turn" || mode === "off") {
            bindings.onSetStampMode(mode);
          }
          break;
        }
        case "set-timeline-scope": {
          const scope = actionEl.getAttribute("data-scope");
          if (scope === "conversation" || scope === "tree") {
            bindings.onSetTimelineScope(scope);
          }
          break;
        }
        default:
          break;
      }
    };
    const onRootMouseOver = (ev) => {
      const btn = ev.target?.closest('[data-action="inspect-node"]');
      if (btn) {
        openPopoverForButton(btn);
        return;
      }
      if (ev.target?.closest("#pulse-node-popover")) {
        clearCloseTimer();
      }
    };
    const onRootMouseOut = (ev) => {
      const fromBtn = ev.target?.closest('[data-action="inspect-node"]');
      const fromPopover = ev.target?.closest("#pulse-node-popover");
      if (!fromBtn && !fromPopover) {
        return;
      }
      const related = ev.relatedTarget;
      if (related?.closest('[data-action="inspect-node"]') || related?.closest("#pulse-node-popover")) {
        return;
      }
      schedulePopoverClose();
    };
    const onRootFocusIn = (ev) => {
      const btn = ev.target?.closest('[data-action="inspect-node"]');
      if (btn) {
        openPopoverForButton(btn);
      }
    };
    const onRootFocusOut = (ev) => {
      const fromBtn = ev.target?.closest('[data-action="inspect-node"]');
      if (!fromBtn) {
        return;
      }
      const nextFocus = ev.relatedTarget;
      if (nextFocus?.closest('[data-action="inspect-node"]') || nextFocus?.closest("#pulse-node-popover")) {
        return;
      }
      schedulePopoverClose();
    };
    const onPopoverToggle = (ev) => {
      const toggleEv = ev;
      if (toggleEv.newState === "closed") {
        clearAnchorAttr();
        if (lastActiveNodeId !== null) {
          lastActiveNodeId = null;
          bindings.onInspectNode(null);
        }
      }
    };
    const onRootKeyDown = (ev) => {
      if (ev.key === "Escape" && lastActiveNodeId !== null) {
        closePopover();
      }
    };
    tablistEl.addEventListener("click", onTablistClick);
    tablistEl.addEventListener("keydown", onTablistKeyDown);
    root.addEventListener("click", onRootClick);
    root.addEventListener("mouseover", onRootMouseOver);
    root.addEventListener("mouseout", onRootMouseOut);
    root.addEventListener("focusin", onRootFocusIn);
    root.addEventListener("focusout", onRootFocusOut);
    root.addEventListener("keydown", onRootKeyDown);
    popoverEl.addEventListener("toggle", onPopoverToggle);
    const syncTabs = (activeTab) => {
      for (const tabId of TAB_ORDER) {
        const btn = tabEls.get(tabId);
        const selected = tabId === activeTab;
        if (btn) {
          btn.setAttribute("aria-selected", selected ? "true" : "false");
          btn.tabIndex = selected ? 0 : -1;
        }
      }
      overviewPanel.hidden = activeTab !== "overview";
      timelinePanel.hidden = activeTab !== "timeline";
      quotaPanel.hidden = activeTab !== "quota";
    };
    return {
      render(snapshot, uiState, snapshotReceivedAtMs) {
        lastSnapshot = snapshot;
        lastActiveNodeId = uiState.openPopoverNodeId;
        const tabChanged = lastRenderedTab !== uiState.activeTab;
        lastRenderedTab = uiState.activeTab;
        const prevScrollTop = !tabChanged && scrollEl ? scrollEl.scrollTop : 0;
        syncTabs(uiState.activeTab);
        if (!snapshot) {
          statusEl.textContent = "Connecting";
          heroSlot.innerHTML = "";
          overviewPanel.innerHTML = '<p class="pulse-empty-note">\u6B63\u5728\u8FDE\u63A5 Model Pulse Sidecar\u2026</p>';
          timelinePanel.innerHTML = '<p class="pulse-empty-note">\u6B63\u5728\u8FDE\u63A5 Model Pulse Sidecar\u2026</p>';
          fuelSlot.innerHTML = "";
          return;
        }
        const nowMs = Date.now();
        statusEl.textContent = snapshot.hostConnected ? "\u25CF Live" : "\u25CB Offline";
        heroSlot.innerHTML = renderHeroHtml(snapshot, nowMs, snapshotReceivedAtMs);
        overviewPanel.innerHTML = renderOverviewPanelHtml(
          snapshot,
          uiState,
          nowMs,
          snapshotReceivedAtMs
        );
        timelinePanel.innerHTML = renderTimelinePanelHtml(snapshot, uiState);
        quotaPanel.innerHTML = renderQuotaPanelHtml(snapshot, uiState);
        fuelSlot.innerHTML = renderFuelBarHtml(snapshot);
        if (scrollEl) {
          scrollEl.scrollTop = prevScrollTop;
        }
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
        const timerNodes = root.querySelectorAll('[data-live-timer="true"]');
        for (const el of timerNodes) {
          const phase = el.getAttribute("data-phase");
          if (!phase || !ACTIVE_PHASES.has(phase)) {
            continue;
          }
          const serverMs = Number(el.getAttribute("data-server-elapsed-ms") ?? "0");
          const nextText = formatDurationCompact(
            computeLivePhaseElapsed(serverMs, snapshotReceivedAtMs, nowMs)
          );
          if (el.textContent !== nextText) {
            el.textContent = nextText;
          }
        }
        const idleNodes = root.querySelectorAll('[data-idle-age="true"]');
        for (const el of idleNodes) {
          const lastMs = Number(el.getAttribute("data-last-modified-ms") ?? "");
          if (!Number.isFinite(lastMs) || lastMs <= 0) {
            continue;
          }
          const nextText = `\u4E0A\u8F6E\u5B8C\u6210\u4E8E ${formatDurationCompact(Math.max(0, nowMs - lastMs))} \u524D`;
          if (el.textContent !== nextText) {
            el.textContent = nextText;
          }
        }
      },
      showLoading(message = "\u6B63\u5728\u8FDE\u63A5 Model Pulse Sidecar\u2026") {
        statusEl.textContent = "Connecting";
        overviewPanel.innerHTML = `<p class="pulse-empty-note">${escapeHtml(message)}</p>`;
      },
      showError(message) {
        statusEl.textContent = "Error";
        overviewPanel.innerHTML = `<aside class="pulse-banner pulse-tier-alert" data-tier="alert" role="alert">${escapeHtml(message)}</aside>`;
      },
      destroy() {
        clearCloseTimer();
        tablistEl.removeEventListener("click", onTablistClick);
        tablistEl.removeEventListener("keydown", onTablistKeyDown);
        root.removeEventListener("click", onRootClick);
        root.removeEventListener("mouseover", onRootMouseOver);
        root.removeEventListener("mouseout", onRootMouseOut);
        root.removeEventListener("focusin", onRootFocusIn);
        root.removeEventListener("focusout", onRootFocusOut);
        root.removeEventListener("keydown", onRootKeyDown);
        popoverEl.removeEventListener("toggle", onPopoverToggle);
      }
    };
  }

  // src/ui/state.ts
  var UUID_RE3 = /^[0-9a-f-]{36}$/i;
  var STAMP_CYCLE = ["smart", "every-turn", "off"];
  var ACTIVE_PHASES2 = /* @__PURE__ */ new Set([
    "PRE_FLIGHT",
    "THINKING",
    "STREAMING",
    "TOOL_RUNNING",
    "BLOCKED_APPROVAL"
  ]);
  function resolvePulseViewMode() {
    const path = window.location.pathname;
    const search = new URLSearchParams(window.location.search);
    if (path === "/fleet" || path.startsWith("/fleet/") || search.get("view") === "fleet") {
      return "fleet";
    }
    return "hud";
  }
  function resolveRequestedConversationId() {
    const fromQuery = new URLSearchParams(window.location.search).get("conversationId")?.trim() ?? "";
    if (UUID_RE3.test(fromQuery)) {
      return fromQuery;
    }
    const fromHost = window.sidecar?.conversationId?.trim() ?? "";
    if (UUID_RE3.test(fromHost)) {
      return fromHost;
    }
    return null;
  }
  function isDocumentInitiallyHidden() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return true;
    }
    try {
      const entries = performance.getEntriesByType?.("visibility-state");
      if (entries && entries.length > 0 && entries[entries.length - 1]?.name === "hidden") {
        return true;
      }
    } catch {
    }
    return false;
  }
  async function sidecarFetch(url, init) {
    if (window.sidecar && typeof window.sidecar.fetch === "function") {
      return window.sidecar.fetch(url, init);
    }
    return window.fetch(url, init);
  }
  function jumpToConversation(cid, onFallback) {
    if (!UUID_RE3.test(cid)) {
      return;
    }
    const bridge = window.sidecar;
    if (typeof bridge?.focusConversation === "function") {
      bridge.focusConversation(cid);
      return;
    }
    if (typeof bridge?.ui?.toggleConversation === "function") {
      bridge.ui.toggleConversation(cid);
      return;
    }
    onFallback(`\u5BBF\u4E3B\u9762\u677F\u672A\u6302\u8F7D\uFF0C\u65E0\u6CD5\u5207\u6362\u81F3\u4F1A\u8BDD ${cid.slice(0, 8)}`);
  }
  function computeAdaptivePollMs(snapshot) {
    if (!snapshot) {
      return 1500;
    }
    const hasRunning = snapshot.activeNode && ACTIVE_PHASES2.has(snapshot.activeNode.phase) || snapshot.treeNodes.some((node) => ACTIVE_PHASES2.has(node.phase));
    return hasRunning ? 1e3 : 2500;
  }
  function computeFleetAdaptivePollMs(snapshot) {
    if (!snapshot) {
      return 1500;
    }
    return snapshot.activeHeadline.totalRunningNodes > 0 ? 1e3 : 2500;
  }
  function mountFleetUi(root) {
    let disposed = false;
    let paused = isDocumentInitiallyHidden();
    let lastSnapshot = null;
    let snapshotReceivedAtMs = Date.now();
    let currentEtag = null;
    let pollTimer = null;
    let stopwatchTimer = null;
    let inFlightAbort = null;
    let requestSeq = 0;
    const uiState = {
      expandedTreeIds: /* @__PURE__ */ new Set(),
      activeWorkspaceUris: [],
      statusMessage: null,
      isLoading: true
    };
    let view;
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
          params.set("etag", currentEtag);
        }
        const query = params.toString();
        const response = await sidecarFetch(`/api/fleet${query ? `?${query}` : ""}`, {
          method: "GET",
          signal: abortController.signal
        });
        if (disposed || seq !== requestSeq) {
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (disposed || seq !== requestSeq) {
          return;
        }
        if ("unchanged" in payload && payload.unchanged === true) {
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
          view.showError(`\u65E0\u6CD5\u8BFB\u53D6 Fleet \u72B6\u6001\uFF1A${msg}`);
        } else {
          uiState.statusMessage = `\u96C6\u7FA4\u5237\u65B0\u6682\u4E0D\u53EF\u7528 (${msg})`;
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
      }
    });
    if (typeof window.sidecar?.getWorkspaceUris === "function") {
      void window.sidecar.getWorkspaceUris().then((uris) => {
        if (!disposed && Array.isArray(uris)) {
          uiState.activeWorkspaceUris = uris;
          if (lastSnapshot) {
            renderCurrent();
          }
        }
      }).catch(() => {
      });
    }
    const unsubscribeWorkspace = typeof window.sidecar?.onWorkspaceChange === "function" ? window.sidecar.onWorkspaceChange((uris) => {
      if (!disposed && Array.isArray(uris)) {
        uiState.activeWorkspaceUris = uris;
        if (lastSnapshot) {
          renderCurrent();
        }
      }
    }) : null;
    const onVisibilityChange = () => {
      const nowHidden = document.visibilityState === "hidden";
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
    document.addEventListener("visibilitychange", onVisibilityChange);
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
      document.removeEventListener("visibilitychange", onVisibilityChange);
      view.destroy();
    };
  }
  function mountPulseUi(root) {
    const viewMode = resolvePulseViewMode();
    if (viewMode === "fleet") {
      return mountFleetUi(root);
    }
    let disposed = false;
    let paused = isDocumentInitiallyHidden();
    let lastSnapshot = null;
    let snapshotReceivedAtMs = Date.now();
    let currentEtag = null;
    let pollTimer = null;
    let stopwatchTimer = null;
    let inFlightAbort = null;
    let requestSeq = 0;
    let timelineEtag = null;
    let timelinePollTimer = null;
    let timelineAbort = null;
    let timelineEpoch = 0;
    let lastTimelineCid = null;
    const uiState = {
      activeTab: "overview",
      expandedIdleGroup: false,
      openPopoverNodeId: null,
      isUpdatingConfig: false,
      statusMessage: null,
      timelineScope: null,
      timelineSnapshot: null,
      timelineLoading: false,
      timelineError: null
    };
    let view;
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
      if (disposed || paused || uiState.activeTab !== "timeline") {
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
    const resolveEffectiveTimelineCid = () => {
      return resolveRequestedConversationId() ?? lastSnapshot?.activeConversationId ?? null;
    };
    const resolveEffectiveTimelineScope = () => {
      return uiState.timelineScope ?? lastSnapshot?.config.timelineScope ?? null;
    };
    const pollTimelineOnce = async () => {
      if (disposed || paused || uiState.activeTab !== "timeline") {
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
          params.set("conversationId", effectiveCid);
        }
        if (effectiveScope) {
          params.set("scope", effectiveScope);
        }
        if (timelineEtag) {
          params.set("etag", timelineEtag);
        }
        const query = params.toString();
        const response = await sidecarFetch(`/api/timeline${query ? `?${query}` : ""}`, {
          method: "GET",
          signal: abortController.signal
        });
        if (disposed || epoch !== timelineEpoch || uiState.activeTab !== "timeline") {
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (disposed || epoch !== timelineEpoch || uiState.activeTab !== "timeline") {
          return;
        }
        if ("unchanged" in payload && payload.unchanged === true) {
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
        if (abortController.signal.aborted || disposed || epoch !== timelineEpoch || uiState.activeTab !== "timeline") {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        uiState.timelineLoading = false;
        uiState.timelineError = `\u65E0\u6CD5\u8BFB\u53D6\u8C03\u7528\u65F6\u95F4\u8F74 (${msg})`;
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
          params.set("conversationId", requestedCid);
        }
        if (currentEtag) {
          params.set("etag", currentEtag);
        }
        const query = params.toString();
        const response = await sidecarFetch(`/api/hud${query ? `?${query}` : ""}`, {
          method: "GET",
          signal: abortController.signal
        });
        if (disposed || seq !== requestSeq) {
          return;
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        if (disposed || seq !== requestSeq) {
          return;
        }
        if ("unchanged" in payload && payload.unchanged === true) {
          currentEtag = payload.etag;
          return;
        }
        lastSnapshot = payload;
        currentEtag = payload.etag;
        snapshotReceivedAtMs = Date.now();
        uiState.statusMessage = null;
        renderCurrent();
        if (uiState.activeTab === "timeline") {
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
          view.showError(`\u65E0\u6CD5\u8BFB\u53D6 HUD \u72B6\u6001\uFF1A${msg}`);
        } else {
          uiState.statusMessage = `\u5237\u65B0\u6682\u4E0D\u53EF\u7528 (${msg})`;
          renderCurrent();
        }
      } finally {
        if (inFlightAbort === abortController) {
          inFlightAbort = null;
        }
        scheduleNextPoll();
      }
    };
    const applyConfigPatch = async (patch) => {
      if (disposed) {
        return;
      }
      const previousConfig = lastSnapshot ? { ...lastSnapshot.config } : null;
      if (lastSnapshot) {
        lastSnapshot = {
          ...lastSnapshot,
          config: {
            ...lastSnapshot.config,
            ...patch
          }
        };
      }
      currentEtag = null;
      uiState.isUpdatingConfig = true;
      uiState.statusMessage = null;
      renderCurrent();
      try {
        const response = await sidecarFetch("/api/config", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(patch)
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const updatedConfig = await response.json();
        if (disposed) {
          return;
        }
        if (lastSnapshot) {
          lastSnapshot = {
            ...lastSnapshot,
            config: updatedConfig
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
            config: previousConfig
          };
        }
        uiState.isUpdatingConfig = false;
        uiState.statusMessage = `\u914D\u7F6E\u4FDD\u5B58\u5931\u8D25: ${err instanceof Error ? err.message : String(err)}`;
        renderCurrent();
      }
    };
    const applyTimelineScope = async (nextScope) => {
      if (disposed) {
        return;
      }
      const currentEffective = uiState.timelineScope ?? lastSnapshot?.config.timelineScope ?? "tree";
      if (currentEffective === nextScope && uiState.timelineSnapshot?.scope === nextScope) {
        return;
      }
      uiState.timelineScope = nextScope;
      if (lastSnapshot) {
        lastSnapshot = {
          ...lastSnapshot,
          config: {
            ...lastSnapshot.config,
            timelineScope: nextScope
          }
        };
      }
      timelineEtag = null;
      currentEtag = null;
      uiState.timelineLoading = true;
      uiState.timelineError = null;
      renderCurrent();
      if (uiState.activeTab === "timeline" && !paused) {
        void pollTimelineOnce();
      }
      try {
        const response = await sidecarFetch("/api/config", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ timelineScope: nextScope })
        });
        if (!disposed && response.ok) {
          const updatedConfig = await response.json();
          if (!disposed && lastSnapshot) {
            lastSnapshot = {
              ...lastSnapshot,
              config: updatedConfig
            };
            renderCurrent();
          }
        }
      } catch {
      }
    };
    view = createHudView(root, {
      onTabChange(tab) {
        if (uiState.activeTab !== tab) {
          uiState.activeTab = tab;
          if (tab === "timeline") {
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
        const currentMode = lastSnapshot?.config.inlineStampMode ?? "smart";
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
      }
    });
    const onVisibilityChange = () => {
      const nowHidden = document.visibilityState === "hidden";
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
        if (uiState.activeTab === "timeline") {
          void pollTimelineOnce();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
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
      document.removeEventListener("visibilitychange", onVisibilityChange);
      view.destroy();
    };
  }

  // src/ui/main.ts
  function parseHexColorLuminance(colorValue) {
    const trimmed = colorValue.trim();
    const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
    if (hexMatch) {
      const hex = hexMatch[1];
      const full = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex;
      const r = Number.parseInt(full.slice(0, 2), 16) / 255;
      const g = Number.parseInt(full.slice(2, 4), 16) / 255;
      const b = Number.parseInt(full.slice(4, 6), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
    if (rgbMatch) {
      const r = Number(rgbMatch[1]) / 255;
      const g = Number(rgbMatch[2]) / 255;
      const b = Number(rgbMatch[3]) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    return null;
  }
  function getThemeQueryOverride() {
    try {
      const raw = new URLSearchParams(window.location.search).get("theme")?.trim().toLowerCase();
      if (raw === "dark" || raw === "light") {
        return raw;
      }
    } catch {
    }
    return void 0;
  }
  function detectResolvedTheme(mediaDark, hostBg, queryOverride) {
    if (queryOverride === "dark" || queryOverride === "light") {
      return queryOverride;
    }
    if (hostBg) {
      const lum = parseHexColorLuminance(hostBg);
      if (lum !== null) {
        return lum < 0.45 ? "dark" : "light";
      }
    }
    return mediaDark ? "dark" : "light";
  }
  function applyResolvedTheme(theme, view) {
    document.documentElement.setAttribute("data-resolved-theme", theme);
    const rootWrapper = document.getElementById("pulse-app");
    if (rootWrapper) {
      rootWrapper.setAttribute("data-resolved-theme", theme);
      rootWrapper.setAttribute("data-view", view);
    }
  }
  function bootstrap() {
    const view = resolvePulseViewMode();
    const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
    let lastHostBg;
    const syncTheme = () => {
      const queryOverride = getThemeQueryOverride();
      const resolved = detectResolvedTheme(darkMedia.matches, lastHostBg, queryOverride);
      applyResolvedTheme(resolved, view);
    };
    darkMedia.addEventListener("change", syncTheme);
    window.addEventListener("message", (event) => {
      const payload = event.data;
      if (payload?.type === "theme-change") {
        const bg = payload.payload?.cssVariables?.["--background"];
        if (typeof bg === "string" && bg.trim()) {
          lastHostBg = bg;
        }
        syncTheme();
      }
    });
    syncTheme();
    const mountRoot = document.getElementById("app") ?? document.body;
    mountPulseUi(mountRoot);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
