---
trigger: always_on
description: Enforce Antigravity Pulse 4 engineering guardrails, canonical primitives reuse, D-001..D-010 invariants, and L-001..L-021 prevention rules.
---

# Architecture Guardrails, Canonical Primitives & Pitfall Prevention

> **Specs**: [00_MASTER_IMPLEMENTATION_BLUEPRINT.md](../../docs/plans/00_MASTER_IMPLEMENTATION_BLUEPRINT.md) · [DECISION_LOG.md](../../docs/plans/DECISION_LOG.md) · [LESSONS_LEARNED.md](../../docs/plans/LESSONS_LEARNED.md)

## 1. The 4 Non-Negotiable Engineering Guardrails

1. **Hook Zero-Blocking & Calibrated Latency (`D-004`, `D-009`, `D-010`)**:
   - `dist/hook-probe.cjs` MUST perform zero network I/O, zero `/proc` scraping, zero recursive scans, and zero `node:crypto`/OpenSSL cold-init (`writeJsonAtomic` in `src/state/state-dir.ts` uses monotonic `pid + hrtime + atomicTmpSeq`).
   - Append hook events via single-line `appendFileSync` (`O_APPEND`) to `$PULSE_STATE_DIR/events.ring.jsonl` (never rotate inside the hook).
   - Fail-open `try/catch` returning valid stdout (`PreToolUse` -> `{"decision":"allow"}`; `PostToolUse`/`Stop` -> `{}`).
   - Sequential `tests/benchmarks/hook-latency.test.ts` (`D-009`) MUST assert both metrics (`D-004` + `D-010`): `in-process JS <= 8.0ms` AND paired bare-V8 calibrated OS `fork+exec` (`pairedDeltaMedianMs <= 20.0ms`, `probeMedianMs <= max(50.0ms, bareMedianMs + 20.0ms)`, `probeMedianMs <= 100.0ms`).

2. **Incremental Connect-RPC & `34B` ETag Caching**:
   - NEVER call `GetCascadeTrajectory` (`500KB+` payload).
   - Call `GetCascadeTrajectoryGeneratorMetadata` ONLY when `stepCount` grows.
   - Call `GetCascadeTrajectorySteps` ONLY when `status === "CASCADE_RUN_STATUS_RUNNING"`, with `stepOffset: Math.max(0, stepCount - 4)` and `disableRehydration: true`.
   - `/api/hud`, `/api/timeline`, and `/api/fleet` MUST return 34-byte `{"unchanged":true,"etag":"..."}` on ETag hit.

3. **100% Read-Only Language Server & Storage Boundary**:
   - Only call the 5 allowlisted methods in `src/rpc/ls-client.ts`: `GetCascadeModelConfigData`, `RetrieveUserQuotaSummary`, `GetAllCascadeTrajectories`, `GetCascadeTrajectoryGeneratorMetadata`, `GetCascadeTrajectorySteps`.
   - NEVER call `DeleteCascadeTrajectory`, `UpdateConversationAnnotations`, `JetboxWriteState`, `DeletePlugin`, or `InstallCustomization`.
   - Open SQLite fallbacks strictly read-only (`file:...?mode=ro`); never mutate `brain/`, `annotations/`, or `app.asar`.

