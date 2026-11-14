# Antigravity Pulse — Engineering Lessons Learned (`LESSONS_LEARNED.md`)

> **Mandatory Pre-Read Protocol**: Every planning, implementation, and referee subagent working on `antigravity-pulse` MUST read this entire file **before** designing or editing code. Each lesson records a real empirically observed host or SDK pitfall using the format: **Symptom -> Root Cause -> Actionable Prevention Rule -> Verified By**.
> Append new entries (`L-008`, ...) immediately whenever any test failure, protocol quirk, or integration trap is discovered.

---

## `L-001`: Connect-RPC `usage.*` Int64 Token Fields Arrive as JSON Strings

- **Symptom**: Summing `usage.inputTokens + usage.outputTokens` or computing token ratios produces string concatenation (e.g., `"19353421"` instead of `19774`) or `NaN` in TypeScript/JavaScript arithmetic.
- **Root Cause**: Protobuf-to-JSON serialization in Antigravity `LanguageServerService` encodes 64-bit integer (`int64`) fields inside `GetCascadeTrajectoryGeneratorMetadata` (`usage.inputTokens`, `usage.outputTokens`, `usage.thinkingOutputTokens`, `usage.responseOutputTokens`, `usage.cacheReadTokens`) as **JSON strings** (e.g. `"19353"`), not JSON numbers, even if TypeScript callers type them loosely.
- **Actionable Prevention Rule**:
  1. Model raw wire `usage.*` fields in `src/types/rpc.ts` as `string | number | undefined`.
  2. Always coerce through a single helper `toIntToken(v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) && n >= 0 ? n : 0; }` immediately at the RPC normalization boundary.
- **Verified By**: Empirically verified host fact (`GetCascadeTrajectoryGeneratorMetadata` contract); Stage 1 unit tests (`tests/unit/core-metrics.test.ts`).

---

## `L-002`: Prompt Cache Hit Denominator Must Sum `inputTokens + cacheReadTokens`

- **Symptom**: Cache hit percentage exceeds `100%` (e.g., `850%`) or evaluates to `Infinity` / `NaN` on heavily cached turns.
- **Root Cause**: In `GetCascadeTrajectoryGeneratorMetadata.chatModel.usage`, `inputTokens` represents **uncached** prompt tokens ONLY, while `cacheReadTokens` represents **cached prefix** tokens. Dividing `cacheReadTokens / inputTokens` uses the wrong denominator and blows up whenever cached tokens exceed uncached tokens or `inputTokens === 0`.
- **Actionable Prevention Rule**:
  1. Compute total input prompt tokens as `totalIn = inputTokens + cacheReadTokens`.
  2. Compute `cacheHitPct = totalIn > 0 ? (cacheReadTokens / totalIn) * 100 : 0` via a single shared core helper. NEVER divide by `inputTokens` alone.
- **Verified By**: Empirically verified host fact (`GetCascadeTrajectoryGeneratorMetadata` cache semantics); Stage 1 unit tests (`inputTokens = 1000, cacheReadTokens = 9000 -> 90.0%`; `inputTokens = 0, cacheReadTokens = 5000 -> 100.0%`; `totalIn = 0 -> 0%`).

---

## `L-003`: `retryInfos.length === 1` Is the Normal Non-Retried Baseline

- **Symptom**: Every normal healthy LLM turn shows a false-positive `⚠ Retried ×1` warning badge and floods `smart` inline turn stamps on every turn.
- **Root Cause**: In `GetCascadeTrajectoryGeneratorMetadata.chatModel`, a standard single-attempt invocation without any backoff or retry already contains **1 entry** in `retryInfos` (`retryInfos.length === 1`). Only when `retryInfos.length > 1` did an actual retry occur.
- **Actionable Prevention Rule**:
  1. Always calculate actual retry count as `const retryCount = Math.max(0, (retryInfos?.length ?? 0) - 1)`.
  2. Detect whether a retry occurred strictly with `(retryInfos?.length ?? 0) > 1` (`retryCount > 0`), never `retryInfos.length > 0`.
- **Verified By**: Empirically verified host fact (`retryInfos` baseline); Stage 1 retry unit tests (`length = 0 -> 0`, `length = 1 -> 0 / no alert`, `length = 3 -> 2 retries / alert`).

---

## `L-004`: `GetCascadeTrajectorySteps` Ignores `startIndex`/`endIndex` — Must Use `stepOffset`

- **Symptom**: Calling `GetCascadeTrajectorySteps` with `{ cascadeId, startIndex, endIndex }` unexpectedly dumps the entire conversation step history (`500KB+`), spiking memory and Sidecar latency.
- **Root Cause**: The `LanguageServerService.GetCascadeTrajectorySteps` protobuf request defines `stepOffset` and `disableRehydration`, NOT `startIndex`/`endIndex`; unknown JSON fields are silently ignored by protobuf JSON decoding, defaulting `stepOffset` to `0`.
- **Actionable Prevention Rule**:
  1. Call `GetCascadeTrajectorySteps` **only** for cascades whose current `status === "CASCADE_RUN_STATUS_RUNNING"`.
  2. Always pass `{ cascadeId: cid, stepOffset: Math.max(0, stepCount - 4), disableRehydration: true }` to inspect only the tail 3–4 steps (`CORTEX_STEP_STATUS_GENERATING`, `CORTEX_STEP_STATUS_RUNNING`, `viewableAt`, `finishedGeneratingAt`, `toolCall`).
