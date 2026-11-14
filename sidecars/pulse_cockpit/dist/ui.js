/* SPDX-License-Identifier: MIT | Copyright (c) 2026 springtian <springtian@gmail.com> */
"use strict";
(() => {
  // src/ui/main.ts
  function parseHexColorLuminance(colorValue) {
    const trimmed = colorValue.trim();
    const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
    if (hexMatch) {
      const hex = hexMatch[1];
      const full = hex.length === 3 ? hex.split("").map((ch) => ch + ch).join("") : hex;
      const r = Number.parseInt(full.slice(0, 2), 16) / 255;
      const g = Number.parseInt(full.slice(2, 4), 16) / 255;
      const b = Number.parseInt(full.slice(4, 6), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
    if (rgbMatch) {
      const r = Number(rgbMatch[1]) / 255;
      const g = Number(rgbMatch[2]) / 255;
      const b = Number(rgbMatch[3]) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    return null;
  }
  function detectResolvedTheme(mediaDark, hostBg) {
    if (hostBg) {
      const lum = parseHexColorLuminance(hostBg);
      if (lum !== null) {
        return lum < 0.45 ? "dark" : "light";
      }
    }
    return mediaDark ? "dark" : "light";
  }
  function applyResolvedTheme(theme) {
    document.documentElement.setAttribute("data-resolved-theme", theme);
    const rootWrapper = document.getElementById("pulse-app");
    if (rootWrapper) {
      rootWrapper.setAttribute("data-resolved-theme", theme);
    }
  }
  function resolveCurrentView() {
    return window.location.pathname.startsWith("/fleet") ? "fleet" : "hud";
  }
  function renderStage0Shell(view, theme) {
    const rootWrapper = document.getElementById("pulse-app");
    if (rootWrapper) {
      rootWrapper.setAttribute("data-view", view);
    }
    const appMount = document.getElementById("app");
    if (!appMount) return;
    appMount.replaceChildren();
    const card = document.createElement("section");
    card.className = "pulse-hero pulse-boot";
    card.setAttribute("role", "status");
    const headerRow = document.createElement("div");
    headerRow.className = "pulse-health-row";
    const dot = document.createElement("span");
    dot.className = "pulse-phase-dot";
    dot.setAttribute("data-phase", "scanning");
    dot.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.className = "pulse-title";
    title.textContent = view === "fleet" ? "Pulse Fleet" : "Model Pulse";
    const badge = document.createElement("span");
    badge.className = "pulse-pill pulse-tier-workhorse tabular-nums";
    badge.textContent = view === "fleet" ? "FLEET \xB7 STAGE 0" : "HUD \xB7 STAGE 0";
    headerRow.append(dot, title, badge);
    const subtitle = document.createElement("p");
    subtitle.className = "pulse-boot-message";
    const cid = window.sidecar?.conversationId ?? "standalone";
    subtitle.textContent = `View: ${view} \xB7 Theme: ${theme} \xB7 Conversation: ${cid}`;
    card.append(headerRow, subtitle);
    appMount.append(card);
  }
  function bootstrap() {
    const view = resolveCurrentView();
    const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
    let lastHostBg;
    const syncTheme = () => {
      const resolved = detectResolvedTheme(darkMedia.matches, lastHostBg);
      applyResolvedTheme(resolved);
      renderStage0Shell(view, resolved);
    };
    darkMedia.addEventListener("change", syncTheme);
    window.addEventListener("message", (event) => {
      const payload = event.data;
      if (payload?.type === "theme-change") {
        const bg = payload.payload?.cssVariables?.["--background"];
        if (typeof bg === "string" && bg.trim()) {
          lastHostBg = bg;
        }
        syncTheme();
      }
    });
    syncTheme();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
