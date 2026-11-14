# Antigravity Pulse — Engineering Lessons Learned (`LESSONS_LEARNED.md`)

> **Mandatory Pre-Read Protocol**: Every planning, implementation, and referee subagent working on `antigravity-pulse` MUST read this entire file **before** designing or editing code. Each lesson records a real empirically observed host or SDK pitfall using the format: **Symptom -> Root Cause -> Actionable Prevention Rule -> Verified By**.
> Append new entries (`L-011`, ...) immediately whenever any test failure, protocol quirk, or integration trap is discovered.

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

## `L-006`: `hooks.json` `map[string]JSONHookSpec` Wrapper, Asymmetric Grouping & `PreToolUse` `{"decision":"allow"}` Contract

- **Symptom**: Tool hooks fail validation or silently fail to register when event names sit at the top level of `hooks.json` without a named hook-group key, OR `PreToolUse` blocks/stalls tool execution when returning `{}` instead of `{"decision":"allow"}`.
- **Root Cause**:
  1. Direct inspection of the `agy` binary (`jsonhook.JSONHookSpec` / `map[string]...JSONHookSpec`) and reference plugin `/home/springtian/.gemini/config/plugins/data-agent-kit-plugin/hooks.json` (`"dak-setup-sync"`, `"dak-telemetry"`) confirms `hooks.json` unmarshals into a **top-level `map[string]JSONHookSpec` named hook-group wrapper** (`{ "pulse-telemetry": { "PreToolUse": [...], ... } }`), NOT bare event keys at JSON root.
  2. Antigravity's `JSONHookSpec` schema is intentionally asymmetric across hook categories, and `PreToolUse` checks a decision field on stdout:
     - `PreToolUse` and `PostToolUse` require **grouped** entries: `[{ matcher: "*", hooks: [{ type: "command", command: "node ./dist/hook-probe.cjs", timeout: 5 }] }]`.
     - `PreInvocation`, `PostInvocation`, and `Stop` require **flat** arrays: `[{ type: "command", command: "node ./dist/hook-probe.cjs", timeout: 5 }]`.
     - `PreToolUse` expects stdout `{"decision":"allow"}`; `PostToolUse` and `Stop` expect `{}`; `PreInvocation` and `PostInvocation` expect `{}` or `{"injectSteps":[{"systemMessage":{"systemMessage":"","metadata":{"user_markdown":"..."}}}]}`.
- **Actionable Prevention Rule**:
  1. Wrap all hook event keys under `"pulse-telemetry"` (`map[string]JSONHookSpec`), lock the exact asymmetric structure in `hooks.json`, and enforce it via `tests/contracts/manifest-contracts.test.ts` + `agy plugin validate . --json` (`"hooks": 1`, zero `hooks.json` findings) and `agy plugin validate <installed-dir> --strict --json`.
  2. Dispatch stdout responses by `hookEventName` in `src/hook/hook-probe.ts` so `PreToolUse` **always** emits `{"decision":"allow"}` even in error-recovery fallback paths, while `PostToolUse`/`Stop` emit `{}`.
  3. Keep `hooks.json` pointing to `"node ./dist/hook-probe.cjs"` in git, and have `scripts/install.mjs` patch the installed copy only if `node` is missing from `PATH` (falling back to `agy-node`).
- **Verified By**: Empirically verified against `/home/springtian/.local/bin/agy` (`1.5.8` `jsonhook.JSONHookSpec` symbols) and `/home/springtian/.gemini/config/plugins/data-agent-kit-plugin/hooks.json`; Stage 0 manifest contract test & Stage 1 hook stdout matrix tests.

---

## `L-007`: `SidecarApp.page()` Defaults Non-`.js` Routes to `text/html` & `SidecarApp.api()` Maps Thrown Errors to HTTP `500` (Use `Response`)

