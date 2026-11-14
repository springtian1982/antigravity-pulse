# Design System: Model Pulse (`antigravity-pulse`)

> **Canonical Specification**: Visual & UX Design System for **Model Pulse** (`antigravity-pulse`), an embedded real-time active model telemetry HUD (`AUX_PANE` `/hud`) and multi-project agent fleet radar (`SIDEBAR` `/fleet`) for **Google Antigravity 2.0**.

---

## 1. Visual Theme & Atmosphere

Model Pulse adopts a **Warm-Paper / Carbon-Ink Telemetry Instrument** aesthetic grounded in the **Flexoki** editorial color system and Antigravity host theme variables:

- **Atmosphere & Physical Metaphor**: Crisp `1px` structural hairlines, disciplined tabular-numeric readouts, high information density without visual noise, and immediate peripheral-vision tier recognition inspired by Linear, Raycast, and precision aviation/hardware telemetry gauges.
- **Zero-Noise Observability**: No generic SaaS drop-shadows, no decorative hero bloat, no ungrounded floating clutter. Every pixel in the `360px` `AUX_PANE` and `400px–760px` `SIDEBAR` serves routing verification (`Requested ➔ Served`), live phase attribution (`Thinking` / `Streaming` / `Tool` / `Blocked` / `Idle`), concurrency visibility, or quota preservation.
- **Dual Light/Dark Polarity**:
  - **Light Mode (Warm Archival Paper)**: `#fffcf0` canvas with `#f2f0e5` layered card surfaces and `#100f0f` carbon ink for sustained daylight readability with minimal glare.
  - **Dark Mode (Deep Obsidian Instrument)**: `#100f0f` deep canvas with `#1c1b1a` elevated surfaces and `#cecdc3` parchment ink that blends seamlessly into dark IDE workbenches.
- **Host Native Integration**: Automatically adopts Antigravity `sidecar_sdk` `theme-change` CSS variables (`--background`, `--foreground`, `--border`, `--primary`, `--muted`, `--muted-foreground`, `--secondary`, `--destructive`, `--card`) while retaining Flexoki fallbacks for standalone browser previews.

---

## 2. Color Palette & Roles

### Primary Foundation (Flexoki Light & Dark Neutrals)

| Role | Token | Light Mode Hex | Dark Mode Hex | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Canvas Background** | `--pulse-bg` | `#fffcf0` | `#100f0f` | Viewport canvas, root background (`--background` host override) |
| **Primary Card Surface** | `--pulse-surface` | `#f2f0e5` | `#1c1b1a` | Hero card, agent matrix cards, quota panels (`--card` / `--secondary` host override) |
| **Elevated / Sub-Surface** | `--pulse-surface-alt` | `#e6e4d9` | `#282726` | Progress tracks, hover fills, secondary badges, table headers (`--muted` host override) |
| **Structural Hairline** | `--pulse-border` | `#cecdc3` | `#403e3c` | `1px` card borders, dividers, tab bar bottom edge (`--border` host override) |
| **Primary Ink** | `--pulse-fg` | `#100f0f` | `#cecdc3` | Headlines, model names, active node titles, numeric telemetry (`--foreground` host override) |
| **Muted Metadata Ink** | `--pulse-muted` | `#6f6e69` | `#878580` | Step counts, cache labels, timestamps, inactive tabs (`--muted-foreground` host override) |

### Semantic 5-Tier Model & Alert Palette (Flexoki Accent Tokens)

| Tier / State | Token | Light Mode Hex | Dark Mode Hex | Model & Status Mapping |
| :--- | :--- | :--- | :--- | :--- |
| **Apex / Heavy (Purple)** | `--pulse-tier-apex` | `#5e409d` | `#8b7ec8` | `Hydrogen (XHigh/High)`, `Carbon (High)`, `Opus 5.5 (High)`, `TTFT` flame bar segment |
| **Workhorse / Pro (Blue)** | `--pulse-tier-workhorse` | `#205ea6` | `#4385be` | `Carbon (Med/Low)`, `Argon (High/Med)`, `Sonnet 5.5`, primary interactive accent (`--primary`) |
| **Fast / Subagent (Cyan)** | `--pulse-tier-fast` | `#24837b` | `#3aa99f` | `Gemini Flash`, `Argon (Low)`, `flash_lite`, `Streaming` flame bar segment, healthy status |
| **Orchestrator / Auto (Yellow)** | `--pulse-tier-orchestrator` | `#ad8301` | `#d0a215` | `Orchestrator (Carbon/Argon)`, `Auto` dynamic routing, `CTX > 70%` warning, Overthinking cue |
| **Alert / Retry / Critical (Red)** | `--pulse-tier-alert` | `#af3029` | `#d14d41` | `429 Retry`, `Served != Expected`, `CTX > 85%`, `5h Quota < 15%`, error states (`--destructive`) |

