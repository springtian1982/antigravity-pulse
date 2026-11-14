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

---

## `L-013`: `esbuild` CJS Test-Bundle Hoisting of `require.main === module`

- **Symptom**: Running `node --test` on `esbuild`-compiled `.test-dist/*.test.cjs` bundles hangs waiting on `stdin` (`readFileSync(0, 'utf8')`) or executes CLI startup side effects whenever a test file imports a CLI/hook entrypoint module (such as `src/hook/hook-probe.ts`, and prospectively Stage 3 `src/cli/main.ts` and `src/mcp/server.ts`) guarded solely by `if (require.main === module)`.
- **Root Cause**: [`scripts/build-tests.mjs`](../../scripts/build-tests.mjs) bundles each `tests/**/*.test.ts` together with all imported `src/**` files into a single self-contained `.cjs` bundle (`format: 'cjs'`). When `node --test` executes `.test-dist/<subpath>--<name>.test.cjs`, that single test bundle *is* `require.main === module`, so `require.main === module` evaluates `true` for every source module inlined inside it—triggering `runHookCli()` inside unit tests. Adding `process.env` opt-out flags to tests would be fragile and risk mutating or breaking spawned child binary smoke/benchmark tests.
- **Actionable Prevention Rule**:
  1. Gate every CLI, hook, and MCP entrypoint (`src/hook/hook-probe.ts`, Stage 3 `src/cli/main.ts`, `src/mcp/server.ts`) on BOTH `require.main === module` AND `require.main?.filename` matching the dedicated entrypoint filename: `typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module && typeof require.main?.filename === 'string' && /(?:^|[\\/])<entrypoint>\.(?:c?js|mjs|ts)$/i.test(require.main.filename)`.
  2. Never rely on test-only environment variable skips that could mask real subprocess execution paths.
- **Verified By**: [`src/hook/hook-probe.ts`](../../src/hook/hook-probe.ts) lines 725–734 (`/(?:^|[\\/])hook-probe\.(?:c?js|mjs|ts)$/i`); [`tests/unit/hook-probe.test.ts`](../../tests/unit/hook-probe.test.ts) & [`tests/benchmarks/hook-latency.test.ts`](../../tests/benchmarks/hook-latency.test.ts) (both in-process imports and real spawned `dist/hook-probe.cjs` runs passing cleanly).

---

## `L-014`: Cross-Stage CSS/DOM Selector Contract Parity & `inline-flex` Ellipsis (`V1`–`V5` Visual QA)

- **Symptom**: Initial Stage 1 headless browser visual QA (`V1`–`V5` at `360×820` and `420×820`) surfaced four layout/styling defects: (1) phase dots and model tier badges fell back to neutral colors instead of distinct Flexoki Light/Dark tiers, and `<progress data-level="critical_85">` (`88.4%` CTX) remained blue instead of coral red; (2) `.pulse-main` / `.pulse-hud-scroll` scroll containers displayed unwanted focus outline rings; (3) narrow `360px` agent cards crushed `.pulse-node-title` down to a single character; and (4) `inline-flex` `.pulse-node-model-btn` pills clipped overflowing model names abruptly instead of rendering a clean `…` ellipsis.
- **Root Cause**:
  1. Stage 0 CSS authored `.pulse-tier-*` class rules before Stage 1 `hud-view.ts` rendered `data-tier`, `data-level`, and `data-phase` attribute hooks; meanwhile native `<progress>` shadow pseudo-elements (`::-webkit-progress-value` and `::-moz-progress-bar`) require strictly separate vendor blocks routed via `--pulse-progress-fill` per `[data-level]`.
  2. Unbudgeted `360px` card row flex widths let `.pulse-node-actions` starve `.pulse-node-title`, and `text-overflow: ellipsis` does not reliably render directly on a `display: inline-flex` `<button>` element unless the text lives inside an inner block child (`<span class="pulse-btn-label">`).
  3. `scrollbar-gutter: stable` wasted horizontal space on `360px` sidecars and default browser `:focus` outlines on `.pulse-main` / `.pulse-hud-scroll` highlighted non-button scroll regions.