- **Symptom**: Registering `app.page('/styles.css', () => cssText)` causes `SidecarApp` to serve `/styles.css` with `Content-Type: text/html` (rejected by Chromium under strict stylesheet MIME rules), AND throwing validation errors inside `app.api(...)` handlers returns HTTP `500` instead of HTTP `400`.
- **Root Cause**: Direct inspection of `/home/springtian/.gemini/antigravity/lib/node_modules/sidecar_sdk/index.mjs`:
  1. `SidecarApp.page()` (lines 145–158) honors `content instanceof Response`, otherwise checks only `url.pathname.endsWith('.js')` to return `application/javascript` and defaults every other plain-string handler to `text/html` without custom headers.
  2. `SidecarApp.api()` (lines 180–192) honors `Response` (or `{ contentType, body, status }`) to emit custom status codes such as `400`, whereas any exception thrown inside an `api()` handler falls into `catch (err)` at lines 189–192 and unconditionally writes HTTP `500` with `{"error": err.message}`.
- **Actionable Prevention Rule**:
  1. Always import `Response` from `sidecar_sdk` in `src/sidecar/server.ts` and wrap `/styles.css` (`text/css; charset=utf-8`), `/dist/ui.js` (`application/javascript; charset=utf-8`), and HTML pages (`text/html; charset=utf-8` + strict CSP headers) in `new Response(body, { contentType, headers })`.
  2. Inside `SidecarApp.api()` handlers, **NEVER** `throw` for client validation failures (invalid `conversationId` UUID, invalid `scope`, malformed `POST /api/config` patch); explicitly return `new Response(JSON.stringify({ error }), { status: 400, contentType: 'application/json' })`.
- **Verified By**: Direct source inspection of `/home/springtian/.gemini/antigravity/lib/node_modules/sidecar_sdk/index.mjs` lines 145–192; Stage 0/1/2 Sidecar HTTP MIME, CSP, and `400` validation E2E tests.

---

## `L-008`: `agy plugin validate . --strict` Flags Contributor `AGENTS.md` at Repo Root (`D-007`)

- **Symptom**: Running `agy plugin validate . --strict --json` in the source repository root exits non-zero (`Error: validation failed in strict mode: 1 warning`) reporting `AGENTS.md`: `"never loaded: plugins load rules only from rules/. Move it to rules/AGENTS.md"`, even when all plugin manifests are valid.
- **Root Cause**: Per Decision `D-007`, repository contributor guidance `AGENTS.md` stays at the repo root and MUST NOT be placed in a plugin `rules/` folder (otherwise Antigravity would inject `always_on` tokens into every user session). Because `agy plugin validate .` treats the working directory as a plugin root, it emits a single warning on the unshipped root `AGENTS.md`, which `--strict` promotes to failure.
- **Actionable Prevention Rule**:
  1. NEVER move contributor `AGENTS.md` into `rules/` or add a plugin-root `rules/` folder (`D-007` non-negotiable invariant).
  2. Validate the **source repository root** using `agy plugin validate . --json` and assert `0` errors, `components.rules === 0`, and that only the expected `AGENTS.md` warning appears.
  3. Run `agy plugin validate ~/.gemini/config/plugins/antigravity-pulse --strict --json` against the **staged or globally installed** plugin bundle (where `scripts/install.mjs` omits `AGENTS.md` and `.agents/`), requiring exit `0` with `"findings": []`.
- **Verified By**: Direct execution of `agy plugin validate . --json` and `agy plugin validate . --strict --json` with `/home/springtian/.local/bin/agy` (`1.5.8`); `STAGE_0_FOUNDATION_PLAN.md` §5.2 & `STAGE_3_CLI_MCP_GOVERNANCE_PLAN.md` §8.3.

---

## `L-009`: `tsconfig.json` Including `"scripts/**/*.mjs"` Requires `"allowJs": true, "checkJs": false` (or Exclusion)

