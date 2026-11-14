---
name: model-pulse
description: >
  On-demand guidance for inspecting active model telemetry, subagent/swarm compute
  budgets, and quota health via Model Pulse (antigravity-pulse) MCP tools, sidecar
  views, and the agy-pulse CLI.
---

# Model Pulse (`antigravity-pulse`)

Model Pulse provides zero-tampering, read-only active model observability and 5h/weekly quota awareness for Google Antigravity 2.0.

## MCP Tools

- **`pulse_status_card`**: Render an inline Flexoki telemetry snapshot card (`<agent-embed>`) for the current conversation, active subagents, and quota buckets, linking to `sidecar://antigravity-pulse/pulse_cockpit/hud`.
- **`pulse_get_compute_budget`**: Query current active model, context window saturation (`%`), and 5h/weekly quota remaining fractions before spawning parallel subagents. Recommends `flash`, `argon`, or `inherit` based on live remaining quota (recommending `flash` for non-critical exploration when 5h quota drops below 25%).
- **`pulse_set_preference`**: Update Model Pulse settings in `$PULSE_STATE_DIR/config.json` (e.g., `inlineStampMode`: `"smart"` | `"every-turn"` | `"off"`, `hudSortMode`: `"active-first"` | `"topology-tree"`, `timelineScope`: `"conversation"` | `"tree"`).

## Sidecar Views

- **Pulse HUD (`AUX_PANE`)**: Open with `sidecar://antigravity-pulse/pulse_cockpit/hud` to view `Requested -> Served` routing trust, live thinking/streaming/tool phases, and the subagent/swarm matrix.
- **Pulse Fleet (`SIDEBAR`)**: Open the **Pulse Fleet** sidebar view (`/fleet`) for cross-project active cascades and Top 5 Quota Burners.

## CLI (`agy-pulse`)

- `agy-pulse status --format waybar|tmux|json [--watch]`: Emit single-line status bar output from `$PULSE_STATE_DIR/live-snapshot.json`.
- `agy-pulse top`: Launch the live terminal monitor (`htop`-style multi-agent dashboard).
- `agy-pulse config`: Inspect or update Model Pulse preferences from the terminal.
