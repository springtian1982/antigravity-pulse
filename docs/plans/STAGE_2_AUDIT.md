# Stage 2 Independent Audit Record (`STAGE_2_AUDIT.md`)

> **Stage**: `Stage 2` (Deep Observability & Global Fleet — `Timeline` Tab in `/hud` + `Pulse Fleet` in `SIDEBAR` `/fleet`)  
> **Independent Referee**: `S2-QA` (`b9fc90ea`, `Independent Stage 2 Auditor`)  
> **Final Audit Verdict**: `VERDICT: APPROVED`  
> **Audit Date**: `2026-11-14`  
> **Plan & Blueprint References**: [`STAGE_2_TIMELINE_FLEET_PLAN.md`](./STAGE_2_TIMELINE_FLEET_PLAN.md) · [`00_MASTER_IMPLEMENTATION_BLUEPRINT.md`](./00_MASTER_IMPLEMENTATION_BLUEPRINT.md) · [`DECISION_LOG.md`](./DECISION_LOG.md) · [`LESSONS_LEARNED.md`](./LESSONS_LEARNED.md)

---

## 1. Executive Verdict & Remediation Summary

`S2-QA` (`b9fc90ea`) independently audited all Stage 2 deliverables (`S2-A` pure Timeline/Fleet builders, `TelemetryEngine` extensions, and Sidecar `/api/timeline` + `/api/fleet` routes; `S2-B` `/hud` `Timeline 调用轴` tab, `/fleet` `Pulse Fleet` Sidebar UI, responsive Flexoki CSS, and `scripts/preview-ui.mjs` dense/alert/idle fixtures), verified frozen Stage 1 integrity on [`src/ui/main.ts`](../../src/ui/main.ts) and [`src/types/telemetry.ts`](../../src/types/telemetry.ts), audited rebuilt prebuilt bundles ([`sidecars/pulse_cockpit/dist/server.mjs`](../../sidecars/pulse_cockpit/dist/server.mjs), [`sidecars/pulse_cockpit/dist/ui.js`](../../sidecars/pulse_cockpit/dist/ui.js)), inspected live browser screenshots (`VIS-01`–`VIS-06` plus post-fix rechecks), and cross-checked the Master Stage 2 Gate verification log (`steps/665/output.txt`, exit `0`).

During Browser Visual QA, initial screenshots (`vis04`, `vis05`, `vis06`) surfaced two CSS layout defects in narrow and wide `/fleet` panes; `S2-B` fixed [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css), rebuilt the bundles, and passed all clean rechecks (`vis04_recheck`, `vis05_recheck`, `vis06_recheck` plus `VIS-01` & `VIS-03` regression checks). Following final inspection, `S2-QA` issued **`VERDICT: APPROVED`** with **`0` Blocking Findings** and **`4` Minor Non-Blocking Observations**:

### 1.1 Pre-Audit Browser CSS Fix Verified Clean (`L-016`)