- **Actionable Prevention Rule**:
  1. Bind semantic CSS rules explicitly to both classes and `data-*` attributes (`[data-tier]`, `[data-level]`, `[data-phase]`), drive `<progress>` colors via `--pulse-progress-fill` in strictly ungrouped `::-webkit-progress-value` / `::-moz-progress-bar` blocks, and assert computed Flexoki RGB values and `<progress>` threshold fills during visual QA.
  2. Suppress focus outlines on scroll containers (`.pulse-main:focus`, `.pulse-hud-scroll:focus`) without suppressing interactive `:focus-visible` rings, omit `scrollbar-gutter: stable`, enforce `@media (max-width: 420px)` / `(max-width: 390px)` row budgets so `360px` card titles never collapse, and wrap truncated pill text inside `<span class="pulse-btn-label">` (`display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`).
- **Verified By**: [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css) lines 450–544, 612–685, 851–856, 1030–1085, 1234–1262; [`src/ui/hud-view.ts`](../../src/ui/hud-view.ts) lines 469–495; `S1-QA` (`48de57b4`) `V1`–`V5` browser screenshots (`0` console/page errors, `scrollWidth === clientWidth`, crisp `…` ellipsis).

---

## `L-015`: Sequential Benchmark Isolation (`D-009`) & Deterministic Headless Preview Theme/Scenario Hooks

- **Symptom**: (1) Running child-spawning `contracts/` and `e2e/` test suites in parallel with `tests/benchmarks/hook-latency.test.ts` injected `~30ms` CPU scheduler jitter, pushing `OS fork+exec` hook startup from `~38–44ms` to `~72ms`; (2) restricted headless browser sandboxes that disallow `page.emulateMedia()` could not toggle Dark Mode via OS `(prefers-color-scheme: dark)` media queries alone, and multi-scenario browser requests without explicit per-request `?scenario=` routing collided on shared preview state or threw in `computePreviewEtag()` when non-HUD responses lacked `treeNodes`.
- **Root Cause**: Concurrent `node --test` workers saturating CPU cores distort wall-clock OS `fork+exec` microbenchmarks; meanwhile `src/ui/main.ts` previously ignored URL `?theme=` parameters and `scripts/preview-ui.mjs` lacked per-request `?scenario=` + `Referer` fallback resolution and array-guarded ETag normalization.
- **Actionable Prevention Rule**:
  1. Run functional test suites (`unit`, `contracts`, `e2e`) in parallel and `benchmarks--*.test.cjs` sequentially afterward (`D-009`) while keeping `D-004` thresholds (`<= 8.0ms` JS / `<= 50.0ms` OS) untouched.
  2. Support `?theme=dark|light` query override in [`src/ui/main.ts`](../../src/ui/main.ts) (`getThemeQueryOverride`) and per-request `?scenario=` + `Referer` scenario resolution plus `Array.isArray(semantic.treeNodes)` guards in [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs) so headless cross-theme/cross-scenario QA remains deterministic across sandboxes.
- **Verified By**: [`package.json`](../../package.json) line 49 (`D-009`); [`src/ui/main.ts`](../../src/ui/main.ts) lines 32–59; [`scripts/preview-ui.mjs`](../../scripts/preview-ui.mjs) lines 621–685; [`tests/e2e/stage1-acceptance.test.ts`](../../tests/e2e/stage1-acceptance.test.ts) & [`tests/benchmarks/hook-latency.test.ts`](../../tests/benchmarks/hook-latency.test.ts).

---

## `L-016`: Dense Flex Drawer Wrapping, Badge `flex: 0 0 auto` & Hidden `@media` Width Overrides