- **Verified By**: Empirically verified host fact (`GetCascadeTrajectorySteps` contract); Stage 1 RPC contract tests asserting `stepOffset` presence, absence of `startIndex`/`endIndex`, and zero step calls for `IDLE` cascades.

---

## `L-005`: `swarm/members.json` Stores `members` as an Object Map, Not an Array

- **Symptom**: Calling `data.members.map(...)` or `for (const m of data.members)` crashes topology construction with `TypeError: data.members.map is not a function` whenever a native Swarm is active.
- **Root Cause**: `~/.gemini/antigravity/brain/<cid>/.system_generated/swarm/members.json` has schema `{ title?: string, members: Record<memberName, { conversation_id, role, desired_state, desired_model, applied_model, workspace_mode, phase, wake_mode, killed, model }> }` — `members` is a keyed object map whose keys are worker member names, NOT a JSON array.
- **Actionable Prevention Rule**:
  1. Type `SwarmMembersFile.members` strictly as `Record<string, SwarmMemberRaw>` in `src/types/rpc.ts`.
  2. Always iterate with `Object.entries(data?.members ?? {})`, preserving `memberName` alongside `conversation_id`, `role`, `phase`, `applied_model` / `desired_model` / `model`, and `killed`.
- **Verified By**: Empirically verified host fact (`swarm/members.json` schema); Stage 1 topology unit tests covering object-map `members` parsing.

---

## `L-006`: `hooks.json` Asymmetric Grouping & `PreToolUse` `{"decision":"allow"}` Contract

- **Symptom**: Tool hooks fail validation or silently fail to register, OR `PreToolUse` blocks/stalls tool execution when returning `{}` instead of `{"decision":"allow"}`.
- **Root Cause**: Antigravity's `hooks.json` schema is intentionally asymmetric across hook categories, and `PreToolUse` checks a decision field on stdout:
  - `PreToolUse` and `PostToolUse` require **grouped** entries: `[{ matcher: "*", hooks: [{ type: "command", command: "node ./dist/hook-probe.cjs", timeout: 5 }] }]`.
  - `PreInvocation`, `PostInvocation`, and `Stop` require **flat** arrays: `[{ type: "command", command: "node ./dist/hook-probe.cjs", timeout: 5 }]`.
  - `PreToolUse` expects stdout `{"decision":"allow"}`; `PostToolUse` and `Stop` expect `{}`; `PreInvocation` and `PostInvocation` expect `{}` or `{"injectSteps":[{"systemMessage":{"systemMessage":"","metadata":{"user_markdown":"..."}}}]}`.
- **Actionable Prevention Rule**:
  1. Lock the exact asymmetric structure in `hooks.json` and enforce it via `tests/contracts/manifest-contracts.test.ts` + `agy plugin validate --strict`.
  2. Dispatch stdout responses by `hookEventName` in `src/hook/hook-probe.ts` so `PreToolUse` **always** emits `{"decision":"allow"}` even in error-recovery fallback paths, while `PostToolUse`/`Stop` emit `{}`.
  3. Keep `hooks.json` pointing to `"node ./dist/hook-probe.cjs"` in git, and have `scripts/install.mjs` patch the installed copy only if `node` is missing from `PATH` (falling back to `agy-node`).
- **Verified By**: Empirically verified host fact (`hooks.json` contract); Stage 0 manifest contract test & Stage 1 hook stdout matrix tests.

---

## `L-007`: `SidecarApp.page()` Defaults Non-`.js` Routes to `text/html` (Use `Response` for CSS & CSP)

- **Symptom**: Registering `app.page('/styles.css', () => cssText)` causes `SidecarApp` to serve `/styles.css` with `Content-Type: text/html`, which Chromium refuses to apply under `X-Content-Type-Options: nosniff` / strict stylesheet MIME rules.
- **Root Cause**: Direct inspection of `/home/springtian/.gemini/antigravity/lib/node_modules/sidecar_sdk/index.mjs` (lines 152–155) confirms `SidecarApp.run()` only checks `url.pathname.endsWith('.js')` to return `application/javascript` and defaults every other plain-string `page()` handler to `text/html`, while skipping `Response` headers when plain strings are returned.
- **Actionable Prevention Rule**:
  1. Always import `Response` from `sidecar_sdk` in `src/sidecar/server.ts` and wrap `/styles.css` (`text/css; charset=utf-8`), `/dist/ui.js` (`application/javascript; charset=utf-8`), and HTML pages (`text/html; charset=utf-8` + strict CSP headers) in `new Response(body, { contentType, headers })`.
- **Verified By**: Direct source inspection of `sidecar_sdk/index.mjs` lines 145–158; Stage 1 Sidecar HTTP MIME & CSP header E2E test.