| Catch & Screenshot | Root Cause | Verified Remediation & Recheck | Ledger Link |
| :--- | :--- | :--- | :--- |
| **`vis04` (`360×820` Dark `/fleet` Drawer)** | `.pulse-node-kind` carried `flex: 0 1 auto` plus Stage 1 `@media (max-width: 420px)` `max-width: 72px` truncation, crushing drawer badges to `R…` / `S…` / `Sw…` while single-line competition clipped model pills (`Gemini 4 Carbon (…`). | Added 2-row flex wrapping on `.pulse-fleet-drawer-item` (`.pulse-fleet-drawer-left { flex: 1 1 180px }`, `.pulse-fleet-drawer-right { flex: 0 0 auto; margin-inline-start: auto }`), widened `.pulse-fleet-drawer-right .pulse-pill` to `max-width: min(210px, 100%)`, and pinned `.pulse-fleet-drawer-item .pulse-node-kind { flex: 0 0 auto; max-width: none; }` both base and inside `@media (max-width: 420px)`. Confirmed crisp `Root` / `Subagent` + full pills in `vis04_recheck`. | [`L-016`](./LESSONS_LEARNED.md#l-016-dense-flex-drawer-wrapping-badge-flex-0-0-auto--hidden-media-width-overrides) |
| **`vis05` (`1024×820` Light) & `vis06` (`420×820` Dark Alert) Top-5 Burners** | Top 5 Quota Burners model pills clipped prematurely (`Gemini 4 Carbon (Hi…`) due to an earlier `140px` `max-width` cap inside `.pulse-burner-meta .pulse-pill`. | Raised `.pulse-burner-meta .pulse-pill` to `max-width: min(220px, 100%)` and `.pulse-burner-meta .pulse-node-kind` to `max-width: min(160px, 100%)` in [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css). Confirmed full unclipped `Gemini 4 Carbon (High)` badges in `vis05_recheck` and `vis06_recheck`. | [`L-016`](./LESSONS_LEARNED.md#l-016-dense-flex-drawer-wrapping-badge-flex-0-0-auto--hidden-media-width-overrides) |

### 1.2 Minor Non-Blocking Observations (`S2-QA` `b9fc90ea`)

1. **Idle Fleet Poll Interval Consistency (`src/ui/state.ts:113`)**: `computeFleetAdaptivePollMs` polls at `2500ms` when `totalRunningNodes === 0` (matching Stage 1 HUD `computeAdaptivePollMs` at [`src/ui/state.ts`](../../src/ui/state.ts#L106)), whereas [`STAGE_2_TIMELINE_FLEET_PLAN.md`](./STAGE_2_TIMELINE_FLEET_PLAN.md) §4.2.A described `3000ms` idle. Consistent across `/hud` and `/fleet` and well within `RTM-18`/`RTM-25`.
2. **Same-Model Routing Shift Display Nuance (`src/ui/hud-view.ts:683-686`, observed in `vis02` Turn #10)**: When `turn.routingChangedFromPrevTurn === true` and the current turn's `requestedLabel === servedModelDisplayName` (e.g., Turn #10 renders `⚡ Orchestrator (Carbon) ➔ Orchestrator (Carbon)`), the pill renders the current turn's requested/served pair while indicating a shift relative to the *previous* turn. Behavior conforms to §4.1.B.2; cosmetic previous-model labeling can optionally be refined in Stage 3.
3. **`compactModelLabel` vs Full Display Label in Top 5 Burners (`src/core/fleet-builder.ts:75-109, 447`, `src/ui/fleet-view.ts:339`)**: `buildFleetSnapshot` populates `QuotaBurnerEntry.dominantModel` via `compactModelLabel(...)` (e.g. `"Carbon(H)"`, `"Flash"`) rather than full `servedModel.displayName` (`"Gemini 4 Carbon (High)"`), whereas Headline/Matrix and [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs) fixtures display full labels. Intentional compact representation in narrow sidebars matching §4.1.B.2.
4. **Harmless Preview Mock Property (`scripts/preview-ui.mjs:1240`)**: `semantic.quota.treeDeltaQuota5hPct ?? 3.15` references a nonexistent property on `QuotaSummaryView` (canonical field is `treeNetDelta5hPct`), harmlessly falling back to `3.15` in preview fixtures only.

---

## 2. Gate Sign-Off Checklist & Verified Stage 2 Artifacts

### 2.1 Stage 2 Gate Sign-Off Checklist (`RTM-07`, `RTM-10`, `RTM-15`, `RTM-18`, `RTM-22`, `RTM-25`, `RTM-26`, `RTM-27`)

| Criterion | Status | Verified Evidence |
| :--- | :--- | :--- |
| **Typecheck, Build & Full `node:test` Suite (`0` skipped)** | `[x] PASS` | `npm run typecheck` exit `0`; `npm run build` compiled 5 bundles; `npm test` passed `77/77` unit+contract+E2E tests across `21` suites (`2837.67ms`) + `2/2` sequential benchmarks (`0.153ms` JS / `40.598ms` OS median). |
| **Incremental RPCs & `34`-Byte ETag Caching (`RTM-25`, `L-004`)** | `[x] PASS` | `MAX_CONCURRENT_META_RPCS = 6` concurrency cap; `GetCascadeTrajectoryGeneratorMetadata` skipped when `stepCount` unchanged; `GetCascadeTrajectory === 0`; `GetCascadeTrajectorySteps` `RUNNING`-only with `stepOffset` + `disableRehydration: true`; `/api/timeline` and `/api/fleet` emit exact `34`-byte `{"unchanged":true,"etag":"..."}`. |
| **Read-Only, Validation (`L-007`), CSP & XSS Defense (`RTM-26`, `RTM-27`)** | `[x] PASS` | `ZERO_AS_ANY_OK`; forbidden RPC scan matches only `FORBIDDEN_LS_METHODS` in `src/rpc/ls-client.ts:27-31`; `make400Json` returns HTTP `400` `Response` on invalid UUID/`scope`; `STRICT_CSP` enforced; `escapeHtml()` blocks `<script>` / `<img onerror=...>` XSS in Timeline and Fleet views. |
| **Frozen Stage 1 Integrity (`src/ui/main.ts`, `src/types/telemetry.ts`)** | `[x] PASS` | `git diff HEAD -- src/ui/main.ts src/types/telemetry.ts` verified empty (`0` modifications vs Stage 1 `bbf1a68`). |
| **Browser Visual QA (`VIS-01`–`VIS-06` + Rechecks)** | `[x] PASS` | `VIS-01`–`VIS-06` plus post-fix `VIS-04-R`, `VIS-05-R`, `VIS-06-R` & `VIS-01`/`VIS-03` regression checks all passed with `scrollWidth <= clientWidth` and `0` console/page errors. |
| **Plugin Hygiene, Context Governance & Strict Mermaid (`D-007`, `L-008`)** | `[x] PASS` | `npm run install:global` atomically installed `19` files; `agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json` returned `findings: []` (`rules: 0`); `verify-context.mjs` `PASS`; `agy-pele check . --strict-mermaid` returned `0 error(s), 0 warning(s)`. |

### 2.2 Verified Stage 2 Implementation, Bundle & Test Inventory

- **`S2-A` (Pure Builders, Telemetry Engine & Sidecar APIs)**:
  - [`src/core/timeline-builder.ts`](../../src/core/timeline-builder.ts): Exports `OVERTHINKING_RATIO_THRESHOLD_PCT` (`75`), `OVERTHINKING_SHORT_RESPONSE_MAX_TOKENS` (`500`), `isOverthinkingTurn`, and `buildTimelineTurns`; enforces `L-001`–`L-003` via `formatters.ts`, sorts chronologically ascending (`compareSortableTurnsAsc`) before assigning `turnIndex` and per-`cascadeId` `routingChangedFromPrevTurn`, and returns reverse-chronological turns.
  - [`src/core/fleet-builder.ts`](../../src/core/fleet-builder.ts): Exports `ROLLING_5H_WINDOW_MS`, `compactModelLabel`, and `buildFleetSnapshot`; computes `activeHeadline` + deterministic `modelHistogram`, groups projects with `'Workspace Unavailable'` fallback and `maxIdleTreesPerProject = 5`, caps rolling 5h `topQuotaBurners` at `5` with non-negative `consumed5hPct`/`delta5hPct`, and guarantees empty-state arrays.
  - [`src/sidecar/telemetry-engine.ts`](../../src/sidecar/telemetry-engine.ts): Caps cold-boot `GetCascadeTrajectoryGeneratorMetadata` fetches at `MAX_CONCURRENT_META_RPCS = 6` (`runWithConcurrency`), gates `GetCascadeTrajectorySteps` strictly on `CASCADE_RUN_STATUS_RUNNING`, syncs `config.json` via `syncConfigIfModified()`, strips volatile timestamps in `stripVolatileFleetFields` for deterministic ETags, implements `getTimelineSnapshot` & `getFleetSnapshot`, and populates `live-snapshot.json.fleet` atomically (`persistLiveSnapshot`).
  - [`src/sidecar/server.ts`](../../src/sidecar/server.ts): Wires `GET /api/timeline` and `GET /api/fleet` with `make400Json` `Response` validation (`L-007`), `config.timelineScope` fallback when `scope` is omitted, `34`-byte `UnchangedEtagResponse` hits, and `STRICT_CSP`.
  - [`tests/unit/timeline-fleet.test.ts`](../../tests/unit/timeline-fleet.test.ts): `11` unit & integration tests across `core/timeline-builder`, `core/fleet-builder`, and `sidecar/telemetry-engine & server` suites.
- **`S2-B` (Frontend `/hud` Timeline Tab, `/fleet` Sidebar, CSS & Preview Fixtures)**:
  - [`src/ui/fleet-view.ts`](../../src/ui/fleet-view.ts): Implements `createFleetView` replacing Stage 1's `/fleet` placeholder: Active Compute Heatmap, Cross-Project Matrix with `activeWorkspaceUris` badge and persistent `expandedTreeIds` node drawers, Top 5 Quota Burners leaderboard, Global Quota 2×2 bars, and `escapeHtml()` XSS sanitization.
  - [`src/ui/hud-view.ts`](../../src/ui/hud-view.ts): Replaces `[data-testid="timeline-placeholder"]` with interactive `Timeline 调用轴` tab: `当前会话` / `整棵会话树` scope toggle, `TTFT`/`Streaming` legend, dual-segment horizontal flame bars with external `.tabular-nums` readouts (`TTFT`, `Stream`, `tok/s`, `Σ`), `💡 Overthinking`, `⚠ Retried ×N`, routing shift pills, and subagent `[↗]` jump chips.
  - [`src/ui/state.ts`](../../src/ui/state.ts): Routes `/hud` vs `/fleet` while keeping [`src/ui/main.ts`](../../src/ui/main.ts) frozen; polls `/api/timeline` strictly when `activeTab === 'timeline'` with `AbortController` + `timelineEpoch` cancellation and `POST /api/config` scope persistence; drives `/fleet` adaptive polling (`1000ms` active / `2500ms` idle), `window.sidecar.getWorkspaceUris`/`onWorkspaceChange` subscriptions, `expandedTreeIds` + `scrollTop` preservation, and UUID-validated `jumpToConversation`.
  - [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css): Adds Timeline flame bar & Fleet grid styles (`< 640px` 1-column stack, `>= 640px` 2-column `.pulse-fleet-grid`, `@media (max-width: 340px)` 1-column quota stack), Flexoki Light/Dark polarity + high-contrast `@media (forced-colors: active)`, and `L-016` drawer/burner pill wrapping fixes.
  - [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs): Serves `/api/timeline` and `/api/fleet` across `dense`, `alert`, and `idle` fixtures.
  - [`tests/e2e/fleet-timeline.test.ts`](../../tests/e2e/fleet-timeline.test.ts): `3` E2E tests verifying built `server.mjs` HTTP routes (`34B` ETag, `400` validation, `POST /api/config`), built `ui.js` / `styles.css` + `preview-ui.mjs` scenario payloads, and DOM XSS/drawer/action rendering.
- **Rebuilt Prebuilt Bundles (`D-005`)**:
  - [`sidecars/pulse_cockpit/dist/server.mjs`](../../sidecars/pulse_cockpit/dist/server.mjs) (`137K`) and [`sidecars/pulse_cockpit/dist/ui.js`](../../sidecars/pulse_cockpit/dist/ui.js) (`97K`), alongside `dist/hook-probe.cjs`, `dist/cli.cjs`, and `dist/mcp.cjs` with SPDX MIT headers.

---

## 3. Browser Visual QA Summary (`VIS-01`–`VIS-06` & Post-Fix Rechecks)

Verified against live `scripts/preview-ui.mjs` serving real compiled `sidecars/pulse_cockpit/styles.css` and `sidecars/pulse_cockpit/dist/ui.js`:

| Check ID | Viewport & Theme | View / Scenario | Verified Visual & DOM Assertions |
| :--- | :--- | :--- | :--- |
| **`VIS-01`** | `360×820` · Light | `/hud` `Timeline` (`dense`) | `scrollWidth <= clientWidth` (`bodyBox` `360×820`); `14` turns reverse-chronological (`Turn #14` down to `Turn #1`); purple TTFT & cyan Streaming dual flame bars with unclipped external metrics; `💡 Overthinking`, `⚠ Retried ×2`, and routing shift pills crisp; `0` console/page errors (also re-verified regression-free after CSS fix). |
| **`VIS-02`** | `360×820` · Dark | `/hud` `Timeline` (`dense`) | Flexoki dark contrast (`#100f0f` / `#1c1b1a`) verified; scope toggle `整棵会话树` (`14 turns`) -> `当前会话` (`6 turns`) updates list cleanly; `scrollWidth <= clientWidth`; `0` console/page errors. |
| **`VIS-03`** | `360×820` · Light | `/fleet` (`dense`) | Single-column stack (`gridBox` `334px` at `x: 8`); active headline (`🔥 活跃算力: 2 主会话 + 6 子代理`), histogram pills, 4 projects, Top 5 Burners, and sticky footer align with `0` overflow & `0` console/page errors (re-verified regression-free after CSS fix). |
| **`VIS-04` -> `VIS-04-R`** | `360×820` · Dark | `/fleet` (`dense` + expanded drawer) | Initial `vis04` caught `R…` / `S…` / `Sw…` kind badge crushing and clipped drawer model pills; after `styles.css` fix, `vis04_recheck` verified clean 2-row drawer layout, full `"Root"` / `"Subagent"` labels, full model pills (`Gemini 4 Carbon (High)`, `Gemini 4 Argon (Medium)`, `Orchestrator (Carbon)`, `Gemini 3.5 Flash`), aligned `[↗]` buttons, `aria-expanded="true"` persistence across polls (`2600ms`), `scrollWidth <= clientWidth`, and `0` console/page errors. |
| **`VIS-05` -> `VIS-05-R`** | `1024×820` · Light | `/fleet` (`dense`) | Initial `vis05` caught Top-5 Burners `#1`/`#3` clipping (`Gemini 4 Carbon (Hi…`); `vis05_recheck` verified balanced 2-column CSS Grid (`561.8px` left / `416.2px` right, `12px` gutter), unclipped `Gemini 4 Carbon (High)` Top-5 Burner badges, 4 Global Quota cards, `scrollWidth <= clientWidth`, and `0` console/page errors. |
| **`VIS-06` -> `VIS-06-R`** | `420×820` · Dark | `/fleet` (`alert`) | Verified narrow Dark `alert` viewport (`gridBox` `394px` at `x: 8`): initial `vis06` caught `Gemini 4 Carbon (Hi…` clipping in Top-5 Burners; `vis06_recheck` verified unclipped `Gemini 4 Carbon (High)` pills plus coral-red alert styling (`#af3029`) on `Gemini 5h: 14.2% (1h 18m)` in Global Quota and sticky footer, `scrollWidth <= clientWidth`, `0` console/page errors. *(Note: `STAGE_2_TIMELINE_FLEET_PLAN.md` §6 listed `VIS-06` at `1024×820` Dark `dense`; 2-column `1024px` layout was verified in `VIS-05-R` and Dark polarity across `VIS-02`, `VIS-04-R`, and `VIS-06-R`.)* |

---

## 4. Verbatim Master Stage 2 Gate Metrics (`steps/665/output.txt`)

Executed at Master Stage 2 verification after all Stage 2 code, CSS, test, and bundle edits (`Command exited with code 0.`):

```text
> antigravity-pulse@0.1.0 typecheck
> tsc --noEmit

> antigravity-pulse@0.1.0 build
> node scripts/build.mjs

[build] Compiled 5 bundles into dist/ and sidecars/pulse_cockpit/dist/

> antigravity-pulse@0.1.0 test
> npm run build && node scripts/build-tests.mjs && node --test .test-dist/unit--*.test.cjs .test-dist/contracts--*.test.cjs .test-dist/e2e--*.test.cjs && node --test .test-dist/benchmarks--*.test.cjs

[build] Compiled 5 bundles into dist/ and sidecars/pulse_cockpit/dist/
[build-tests] Compiled 15 test file(s) into .test-dist/
...
ℹ tests 77
ℹ suites 21
ℹ pass 77
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2837.668362
[bench] Metric 1 in-process JS (n=100): median=0.153ms p95=0.394ms max=1.255ms
[bench] Metric 2 OS fork+exec (n=10): median=40.598ms p95=44.518ms max=44.518ms
▶ Dual-metric honest hook latency benchmarks (D-004, RTM-24)
  ✔ Metric 1: in-process JS processHookPayload x100 stays <= 8.0ms (median & p95) with zero network I/O (22.614939ms)
  ✔ Metric 2: OS fork+exec dist/hook-probe.cjs x10 stays <= 50.0ms median and exits 0 (406.147002ms)
✔ Dual-metric honest hook latency benchmarks (D-004, RTM-24) (429.98994ms)
ℹ tests 2
ℹ suites 1
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 495.133596

> antigravity-pulse@0.1.0 install:global
> node scripts/install.mjs

[install] Installed 19 file(s) atomically to /home/springtian/.gemini/config/plugins/antigravity-pulse
[install] CLI linked at /home/springtian/.local/bin/agy-pulse
{
  "dir": ".",
  "manifest": "plugin.json",
  "name": "antigravity-pulse",
  "agentPluginsSpec": false,
  "components": {
    "agents": 0,
    "hooks": 1,
    "mcpServers": 1,
    "rules": 0,
    "sidecars": 1,
    "skills": 1
  },
  "findings": [
    {
      "severity": "warning",
      "file": "AGENTS.md",
      "message": "never loaded: plugins load rules only from rules/. Move it to rules/AGENTS.md"
    }
  ]
}
{
  "dir": "/home/springtian/.gemini/config/plugins/antigravity-pulse",
  "manifest": "plugin.json",
  "name": "antigravity-pulse",
  "agentPluginsSpec": false,
  "components": {
    "agents": 0,
    "hooks": 1,
    "mcpServers": 1,
    "rules": 0,
    "sidecars": 1,
    "skills": 1
  },
  "findings": []
}
[verify-context] PASS — AGENTS.md=5651B | rules=1 (alwaysOn=12960B) | skills=1 (+1 plugin) | links=26 | paths=59 on-disk, 0 planned
Checked 12 diagram(s) across 21 file(s): 0 error(s), 0 warning(s).
ZERO_AS_ANY_OK
src/rpc/ls-client.ts:27:  'DeleteCascadeTrajectory',
src/rpc/ls-client.ts:28:  'UpdateConversationAnnotations',
src/rpc/ls-client.ts:29:  'JetboxWriteState',
src/rpc/ls-client.ts:30:  'DeletePlugin',
src/rpc/ls-client.ts:31:  'InstallCustomization',
```

---

## 5. Follow-Ups Handed Off to Stage 3 (`S3-A`, `S3-B`, `S3-QA`)

1. **Consume Populated `$PULSE_STATE_DIR` Telemetry (`S3-A`, `S3-B`)**: Read populated `live-snapshot.json.fleet` (`projects`, `topQuotaBurners`, `activeHeadline`) and `config.json.timelineScope` inside `src/cli/*` (`agy-pulse top | status | config`) and `src/mcp/*` (`pulse_status_card`, `pulse_get_compute_budget`, `pulse_set_preference`).
2. **Preserve `L-013` Entrypoint Guard**: Gate `src/cli/main.ts` and `src/mcp/server.ts` on both `require.main === module` and `require.main?.filename` regex matching so `esbuild`-bundled tests never hang on `stdin`.
3. **Optional Minor Polish**: Optionally harmonize `computeFleetAdaptivePollMs` idle interval (`2500ms` vs `3000ms`), surface previous-turn model name on `routingChangedFromPrevTurn` shifts in [`src/ui/hud-view.ts`](../../src/ui/hud-view.ts), and change `semantic.quota.treeDeltaQuota5hPct` to `treeNetDelta5hPct` in [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs#L1240).
4. **Stage 3 Closeout Backfill & `--strict-paths`**: Backfill Stage 2's atomic commit SHA into [`STAGE_2_TIMELINE_FLEET_PLAN.md`](./STAGE_2_TIMELINE_FLEET_PLAN.md) and [`00_MASTER_IMPLEMENTATION_BLUEPRINT.md`](./00_MASTER_IMPLEMENTATION_BLUEPRINT.md) §6 during Stage 3 closeout, and run `node scripts/verify-context.mjs --strict-paths` once all Stage 3 files exist on disk.