- **Symptom**: During initial Stage 2 visual QA (`vis04`, `vis05`, `vis06`), (1) expanded `360×820` `/fleet` drawer rows crushed `.pulse-node-kind` badges (`Root` -> `R…`, `Subagent` -> `S…`, `Swarm` -> `Sw…`) and clipped model pills (`Gemini 4 Carbon (…`, `Orchestrator (Ca…`), and (2) Top 5 Quota Burners model pills clipped prematurely (`Gemini 4 Carbon (Hi…`) in both `1024×820` and `420×820` views despite having sufficient vertical room to wrap cleanly.
- **Root Cause**:
  1. `.pulse-node-kind` carried base `flex: 0 1 auto` and a Stage 1 `@media (max-width: 420px)` rule setting `max-width: 72px; overflow: hidden; text-overflow: ellipsis;`. Inside dense single-line drawer flex items (`.pulse-fleet-drawer-item`), flex shrinking plus the hidden `@media (max-width: 420px)` `max-width` override compressed short kind badges (`Root`/`Subagent`/`Swarm`) down to 1–2 characters.
  2. Forcing `[dot + kind + title]` and `[model pill + ↗]` onto a single rigid line at `360px` starved both sides, while `.pulse-burner-meta .pulse-pill` had an overly tight `140px` `max-width` cap that clipped long model display names such as `Gemini 4 Carbon (High)`.
- **Actionable Prevention Rule**:
  1. Prevent categorical kind badges inside dense drawers from shrinking or inheriting narrow-pane truncation: set `flex: 0 0 auto; max-width: none;` on `.pulse-fleet-drawer-item .pulse-node-kind` **and** explicitly override it inside `@media (max-width: 420px)`.
  2. Give narrow (`360px`) drawer items explicit 2-row flex wrapping (`flex-wrap: wrap` on `.pulse-fleet-drawer-item`, `flex: 1 1 180px` on `.pulse-fleet-drawer-left`, `flex: 0 0 auto; margin-inline-start: auto` on `.pulse-fleet-drawer-right`, and `max-width: min(210px, 100%)` on `.pulse-fleet-drawer-right .pulse-pill`) so titles, kind badges, model pills, and `[↗]` jump buttons stay legible with zero horizontal overflow.
  3. Audit `.pulse-pill` `max-width` caps in wrapping metadata rows (e.g. `.pulse-burner-meta .pulse-pill { max-width: min(220px, 100%); }` and `.pulse-burner-meta .pulse-node-kind { max-width: min(160px, 100%); }`) across both `< 640px` and `>= 640px` breakpoints so full model names display without premature `…` clipping.
- **Verified By**: [`sidecars/pulse_cockpit/styles.css`](../../sidecars/pulse_cockpit/styles.css) lines 1051–1060, 1254–1264, 1731–1785, 1845–1857; [`src/ui/fleet-view.ts`](../../src/ui/fleet-view.ts) lines 163–199, 314–345; `VIS-04-R`, `VIS-05-R`, and `VIS-06-R` post-fix browser recheck screenshots (`0` console/page errors, `scrollWidth === clientWidth`).

---

## `L-017`: E2E `--watch` Race Against Live Sidecar Polling & Ambient `ANTIGRAVITY_*` Env Isolation

- **Symptom**: In full-system E2E runs inside an active Antigravity IDE agent shell, leaving a spawned background `pulse_cockpit` Sidecar polling concurrently while mutating `live-snapshot.json` for `--watch` assertions created file-write overwrite races; meanwhile inherited `ANTIGRAVITY_LS_ADDRESS`, `ANTIGRAVITY_CSRF_TOKEN`, `ANTIGRAVITY_CONVERSATION_ID`, and `CLAUDE_PLUGIN_DATA` env vars leaked live host state into isolated CLI/MCP tests.
- **Root Cause**: `fs.watch` in `agy-pulse status --watch` reacts to any rewrite of `live-snapshot.json`, so an active Sidecar poll loop running against a mock LS immediately overwrote manual `writeJsonAtomic` test mutations; simultaneously, `execFileSync`/`spawn` inherit parent `process.env` unless Antigravity host variables are scrubbed explicitly.
- **Actionable Prevention Rule**:
  1. Scrub `ANTIGRAVITY_*`, `PULSE_*`, and `CLAUDE_PLUGIN_DATA` via a shared `isolatedEnv()` helper (or `beforeEach`/`afterEach` env restoration) in all CLI, MCP, and E2E child-process tests.
  2. Stop background Sidecar child processes cleanly (`await stopChild(sidecarChild)`) before performing deterministic `--watch` disk-mutation steps, and wrap spawned child processes in `try/finally` cleanup blocks.
