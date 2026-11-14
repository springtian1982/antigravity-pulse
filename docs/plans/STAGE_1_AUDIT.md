# Stage 1 Independent Audit Record (`STAGE_1_AUDIT.md`)

> **Stage**: `Stage 1` (MVP Core Telemetry Loop — Dual-Channel RPC+Hook, 7-State Machine & `/hud` `AUX_PANE`)  
> **Independent Referee**: `S1-QA` (`48de57b4`, `Independent Stage 1 Auditor`)  
> **Final Audit Verdict**: `VERDICT: APPROVED`  
> **Audit Date**: 2026-11-14  
> **Plan & Blueprint References**: [`STAGE_1_MVP_LOOP_PLAN.md`](./STAGE_1_MVP_LOOP_PLAN.md) · [`00_MASTER_IMPLEMENTATION_BLUEPRINT.md`](./00_MASTER_IMPLEMENTATION_BLUEPRINT.md) · [`DECISION_LOG.md`](./DECISION_LOG.md) · [`LESSONS_LEARNED.md`](./LESSONS_LEARNED.md)

---

## 1. Executive Verdict & Remediation Summary

`S1-QA` (`48de57b4`) independently audited all Stage 1 deliverables (`S1-A` pure core & read-only RPC, `S1-B` hook probe & zero-token inline stamp, `S1-C` `TelemetryEngine`, `SidecarApp`, `/hud` UI & `scripts/preview-ui.mjs`), prebuilt git-tracked bundles (`dist/hook-probe.cjs`, `sidecars/pulse_cockpit/dist/server.mjs`, `sidecars/pulse_cockpit/dist/ui.js`), static/runtime read-only contract tests (`tests/contracts/readonly-guard.test.ts`), dual-metric hook latency benchmarks (`tests/benchmarks/hook-latency.test.ts`), end-to-end integration gates (`tests/e2e/hud-loop.test.ts`, `tests/e2e/stage1-acceptance.test.ts`), and 5 post-fix browser screenshots (`V1`–`V5`) across `360×820` and `420×820` Flexoki Light/Dark viewports.

An initial `S1-QA` pass flagged `CHANGES_REQUIRED` on one blocking CSS/DOM contract mismatch and three minor findings (`[BLOCKING 1]`, `[Minor 3]`, `[Minor 4]`, `[Minor 5]`). Following targeted remediations, bundle rebuilds, and re-verification against live browser renders and Master's untruncated shell gate output, `S1-QA` issued **`VERDICT: APPROVED`**:

| Finding ID & Summary | Root Cause & Verified Remediation | Ledger Link |
| :--- | :--- | :--- |
| **`[BLOCKING 1]` Semantic CSS/DOM Bindings & `360px` Card Budgets** | Added `[data-tier]`, `[data-level]`, and `[data-phase]` attribute selectors alongside `.pulse-tier-*` classes in [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css); routed `<progress>` threshold fills (`normal` / `warn_70` / `critical_85`) via `--pulse-progress-fill` across strictly separate `::-webkit-progress-value` / `::-moz-progress-bar` blocks; stripped `scrollbar-gutter: stable` and focus outline rings on `.pulse-main` / `.pulse-hud-scroll`; budgeted `@media (max-width: 420px)` / `(max-width: 390px)` row widths so titles never crush to 1 character at `360px`. | [`L-014`](./LESSONS_LEARNED.md#l-014-cross-stage-cssdom-selector-contract-parity--inline-flex-ellipsis-v1v5-visual-qa) |
| **`[Minor 3]` `inline-flex` `.pulse-btn-label` Ellipsis** | Wrapped pill button text inside `<span class="pulse-btn-label">` (`display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`) inside `inline-flex` `.pulse-node-model-btn` buttons in [`src/ui/hud-view.ts`](../../src/ui/hud-view.ts) and [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css), replacing abrupt clipping with crisp `…` ellipsis. | [`L-014`](./LESSONS_LEARNED.md#l-014-cross-stage-cssdom-selector-contract-parity--inline-flex-ellipsis-v1v5-visual-qa) |
| **`[Minor 4]` Monotonic `turnEpoch` Across Mixed Hook Streams** | Updated `advanceTurnEpochOnStop` and `evaluatePostInvocationStamp` in [`src/hook/hook-probe.ts`](../../src/hook/hook-probe.ts) to advance `turnEpoch` monotonically across mixed numbered `PostInvocation` events and unnumbered `Stop` / `PostInvocation` sequences; locked with regression coverage in [`tests/unit/hook-probe.test.ts`](../../tests/unit/hook-probe.test.ts). | [`src/hook/hook-probe.ts`](../../src/hook/hook-probe.ts) |
| **`[Minor 5]` Breadcrumb `[← 父会话]` Selector Parity** | Aligned [`STAGE_1_MVP_LOOP_PLAN.md`](./STAGE_1_MVP_LOOP_PLAN.md) §4 specification with the implemented `data-action="jump-node"` + `data-cid="${parentCid}"` attributes in [`src/ui/hud-view.ts`](../../src/ui/hud-view.ts). | [`STAGE_1_MVP_LOOP_PLAN.md`](./STAGE_1_MVP_LOOP_PLAN.md) |
| **Sequential Benchmark Runner & Preview Determinism** | Split functional suites (`unit--*.test.cjs contracts--*.test.cjs e2e--*.test.cjs`) from sequential `benchmarks--*.test.cjs` in [`package.json`](../../package.json) to eliminate `~30ms` parallel CPU contention against `D-004` (`<= 50.0ms` OS budget); added `require.main?.filename` entrypoint guard in [`src/hook/hook-probe.ts`](../../src/hook/hook-probe.ts) and deterministic `?theme=dark\|light`, `?scenario=`, `Referer`, and array-guarded `computePreviewEtag()` in [`src/ui/main.ts`](../../src/ui/main.ts) and [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs). | [`D-009`](./DECISION_LOG.md#d-009-sequential-benchmark-runner-isolation-in-packagejson-test-script) · [`L-013`](./LESSONS_LEARNED.md#l-013-esbuild-cjs-test-bundle-hoisting-of-requiremain--module) · [`L-015`](./LESSONS_LEARNED.md#l-015-sequential-benchmark-isolation-d-009--deterministic-headless-preview-themescenario-hooks) |

---

## 2. Gate Sign-Off Checklist (`STAGE_1_MVP_LOOP_PLAN.md` §6.3) & Deliverables

### 2.1 §6.3 Gate Sign-Off Checklist

| Criterion (`STAGE_1_MVP_LOOP_PLAN.md` §6.3) | Status | Verified Evidence |
| :--- | :--- | :--- |
| **All automated gate commands exit `0` with `0` skipped tests** | `[x] PASS` | `npm run typecheck`, `npm run build`, `npm test` (`63/63` unit/contract/E2E + `2/2` benchmarks = `65/65`, `fail 0`, `skipped 0`), `node scripts/verify-context.mjs`, `agy-pele check`. |
| **Dual-metric hook latency (`D-004`, `RTM-24`)** | `[x] PASS` | In-process JS (`n=100`): `median=0.198ms`, `p95=0.499ms` (`<= 8.0ms`); OS `fork+exec` (`n=10`): `median=42.692ms` (`<= 50.0ms`) in `npm test`, and `0.220ms` JS / `43.999ms` OS median in isolated run; zero network I/O verified statically and dynamically. |
| **Browser Visual Inspection (`V1`–`V5`)** | `[x] PASS` | All 5 viewport/theme/scenario checks (`360×820` & `420×820`, Flexoki Light & Dark) passed with `scrollWidth === clientWidth`, `0` console/page errors, verified Flexoki RGB tiers, and crisp `…` ellipsis. |
| **Read-Only & Zero-Token Guarantees (`RTM-03`, `RTM-26`, `D-007`)** | `[x] PASS` | AST + runtime mock LS tests block all forbidden/unknown RPCs and `GetCascadeTrajectory`, enforce `?mode=ro` SQLite, enforce `stepOffset` + `disableRehydration: true`, emit `systemMessage.systemMessage === ""` on stamps, report `components.rules === 0`, and emit `findings: []` on strict installed plugin validation. |
| **Audit Report & Atomic Stage 1 Commit** | `[x] PASS` | `docs/plans/STAGE_1_AUDIT.md` recorded with `VERDICT: APPROVED` prior to atomic Stage 1 git commit on `main`. |

### 2.2 Verified Stage 1 Implementation & Test Inventory

- **`S1-A` (Pure Core & Read-Only RPC)**:
  - [`src/rpc/ls-client.ts`](../../src/rpc/ls-client.ts): Read-only 5-method `ReadOnlyLsClient` allowlist with loopback HTTP (`x-codeium-csrf-token`), `FORBIDDEN_LS_METHODS` guard, and `L-004` `stepOffset` + `disableRehydration: true` enforcement.
  - [`src/core/formatters.ts`](../../src/core/formatters.ts), [`src/core/model-catalog.ts`](../../src/core/model-catalog.ts), [`src/core/quota-calculator.ts`](../../src/core/quota-calculator.ts), [`src/core/state-machine.ts`](../../src/core/state-machine.ts), [`src/core/topology-builder.ts`](../../src/core/topology-builder.ts), [`src/core/etag.ts`](../../src/core/etag.ts): Int64 coercion (`L-001`), cache hit ratio (`L-002`), `retryInfos` baseline (`L-003`), 5-tier model decoding, 8-decimal `ΔQuota%`, Smart Governance Banner truth table, 7-state lifecycle + Anti-Stale Reconciler, 3-source topology fusion (`subagents/*.json`, `swarm/members.json` object map per `L-005`, optional `?mode=ro` SQLite fallback), deterministic 6-char ETag + `34B` `unchanged` payload, and HTML/Markdown XSS escaping.
- **`S1-B` (Hook Probe & Zero-Token Inline Stamp)**:
  - [`src/hook/hook-probe.ts`](../../src/hook/hook-probe.ts) -> [`dist/hook-probe.cjs`](../../dist/hook-probe.cjs): Zero-network `O_APPEND` ring writer, fail-open stdout dispatch (`PreToolUse` -> `{"decision":"allow"}`, `PostToolUse`/`Stop` -> `{}` per `L-006`), `smart`/`every-turn`/`off` inline `user_markdown` stamps linking `sidecar://antigravity-pulse/pulse_cockpit/hud` (`D-002`), monotonic `turnEpoch` across mixed `Stop`/`PostInvocation` hooks, `200`-entry LRU dedup pruning, and `require.main?.filename` CJS bundle guard (`L-013`).
- **`S1-C` (Sidecar Engine, Server & `/hud` UI)**:
  - [`src/sidecar/telemetry-engine.ts`](../../src/sidecar/telemetry-engine.ts), [`src/sidecar/server.ts`](../../src/sidecar/server.ts) -> [`sidecars/pulse_cockpit/dist/server.mjs`](../../sidecars/pulse_cockpit/dist/server.mjs): Adaptive `1s`/`3s` polling + `fs.watch` on `events.ring.jsonl`, incremental metadata & `RUNNING`-only steps (`RTM-25`, `L-004`), `Response`-wrapped MIME/CSP/400/401 guards (`L-007`), and `34B` ETag hits.
  - [`src/ui/main.ts`](../../src/ui/main.ts), [`src/ui/state.ts`](../../src/ui/state.ts), [`src/ui/hud-view.ts`](../../src/ui/hud-view.ts), [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css) -> [`sidecars/pulse_cockpit/dist/ui.js`](../../sidecars/pulse_cockpit/dist/ui.js): `/hud` cockpit (`Hero` + `Overview`/`Timeline` stub/`Quota` tabs + `Agent Matrix` + `Fuel Bar`), `/fleet` Stage 2 placeholder seam, 100ms stopwatch ticker, `?theme=dark|light` determinism (`L-015`), and `V1`–`V5` layout remediations (`L-014`).
- **Automated Test Suite (`13` test files, `65/65` tests passing)**:
  - Unit (`8` files): `tests/unit/state-dir.test.ts`, [`tests/unit/core-catalog.test.ts`](../../tests/unit/core-catalog.test.ts), [`tests/unit/core-etag.test.ts`](../../tests/unit/core-etag.test.ts), [`tests/unit/core-metrics.test.ts`](../../tests/unit/core-metrics.test.ts), [`tests/unit/core-quota.test.ts`](../../tests/unit/core-quota.test.ts), [`tests/unit/core-state-machine.test.ts`](../../tests/unit/core-state-machine.test.ts), [`tests/unit/hook-probe.test.ts`](../../tests/unit/hook-probe.test.ts), [`tests/unit/topology-builder.test.ts`](../../tests/unit/topology-builder.test.ts).
  - Contracts (`2` files): [`tests/contracts/manifest-contracts.test.ts`](../../tests/contracts/manifest-contracts.test.ts), [`tests/contracts/readonly-guard.test.ts`](../../tests/contracts/readonly-guard.test.ts).
  - Benchmarks (`1` file): [`tests/benchmarks/hook-latency.test.ts`](../../tests/benchmarks/hook-latency.test.ts).
  - E2E (`2` files): [`tests/e2e/hud-loop.test.ts`](../../tests/e2e/hud-loop.test.ts), [`tests/e2e/stage1-acceptance.test.ts`](../../tests/e2e/stage1-acceptance.test.ts).

---

## 3. Browser Visual QA Summary (`V1`–`V5` Flexoki Light/Dark `360px` / `420px`)

Verified across 5 post-fix browser renders (`V1`–`V5`) against live `scripts/preview-ui.mjs` serving real compiled `sidecars/pulse_cockpit/styles.css` and `sidecars/pulse_cockpit/dist/ui.js`:

| Check ID | Viewport & Theme | Scenario / State | Verified Visual & DOM Assertions |
| :--- | :--- | :--- | :--- |
| **`V1`** | `360×820` · Flexoki Light | `dense` · `Overview` (`active-first`) | `scrollWidth === clientWidth` (`0` overflow); Hero, `Requested ➔ Served`, `CTX` / `Cache Hit` bars, `[← 父会话]` breadcrumb button, and 3-row Subagent + Swarm cards cleanly aligned with verified Flexoki RGB tier dots/pills/borders and crisp `…` ellipsis (`0` console/page errors). |
| **`V2`** | `360×820` · Flexoki Dark | `dense` · `Overview` (`topology-tree`) | Dark Flexoki `#100f0f` / `#1c1b1a` polarity verified; bounded topology indentation fits within `360px` (`scrollWidth === clientWidth`); `.pulse-pill` model badge popover stays inside viewport bounds (`0` console/page errors). |
| **`V3`** | `420×820` · Flexoki Light | `alert` · `Overview` | Smart Governance Banner visible (`>= 3 apex` & `14.2%` 5h); `CTX = 88.4%` (`critical_85`) coral-red `<progress>` fill verified; `⚠ Retried ×2` red alert badge high-contrast; low-quota `< 15%` red indicator verified in Fuel Bar (`0` console/page errors). |
| **`V4`** | `420×820` · Flexoki Dark | `dense` · `Quota`, `Timeline`, `[↗]` Jump | `Quota` tab renders all 4 buckets + burn rate; Stamp switcher persists via `POST /api/config`; `Timeline` tab renders clean Stage 2 stub; `[↗]` jump invokes `toggleConversation(subCid)` cleanly (`0` console/page errors). |
| **`V5`** | `360×820` · Flexoki Light | `idle` · `Overview` (idle group toggle) | Hero displays gray `⚪ Idle` dot + elapsed idle age; collapsed idle group (`已完成 / 空闲节点 (4)`) expands cleanly with verified purple/cyan Flexoki tier cards and crisp `…` pill truncation (`Gemini 4 Carbon…`, `0` console/page errors). |

---

## 4. Verbatim Post-Remediation Gate Metrics (Master Verification Run)

Executed after all Stage 1 code, style, test, and bundle remediations:

```text
$ npm run typecheck
> antigravity-pulse@0.1.0 typecheck
> tsc --noEmit

$ npm run build
> antigravity-pulse@0.1.0 build
> node scripts/build.mjs

[build] Compiled 5 bundles into dist/ and sidecars/pulse_cockpit/dist/

$ npm test
> antigravity-pulse@0.1.0 test
> npm run build && node scripts/build-tests.mjs && node --test .test-dist/unit--*.test.cjs .test-dist/contracts--*.test.cjs .test-dist/e2e--*.test.cjs && node --test .test-dist/benchmarks--*.test.cjs

[build] Compiled 5 bundles into dist/ and sidecars/pulse_cockpit/dist/
[build-tests] Compiled 13 test file(s) into .test-dist/
ℹ tests 63
ℹ suites 17
ℹ pass 63
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2479.831697
[bench] Metric 1 in-process JS (n=100): median=0.198ms p95=0.499ms max=1.454ms
[bench] Metric 2 OS fork+exec (n=10): median=42.692ms p95=45.869ms max=45.869ms
▶ Dual-metric honest hook latency benchmarks (D-004, RTM-24)
  ✔ Metric 1: in-process JS processHookPayload x100 stays <= 8.0ms (median & p95) with zero network I/O (29.204853ms)
  ✔ Metric 2: OS fork+exec dist/hook-probe.cjs x10 stays <= 50.0ms median and exits 0 (434.369706ms)
✔ Dual-metric honest hook latency benchmarks (D-004, RTM-24) (465.110327ms)
ℹ tests 2
ℹ suites 1
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 542.223831

$ node --test .test-dist/benchmarks--hook-latency.test.cjs
[bench] Metric 1 in-process JS (n=100): median=0.220ms p95=0.472ms max=1.799ms
[bench] Metric 2 OS fork+exec (n=10): median=43.999ms p95=49.352ms max=49.352ms
▶ Dual-metric honest hook latency benchmarks (D-004, RTM-24)
  ✔ Metric 1: in-process JS processHookPayload x100 stays <= 8.0ms (median & p95) with zero network I/O (31.066658ms)
  ✔ Metric 2: OS fork+exec dist/hook-probe.cjs x10 stays <= 50.0ms median and exits 0 (452.183431ms)
✔ Dual-metric honest hook latency benchmarks (D-004, RTM-24) (484.893817ms)
ℹ tests 2
ℹ suites 1
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 565.640324

$ /home/springtian/.local/bin/agy plugin validate . --json
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

$ npm run install:global
[install] Installed 19 file(s) atomically to /home/springtian/.gemini/config/plugins/antigravity-pulse
[install] CLI linked at /home/springtian/.local/bin/agy-pulse

$ /home/springtian/.local/bin/agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json
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

$ node scripts/verify-context.mjs
[verify-context] PASS — AGENTS.md=5651B | rules=1 (alwaysOn=12960B) | skills=1 (+1 plugin) | links=26 | paths=57 on-disk, 2 planned

$ /home/springtian/.local/bin/agy-pele check docs/plans/STAGE_1_MVP_LOOP_PLAN.md --strict-mermaid
Checked 1 diagram(s) across 1 file(s): 0 error(s), 0 warning(s).
```

---

## 5. Follow-Ups Handed Off to Stage 2 (`S2-A`, `S2-B`, `S2-QA`)

1. **Consume Stage 1 HUD Tab Hooks (`S2-B`)**: Replace the `Timeline` tab stub (`[data-testid="timeline-placeholder"]`) in [`src/ui/hud-view.ts`](../../src/ui/hud-view.ts) and the `/fleet` placeholder (`[data-testid="fleet-placeholder"]`) in [`src/ui/state.ts`](../../src/ui/state.ts) while keeping [`src/ui/main.ts`](../../src/ui/main.ts) immutable.
2. **Preserve `D-009` & `L-013`–`L-015` Discipline**: Keep sequential benchmark isolation in [`package.json`](../../package.json), verify both class and `data-*` attribute bindings in CSS (`L-014`), and retain `?theme=`/`?scenario=` determinism in [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs) when adding Stage 2 `Timeline` and `/fleet` preview scenarios.
3. **Master Blueprint SHA Backfill**: Backfill Stage 1's atomic commit SHA into [`00_MASTER_IMPLEMENTATION_BLUEPRINT.md`](./00_MASTER_IMPLEMENTATION_BLUEPRINT.md) §6 during Stage 2 closeout (same pattern used for Stage 0 `5ca47d4`).