- **Symptom**: `tsconfig.json` includes `"scripts/**/*.mjs"` alongside `"src/**/*.ts"` and `"tests/**/*.ts"` without `"allowJs": true`, which can cause `tsc --noEmit` to reject or skip `.mjs` inputs in the program graph.
- **Root Cause**: Baseline `tsconfig.json` sets `strict: true` and `noEmit: true` with `"include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.mjs"]`, omitting `"allowJs"` and `"checkJs"`. TypeScript does not include `.mjs`/`.js` files smoothly unless `"allowJs": true` is configured (with `"checkJs": false` to avoid noisy JS diagnostics on zero-dep Node build/install scripts), or `.mjs` scripts are excluded from `"include"`.
- **Actionable Prevention Rule**:
  1. In `Stage 0` (`S0-A`), update `tsconfig.json` cleanly (add `"allowJs": true, "checkJs": false` or exclude `"scripts/**/*.mjs"` if strictly checking `.ts` sources only) and verify `npm run typecheck` (`tsc --noEmit`) exits `0` cleanly.
- **Verified By**: Inspection of repo `tsconfig.json` lines 1–15 and `STAGE_0_FOUNDATION_PLAN.md` §3.1 (`3. tsconfig.json`); verified during `Stage 0` `S0-A` / `S0-QA`.

---

## `L-010`: `scripts/build-tests.mjs` Must Flatten `tests/<subpath>/<name>.test.ts` to `.test-dist/<subpath>--<name>.test.cjs`

- **Symptom**: Keeping compiled test bundles in nested `.test-dist/unit/`, `.test-dist/contracts/`, `.test-dist/benchmarks/`, and `.test-dist/e2e/` subdirectories causes `package.json`'s `"test"` command (`node --test .test-dist/*.test.cjs`) to skip every test file.
- **Root Cause**: `package.json` executes `npm run build && node scripts/build-tests.mjs && node --test .test-dist/*.test.cjs`, whose single-level `*` wildcard only matches direct children of `.test-dist/`.
- **Actionable Prevention Rule**:
  1. `scripts/build-tests.mjs` MUST recursively discover all `tests/**/*.test.ts` files and flatten each relative path into `.test-dist/<subpath>--<name>.test.cjs` (e.g., `unit--state-dir.test.cjs`, `contracts--manifest-contracts.test.cjs`, `benchmarks--hook-latency.test.cjs`, `e2e--hud-loop.test.cjs`).
  2. Preserve `package.json`'s `.test-dist/*.test.cjs` glob unchanged so `npm test` discovers all four test categories consistently across Linux and Windows.
- **Verified By**: Repo `package.json` line 49 (`"test"` script) & `STAGE_0_FOUNDATION_PLAN.md` §3.5(3).

---

## `L-011`: Stitch API `v1 :download` JSON `dataString` Wrapping, `find screens` `DOCUMENT`-Only Filtering & `360px` HUD Truncation Risks

- **Symptom**: Running `stitch_ops.py export-project` returns only `DESIGN.md` (`returnedCount=1`) and overwrites `export_manifest.json`, hiding generated `DESIGN` screens (`af32887f71e7494e9e38e4ae4ef39b52`, `630bde1beb414834bcefe327fcf73551`); meanwhile files saved from Stitch `v1 :download` endpoints contain JSON text (`{"dataString": "..."}`) rather than raw PNG/HTML bytes, failing `read_file` image inspection. In addition, visual inspection of the generated `360px` HUD screenshot shows right-edge clipping in three high-density horizontal rows.
- **Root Cause**:
  1. Stitch `v1` `:download` endpoints wrap PNG screenshots (`base64`) and HTML payloads (stringified) inside JSON `dataString` envelopes that must be decoded locally (`screenshot_decoded.png`, `index_decoded.html`) before visual/DOM inspection.
  2. `stitch find screens --project <pid>` (called internally by `stitch_ops.py export-project`) only returns mounted `screenType: "DOCUMENT"` artifacts (`16500565309143592318` `DESIGN.md`), overwriting `export_manifest.json` even when live `screenType: "DESIGN"` screens exist and resolve via positional `stitch get screen <id> --project <pid> -f json` (or MCP `stitch_get`).
  3. In narrow `360px` `AUX_PANE` viewports (`Model Pulse HUD - Aux Pane`), unguarded flex rows risk truncation at (a) the top tabbar (`Quota 配额`) next to right-side icon buttons, (b) the sticky hero `Requested ➔ Served` nameplate (`Auto ➔ Gemini...` vs `✓ gemini-4-argon`), and (c) the bottom `36px` fuel bar (`Wk: 96.5%` adjacent to tree delta and stamp mode pill).