- **Verified By**: [`tests/e2e/full-system.test.ts`](../../tests/e2e/full-system.test.ts) lines 339–347, 611, 678–680, 855–858; [`tests/unit/cli-top.test.ts`](../../tests/unit/cli-top.test.ts) lines 27–55; [`tests/contracts/manifest-contracts.test.ts`](../../tests/contracts/manifest-contracts.test.ts) lines 240–246.

---

## `L-018`: East Asian/CJK Wide Glyph Terminal Display Width & Non-TTY `COLUMNS`/`LINES` Fallback

- **Symptom**: Rendering `agy-pulse top --once` with Chinese cascade titles (e.g., `产品设计分阶段实施规划`) or emojis caused table columns and separator rules to overflow or drift horizontally when measured via `String.length`, and piped/non-TTY execution where `stdout.columns` is `undefined` ignored caller `COLUMNS`/`LINES` dimensions.
- **Root Cause**: CJK ideographs and wide emojis occupy 2 terminal display cells while JavaScript `string.length` counts UTF-16 code units (1 per CJK char, 2 per astral surrogate), and `process.stdout.columns` is `undefined` outside interactive PTYs.
- **Actionable Prevention Rule**:
  1. Compute padding and ANSI-aware truncation exclusively using East Asian/emoji `codePointDisplayWidth` / `displayWidth` cell widths (`0` for combining/control/ZWJ, `2` for CJK/fullwidth/emoji ranges, `1` otherwise) inside [`src/cli/top-tui.ts`](../../src/cli/top-tui.ts).
  2. Resolve terminal dimensions via `stdout.columns ?? parsePositiveEnvInt(process.env.COLUMNS) ?? 100` and `stdout.rows ?? parsePositiveEnvInt(process.env.LINES) ?? 24`, keeping POSIX PTY precedence while supporting deterministic non-TTY rendering.
- **Verified By**: [`src/cli/top-tui.ts`](../../src/cli/top-tui.ts) lines 75–224, 703–704, 726–727; [`tests/unit/cli-top.test.ts`](../../tests/unit/cli-top.test.ts) lines 456–642; live `top --once --no-color` captures (`SEP_WIDTHS=[80,80]` and `[120,120]`).

---

## `L-019`: `<agent-embed>` `.pill` `inline-block` Ellipsis & Responsive 2-Tier Flex Rows vs Fixed `%` Tables

- **Symptom**: Inside narrow `440px` `<agent-embed>` status cards, fixed-percentage single-row tables and `inline-flex` `.pill` badges clipped `CTX%`/`ΔQuota%` metrics and alert pills (`Fallback`, `Retry ×1`) or failed to emit clean `…` truncation on long model badges.
- **Root Cause**: `text-overflow: ellipsis` does not apply reliably on `inline-flex` elements without inner block spans, and multi-column fixed `%` tables collapse at narrow chat-embed widths (`440px`).
- **Actionable Prevention Rule**:
  1. Style standalone `.pill` elements with `display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` (and `.pill-model { max-width: 165px }`).
  2. Render each topology node as a 2-tier responsive flex card (`.tree-row-main` wrapping `.node-cell` + `.node-badges` with `flex: 0 0 auto` badges, paired with `.tree-row-sub` carrying full model & last-tool detail) plus a `2×2` `@media (max-width: 460px)` fuel strip.
- **Verified By**: [`src/mcp/embed-card.ts`](../../src/mcp/embed-card.ts) lines 276–299, 470–666; [`tests/unit/mcp-embed-card.test.ts`](../../tests/unit/mcp-embed-card.test.ts) lines 275–343; browser inspection `1571a09f` (`640×520` Light/Dark & `440×520` Narrow Dark).

