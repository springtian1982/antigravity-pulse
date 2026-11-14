# Antigravity Pulse — Architectural Decision Log (`DECISION_LOG.md`)

> **Governance Protocol**: This file is an **append-only engineering ledger**. Never delete or silently rewrite historical entries; if a decision is superseded, append a new `D-NNN` entry referencing the prior ID (`Supersedes D-XXX`). Every architectural, protocol, packaging, or on-the-spot trade-off during MISSION I and MISSION II MUST be recorded with:
> - **ID & Title** (`D-001`, `D-002`, ...)
> - **Date & Stage**
> - **Context**
> - **Options Considered**
> - **Chosen Decision & Rationale**
> - **Verification Evidence**

---

## `D-001`: Four-Stage Implementation Decomposition (`Stage 0..3`) vs. Three-Phase PRD Roadmap

- **Date**: 2026-11-14
- **Stage**: MISSION I — M1.1 (Master Blueprint)
- **Context**: [`docs/PRODUCT_DESIGN.md`](../PRODUCT_DESIGN.md) §7.1 outlines three product delivery phases (Phase 1 MVP, Phase 2 Timeline & Fleet, Phase 3 CLI & MCP Governance). Executing Phase 1 directly across parallel tracks without first locking build scripts, TypeScript contracts, Stitch UI design tokens, and the cross-process state bus risks schema drift and merge conflicts.
- **Options Considered**:
  1. Start directly with 3 phases, building infrastructure ad hoc inside Phase 1.
  2. Insert an explicit **Stage 0 (Engineering & Design Foundation)** before Phases 1–3, yielding a 4-stage engineering pipeline (`Stage 0 -> Stage 1 -> Stage 2 -> Stage 3`).
- **Chosen Decision & Rationale**: Adopt **Option 2 (4-Stage Decomposition)**. Stage 0 freezes `src/types/`, `$PULSE_STATE_DIR` schemas, `esbuild` pipelines, `DESIGN.md` + Stitch `/hud` & `/fleet` visual specs, and the inode-safe installer before any feature code runs in parallel. Every PRD requirement in Phases 1–3 maps 1:1 onto Stages 1–3 with zero scope loss.
- **Verification Evidence**: [`00_MASTER_IMPLEMENTATION_BLUEPRINT.md`](./00_MASTER_IMPLEMENTATION_BLUEPRINT.md) §1.1 & §5 (RTM rows `RTM-01`–`RTM-28`).

---

## `D-002`: Canonical Sidecar Pill URI `sidecar://antigravity-pulse/pulse_cockpit/hud` (+ `/` Alias)