- **Actionable Prevention Rule**:
  1. Decode Stitch `v1 :download` JSON `dataString` wrappers locally (`base64` -> PNG, string -> HTML) before visual inspection via `read_file`.
  2. Pass explicit `--project <pid>` flags (`--project 9409889379743133909`) and verify `DESIGN` screens via positional `stitch get screen <id> --project <pid> -f json` (or MCP `stitch_get`) rather than relying solely on `find screens` / `export-project`.
  3. Enforce `min-width: 0`, scrollable single-row tabbars, compact label truncation guards, and visual QA verification across all 3 `360px` HUD rows during Stage 1 (`S1-C`) and Stage 2 (`S2-B`).
- **Verified By**: Live MCP `stitch_get` responses for screens `af32887f71e7494e9e38e4ae4ef39b52` and `630bde1beb414834bcefe327fcf73551` (`2560x2048` `DESKTOP` `DESIGN`); `.stitch/exports/9409889379743133909/export_manifest.json`; visual inspection of `screenshot_decoded.png` for both screens.

---

## `L-012`: Ephemeral Port `0` Falsy Coercion (`Number(raw) || 4173`), POSIX `set -eu` `"${HOME:-}"` Guard & `<progress>` / `#pulse-app` Overflow Containment

- **Symptom**: (a) Passing `--port 0`, `--port=0`, or `PORT=0` to `scripts/preview-ui.mjs` falls back to port `4173` instead of binding an ephemeral OS port; (b) POSIX launcher `bin/agy-pulse` under `set -eu` crashes with `HOME: unbound variable` when `HOME` is unset; (c) uncontained `<progress>` and outer `100dvh` flex shells leak fill past rounded borders or spawn double scrollbars.
- **Root Cause**:
  1. `Number('0') || 4173` evaluates `0` as falsy in JS, discarding valid port `0` before `server.listen(0, '127.0.0.1')` and skipping `server.address().port`.
  2. Under `set -eu`, guarding `[ -x "${HOME:-}/..." ]` without also writing `"${HOME:-}"` on the `exec` line still raises an unbound variable error if `HOME` is unset (or vice versa).
  3. Native `<progress>` requires `overflow: clip;` to contain track border-radius across engines, and a fixed-viewport sidecar requires `height: 100dvh; max-height: 100dvh; overflow: hidden;` on `#pulse-app` (`.pulse-app`) paired with `min-height: 0; overflow-y: auto;` on `.pulse-main`.
- **Actionable Prevention Rule**:
  1. Parse port arguments and `PORT` env using strict integer validation (`Number.isInteger(n) && n >= 0 && n <= 65535`) and resolve the bound port via `server.address().port`.
  2. Guard `"${HOME:-}"` consistently across both condition checks and `exec` statements in POSIX `set -eu` scripts.
  3. Keep `overflow: clip;` on `.pulse-progress` and `height: 100dvh; max-height: 100dvh; overflow: hidden;` on `.pulse-app` (`#pulse-app`).
- **Verified By**: [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs) lines 15–39 & 196–200; [`bin/agy-pulse`](../../bin/agy-pulse) lines 21–23; [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css) lines 264–290 & 471–482; `tests/contracts/manifest-contracts.test.ts` ephemeral `--port 0` / `--port=0` / `PORT=0` subprocess assertions.