---

## `L-020`: Cold-Spawn `node:crypto` OpenSSL Penalty (`~8.3ms`) & Paired Bare-V8 Baseline Calibration

- **Symptom**: `dist/hook-probe.cjs` eagerly loaded `node:crypto` solely for `.tmp` suffix uniqueness in `writeJsonAtomic`, adding `~8.3ms` OpenSSL cold-init latency on every hook invocation; concurrently, under host CPU contention (`load average: 4.1–5.2`), bare `node -e ""` (`v24.21.0`) spawn latency rose to `43.4–54.1ms`, causing an uncalibrated `<= 50.0ms` OS wall-clock ceiling on `Metric 2` to fail despite `~12–13ms` marginal hook runtime cost.
- **Root Cause**: Importing `node:crypto` inside shared state-bus code pulls OpenSSL initialization into hot-path CLI hooks, while comparing absolute `fork+exec` wall-clock against a static `50ms` constant conflates host kernel/V8 startup load with hook code efficiency.
- **Actionable Prevention Rule**:
  1. Keep `dist/hook-probe.cjs` free of `node:crypto` (`writeJsonAtomic` uses monotonic `${process.pid}.${process.hrtime.bigint().toString(36)}.${atomicTmpSeq.toString(36)}` in [`src/state/state-dir.ts`](../../src/state/state-dir.ts)), verified by `! grep -q "node:crypto" dist/hook-probe.cjs`.
  2. Calibrate `Metric 2` via 1 warmup pair + 10 paired `bare node -e ''` vs `dist/hook-probe.cjs` spawns enforcing all three invariants simultaneously (`D-010`): `pairedDeltaMedianMs <= 20.0`, `probeMedianMs <= Math.max(50.0, bareMedianMs + 20.0)`, and `probeMedianMs <= 100.0`.
