---
name: pulse-dev-workflow
description: >-
  End-to-end contributor and agent development SOP for antigravity-pulse:
  ledger pre-read, typecheck/build/test, context governance check, strict
  Mermaid validation, Antigravity plugin validation, and global install smoke test.
---

# Antigravity Pulse — Developer & Agent Workflow SOP

Follow this 6-step workflow for every implementation, refactoring, or documentation task in `antigravity-pulse`.

## Step 1: Mandatory Pre-Read & Contract Check

1. Read [00_MASTER_IMPLEMENTATION_BLUEPRINT.md](../../../docs/plans/00_MASTER_IMPLEMENTATION_BLUEPRINT.md), [DECISION_LOG.md](../../../docs/plans/DECISION_LOG.md), and [LESSONS_LEARNED.md](../../../docs/plans/LESSONS_LEARNED.md).
2. Read the active stage plan (`docs/plans/STAGE_*_PLAN.md`) and verify your `OWNED_WRITE_PATHS` in Blueprint §4.1.
3. Review [architecture-and-guardrails.md](../../rules/architecture-and-guardrails.md) (`L-001`–`L-007` and the 4 Engineering Guardrails).
4. **Contract Freeze Rule**: Never modify `src/types/telemetry.ts` or `$PULSE_STATE_DIR` JSON schemas unilaterally. Send `[CONTRACT_CHANGE_REQUEST]` and log a `D-NNN` entry in [DECISION_LOG.md](../../../docs/plans/DECISION_LOG.md) first.

## Step 2: Implement With Canonical Primitives

- Reuse shared primitives (`src/types/telemetry.ts`, `src/state/state-dir.ts`, `src/rpc/ls-client.ts`, `src/core/formatters.ts`) instead of inline duplicates.
- Maintain 100% read-only Language Server RPCs and read-only SQLite access (`file:...?mode=ro`).
- Keep `AGENTS.md` and `.agents/` workspace-only (`D-007`); never create a plugin-root `rules/` folder.

## Step 3: Typecheck, Compile Prebuilt Bundles & Test

Run from the repository root:

```bash
npm run typecheck && npm run build && npm test
```

Verify that:
- Zero TypeScript errors exist (`tsc --noEmit`).
- `scripts/build.mjs` cleanly emits `dist/hook-probe.cjs`, `dist/mcp.cjs`, `dist/cli.cjs`, `sidecars/pulse_cockpit/dist/server.mjs`, and `sidecars/pulse_cockpit/dist/ui.js` with SPDX MIT headers and `sidecar_sdk` marked external.
- All `node:test` suites (`unit/`, `contracts/`, `benchmarks/`, `e2e/`) pass with zero skipped or relaxed assertions.

## Step 4: Context Governance, Mermaid & Plugin Validation

Run all three verification gates:

```bash
# 1. Context budgets, frontmatter, .gitignore (D-005), zero legacy .agent/, 0 broken links
node scripts/verify-context.mjs
# (After Stage 3 / Docs Sync, also enforce strict on-disk presence for all paths:)
node scripts/verify-context.mjs --strict-paths

# 2. Strict Mermaid 12.1 compatibility across all repository Markdown files
agy-pele check . --strict-mermaid

# 3. Validate Antigravity plugin manifest & zero-rules hygiene on workspace root
#    (Note: workspace root AGENTS.md triggers 1 expected "never loaded" warning because D-007 keeps it dev-only;
#     run --strict against the installed/staged plugin bundle in Step 5 to assert 0 errors & 0 warnings)
agy plugin validate . --json
```

Confirm in `agy plugin validate`:
- `0` errors; `components.rules` is `0` (`D-007` zero-token plugin guarantee).

## Step 5: Atomic Global Install Smoke Test & Strict Plugin Validation

Verify clean deployment, inode preservation (`D-006`), and zero-warning strict validation without requiring `npm install` at install time:

```bash
npm run install:global
agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json
```

Confirm `~/.gemini/config/plugins/antigravity-pulse/` contains only distributed plugin artifacts (never `.agents/`, `AGENTS.md`, or `rules/`), `findings` is `[]`, and `agy-pulse` launches cleanly on `PATH`.

## Step 6: Ledger Closeout & Atomic Commit

1. Record any newly resolved architectural trade-offs in [DECISION_LOG.md](../../../docs/plans/DECISION_LOG.md) and any new host/SDK pitfalls in [LESSONS_LEARNED.md](../../../docs/plans/LESSONS_LEARNED.md).
2. Confirm [.gitignore](../../../.gitignore) has NOT excluded `dist/` or `sidecars/pulse_cockpit/dist/` (`D-005`), and commit updated prebuilt bundles alongside source edits so fresh git clones remain ready to install immediately.
3. Re-read [contributing.md](../../../docs/developer-guide/contributing.md) if updating user-facing docs or PR artifacts.
