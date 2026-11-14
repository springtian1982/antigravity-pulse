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

1. Read [00_MASTER_IMPLEMENTATION_BLUEPRINT.md](../../../docs/plans/00_MASTER_IMPLEMENTATION_BLUEPRINT.md), [DECISION_LOG.md](../../../docs/plans/DECISION_LOG.md) (`D-001`–`D-011`), and [LESSONS_LEARNED.md](../../../docs/plans/LESSONS_LEARNED.md) (`L-001`–`L-022`).
2. Read the relevant stage plan (`docs/plans/STAGE_0_FOUNDATION_PLAN.md`–`docs/plans/STAGE_3_CLI_MCP_GOVERNANCE_PLAN.md`) and audit record (`docs/plans/STAGE_0_AUDIT.md`–`docs/plans/FINAL_ACCEPTANCE_AUDIT_REPORT.md`), verifying your `OWNED_WRITE_PATHS` in Blueprint §4.1.
3. Review [architecture-and-guardrails.md](../../rules/architecture-and-guardrails.md) (`D-001`–`D-011`, `L-001`–`L-022`, and the 4 Engineering Guardrails).
4. **Contract Freeze Rule**: Never modify `src/types/telemetry.ts`, `src/types/rpc.ts`, or `$PULSE_STATE_DIR` JSON schemas unilaterally. Send `[CONTRACT_CHANGE_REQUEST]` and log a `D-NNN` entry in [DECISION_LOG.md](../../../docs/plans/DECISION_LOG.md) first.

## Step 2: Implement With Canonical Primitives & Pitfall Guards

- Reuse shared primitives (`src/types/telemetry.ts`, `src/state/state-dir.ts`, `src/state/config-store.ts`, `src/rpc/ls-client.ts`, `src/core/formatters.ts`, `src/core/model-catalog.ts`, `src/cli/snapshot-reader.ts`, `src/mcp/embed-card.ts`) instead of inline duplicates.
- Maintain 100% read-only Language Server RPCs (`ReadOnlyLsClient` 5-method allowlist, `stepCount`-gated `GetCascadeTrajectoryGeneratorMetadata`, `RUNNING`-only `stepOffset` per `L-004`) and read-only SQLite access (`file:...?mode=ro`).
- Enforce hot-path & bundler hygiene:
  - Keep `src/state/state-dir.ts` and `dist/hook-probe.cjs` free of `node:crypto` (`D-010` / `L-020`).
  - Gate CLI/hook/MCP entrypoints (`src/hook/hook-probe.ts`, `src/cli/main.ts`, `src/mcp/server.ts`) on both `require.main === module` and `require.main?.filename` regex (`L-013`).
  - Scrub ambient `ANTIGRAVITY_APP_DATA_DIR` / `ANTIGRAVITY_*` / `PLUGIN_DATA` / `PULSE_*` / `CLAUDE_PLUGIN_DATA` env vars in isolated child-process tests (`L-017` / `L-022`), use `codePointDisplayWidth` for CJK terminal alignment (`L-018`), and keep `skills/model-pulse/SKILL.md` locked to `ComputeBudgetAdvice` / `pulse_status_card` keys (`L-021`).
- Keep `AGENTS.md` and `.agents/` workspace-only (`D-007`); never create a plugin-root `rules/` folder.

## Step 3: Typecheck, Compile Prebuilt Bundles & Run Sequential Benchmark Gate

Run from the repository root:

```bash
npm run typecheck && npm run build && npm test
! grep -q "node:crypto" dist/hook-probe.cjs
```

Verify that:
- Zero TypeScript errors exist (`tsc --noEmit`).
- `scripts/build.mjs` cleanly emits `dist/hook-probe.cjs`, `dist/mcp.cjs`, `dist/cli.cjs`, `sidecars/pulse_cockpit/dist/server.mjs`, and `sidecars/pulse_cockpit/dist/ui.js` with SPDX MIT headers, `sidecar_sdk` marked external, and zero `node:crypto` inside `dist/hook-probe.cjs`.
- `npm test` passes all functional `node:test` suites (`unit/`, `contracts/`, `e2e/` — `109` tests) in parallel AND passes the isolated sequential benchmark phase (`tests/benchmarks/hook-latency.test.ts` — `2` tests per `D-009` & `D-010`: `in-process JS <= 8.0ms` and paired bare-V8 calibrated `pairedDelta <= 20.0ms`, `<= max(50ms, bareNode+20ms)`, `<= 100ms`) with zero skipped or weakened assertions.

## Step 4: Strict Context Governance, Mermaid 12.1 & Repo Plugin Validation

Run all three verification gates:

```bash
# 1. Context budgets (< 9,000 B L1/L2, < 18,000 B combined always-on), frontmatter, .gitignore (D-005),
#    zero legacy .agent/ or rules/ (D-007), 0 broken links, and 100% on-disk existence for all paths
node scripts/verify-context.mjs --strict-paths

# 2. Strict Mermaid 12.1 compatibility across all repository Markdown files (0 errors, 0 warnings)
agy-pele check . --strict-mermaid

# 3. Validate Antigravity plugin manifest & zero-rules hygiene on workspace root
#    (Workspace root AGENTS.md triggers 1 expected "never loaded" warning per L-008/D-007;
#     Step 5 runs --strict against the installed clean plugin bundle to assert findings: [])
agy plugin validate . --json
```

Confirm in `agy plugin validate . --json`:
- `0` errors; `components.rules` is `0` (`D-007` zero-token plugin guarantee).

## Step 5: Atomic Global Install Smoke Test, Strict Plugin Validation & `doctor`

Verify clean deployment, inode preservation (`D-006`), zero-warning strict validation, and live CLI diagnostics without requiring `npm install` at install time:

```bash
npm run install:global
agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json
agy-pulse doctor
```

Confirm `~/.gemini/config/plugins/antigravity-pulse/` contains only distributed plugin artifacts (never `.agents/`, `AGENTS.md`, or `rules/`), `findings` is `[]`, and `agy-pulse doctor` passes on `PATH`.

## Step 6: Ledger Closeout & Atomic Commit

1. Record any newly resolved architectural trade-offs in [DECISION_LOG.md](../../../docs/plans/DECISION_LOG.md) and any new host/SDK pitfalls in [LESSONS_LEARNED.md](../../../docs/plans/LESSONS_LEARNED.md).
2. Confirm [.gitignore](../../../.gitignore) has NOT excluded `dist/` or `sidecars/pulse_cockpit/dist/` (`D-005`), and commit updated prebuilt bundles alongside source edits so fresh git clones remain ready to install immediately.
3. Re-read [contributing.md](../../../docs/developer-guide/contributing.md) when updating user-facing docs or PR artifacts.