### Accessibility & Contrast Guardrails

- **WCAG 1.4.1 (Non-Color State Cues)**: Model tiers and execution states never rely on color alone. Every badge pairs color with explicit text labels or glyph markers (`🟣`, `🟢`, `🔵`, `⏸️`, `⚠`, `✓`), and selected `[role="tab"]` buttons render a `2px` bottom underline via `::after` `border-block-end` so selection remains unmistakable in grayscale and Windows Forced Colors Mode (`@media (forced-colors: active)`).
- **WCAG 1.4.3 & 1.4.11 Contrast**: Text maintains `>= 4.5:1` contrast against card/pill backgrounds (for Light Mode Orchestrator Amber `#ad8301`, pills pair dark `#100f0f` ink or tinted surface with `1px` `#ad8301` borders instead of low-contrast yellow text on cream), and structural borders/progress bars maintain `>= 3:1` non-text contrast.

---

## 3. Typography Rules

- **Strict CSP Zero-CDN Font Stack**:
  - **UI Sans**: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` (zero external font requests; fully compliant with `default-src 'self'`).
  - **Telemetry Monospace**: `ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace` for model IDs (`gemini-4-carbon`), step indices, and raw endpoint hints.
- **Type Scale & Rhythm**:
  - **Hero Title / Active Session Heading**: `13px` / `18px` line-height, weight `600`, `-0.01em` tracking.
  - **Section / Tab Labels**: `11.5px` / `16px` line-height, weight `600`.
  - **Card Primary Title / Node Role**: `12px` / `16px` line-height, weight `600`.
  - **Telemetry Body / Action Summary**: `11.5px` / `16px` line-height, weight `400`.
  - **Micro Readouts, Pills & Fuel Bar**: `10.5px`–`11px` / `14px` line-height, weight `500–600`.
- **Mandatory Tabular Numerals (`.tabular-nums`)**:
  - `font-variant-numeric: tabular-nums` is mandatory on all timers (`18.4s`), token throughput (`46 tok/s`), token counts (`38.8k / 256k`), percentages (`91.8%`), `ΔQuota` deltas (`-0.41%`), and reset countdowns (`2h 21m`) to eliminate horizontal jitter during `100ms` stopwatch ticks.

---

## 4. Component Stylings

- **Corner Radius & Borders**:
  - Cards & Banners: `6px` (`--pulse-radius-md`) with `1px solid var(--pulse-border)`.
  - Compact Buttons & Inputs: `5px` (`--pulse-radius-sm`), minimum `26px` height (`>= 26px` accessible target in dense panes; `min-width: 26px` for `[↗]` jump icons).
  - Status & Tier Pills (`.pulse-pill`): `9999px` pill radius, `2px 7px` padding, `10.5px` uppercase/compact text.
- **Top Navigation Tab Bar (`.pulse-tabs`, `.pulse-tab`, `.pulse-tabpanel`)**:
  - Single non-wrapping row (`display: flex; overflow-x: auto;`) inside `36px` sticky header; zero multi-line tab wrapping.
  - Selected `[aria-selected="true"]` tab renders an underline using `::after { border-block-end: 2px solid var(--pulse-accent); }` (preserving visibility in Forced Colors mode without shifting layout box height).
  - Inactive `[role="tabpanel"]` elements enforce `[hidden] { display: none; }`.
- **Sticky Active Session Hero Card (`.pulse-hero`, ~88px target height)**:
  - Displays optional child breadcrumb (`Root › Role` + `[← 父会话]`), live breathing phase indicator + stopwatch, `Requested ➔ Served` dual verification nameplate, and 2 compact horizontal `<progress>` health bars (`.pulse-health-row` + `.pulse-progress`).
- **Native Health & Fuel Meters (`.pulse-progress`)**:
  - Semantic `<progress value="..." max="100" aria-label="...">` with `appearance: none; border: 0 solid; overflow: clip;` and **separate** `::-webkit-progress-value` and `::-moz-progress-bar` rule blocks (never grouped).
  - Threshold color modifiers: default `var(--pulse-tier-fast)`, `>70%` context warning `var(--pulse-tier-orchestrator)`, `>85%` context critical or `<15%` quota `var(--pulse-tier-alert)`.
- **Live Agent Tree & Swarm Matrix (`.pulse-matrix`, `.pulse-node-card`)**:
  - 3-row high-density card per active/idle cascade node:
    - Row 1: Breathing pulse dot + Node role/title (`min-width: 0; text-overflow: ellipsis`) + tier pill (`.pulse-pill`) + `[↗]` jump button (`window.sidecar.ui.toggleConversation`).
    - Row 2: Live tool summary or thinking step + stopwatch.
    - Row 3: `Steps · In (Cache %) / Out (Think) · ΔQuota%`.
  - Topology indentation caps at `depth * 10px` (max `30px`) with subtle left connector border so `360px` panes never overflow horizontally.
- **Smart Governance Banner (`.pulse-banner`)**:
  - Single compact `1px`-bordered callout bar using Flexoki Yellow tint when `>= 3` concurrent `apex` subagents run while `5h` quota is `< 40%`.
- **Dual-Segment Flame Bar (`.pulse-timeline-bar`)**:
  - `8px–10px` horizontal track scaled relative to `maxTurnMs`; left segment in Flexoki Purple (`--pulse-tier-apex`, TTFT) and right segment in Flexoki Cyan (`--pulse-tier-fast`, Streaming), with numeric labels positioned cleanly beside/below the bar to prevent clipping at `340px`.
- **Sticky Bottom Quota Fuel Bar (`.pulse-fuel-bar`, ~36px height)**:
  - Docked bottom bar displaying `Gemini 5h`, `Weekly`, `Claude/3P 5h`, active tree `ΔQuota%`, and clickable Inline Stamp mode pill (`smart` / `every-turn` / `off`).
- **Detail Popovers (`.pulse-popover`)**:
  - Native `[popover]` tooltip/toggletip displaying `modelEnum ➔ responseModel` and config source; uses `@supports (position-area: block-end)` for implicit anchor placement with a safe `@supports not (position-area: block-end)` viewport-bounded fallback so overlays never strand at `(0, 0)`.

---

## 5. Layout Principles

- **Spatial Baseline**: `4px` micro-unit / `8px` layout rhythm.
- **Viewport 1 — `Pulse HUD` Narrow Aux Pane (`340px–480px`, default `360px`)**:
  - Full-height flex shell (`100dvh`, `overflow: hidden` outer frame with dedicated scrollable middle `.pulse-main` pane) so sticky tabs, hero card, and bottom `36px` fuel bar remain anchored while the agent matrix scrolls cleanly without obscuring cards.
  - `8px` outer inline padding, `6px` vertical gaps, `min-width: 0` on all flex/grid items so long file paths or model strings truncate gracefully (`scrollWidth <= clientWidth` invariant).
- **Viewport 2 — `Pulse Fleet` Global Sidebar & Wide Radar (`>= 640px` fluid)**:
  - Expands `.pulse-fleet-grid` into multi-column responsive CSS Grid (`grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))`) displaying project-grouped active cascade trees alongside the Top 5 Quota Burners leaderboard and 4-bucket quota bars.

---

## 6. Stitch Generation Notes

- **Atmosphere Keywords**: Warm-paper Flexoki Light (`#fffcf0`, `#f2f0e5`, `#cecdc3`, `#100f0f`) & obsidian Flexoki Dark (`#100f0f`, `#1c1b1a`, `#403e3c`, `#cecdc3`), crisp `1px` borders, Linear/Raycast precision telemetry density, tabular numerals, 5-tier semantic pills (Purple `#5e409d`/`#8b7ec8`, Blue `#205ea6`/`#4385be`, Cyan `#24837b`/`#3aa99f`, Amber `#ad8301`/`#d0a215`, Red `#af3029`/`#d14d41`).
- **Target Screen Archetypes**:
  1. **`Pulse HUD` (`AUX_PANE`, 360px companion pane)**: `36px` single-row tab bar (`Overview 实时态`, `Timeline 调用轴`, `Quota 配额精算`) → `88px` sticky Hero Card with child breadcrumb, live phase stopwatch, `Auto ➔ Gemini 4 Argon` verification pill, and `CTX` / `Cache Hit` bars → scrollable 3-row Live Agent Tree & Swarm Matrix + Smart Governance Banner → pinned `36px` bottom Quota Fuel Bar.
  2. **`Pulse Fleet` (`SIDEBAR`, fluid multi-project radar)**: `56px` sticky Active Compute Headline (`2 Roots + 5 Subagents`) with tier mix pills → Project-grouped Active Cascade Tree Cards with expandable subagent quick-jump rows → Ranked Top 5 Quota Burners leaderboard → pinned `36px` bottom Quota Fuel Bar.
