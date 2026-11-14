# Stage 0 Independent Audit Record (`STAGE_0_AUDIT.md`)

> **Stage**: `Stage 0` (Engineering & UI/UX Design Foundation)  
> **Independent Referee**: `S0-QA` (`ba16e33c`, `Independent Stage 0 Auditor`)  
> **Final Audit Verdict**: `VERDICT: APPROVED`  
> **Audit Date**: 2026-11-14  
> **Plan & Blueprint References**: [`STAGE_0_FOUNDATION_PLAN.md`](./STAGE_0_FOUNDATION_PLAN.md) · [`00_MASTER_IMPLEMENTATION_BLUEPRINT.md`](./00_MASTER_IMPLEMENTATION_BLUEPRINT.md) · [`DECISION_LOG.md`](./DECISION_LOG.md) · [`LESSONS_LEARNED.md`](./LESSONS_LEARNED.md)

---

## 1. Executive Verdict & Remediation Summary

`S0-QA` (`ba16e33c`) independently audited all Stage 0 code (`S0-A`), UI/UX & Stitch artifacts (`S0-B`), manifests, cross-platform launchers, prebuilt bundles, inode-preserving installer, and automated tests (`17/17` passing). After an initial `CHANGES_REQUIRED` review pass caught three subtle runtime and layout edge cases, all remediations were verified and `S0-QA` issued **`VERDICT: APPROVED`**:

| Finding / Remediation | Root Cause & Fix Verified | Ledger Link |
| :--- | :--- | :--- |
| Ephemeral port `0` fallback in `scripts/preview-ui.mjs` | Replaced `Number(raw) || 4173` with strict `parsePortValue` (`Number.isInteger(n) && n >= 0 && n <= 65535`) and logged bound `server.address().port`; verified via `--port 0`, `--port=0`, and `PORT=0` subprocess tests. | [`L-012`](./LESSONS_LEARNED.md#l-012-ephemeral-port-0-falsy-coercion-numberraw--4173-posix-set--eu-home--guard--progress--pulse-app-overflow-containment) |
| POSIX `set -eu` `HOME` guard in `bin/agy-pulse` | Applied `"${HOME:-}"` consistently across both `[ -x ... ]` check and `exec` invocation in `bin/agy-pulse` (`0o755`, LF). | [`L-012`](./LESSONS_LEARNED.md#l-012-ephemeral-port-0-falsy-coercion-numberraw--4173-posix-set--eu-home--guard--progress--pulse-app-overflow-containment) |
| `<progress>` clipping & outer `#pulse-app` flex containment | Added `overflow: clip;` on `.pulse-progress` and `height: 100dvh; max-height: 100dvh; overflow: hidden;` on `.pulse-app` (`#pulse-app`) paired with `min-height: 0; overflow-y: auto;` on `.pulse-main`. | [`L-012`](./LESSONS_LEARNED.md#l-012-ephemeral-port-0-falsy-coercion-numberraw--4173-posix-set--eu-home--guard--progress--pulse-app-overflow-containment) |
| Host `preload.js` `#fafafa` override & Amber WCAG contrast | Bound `--pulse-bg: var(--background, var(--pulse-paper))` with `!important` on `body`, re-declared `--pulse-*` in `[data-resolved-theme="light"|"dark"]`, and added `*-ink` tokens (`#5c4500` / `#f3da8b`) alongside Flexoki Amber (`#ad8301` / `#d0a215`). | [`D-008`](./DECISION_LOG.md#d-008-host-css-variable-mapping-preloadjs-fafafa-override--stitch-explicit---project-invocation) |

---

## 2. Deliverables & Automated Contract Verification

### 2.1 `S0-A` Engineering Foundation & Plugin Plumbing

- **Toolchain & Hygiene**: [`package.json`](../../package.json) (zero runtime `dependencies`, all 6 required scripts, strict `"files"` allowlist omitting `.agents/`, `rules/`, `src/`, `tests/`, `.stitch/`, `AGENTS.md`), [`package-lock.json`](../../package-lock.json), [`tsconfig.json`](../../tsconfig.json) (`strict: true`, `allowJs: true`, `checkJs: false`, `noEmit: true`).
- **Antigravity 2.0 Manifests & On-Demand Skill**:
  - [`plugin.json`](../../plugin.json) (`antigravity-pulse` / `Model Pulse`, valid `assets/logo.svg`, `suggestedPrompts`).
  - [`hooks.json`](../../hooks.json) (`"pulse-telemetry"` `JSONHookSpec` wrapper, grouped `PreToolUse` / `PostToolUse` with `matcher: "*"`, flat `PreInvocation` / `PostInvocation` / `Stop`, `timeout: 5`, per `L-006`).
  - [`mcp_config.json`](../../mcp_config.json) (`antigravity-pulse` -> `node dist/mcp.cjs`).
  - [`sidecars/pulse_cockpit/sidecar.json`](../../sidecars/pulse_cockpit/sidecar.json) (single-process dual-view `/hud` `AUX_PANE` + `/fleet` `SIDEBAR` per `D-002`).
  - [`skills/model-pulse/SKILL.md`](../../skills/model-pulse/SKILL.md) (valid frontmatter, canonical `sidecar://antigravity-pulse/pulse_cockpit/hud`, zero root `rules/` directory per `D-007`).
- **Cross-Platform Launchers**: [`bin/agy-pulse`](../../bin/agy-pulse) (LF, `0o755`), [`bin/agy-pulse.cmd`](../../bin/agy-pulse.cmd) (CRLF), [`bin/agy-pulse.ps1`](../../bin/agy-pulse.ps1) (CRLF) with `node` -> `agy-node` fallback.
- **Frozen Contracts & State Bus**: [`src/types/telemetry.ts`](../../src/types/telemetry.ts), [`src/types/rpc.ts`](../../src/types/rpc.ts), [`src/types/sidecar-sdk.d.ts`](../../src/types/sidecar-sdk.d.ts), [`src/types/index.ts`](../../src/types/index.ts), [`src/state/state-dir.ts`](../../src/state/state-dir.ts) (`0o700`/`0o600`, atomic `tmp + renameSync`, UUID validator, `512 KiB` ring rotation), [`src/state/config-store.ts`](../../src/state/config-store.ts) (defaults, validation, `__proto__` pollution defense).
- **Scaffolds, Build/Test/Install Scripts & Prebuilt Bundles**: [`scripts/build.mjs`](../../scripts/build.mjs), [`scripts/build-tests.mjs`](../../scripts/build-tests.mjs), [`scripts/install.mjs`](../../scripts/install.mjs), [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs), and all 5 SPDX-MIT bundles (`dist/hook-probe.cjs`, `dist/mcp.cjs`, `dist/cli.cjs`, `sidecars/pulse_cockpit/dist/server.mjs` with externalized `sidecar_sdk` + `Response` + strict CSP, `sidecars/pulse_cockpit/dist/ui.js`).

### 2.2 `S0-B` UI/UX Design, `modern-web-guidance` & Flexoki Shell

- **Canonical Design System & Web Standards**: [`DESIGN.md`](../../DESIGN.md), [`sidecars/pulse_cockpit/index.html`](../../sidecars/pulse_cockpit/index.html) (`<meta name="color-scheme" content="light dark">`, strict CSP load order `/preload.js` -> `/styles.css` -> `/dist/ui.js`, zero inline `<script>` / external CDNs), [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css) (all 10 Flexoki Light/Dark 5-tier hexes, `tabular-nums`, split `::-webkit-progress-value` / `::-moz-progress-bar` selectors, `@supports (position-area: block-end)` + fallback, `@media (prefers-reduced-motion: reduce)` & `@media (forced-colors: active)`).

### 2.3 `S0-QA` Automated Test Harness

- [`tests/unit/state-dir.test.ts`](../../tests/unit/state-dir.test.ts): 9 passing unit tests covering state directory resolution precedence, `0o700`/`0o600` permissions, atomic writes without orphan `.tmp` files, `readJsonSafe` fallbacks, UUID validation, `512 KiB` ring rotation, and `config-store` persistence + prototype-pollution defense.
- [`tests/contracts/manifest-contracts.test.ts`](../../tests/contracts/manifest-contracts.test.ts): 8 passing contract & smoke tests covering `package.json` allowlist, plugin manifests, launchers & SPDX-MIT bundles, `hook-probe.cjs` fail-open stdout (`{"decision":"allow"}` / `{}`), `cli.cjs` & `mcp.cjs` scaffolds, `install.mjs` inode preservation + `--strict` `agy plugin validate` + `--force-patch` isolation, `preview-ui.mjs` `--port 0` / `--port=0` / `PORT=0` asset + API serving, and `index.html` / `styles.css` / `DESIGN.md` contracts.

---

## 3. Live Stitch MCP Verification & Visual Screenshot Inspection

Verified live via MCP `stitch_get` against Stitch Canvas project `9409889379743133909` (`Antigravity Model Pulse`) and inspected local decoded PNG screenshots (`screenshot_decoded.png`) in gitignored scratch `.stitch/exports/9409889379743133909/`:

| Resource | Stitch ID | Type & Dimensions | Live Inspection Findings |
| :--- | :--- | :--- | :--- |
| **Model Pulse HUD - Aux Pane** | `af32887f71e7494e9e38e4ae4ef39b52` | `DESIGN` · `DESKTOP` · `2560x2048` | Confirms Flexoki Light `#fffcf0` / `#f2f0e5` surfaces, 5-tier pills, 3-row agent matrix cards, and Smart Governance Banner. **Captured `360px` truncation risk (`L-011`)**: right-edge clipping near top tabbar (`Quota 配额` vs icon buttons), hero `Auto -> Gemini...` vs `✓ gemini-4-argon`, and bottom fuel bar `Wk: 96.5%` next to `本树 -1.68%` / `smart`. |
| **Antigravity 2.0 Model Pulse Fleet Radar** | `630bde1beb414834bcefe327fcf73551` | `DESIGN` · `DESKTOP` · `2560x2048` | Confirms multi-project radar (`antigravity-pulse`, `data-agent-kit`), active headline, Top 5 Quota Burners leaderboard, and 4-bucket Global Quota Budgets cards; minor bottom footer text clipping behind the `smart` pill also flagged for `S2-B`. |
| **`DESIGN.md` Document** | `16500565309143592318` | `DOCUMENT` · `780x1768` | Mounted in project `9409889379743133909`; note `stitch find screens` returns only `DOCUMENT` items (`L-011`). |

---

## 4. Global Install Diff & Zero-Token Hygiene Audit

Installed bundle inspection at `~/.gemini/config/plugins/antigravity-pulse` after `npm run install:global`:
- **Zero-Leakage Check**: Installed directory contains only `plugin.json`, `hooks.json`, `mcp_config.json`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `assets/`, `bin/`, `dist/`, `sidecars/`, and `skills/`. Zero `AGENTS.md`, `.agents/`, `rules/`, `src/`, `tests/`, or `.stitch/` files exist in the installed plugin (`D-007`).
- **Strict Host Validation**: `agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json` exited `0` with `"findings": []` (`rules: 0`, `hooks: 1`, `mcpServers: 1`, `sidecars: 1`, `skills: 1`).
- **Repo Root Validation**: `agy plugin validate . --json` exited `0` with `0` errors and `components.rules === 0` (emitting only the expected contributor `AGENTS.md` `"never loaded"` warning per `L-008`).

---

## 5. Post-Edit Gate Suite Verbatim Evidence

```text
$ npm run typecheck
> antigravity-pulse@0.1.0 typecheck
> tsc --noEmit

$ npm run build
> antigravity-pulse@0.1.0 build
> node scripts/build.mjs

[build] Compiled 5 bundles into dist/ and sidecars/pulse_cockpit/dist/

$ npm test
[build] Compiled 5 bundles into dist/ and sidecars/pulse_cockpit/dist/
[build-tests] Compiled 2 test file(s) into .test-dist/
ℹ tests 17
ℹ suites 5
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1021.493138

$ npm run install:global
[install] Installed 19 file(s) atomically to /home/springtian/.gemini/config/plugins/antigravity-pulse
[install] CLI linked at /home/springtian/.local/bin/agy-pulse

$ ls -1A ~/.gemini/config/plugins/antigravity-pulse | sort
assets
bin
dist
hooks.json
LICENSE
mcp_config.json
plugin.json
README.md
sidecars
skills
THIRD_PARTY_NOTICES.md

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
[verify-context] PASS — AGENTS.md=5651B | rules=1 (alwaysOn=12960B) | skills=1 (+1 plugin) | links=26 | paths=47 on-disk, 12 planned

$ /home/springtian/.local/bin/agy-pele check . --strict-mermaid
Checked 12 diagram(s) across 20 file(s): 0 error(s), 0 warning(s).
```

---

## 6. Known Follow-Ups Handed Off to Stage 1

1. **`S1-C` (`360px` HUD Overflow & Truncation Vigilance)**: Implement `min-width: 0`, scrollable tab overflow, and compact badge formatting across the top tabbar, hero `Requested ➔ Served` nameplate, and bottom `36px` fuel bar so zero labels clip at `360px` (`L-011`).
2. **`S1-C` / `S1-QA` (Live `SidecarApp` Runtime HTTP Integration Tests)**: Add live HTTP tests against `src/sidecar/server.ts` verifying `/`, `/hud`, `/fleet`, `/styles.css` (`text/css`), `/dist/ui.js` (`application/javascript`), strict CSP headers, `400` `Response` validation errors (`L-007`), and `34B` ETag `unchanged` hits.
