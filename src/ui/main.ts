import { mountPulseUi, resolvePulseViewMode, type PulseViewMode } from './state';

type ResolvedTheme = 'light' | 'dark';

function parseHexColorLuminance(colorValue: string): number | null {
  const trimmed = colorValue.trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1];
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : hex;
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

function getThemeQueryOverride(): ResolvedTheme | undefined {
  try {
    const raw = new URLSearchParams(window.location.search).get('theme')?.trim().toLowerCase();
    if (raw === 'dark' || raw === 'light') {
      return raw;
    }
  } catch {
    // Ignore malformed query string
  }
  return undefined;
}

function detectResolvedTheme(
  mediaDark: boolean,
  hostBg?: string,
  queryOverride?: ResolvedTheme
): ResolvedTheme {
  if (queryOverride === 'dark' || queryOverride === 'light') {
    return queryOverride;
  }
  if (hostBg) {
    const lum = parseHexColorLuminance(hostBg);
    if (lum !== null) {
      return lum < 0.45 ? 'dark' : 'light';
    }
  }
  return mediaDark ? 'dark' : 'light';
}

function applyResolvedTheme(theme: ResolvedTheme, view: PulseViewMode): void {
  document.documentElement.setAttribute('data-resolved-theme', theme);
  const rootWrapper = document.getElementById('pulse-app');
  if (rootWrapper) {
    rootWrapper.setAttribute('data-resolved-theme', theme);
    rootWrapper.setAttribute('data-view', view);
  }
}

function bootstrap(): void {
  const view = resolvePulseViewMode();
  const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  let lastHostBg: string | undefined;

  const syncTheme = (): void => {
    const queryOverride = getThemeQueryOverride();
    const resolved = detectResolvedTheme(darkMedia.matches, lastHostBg, queryOverride);
    applyResolvedTheme(resolved, view);
  };

  darkMedia.addEventListener('change', syncTheme);

  window.addEventListener('message', (event: MessageEvent) => {
    const payload = event.data as
      | { type?: string; payload?: { cssVariables?: Record<string, string> } }
      | undefined;
    if (payload?.type === 'theme-change') {
      const bg = payload.payload?.cssVariables?.['--background'];
      if (typeof bg === 'string' && bg.trim()) {
        lastHostBg = bg;
      }
      syncTheme();
    }
  });

  syncTheme();
  const mountRoot = document.getElementById('app') ?? document.body;
  mountPulseUi(mountRoot);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