- **Verified By**: [`src/state/state-dir.ts`](../../src/state/state-dir.ts) lines 24 & 141–143; [`dist/hook-probe.cjs`](../../dist/hook-probe.cjs) (`34K`, `NO_CRYPTO_IN_HOOK_OK`); [`tests/benchmarks/hook-latency.test.ts`](../../tests/benchmarks/hook-latency.test.ts) lines 239–329; [`D-010`](./DECISION_LOG.md#d-010-contract_change_request-openssl-free-hook-bundle--paired-bare-v8-baseline-calibration-for-metric-2-refines-d-004--d-009).

---

## `L-021`: Automated `SKILL.md` Schema-Key Contract Guards & Unmapped Host `MODEL_PLACEHOLDER_*` Routing Trust

- **Symptom**: Initial `S3-QA` audit caught two silent semantic drifts: (1) `skills/model-pulse/SKILL.md` referenced stale/invented field names (`recommendedTier`, `quotaPressure`, `swarmDensity`) instead of `ComputeBudgetAdvice` / `pulse_status_card` keys (`recommendedSubagentModel`, `reason`, `warnings`, `embedTag`, `sidecarPill`), and (2) live Antigravity cascades using internal placeholders omitted from `clientModelConfigs` (`MODEL_PLACEHOLDER_M669`, `MODEL_PLACEHOLDER_M681`, `MODEL_PLACEHOLDER_M322`) or future unmapped placeholders (`MODEL_PLACEHOLDER_*`) triggered false `mismatch_or_fallback` warnings.
- **Root Cause**: `SKILL.md` lacked automated schema-key regression tests, while `decodeModelDescriptor()` previously synthesized literal fallback descriptors for unmapped `MODEL_PLACEHOLDER_*` strings so `reconcileRequestedVsServed()` compared `"model_placeholder_m669"` against `"gemini-flash-worker-agy"` and flagged a mismatch.
- **Actionable Prevention Rule**:
  1. Lock distributed skill docs against frozen [`src/types/telemetry.ts`](../../src/types/telemetry.ts) & MCP response keys in [`tests/contracts/manifest-contracts.test.ts`](../../tests/contracts/manifest-contracts.test.ts) (explicitly asserting required keys and banning deprecated aliases).
  2. Map known live host placeholders (`M669`, `M681`, `M322`) in `BUILTIN_ALIASES`, return `null` from `decodeModelDescriptor()` for unknown `^MODEL_PLACEHOLDER_` enums, and resolve unmapped `MODEL_PLACEHOLDER_*` requested models cleanly to `'matched'` or `'routed'` in `reconcileRequestedVsServed()`.
- **Verified By**: [`skills/model-pulse/SKILL.md`](../../skills/model-pulse/SKILL.md) lines 27–58; [`tests/contracts/manifest-contracts.test.ts`](../../tests/contracts/manifest-contracts.test.ts) lines 139–158; [`src/core/model-catalog.ts`](../../src/core/model-catalog.ts) lines 50–76, 316–318, 520–531; [`tests/unit/core-catalog.test.ts`](../../tests/unit/core-catalog.test.ts) lines 92–102, 296–383.

---

## `L-022`: Long-Lived Sidecar V8 Memory Caching Across Atomic Installs & Host `PLUGIN_DATA` Split-Brain

- **Symptom**: After upgrading an initial Stage 0 global install via `npm run install:global`, `/hud` continued rendering `"Idle · 未检测到活跃会话 / Language Server 未连接"` (`etag: "stage0"`, `hostConnected: false`), while standalone `agy-pulse` shells without `PLUGIN_DATA` looked in `~/.gemini/antigravity/pulse-state` instead of the host's `~/.gemini/antigravity/plugin_data/antigravity-pulse`.
- **Root Cause**: (1) Antigravity 2.0 injects `PLUGIN_DATA=<appDataDir>/plugin_data/antigravity-pulse` into Hook/MCP/Sidecar child processes, whereas external terminals lack `PLUGIN_DATA`; (2) `D-006` atomic `tmp + renameSync` replaces `sidecars/pulse_cockpit/dist/server.mjs` on disk without signaling an already-running Node/V8 Sidecar daemon, leaving pre-upgrade code resident in memory indefinitely unless the daemon watches its own bundle or the plugin is toggled.
- **Actionable Prevention Rule**:
  1. Match standalone CLI fallback in [`src/state/state-dir.ts`](../../src/state/state-dir.ts) to `<ANTIGRAVITY_APP_DATA_DIR || ANTIGRAVITY_DATA_DIR || ~/.gemini/antigravity>/plugin_data/antigravity-pulse`, check `ANTIGRAVITY_APP_DATA_DIR` before `ANTIGRAVITY_DATA_DIR` in [`src/sidecar/telemetry-engine.ts`](../../src/sidecar/telemetry-engine.ts), and scrub `ANTIGRAVITY_APP_DATA_DIR` alongside `ANTIGRAVITY_DATA_DIR` / `PLUGIN_DATA` in isolated child-process E2E spawns.
  2. Detect bundle inode/mtime/size changes via `watchBundleForRestart()` (`3000ms` `.unref()` `statSync` check + `400ms` deferred `shutdown()`) in [`src/sidecar/server.ts`](../../src/sidecar/server.ts) so `"restart_policy": "always"` respawns updated Sidecar bundles automatically, and run `agy plugin disable antigravity-pulse && agy plugin enable antigravity-pulse` once when replacing an older pre-watcher daemon.
- **Verified By**: [`src/state/state-dir.ts`](../../src/state/state-dir.ts) lines 102–116; [`src/sidecar/telemetry-engine.ts`](../../src/sidecar/telemetry-engine.ts) lines 228–232; [`src/sidecar/server.ts`](../../src/sidecar/server.ts) lines 262–353; [`tests/unit/state-dir.test.ts`](../../tests/unit/state-dir.test.ts) lines 49–96; [`tests/e2e/hud-loop.test.ts`](../../tests/e2e/hud-loop.test.ts) lines 377–380, 669–723.
