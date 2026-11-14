import { existsSync, readFileSync, realpathSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { ConfigValidationError, validateConfigPatch } from '../state/config-store';
import { isValidUuid } from '../state/state-dir';
import type {
  FleetSnapshotResponse,
  HudSnapshotResponse,
  PulseUserConfig,
  TimelineSnapshotResponse,
  UnchangedEtagResponse,
} from '../types/telemetry';
import {
  type LsClientLike,
  TelemetryEngine,
  type TelemetryEngineOptions,
} from './telemetry-engine';

export const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors *";

export interface PulseSidecarServerOptions extends TelemetryEngineOptions {
  lsClient?: LsClientLike;
  autoStartEngine?: boolean;
}

export interface PulseSidecarServerHandle {
  app: SidecarApp;
  engine: TelemetryEngine;
  start(): Promise<Server>;
  stop(): Promise<void>;
}

function resolveSidecarRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const parentDir = path.resolve(here, '..');
  if (existsSync(path.join(parentDir, 'index.html'))) {
    return parentDir;
  }
  return path.resolve(here, '..', '..', 'sidecars', 'pulse_cockpit');
}

function make400Json(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    contentType: 'application/json',
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

function injectHtmlViewAttribute(html: string, view: 'hud' | 'fleet'): string {
  if (/data-view="(?:hud|fleet)"/.test(html)) {
    return html.replace(/data-view="(?:hud|fleet)"/, `data-view="${view}"`);
  }
  return html.replace(/<div\s+id="pulse-app"/, `<div id="pulse-app" data-view="${view}"`);
}

function validateAllowedConfigPostKeys(payload: Record<string, unknown>): void {
  const keys = Object.getOwnPropertyNames(payload);
  if (keys.length === 0) {
    throw new ConfigValidationError('Empty config patch');
  }
  const allowedPostKeys = new Set([
    'inlineStampMode',
    'hudSortMode',
    'timelineScope',
    'smartThresholds',
    'pollIntervalsMs',
  ]);
  for (const key of keys) {
    if (!allowedPostKeys.has(key)) {
      throw new ConfigValidationError(`Disallowed or unknown config patch field: ${key}`);
    }
  }
}

export async function createPulseSidecarServer(
  options: PulseSidecarServerOptions = {}
): Promise<PulseSidecarServerHandle> {
  const startedAt = Date.now();
  const sidecarRoot = resolveSidecarRoot();
  const app = new SidecarApp();
  const engine = new TelemetryEngine(options);

  const readAsset = (relPath: string): string | null => {
    const fullPath = path.join(sidecarRoot, relPath);
    if (!existsSync(fullPath)) {
      return null;
    }
    return readFileSync(fullPath, 'utf8');
  };

  const serveHtmlPage = (view: 'hud' | 'fleet'): Response => {
    const rawHtml =
      readAsset('index.html') ??
      '<!doctype html><html><head><meta charset="utf-8"><title>Model Pulse</title></head><body><div id="pulse-app" class="pulse-app" data-view="hud" data-theme-mode="auto"><main id="app" class="pulse-main" aria-live="polite">Model Pulse loading...</main></div></body></html>';
    const html = injectHtmlViewAttribute(rawHtml, view);
    return new Response(html, {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        'Content-Security-Policy': STRICT_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  };

  app.page('/', () => serveHtmlPage('hud'));
  app.page('/hud', () => serveHtmlPage('hud'));
  app.page('/fleet', () => serveHtmlPage('fleet'));

  app.page('/styles.css', () => {
    const css = readAsset('styles.css');
    if (css === null) {
      return new Response('/* styles.css not found */', {
        status: 404,
        contentType: 'text/css; charset=utf-8',
        headers: { 'X-Content-Type-Options': 'nosniff' },
      });
    }
    return new Response(css, {
      status: 200,
      contentType: 'text/css; charset=utf-8',
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });

  app.page('/dist/ui.js', () => {
    const js = readAsset(path.join('dist', 'ui.js'));
    if (js === null) {
      return new Response('// ui.js not found', {
        status: 404,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'X-Content-Type-Options': 'nosniff' },
      });
    }
    return new Response(js, {
      status: 200,
      contentType: 'application/javascript; charset=utf-8',
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });

  app.api(
    '/api/health',
    () => {
      const health = engine.getHealthInfo();
      return {
        ok: true,
        version: '0.1.0',
        lsConnected: health.lsConnected,
        stateDir: health.stateDir,
        activeConversationId: health.activeConversationId,
        uptimeMs: Date.now() - startedAt,
      };
    },
    'GET'
  );

  app.api('/api/config', () => engine.getConfig(), 'GET');

  app.api(
    '/api/config',
    (data): PulseUserConfig | Response => {
      try {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return make400Json('Config patch must be a JSON object');
        }
        validateAllowedConfigPostKeys(data);
        validateConfigPatch(data);
        return engine.updateConfig(data);
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          return make400Json(err.message);
        }
        return make400Json(err instanceof Error ? err.message : 'Invalid config payload');
      }
    },
    'POST'
  );

  app.api(
    '/api/hud',
    (data): HudSnapshotResponse | UnchangedEtagResponse | Response => {
      const rawCid = typeof data.conversationId === 'string' ? data.conversationId.trim() : '';
      if (rawCid && !isValidUuid(rawCid)) {
        return make400Json('Invalid conversationId UUID');
      }
      const hostCid = app.config.conversationId?.trim() ?? '';
      const requestedCid = rawCid || (isValidUuid(hostCid) ? hostCid : null);
      const clientEtag = typeof data.etag === 'string' ? data.etag.trim() : undefined;
      return engine.getHudSnapshot(requestedCid, clientEtag);
    },
    'GET'
  );

  app.api(
    '/api/timeline',
    (data): TimelineSnapshotResponse | UnchangedEtagResponse | Response => {
      if (data.conversationId !== undefined && typeof data.conversationId !== 'string') {
        return make400Json('Invalid conversationId UUID');
      }
      const rawCid = typeof data.conversationId === 'string' ? data.conversationId.trim() : '';
      if (rawCid && !isValidUuid(rawCid)) {
        return make400Json('Invalid conversationId UUID');
      }
      let requestedScope: 'conversation' | 'tree' | undefined;
      if (data.scope !== undefined) {
        const rawScope = typeof data.scope === 'string' ? data.scope.trim() : '';
        if (rawScope !== 'conversation' && rawScope !== 'tree') {
          return make400Json('Invalid timeline scope: expected conversation | tree');
        }
        requestedScope = rawScope;
      }
      const hostCid = app.config.conversationId?.trim() ?? '';
      const requestedCid = rawCid || (isValidUuid(hostCid) ? hostCid : null);
      const clientEtag = typeof data.etag === 'string' ? data.etag.trim() : undefined;
      return engine.getTimelineSnapshot(requestedCid, requestedScope, clientEtag);
    },
    'GET'
  );

  app.api(
    '/api/fleet',
    (data): FleetSnapshotResponse | UnchangedEtagResponse => {
      const clientEtag = typeof data.etag === 'string' ? data.etag.trim() : undefined;
      return engine.getFleetSnapshot(clientEtag);
    },
    'GET'
  );

  if (options.autoStartEngine !== false) {
    await engine.start();
  }

  return {
    app,
    engine,
    async start() {
      await engine.start();
      return app.run();
    },
    async stop() {
      engine.stop();
      await app.close();
    },
  };
}

function isServerEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  try {
    const resolved = realpathSync(argv1);
    return (
      import.meta.url === pathToFileURL(resolved).href &&
      /(?:^|[\\/])server\.(?:m?js|cjs|ts)$/i.test(resolved)
    );
  } catch {
    return false;
  }
}

if (isServerEntryPoint()) {
  createPulseSidecarServer({ autoStartEngine: false })
    .then(async (handle) => {
      const shutdown = () => {
        void handle.stop().finally(() => {
          process.exit(0);
        });
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      await handle.start();
    })
    .catch((err) => {
      console.error('[pulse_cockpit] Fatal startup error:', err);
      process.exit(1);
    });
}
