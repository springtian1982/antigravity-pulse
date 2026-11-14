# AGENTS.md — Antigravity Pulse Workspace Control Tower

> **Project**: `antigravity-pulse` (Display Name: **Model Pulse** · CLI: **`agy-pulse`**)  
> **Scope**: Repository contributor & agent governance ONLY (never shipped inside the installed plugin bundle; see `D-007`).

## 1. Mission & Product Scope

`antigravity-pulse` is a **100% local (`127.0.0.1`), zero-`app.asar`-tampering, read-only** active model indicator, multi-agent topology HUD, and quota telemetry plugin + CLI for **Google Antigravity 2.0** (Linux & Windows). It delivers four official surfaces backed by a `$PULSE_STATE_DIR` atomic state bus:
1. **Inline Turn Stamp** (`hooks.json` -> `dist/hook-probe.cjs`): zero-token `metadata.user_markdown` (`systemMessage: ""`).
2. **Pulse HUD (`/hud`)**: `AUX_PANE` sidecar view with live phase attribution, `Requested -> Served` routing trust, and subagent/swarm matrix.
3. **Pulse Fleet (`/fleet`)**: `SIDEBAR` view in the same single-process sidecar for cross-project active cascades and Top 5 quota burners.
4. **MCP Server & CLI**: `dist/mcp.cjs` (`<agent-embed>`, compute budget advice) and `dist/cli.cjs` (`agy-pulse top | status | config`).

## 2. Canonical Single-Source Documents (Read Before Coding)

| Document | Role |
| :--- | :--- |
| [PRODUCT_DESIGN.md](docs/PRODUCT_DESIGN.md) | Canonical PRD v1.0, JTBD, UX specs, Flexoki Light/Dark semantics, host boundaries |
| [00_MASTER_IMPLEMENTATION_BLUEPRINT.md](docs/plans/00_MASTER_IMPLEMENTATION_BLUEPRINT.md) | Stage 0–3 DAG, frozen directory tree (§2), `src/types/telemetry.ts` & bus schemas (§3), track ownership lock table (§4), RTM (§5) |
| [DECISION_LOG.md](docs/plans/DECISION_LOG.md) | Append-only architectural decisions (`D-001`–`D-007`+); log new trade-offs here |
| [LESSONS_LEARNED.md](docs/plans/LESSONS_LEARNED.md) | Mandatory pre-read empirical pitfall ledger (`L-001`–`L-007`+) |
| [architecture.md](docs/developer-guide/architecture.md) | Dual-channel telemetry & read-only boundary overview |
| [contributing.md](docs/developer-guide/contributing.md) | Contributor environment, build, Mermaid, and PR checklist |

## 3. Repository & Distribution Boundary Map

- **Workspace-Only Governance (NEVER shipped in plugin)**:
  - `AGENTS.md` — L1 repo router (this file, `< 9,000 B`).
  - [architecture-and-guardrails.md](.agents/rules/architecture-and-guardrails.md) — L2 `always_on` guardrails, canonical primitives map, `L-001`–`L-008` rules (`< 9,000 B`).
  - [SKILL.md](.agents/skills/pulse-dev-workflow/SKILL.md) — L3 contributor build/test/release SOP (`pulse-dev-workflow`).
  - [verify-context.mjs](scripts/verify-context.mjs) — Zero-dep ESM governance & link verifier.
- **Distributed Plugin Surface** (packaged via [package.json](package.json) `"files"` & `scripts/install.mjs`):
  - Manifests & launchers: [plugin.json](plugin.json), `hooks.json`, `mcp_config.json`, `assets/logo.svg`, `bin/agy-pulse`, `bin/agy-pulse.cmd`, `bin/agy-pulse.ps1`.
  - Prebuilt git-tracked bundles (`D-005`): `dist/hook-probe.cjs`, `dist/mcp.cjs`, `dist/cli.cjs`, `sidecars/pulse_cockpit/dist/server.mjs`, `sidecars/pulse_cockpit/dist/ui.js`.
  - On-demand user skill ONLY (`D-007`): `skills/model-pulse/SKILL.md`.
- **Source & Test Truth**:
  - `src/` (frozen TypeScript implementation layout in Blueprint §2) and `tests/` (`unit/`, `contracts/`, `benchmarks/`, `e2e/` using `node:test`).
  - Never create legacy `.agent/` directories, `CLAUDE.md`, or a plugin-root `rules/` directory.

## 4. Executable Commands & Verification Gates

Run all commands from the repository root:

```bash
# TypeScript strict check
npm run typecheck

# Compile zero-dep bundles (dist/* & sidecars/pulse_cockpit/dist/*) with SPDX MIT headers
npm run build

# Build & run full node:test suite (unit, contracts, benchmarks, e2e)
npm test

# Context governance, byte budgets, YAML frontmatter, .gitignore & link integrity
node scripts/verify-context.mjs
# Post-Stage-3 strict on-disk check for all planned src/dist paths:
node scripts/verify-context.mjs --strict-paths

# Validate all Mermaid 12.1 diagrams in repository Markdown (0 errors, 0 warnings)
agy-pele check . --strict-mermaid

# Validate workspace plugin components (on repo root, only workspace AGENTS.md emits an expected non-plugin-rule warning):
agy plugin validate . --json

# Atomic inode-preserving global install smoke check, then strict validate installed bundle (0 errors, 0 warnings):
npm run install:global
agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json
```

## 5. Non-Negotiable Architectural Invariants

1. **Zero-Token Plugin Hygiene (`D-007`)**: NEVER add a root `rules/` directory or copy `AGENTS.md` / `.agents/` into [package.json](package.json) `"files"` or `scripts/install.mjs`. Plugin `rules/` inject `always_on` tokens into every user session and break our 0-token idle guarantee.
2. **Git-Tracked Prebuilt Bundles (`D-005`)**: NEVER add `dist/` or `sidecars/pulse_cockpit/dist/` to [.gitignore](.gitignore). Users install directly from git without `npm install`.
3. **Canonical Sidecar URI (`D-002`)**: Always link to `sidecar://antigravity-pulse/pulse_cockpit/hud` (never `pulse_hud`).
4. **Frozen Cross-Module Contracts**: Never unilaterally edit `src/types/telemetry.ts`, `$PULSE_STATE_DIR` JSON schemas, or HTTP/MCP/Hook contracts without a `[CONTRACT_CHANGE_REQUEST]` recorded in [DECISION_LOG.md](docs/plans/DECISION_LOG.md).
5. **Anti-Bloat Rules**: Keep `AGENTS.md` and every `.agents/rules/*.md` strictly `< 9,000 B`. Never use `@[label](path)` inlining syntax (expands before platform truncation checks); use relative links or backtick paths.
