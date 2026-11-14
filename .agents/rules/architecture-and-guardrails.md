---
trigger: always_on
description: Enforce Antigravity Pulse 4 engineering guardrails, canonical primitives reuse, D-002..D-007 invariants, and L-001..L-008 prevention rules.
---

# Architecture Guardrails, Canonical Primitives & Pitfall Prevention

> **Authoritative Specs**: [00_MASTER_IMPLEMENTATION_BLUEPRINT.md](../../docs/plans/00_MASTER_IMPLEMENTATION_BLUEPRINT.md) · [DECISION_LOG.md](../../docs/plans/DECISION_LOG.md) · [LESSONS_LEARNED.md](../../docs/plans/LESSONS_LEARNED.md)

## 1. The 4 Non-Negotiable Engineering Guardrails

1. **Hook Zero-Blocking (`< 8ms` JS / `<= 50ms` OS, `D-004`)**:
   - `dist/hook-probe.cjs` MUST perform zero network I/O, zero `/proc` scraping, and zero recursive directory scans.
   - Write hook events via single-line `appendFileSync` (`O_APPEND`) to `$PULSE_STATE_DIR/events.ring.jsonl` (never rewrite/rotate inside the hook process).
   - Wrap the entire probe in fail-open `try/catch` returning valid stdout (`PreToolUse` -> `{"decision":"allow"}`; `PostToolUse`/`Stop` -> `{}`).
   - Benchmarks MUST assert both metrics honestly: `in-process JS <= 8ms` AND `OS fork+exec <= 50ms`.

2. **Incremental Connect-RPC & ETag Caching**:
   - NEVER call `GetCascadeTrajectory` inside polling loops (`500KB+` payload).
   - Call `GetCascadeTrajectoryGeneratorMetadata` ONLY when `stepCount` increases.
   - Call `GetCascadeTrajectorySteps` ONLY when `status === "CASCADE_RUN_STATUS_RUNNING"`, with `stepOffset` and `disableRehydration: true`.
   - `/api/hud`, `/api/timeline`, and `/api/fleet` MUST return 34-byte `{ "unchanged": true, "etag": "..." }` when the snapshot ETag matches.

3. **100% Read-Only Language Server & Storage Boundary**:
   - Only call read-only `LanguageServerService` methods: `GetCascadeModelConfigData`, `RetrieveUserQuotaSummary`, `GetAllCascadeTrajectories`, `GetCascadeTrajectoryGeneratorMetadata`, `GetCascadeTrajectorySteps`.
   - **NEVER** call `DeleteCascadeTrajectory`, `UpdateConversationAnnotations`, `JetboxWriteState`, `DeletePlugin`, or `InstallCustomization`.
   - Open optional SQLite fallbacks strictly read-only (`file:...?mode=ro`); never mutate `~/.gemini/antigravity/brain/`, `annotations/`, or `app.asar`.

