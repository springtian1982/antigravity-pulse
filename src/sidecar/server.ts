import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { ConfigValidationError, loadConfig, updateConfigPartial } from '../state/config-store';
import { isValidUuid, resolveStateDir } from '../state/state-dir';
import type {
  FleetSnapshotResponse,
  HudSnapshotResponse,
  QuotaSummaryView,
  TimelineSnapshotResponse,
  UnchangedEtagResponse,
} from '../types/telemetry';

export const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors *";

const STAGE0_ETAG = 'stage0';

function resolveSidecarRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const parentDir = path.resolve(here, '..');
  if (existsSync(path.join(parentDir, 'index.html'))) {
    return parentDir;
  }
  return path.resolve(here, '..', '..', 'sidecars', 'pulse_cockpit');
}

function createEmptyQuotaSummary(nowIso: string): QuotaSummaryView {
  return {
    fetchedAt: nowIso,
    buckets: [],
    gemini5h: null,
    geminiWeekly: null,
    thirdParty5h: null,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: null,
    burnRate5hPctPerMin: null,
  };
}

function make400Json(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    contentType: 'application/json',
  });
}

function makeUnchanged(etag: string): UnchangedEtagResponse {
  return { unchanged: true, etag };
}

export function createPulseSidecarServer(): SidecarApp {
  const startedAt = Date.now();
  const sidecarRoot = resolveSidecarRoot();
  const app = new SidecarApp();

  const readAsset = (relPath: string): string | null => {
    const fullPath = path.join(sidecarRoot, relPath);
    if (!existsSync(fullPath)) {
      return null;
    }
    return readFileSync(fullPath, 'utf8');
  };

  const serveHtmlPage = (): Response => {
    const html =
      readAsset('index.html') ??
      '<!doctype html><html><head><meta charset="utf-8"><title>Model Pulse</title></head><body><div id="pulse-app" class="pulse-app" data-view="hud" data-theme-mode="auto"><main id="app" class="pulse-main" aria-live="polite">Model Pulse loading...</main></div></body></html>';
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

  app.page('/', serveHtmlPage);
  app.page('/hud', serveHtmlPage);
  app.page('/fleet', serveHtmlPage);

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
    () => ({
      ok: true,
      version: '0.1.0',
      lsConnected: false,
      stateDir: resolveStateDir(),
      uptimeMs: Date.now() - startedAt,
    }),
    'GET'
  );

  app.api('/api/config', () => loadConfig(), 'GET');

  app.api(
    '/api/config',
    (data) => {
      try {
        return updateConfigPartial(data);
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
      if (typeof data.etag === 'string' && data.etag.trim() === STAGE0_ETAG) {
        return makeUnchanged(STAGE0_ETAG);
      }
      const nowIso = new Date().toISOString();
      return {
        etag: STAGE0_ETAG,
        generatedAt: nowIso,
        hostConnected: false,
        activeConversationId: rawCid || app.config.conversationId || null,
        rootCascadeId: null,
        breadcrumb: [],
        activeNode: null,
        treeNodes: [],
        smartGovernanceBanner: {
          active: false,
          heavyConcurrentCount: 0,
          gemini5hRemainingPct: null,
          estimatedBurnPctPerMin: null,
          message: null,
        },
        quota: createEmptyQuotaSummary(nowIso),
        config: loadConfig(),
        warnings: ['Stage 0 scaffold active: awaiting Stage 1 telemetry engine.'],
      };
    },
    'GET'
  );

  app.api(
    '/api/timeline',
    (data): TimelineSnapshotResponse | UnchangedEtagResponse | Response => {
      const rawCid = typeof data.conversationId === 'string' ? data.conversationId.trim() : '';
      if (rawCid && !isValidUuid(rawCid)) {
        return make400Json('Invalid conversationId UUID');
      }
      const rawScope = typeof data.scope === 'string' ? data.scope.trim() : 'tree';
      if (rawScope !== 'conversation' && rawScope !== 'tree') {
        return make400Json('Invalid timeline scope: expected conversation | tree');
      }
      if (typeof data.etag === 'string' && data.etag.trim() === STAGE0_ETAG) {
        return makeUnchanged(STAGE0_ETAG);
      }
      return {
        etag: STAGE0_ETAG,
        generatedAt: new Date().toISOString(),
        rootCascadeId: null,
        scope: rawScope,
        turns: [],
      };
    },
    'GET'
  );

  app.api(
    '/api/fleet',
    (data): FleetSnapshotResponse | UnchangedEtagResponse => {
      if (typeof data.etag === 'string' && data.etag.trim() === STAGE0_ETAG) {
        return makeUnchanged(STAGE0_ETAG);
      }
      const nowIso = new Date().toISOString();
      return {
        etag: STAGE0_ETAG,
        generatedAt: nowIso,
        hostConnected: false,
        activeHeadline: {
          runningRoots: 0,
          runningSubagents: 0,
          totalRunningNodes: 0,
          modelHistogram: [],
        },
        projects: [],
        topQuotaBurners: [],
        quota: createEmptyQuotaSummary(nowIso),
      };
    },
    'GET'
  );

  return app;
}

const isEntryPoint =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isEntryPoint) {
  const server = createPulseSidecarServer();
  void server.run();
}
