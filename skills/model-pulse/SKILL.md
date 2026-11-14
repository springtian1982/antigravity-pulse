---
name: model-pulse
description: >
  On-demand guidance for inspecting active model telemetry, subagent/swarm compute
  budgets, and quota health via Model Pulse (antigravity-pulse) MCP tools, sidecar
  views, and the agy-pulse CLI.
---

# Model Pulse (`antigravity-pulse`)

Model Pulse delivers **100% local (`127.0.0.1`), read-only** active model observability, multi-agent swarm topology tracking, and 5h/weekly quota awareness for Google Antigravity 2.0 without modifying `app.asar` or session databases.

## When to Invoke This Skill

- Before spawning parallel subagents or swarm workers, to avoid exhausting 5h quota or pushing high-cost reasoning models on lightweight exploration.
- When the user asks which model actually served a turn (`Requested -> Served`), what phase an agent or subagent is stuck in, or why quota dropped.
- To render an inline Flexoki telemetry snapshot card (`<agent-embed>`) in chat or configure inline turn stamp / HUD preferences.

## 1. Adaptive Compute Governance (`pulse_get_compute_budget`)

Before creating subagents or delegating bulk exploration, call `pulse_get_compute_budget` with optional parameters:

- `conversationId` (UUID): target cascade (auto-resolved if omitted).
- `plannedSubagentCount` (integer >= 0): expected parallel child runs.
- `taskKind`: `"exploration" | "coding" | "review" | "general"`.

Returned `ComputeBudgetAdvice` payload fields:

- `generatedAt`, `conversationId`
- `activeModel`: `{ displayName, responseModel, tier } | null`
- `contextWindowPct`: `number | null`
- `quota`: `{ gemini5hRemainingPct, geminiWeeklyRemainingPct, thirdParty5hRemainingPct, resetInLabel }`
- `recommendedSubagentModel`: `"inherit" | "argon" | "flash"`
- `reason`: concise rule explanation
- `warnings`: array of quota, context (`> 70%` elevated / `> 85%` critical), staleness, or disconnect notices

Decision rules evaluated in order for `recommendedSubagentModel`:

| Condition | `recommendedSubagentModel` | Guidance |
| :--- | :--- | :--- |
| 5h quota remaining `< 25%` | `flash` | Conserve quota; route non-critical exploration/summarization to Flash. |
| Running apex nodes `>= 3` and 5h `< 40%` | `flash` | Smart Governance triggered (explained in `reason`); downgrade fan-out. |
| `taskKind === "exploration"` and 5h `< 45%` | `flash` | Use fast low-cost Flash workers for retrieval/discovery. |
| `(plannedSubagentCount >= 4 and 5h < 55%)` or `(runningApexNodes + plannedSubagentCount >= 5 and 5h < 50%)` | `flash` | Prevent multi-worker 5h cliff on heavy subagent fan-out. |
| 5h quota remaining `< 45%` (`25%..45%`) | `argon` | Prefer balanced mid-tier reasoning or smaller fan-out. |
| Healthy quota (`>= 45%`) or live telemetry unavailable (`null`) | `inherit` | Safe to inherit the primary model; inspect `warnings` for disconnected, stale, or unavailable notices. |

Also inspect `contextWindowPct` and `warnings`: above `85%`, compact conversation context before spawning child runs.

## 2. Inline Telemetry Card (`pulse_status_card`)

Call `pulse_status_card` (`{ conversationId?, theme?: "auto" | "light" | "dark", includeTree?: boolean }`) to write a self-contained Flexoki HTML card under `$PULSE_STATE_DIR/cards/` and receive:

- `embedTag`: embed verbatim in Markdown as `<agent-embed src="file:///..."></agent-embed>`.
- `sidecarPill`: `[Model Pulse](sidecar://antigravity-pulse/pulse_cockpit/hud)` — surface alongside the card so the user can open live HUD details in one click.
- `summary`, `hostConnected`, `stale`, `nodeCount`.

Never pass untrusted or malformed paths into `conversationId` (must be a canonical UUID).

## 3. Preferences (`pulse_set_preference`)

Update user preferences atomically in `$PULSE_STATE_DIR/config.json`:

- `inlineStampMode`: `"smart"` (default — zero clutter on routine turns) | `"every-turn"` | `"off"`
- `hudSortMode`: `"active-first"` | `"topology-tree"`
- `timelineScope`: `"conversation"` | `"tree"`
- `smartThresholds`: `{ contextWarnPct, contextCriticalPct, stampContextTriggerPct, quotaLowTriggerPct, heavyConcurrentAlertCount, heavyQuotaThresholdPct }`

## 4. Sidecar Views & CLI (`agy-pulse`)

- **Pulse HUD (`AUX_PANE`)**: Open [Model Pulse](sidecar://antigravity-pulse/pulse_cockpit/hud) for live phase attribution (`Thinking`, `Streaming`, `Waiting Tool`, `Retrying`, `Idle`), `Requested -> Served` trust pills, context saturation, and cascade tree matrix.
- **Pulse Fleet (`SIDEBAR`)**: Open the **Pulse Fleet** sidebar (`/fleet`) for cross-project active cascades and Top 5 Quota Burners.
- **CLI**:
  - `agy-pulse status --format waybar|tmux|json|text [--watch]` — single-line bar integration or streaming JSON updates.
  - `agy-pulse top [--interval <ms>] [--once] [--no-color]` — live terminal multi-agent and quota monitor.
  - `agy-pulse config [get [key] | set <key> <value> | reset | path]` — inspect or update `$PULSE_STATE_DIR/config.json`.
  - `agy-pulse doctor [--json]` — verify runtime, state dir, host LS, plugin install, and PATH launcher.