4. **Strict CSP, UUID Validation, `x-sidecar-token` & XSS Defense**:
   - Bind Sidecar HTTP to `127.0.0.1`; validate `conversationId` against `/^[0-9a-f-]{36}$/i`; require `x-sidecar-token` on `POST /api/config`.
   - Emit strict CSP (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors *`).
   - Escape all untrusted strings via `src/core/formatters.ts` (zero `<script>` or external URLs in `<agent-embed>` cards).

## 2. Canonical Primitives Map (Reuse — Do Not Reinvent)

| Primitive Module | Canonical Responsibility |
| :--- | :--- |
| `src/types/telemetry.ts`, `src/types/rpc.ts` | Frozen domain, snapshot, config, budget, bus & Connect-RPC types (`[CONTRACT_CHANGE_REQUEST]` required) |
| `src/state/state-dir.ts`, `src/state/config-store.ts` | `$PULSE_STATE_DIR` resolver, crypto-free `0700`/`0600` atomic `tmp + renameSync`, `512 KiB` ring rotation, config store |
| `src/rpc/ls-client.ts` | Read-only loopback Connect-RPC client (`x-codeium-csrf-token`) with 5-method allowlist guard |
| `src/core/formatters.ts` | Duration/token/quota formatting, inline stamp markdown, HTML/Markdown XSS escaping |
| `src/core/model-catalog.ts`, `src/core/quota-calculator.ts`, `src/core/state-machine.ts` | Placeholder catalog + unmapped `MODEL_PLACEHOLDER_*` trust (`L-021`), `cacheHitPct`, `retryCount`, 8-decimal `ΔQuota%`, 7-state lifecycle & Anti-Stale Reconciler |
| `src/core/topology-builder.ts`, `src/core/timeline-builder.ts`, `src/core/fleet-builder.ts`, `src/core/etag.ts` | 3-source cascade tree fusion, timeline TTFT/streaming/thinking ratio, fleet & Top 5 burners, `34B` ETag |
| `src/hook/hook-probe.ts`, `src/sidecar/telemetry-engine.ts`, `src/sidecar/server.ts` | Zero-blocking hook (`smart` dedup), incremental RPC poller, `SidecarApp` `Response` server (`/hud`, `/fleet`, APIs) |
| `src/ui/state.ts`, `src/ui/hud-view.ts`, `src/ui/fleet-view.ts`, `src/ui/main.ts` | Browser state, `360px` Flexoki `/hud` + `Timeline` & `/fleet` views, host theme sync |
| `src/cli/snapshot-reader.ts`, `src/cli/status-formatter.ts`, `src/cli/top-tui.ts`, `src/cli/main.ts` | Bus/`--live` reader, `waybar`/`tmux`/`json`/`text` (`--watch`), CJK-aware `top` TUI (`L-018`), `config` & `doctor` |
| `src/mcp/server.ts`, `src/mcp/embed-card.ts` | Dual-framing (`NDJSON` + UTF-8 `Content-Length`) MCP server & XSS-safe Flexoki `<agent-embed>` card builder |

## 3. Empirical Pitfall Prevention Rules (`L-001`–`L-021`)

- **`L-001`–`L-003` RPC Metrics**: `usage.*` Int64 fields arrive as JSON strings -> coerce via `toIntToken` (`L-001`); `inputTokens` is uncached -> `cacheHitPct = cacheReadTokens / (inputTokens + cacheReadTokens) * 100` (`L-002`); unretried calls have `retryInfos.length === 1` -> `retryCount = Math.max(0, len - 1)` (`L-003`).
- **`L-004` & `L-005` Steps & Swarm**: Pass `{ cascadeId, stepOffset: Math.max(0, stepCount - 4), disableRehydration: true }` ONLY when `RUNNING` (`L-004`); iterate `swarm/members.json` via `Object.entries(data?.members ?? {})` (`L-005`).
- **`L-006` & `L-007` Host Contracts**: Wrap `hooks.json` under `"pulse-telemetry"` with grouped `PreToolUse`/`PostToolUse` + flat `PreInvocation`/`PostInvocation`/`Stop`, and ALWAYS stdout `{"decision":"allow"}` on `PreToolUse` (`L-006`); wrap Sidecar CSS/JS/HTML and HTTP `400` errors in `new Response(...)` from `sidecar_sdk` (`L-007`).
- **`L-008`–`L-010` Tooling & Tests**: `agy plugin validate . --json` expects 1 dev-only warning on root `AGENTS.md` (`0` errors, `rules === 0`), while `--strict` runs on installed bundle (`L-008`); keep `tsconfig.json` clean (`L-009`) and flatten tests to `.test-dist/<subpath>--<name>.test.cjs` in `scripts/build-tests.mjs` (`L-010`).
- **`L-011`–`L-013` Stitch, Port `0` & Entrypoints**: Decode Stitch `:download` `dataString` JSON + pass explicit `--project 9409889379743133909` (`L-011`); validate port `0` via `Number.isInteger`, guard `"${HOME:-}"` in `bin/agy-pulse`, set `overflow: clip` on `.pulse-progress` (`L-012`); gate `src/hook/hook-probe.ts`, `src/cli/main.ts`, `src/mcp/server.ts` CLI startup on `require.main === module` AND `require.main?.filename` regex (`L-013`).
- **`L-014` & `L-016` Narrow `360px` CSS**: Bind `[data-tier]`/`[data-level]`/`[data-phase]`, separate `-webkit`/`-moz` `<progress>` selectors, wrap truncated button labels in `<span class="pulse-btn-label">` (`L-014`), and keep `.pulse-fleet-drawer-item .pulse-node-kind { flex: 0 0 auto; max-width: none }` with 2-row drawer wrapping (`L-016`).
- **`L-015` & `L-017` Test Isolation**: Run `benchmarks--*.test.cjs` sequentially (`D-009`), support `?theme=`/`?scenario=` in `scripts/preview-ui.mjs` (`L-015`), scrub `ANTIGRAVITY_*`/`PULSE_*`/`CLAUDE_PLUGIN_DATA`, and stop Sidecar children before `--watch` file mutations (`L-017`).
- **`L-018`–`L-021` Stage 3 Guards**: Use `codePointDisplayWidth` + `stdout.columns ?? COLUMNS ?? 100` in `src/cli/top-tui.ts` (`L-018`); use `inline-block` `.pill` ellipsis + 2-tier rows in `src/mcp/embed-card.ts` (`L-019`); ban `node:crypto` in `dist/hook-probe.cjs` (`L-020`); lock `skills/model-pulse/SKILL.md` keys in `tests/contracts/manifest-contracts.test.ts` and resolve unmapped `^MODEL_PLACEHOLDER_` to `'matched'`/`'routed'` (`L-021`).

## 4. Decisions & Distribution Invariants (`D-001`–`D-010`)

- **`D-001`–`D-003`**: 4-stage pipeline (`Stage 0..3`), canonical `sidecar://antigravity-pulse/pulse_cockpit/hud` (`/` -> `/hud`), `$PULSE_STATE_DIR` atomic bus.
- **`D-004`, `D-009`, `D-010`**: Crypto-free `34K` hook + sequential calibrated benchmark (`JS <= 8ms`; `pairedDelta <= 20ms`, `<= max(50ms, bare+20ms)`, `<= 100ms`).
- **`D-005`–`D-008`**: Git-tracked SPDX bundles in `dist/` & `sidecars/pulse_cockpit/dist/` (never gitignored), inode-safe `scripts/install.mjs`, zero-token plugin hygiene (NO `rules/`; only `skills/model-pulse/SKILL.md`), and host CSS vars + `body` `!important` override over `preload.js` `#fafafa` + WCAG `>= 4.5:1` `*-ink` tokens.