- **Date**: 2026-11-14
- **Stage**: MISSION I — M1.1 (Master Blueprint)
- **Context**: Early illustrative snippets in [`docs/PRODUCT_DESIGN.md`](../PRODUCT_DESIGN.md) (§2.1, §3.2, §4.2) showed `sidecar://antigravity-pulse/pulse_hud/`, whereas §6.1, [`README.md`](../../README.md) (§2), and [`docs/user-guide/getting-started.md`](../user-guide/getting-started.md) (§2.1) specify a single sidecar directory `sidecars/pulse_cockpit/` hosting both `/hud` (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`) and `/fleet` (`SIDECAR_UI_ENTRYPOINT_SIDEBAR`).
- **Options Considered**:
  1. Split into two separate sidecars (`pulse_hud` and `pulse_fleet`), doubling Node process memory and Language Server RPC polling.
  2. Use one unified sidecar `sidecars/pulse_cockpit/sidecar.json` declaring `/hud` and `/fleet`, standardize all deep links on `sidecar://antigravity-pulse/pulse_cockpit/hud`, and mount `/` in `server.mjs` as an alias for `/hud`.
- **Chosen Decision & Rationale**: Adopt **Option 2**. Single-process dual-entry halves background Node memory and lets `/hud` and `/fleet` share one in-memory cascade topology and quota cache (`sidecar_sdk/index.mjs` supports multiple `SidecarApp.page()` routes). Standardizing on `sidecar://antigravity-pulse/pulse_cockpit/hud` eliminates broken links across `README.md`, `getting-started.md`, `hook-probe.cjs`, and `mcp.cjs`.
- **Verification Evidence**: [`README.md`](../../README.md) line 71, [`docs/user-guide/getting-started.md`](../user-guide/getting-started.md) line 22, and `sidecar_sdk/index.mjs` route registration (`#pages`).

---

## `D-003`: `$PULSE_STATE_DIR` Atomic Snapshot Bus for Cross-Process Telemetry Sharing

- **Date**: 2026-11-14
- **Stage**: MISSION I — M1.1 (Master Blueprint)
- **Context**: `dist/hook-probe.cjs`, `dist/cli.cjs` (`agy-pulse`), and `dist/mcp.cjs` execute as independent OS processes outside the long-lived `pulse_cockpit` Sidecar process and do not reliably receive `ANTIGRAVITY_LS_ADDRESS` / `ANTIGRAVITY_CSRF_TOKEN` in every shell or terminal context. Scraping `/proc` or probing unknown loopback ports from CLI/Hook processes is fragile across Linux and Windows and violates latency targets.
- **Options Considered**:
  1. Require CLI and MCP to scrape process tables (`/proc` or `wmic`) for `language_server` flags and re-poll RPCs independently.
  2. Maintain a dedicated local state directory `$PULSE_STATE_DIR` (`ANTIGRAVITY_PULSE_STATE_DIR || PLUGIN_DATA || ~/.gemini/antigravity/pulse-state`, `0700` dir / `0600` files) containing `live-snapshot.json`, `model-map.json`, `quota-cache.json`, `events.ring.jsonl`, `config.json`, and `stamp-dedup.json`, updated via atomic `tmp + renameSync` (and single-line `O_APPEND` for `events.ring.jsonl`).
- **Chosen Decision & Rationale**: Adopt **Option 2 (`$PULSE_STATE_DIR` Atomic Bus)**. It decouples process lifecycles across Linux and Windows, allows `hook-probe.cjs`, `agy-pulse`, and `mcp.cjs` to read verified telemetry in `< 2ms` with zero network I/O and zero `/proc` scraping, and guarantees crash-safe JSON consistency via atomic rename.
- **Verification Evidence**: [`00_MASTER_IMPLEMENTATION_BLUEPRINT.md`](./00_MASTER_IMPLEMENTATION_BLUEPRINT.md) §3.3; Stage 0 & Stage 1 unit/E2E test plans.

---

## `D-004`: Dual-Metric Honest Hook Latency Assertion (`in-process <= 8ms` & `OS wall-clock <= 50ms`)

- **Date**: 2026-11-14
- **Stage**: MISSION I — M1.1 (Master Blueprint)
- **Context**: Empirical measurement on this host (`Node v24.21.0`, Linux) shows that OS `fork+exec` + V8 cold startup alone consumes `~25–32ms` before line 1 of any JS script executes, whereas in-process JS handler execution (`process.hrtime.bigint()`) finishes in `< 5ms`. Asserting a single ambiguous `< 8ms` OS spawn budget for a Node CLI hook would be physically impossible and invite misleading test mocks.
- **Options Considered**:
  1. Claim `< 8ms` total OS wall-clock while actually timing only an in-process function call.
  2. Explicitly separate and assert **two honest metrics**: (a) in-process JS handler execution (`process.hrtime.bigint()`) `<= 8ms`, and (b) end-to-end OS `fork+exec` child process wall-clock `<= 50ms`, with **zero network I/O**.
- **Chosen Decision & Rationale**: Adopt **Option 2 (Dual-Metric Honest Assertion)**. It preserves strict engineering honesty while enforcing both ultra-fast synchronous JS execution (`<= 8ms`) and tight total process overhead (`<= 50ms` OS wall-clock) so Antigravity's agent loop is never visibly stalled.
- **Verification Evidence**: Observed runtime `node v24.21.0`; Stage 1 benchmark suite `tests/benchmarks/hook-latency.test.ts` (to be executed in Stage 1).

---

## `D-005`: Git-Tracked Prebuilt `dist/` and `sidecars/pulse_cockpit/dist/` Bundles

- **Date**: 2026-11-14
- **Stage**: MISSION I — M1.1 (Master Blueprint)
- **Context**: [`docs/developer-guide/contributing.md`](../developer-guide/contributing.md) §3 requires end users cloning the repository to run `node scripts/install.mjs` immediately without running `npm install` or compiling TypeScript, and Antigravity plugin loaders execute `dist/*.cjs` and `sidecars/pulse_cockpit/dist/*.mjs` directly from the cloned/installed folder.
- **Options Considered**:
  1. Add `dist/` to `.gitignore` and require users to run `npm install && npm run build`.
  2. Commit compiled zero-external-runtime bundles (`dist/hook-probe.cjs`, `dist/mcp.cjs`, `dist/cli.cjs`, `sidecars/pulse_cockpit/dist/server.mjs`, `sidecars/pulse_cockpit/dist/ui.js`) directly in git with SPDX MIT headers (`sidecar_sdk` marked `external`), and verify bundle freshness in CI/stage audits.
- **Chosen Decision & Rationale**: Adopt **Option 2**. Matches the existing `.gitignore` (which intentionally excludes `node_modules/` and `.test-dist/` but NOT `dist/`) and aligns with sister plugin `antigravity-pele`, delivering zero-dependency cross-platform readiness on Windows and Linux (including `agy-node`-only machines).
- **Verification Evidence**: [`.gitignore`](../../.gitignore) lines 1–6; [`package.json`](../../package.json) lines 33–45.

---

## `D-006`: Inode-Preserving Atomic Global Installer (`scripts/install.mjs`)

- **Date**: 2026-11-14
- **Stage**: MISSION I — M1.1 (Master Blueprint)
- **Context**: When users upgrade `antigravity-pulse` while Antigravity 2.0 already has `pulse_cockpit` Sidecar or `mcp.cjs` running out of `~/.gemini/config/plugins/antigravity-pulse/`, running `fs.rmSync(pluginDir, { recursive: true })` unlinks the live directory inode, causing subsequent relative asset/module reads or open file handles in running processes to break with `ENOENT`.
- **Options Considered**:
  1. Delete and recreate `~/.gemini/config/plugins/antigravity-pulse/` wholesale on install.
  2. Use `mkdirSync(..., { recursive: true })` and write each installed file via temporary sibling file + atomic `renameSync` (preserving directory and parent inodes), plus clean `bin/agy-pulse` / `.cmd` shims and optional `hooks.json` runtime fallback patching if `node` is absent from `PATH`.
- **Chosen Decision & Rationale**: Adopt **Option 2 (Inode-Preserving Atomic Installer)**. Explicitly matches [`docs/developer-guide/contributing.md`](../developer-guide/contributing.md) §2 (`install:global`) and eliminates upgrade races against live Antigravity plugin processes on both Linux and Windows.
- **Verification Evidence**: [`docs/developer-guide/contributing.md`](../developer-guide/contributing.md) line 34; Stage 0 `scripts/install.mjs` + inode-preservation test.

---

## `D-007`: Zero-Token Plugin Surface Hygiene (`skills/model-pulse/SKILL.md` Over `rules/AGENTS.md`)

- **Date**: 2026-11-14
- **Stage**: MISSION I — M1.1 (Master Blueprint)
- **Context**: Antigravity 2.0 automatically injects any plugin's `rules/*.md` files into LLM system prompts on every conversation turn (`always_on`), whereas plugin `skills/*/SKILL.md` files only load their full body on demand when invoked/relevant. Meanwhile, [`docs/PRODUCT_DESIGN.md`](../PRODUCT_DESIGN.md) §1.2 & §3.2 mandate **0 LLM Token Injection** when idle so user prompts and Prompt Cache prefixes remain untouched.
- **Options Considered**:
  1. Ship a plugin `rules/AGENTS.md` inside `~/.gemini/config/plugins/antigravity-pulse/`.
  2. Omit plugin `rules/` entirely from the distributed bundle (`package.json` `"files"` and `scripts/install.mjs`), ship only on-demand `skills/model-pulse/SKILL.md` for `antigravity-pulse` MCP usage, and restrict 3-tier `AGENTS.md` + `.agents/` solely to repository development scope.
- **Chosen Decision & Rationale**: Adopt **Option 2**. Guarantees 0 idle prompt token overhead and 0 Prompt Cache perturbation for end users while still providing structured repository governance for contributors and on-demand MCP compute-budget guidance when an orchestrating agent explicitly activates `model-pulse`.
- **Verification Evidence**: [`package.json`](../../package.json) lines 33–45 (`"files"` omits `.agents/` and `rules/`); `agy plugin validate . --strict --json` component inspection.