4. **Strict CSP, UUID Validation, `x-sidecar-token` & XSS Defense**:
   - Bind Sidecar HTTP strictly to `127.0.0.1`.
   - Validate `conversationId` query params against `/^[0-9a-f-]{36}$/i`.
   - Require `x-sidecar-token` on `POST /api/config` (via `SidecarApp`).
   - Emit strict CSP headers (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors *`).
   - Escape all untrusted strings (titles, roles, tool names/summaries) through `src/core/formatters.ts` before inserting into HTML, DOM, or Markdown.

## 2. Canonical Primitives Map (Reuse — Do Not Reinvent)

| Primitive Module | Canonical Responsibility |
| :--- | :--- |
| `src/types/telemetry.ts` & `src/types/rpc.ts` | Frozen cross-module domain, snapshot, config, bus, and raw Connect-RPC contracts (changes require `[CONTRACT_CHANGE_REQUEST]`) |
| `src/state/state-dir.ts` & `src/state/config-store.ts` | `$PULSE_STATE_DIR` resolver (`ANTIGRAVITY_PULSE_STATE_DIR \|\| PLUGIN_DATA \|\| ~/.gemini/antigravity/pulse-state`), `0700`/`0600` atomic `tmp + renameSync`, `512 KiB` ring rotation, config store |
| `src/rpc/ls-client.ts` | Read-only loopback Connect-RPC client (`x-codeium-csrf-token`) with method allowlist guard |
| `src/core/formatters.ts` | Duration formatting, compact token counts, inline stamp markdown, HTML/Markdown XSS escaping |
| `src/core/model-catalog.ts`, `src/core/quota-calculator.ts`, `src/core/state-machine.ts` | Placeholder decoding, `cacheHitPct`, `retryCount`, 8-decimal `ΔQuota%`, 7-state lifecycle & Anti-Stale Reconciler |
| `src/core/topology-builder.ts`, `src/core/timeline-builder.ts`, `src/core/fleet-builder.ts`, `src/core/etag.ts` | 3-source cascade tree fusion, timeline TTFT/streaming/thinking ratio, cross-project fleet & Top 5 burners, deterministic ETag |

## 3. Empirical Pitfall Prevention Rules (`L-001`–`L-008`)

- **`L-001` Int64 String Tokens**: `usage.*` fields arrive as JSON strings (`"19353"`). Always coerce via shared `Number(v ?? 0)` finite non-negative helper at the RPC boundary.
- **`L-002` Prompt Cache Hit Formula**: `inputTokens` is **uncached** only. ALWAYS compute `totalIn = inputTokens + cacheReadTokens` and `cacheHitPct = totalIn > 0 ? (cacheReadTokens / totalIn) * 100 : 0`.
- **`L-003` `retryInfos` Baseline**: Normal unretried calls have `retryInfos.length === 1`. Compute `retryCount = Math.max(0, (retryInfos?.length ?? 0) - 1)`; a retry occurred ONLY when `retryInfos.length > 1`.
- **`L-004` `stepOffset` Not `startIndex`**: `GetCascadeTrajectorySteps` ignores `startIndex`/`endIndex`. ALWAYS pass `{ cascadeId, stepOffset: Math.max(0, stepCount - 4), disableRehydration: true }` and ONLY when `RUNNING`.
- **`L-005` `swarm/members.json` Object Map**: `members` is `Record<string, SwarmMemberRaw>`, NOT an array. ALWAYS iterate via `Object.entries(data?.members ?? {})`.
- **`L-006` `hooks.json` Wrapper Key, Asymmetric Grouping & Stdout**: Wrap events under top-level `"pulse-telemetry"` key (`map[string]JSONHookSpec`). `PreToolUse` and `PostToolUse` MUST use grouped `{ matcher: "*", hooks: [...] }`; `PreInvocation`, `PostInvocation`, and `Stop` MUST use flat arrays. `PreToolUse` MUST always stdout `{"decision":"allow"}`; `PostToolUse`/`Stop` stdout `{}`. Keep `"node ./dist/hook-probe.cjs"` in git (`scripts/install.mjs` patches the installed copy only if `node` is absent from `PATH`).
- **`L-007` `SidecarApp.page()` MIME & `SidecarApp.api()` 400 `Response`**: `SidecarApp.page()` defaults non-`.js` routes to `text/html`, and throwing inside `SidecarApp.api()` causes `sidecar_sdk` to return HTTP `500`. Import `Response` from `sidecar_sdk` in `src/sidecar/server.ts`: return `new Response(body, { contentType, headers })` for `/styles.css`, `/dist/ui.js`, and HTML shells, and return `new Response(JSON.stringify({ error }), { status: 400, contentType: 'application/json' })` on client validation errors instead of throwing.
- **`L-008` `agy plugin validate` Scope (`D-007`)**: On workspace root `.`, workspace-only `AGENTS.md` triggers 1 expected `"never loaded"` warning; assert `agy plugin validate . --json` has `0` errors and `components.rules === 0`. Run `agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json` (or staged pack dir) for `0`-warning `--strict` validation.

## 4. Distribution & Git-Tracking Invariants (`D-002`, `D-005`, `D-006`, `D-007`)

- **Git-Tracked Prebuilt Bundles (`D-005`)**: `dist/` and `sidecars/pulse_cockpit/dist/` MUST remain tracked in git (NEVER add either to `.gitignore`). Bundles include SPDX MIT headers (`sidecar_sdk` marked `external`).
- **Inode-Safe Atomic Install (`D-006`)**: `scripts/install.mjs` MUST update files via sibling temp + `renameSync` (never `fs.rmSync` on live plugin directories).
- **Zero-Token Plugin Hygiene (`D-007`)**: NEVER add a root `rules/` directory or ship `AGENTS.md` / `.agents/`. Only on-demand `skills/model-pulse/SKILL.md` ships with the plugin.
- **Canonical Sidecar URI (`D-002`)**: Always use `sidecar://antigravity-pulse/pulse_cockpit/hud` (`server.mjs` aliases `/` to `/hud`).
