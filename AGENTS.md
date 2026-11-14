# AGENTS.md — Antigravity Pulse Workspace Control Tower

> **Project**: `antigravity-pulse` (Display Name: **Model Pulse** · CLI: **`agy-pulse`**)  
> **Scope**: Repository contributor & agent governance ONLY (never shipped inside the installed plugin bundle; see `D-007`).

## 1. Mission & Product Scope

`antigravity-pulse` is a **100% local (`127.0.0.1`), zero-`app.asar`-tampering, read-only** active model indicator, multi-agent topology HUD, and quota telemetry plugin + CLI for **Google Antigravity 2.0** (Linux & Windows). It delivers four official surfaces backed by a `$PULSE_STATE_DIR` atomic state bus (`D-003`):
1. **Inline Turn Stamp** (`hooks.json` -> `dist/hook-probe.cjs`): OpenSSL-free (`D-010`) zero-token `metadata.user_markdown` (`systemMessage: ""`).
2. **Pulse HUD (`/hud`)**: `AUX_PANE` sidecar view with 7-state live phase attribution, `Requested -> Served` routing trust, subagent/swarm matrix, and `Timeline` flame axis.
3. **Pulse Fleet (`/fleet`)**: `SIDEBAR` view in the same single-process sidecar (`D-002`) for cross-project active cascades and Top 5 quota burners.
4. **MCP Server & CLI**: dual-framing `dist/mcp.cjs` (`pulse_status_card`, `pulse_get_compute_budget`, `pulse_set_preference`) and `dist/cli.cjs` (`agy-pulse status | top | config | doctor`).

## 2. Canonical Single-Source Documents (Read Before Coding)

| Document | Role |
| :--- | :--- |
| [PRODUCT_DESIGN.md](docs/PRODUCT_DESIGN.md) & [DESIGN.md](DESIGN.md) | Canonical PRD v1.0, JTBD, UX specs, Flexoki Light/Dark tokens (`D-008`), host boundaries |
| [00_MASTER_IMPLEMENTATION_BLUEPRINT.md](docs/plans/00_MASTER_IMPLEMENTATION_BLUEPRINT.md) | Stage 0–3 DAG, frozen directory tree (§2), `src/types/telemetry.ts` & bus schemas (§3), lock table (§4), RTM (§5), commit ledger (§6) |
| [DECISION_LOG.md](docs/plans/DECISION_LOG.md) | Append-only architectural decisions (`D-001`–`D-011`); log `[CONTRACT_CHANGE_REQUEST]` trade-offs here |
| [LESSONS_LEARNED.md](docs/plans/LESSONS_LEARNED.md) | Mandatory pre-read empirical pitfall ledger (`L-001`–`L-022`) |
| [STAGE_0_AUDIT.md](docs/plans/STAGE_0_AUDIT.md) – [FINAL_ACCEPTANCE_AUDIT_REPORT.md](docs/plans/FINAL_ACCEPTANCE_AUDIT_REPORT.md) | Independent stage & final acceptance audit records (`5ca47d4`, `bbf1a68`, `71a621f`, `4064b48`, `99fbaa3`) |
| [architecture.md](docs/developer-guide/architecture.md) & [contributing.md](docs/developer-guide/contributing.md) | Shipped `src/` module architecture, dual-channel pipeline, build/test/Mermaid/PR gates |

## 3. Repository & Distribution Boundary Map

- **Workspace-Only Governance (NEVER shipped in plugin)**:
  - `AGENTS.md` — L1 repo router (this file, `< 9,000 B`, no YAML frontmatter).
  - [architecture-and-guardrails.md](.agents/rules/architecture-and-guardrails.md) — L2 `always_on` guardrails, canonical primitives map, `D-001`–`D-011` & `L-001`–`L-022` rules (`< 9,000 B`).
  - [SKILL.md](.agents/skills/pulse-dev-workflow/SKILL.md) — L3 contributor build/test/release SOP (`pulse-dev-workflow`, `< 18,000 B`).
  - [verify-context.mjs](scripts/verify-context.mjs) — Zero-dep ESM context budget, frontmatter, `.gitignore` & strict path/link verifier.
- **Distributed Plugin Surface** (packaged via [package.json](package.json) `"files"` & `scripts/install.mjs`):
  - Manifests & launchers: [plugin.json](plugin.json), `hooks.json`, `mcp_config.json`, `sidecars/pulse_cockpit/sidecar.json`, `assets/logo.svg`, `bin/agy-pulse`, `bin/agy-pulse.cmd`, `bin/agy-pulse.ps1`.
  - Prebuilt git-tracked bundles (`D-005`): `dist/hook-probe.cjs`, `dist/mcp.cjs`, `dist/cli.cjs`, `sidecars/pulse_cockpit/dist/server.mjs`, `sidecars/pulse_cockpit/dist/ui.js`.
  - On-demand user skill ONLY (`D-007`): `skills/model-pulse/SKILL.md`.
- **Source & Test Truth**:
  - `src/` (frozen TypeScript layout in Blueprint §2) and `tests/` (`unit/`, `contracts/`, `benchmarks/`, `e2e/` using `node:test`).
  - Never create legacy `.agent/` directories, `CLAUDE.md`, or a plugin-root `rules/` directory.

## 4. Executable Commands & Verification Gates

Run all commands from the repository root:

```bash
# TypeScript strict check
npm run typecheck

# Compile 5 zero-dep bundles (dist/* & sidecars/pulse_cockpit/dist/*) with SPDX MIT headers
npm run build

# Build & run full node:test suite (109 functional tests in parallel + 2 sequential calibrated hook benchmarks, D-009/D-010)
npm test

# Strict context governance: byte budgets, YAML frontmatter, .gitignore (D-005), zero rules/ (D-007), links & 100% on-disk paths
node scripts/verify-context.mjs --strict-paths

# Validate all Mermaid 12.1 diagrams in repository Markdown (0 errors, 0 warnings)
agy-pele check . --strict-mermaid

# Validate workspace plugin components (0 errors, components.rules === 0; root AGENTS.md emits 1 expected dev-only warning, L-008)
agy plugin validate . --json

# Inode-preserving global install (D-006), strict validate installed bundle (0 errors, 0 warnings), and live doctor check
npm run install:global
agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json
agy-pulse doctor
```

## 5. Non-Negotiable Architectural Invariants

1. **Zero-Token Plugin Hygiene (`D-007`)**: NEVER add a root `rules/` directory or copy `AGENTS.md` / `.agents/` into [package.json](package.json) `"files"` or `scripts/install.mjs`. Plugin `rules/` inject `always_on` tokens into every user session and break our 0-token idle guarantee.
2. **Git-Tracked Prebuilt Bundles (`D-005`)**: NEVER add `dist/` or `sidecars/pulse_cockpit/dist/` to [.gitignore](.gitignore). Users install directly from git without `npm install`.
3. **Canonical Sidecar URI (`D-002`)**: Always link to `sidecar://antigravity-pulse/pulse_cockpit/hud` (never `pulse_hud`).
4. **Frozen Cross-Module Contracts**: Never unilaterally edit `src/types/telemetry.ts`, `$PULSE_STATE_DIR` JSON schemas, or HTTP/MCP/Hook contracts without a `[CONTRACT_CHANGE_REQUEST]` recorded in [DECISION_LOG.md](docs/plans/DECISION_LOG.md).
5. **Anti-Bloat Rules**: Keep `AGENTS.md` and every `.agents/rules/*.md` strictly `< 9,000 B` (`always_on` combined `< 18,000 B`). Never use `@[label](path)` inlining syntax; use relative links or backtick paths.
