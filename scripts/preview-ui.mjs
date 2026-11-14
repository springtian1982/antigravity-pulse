#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SIDECAR_DIR = path.join(REPO_ROOT, 'sidecars', 'pulse_cockpit');

const STRICT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors *";

function parsePortValue(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    return null;
  }
  return n;
}

function resolvePort(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && i + 1 < argv.length) {
      const parsed = parsePortValue(argv[i + 1]);
      if (parsed !== null) return parsed;
    }
    if (argv[i].startsWith('--port=')) {
      const parsed = parsePortValue(argv[i].slice('--port='.length));
      if (parsed !== null) return parsed;
    }
  }
  const envParsed = parsePortValue(process.env.PORT);
  return envParsed !== null ? envParsed : 4173;
}

const PRELOAD_SHIM = `
(function () {
  window.sidecar = {
    conversationId: '198d5aa0-44bb-4273-9a52-b83805a34a3a',
    fetch: function (url, options) { return fetch(url, options); },
    getWorkspaceUris: async function () { return ['file:///workspace/antigravity-pulse']; },
    onWorkspaceChange: function () { return function () {}; },
    agent: {
      sendMessage: async function () { return {}; },
      startConversation: async function () { return {}; },
      getConversationMetadata: async function () { return {}; }
    },
    ui: {
      toggleAuxPane: function () {},
      toggleConversation: function (cid) { console.log('[preview] toggleConversation:', cid); },
      addArtifactComment: function () {}
    }
  };
})();
`;

function createEmptyQuota(nowIso) {
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

const port = resolvePort(process.argv.slice(2));
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const nowIso = new Date().toISOString();

  if (url.pathname === '/' || url.pathname === '/hud' || url.pathname === '/fleet') {
    const htmlPath = path.join(SIDECAR_DIR, 'index.html');
    const html = existsSync(htmlPath)
      ? readFileSync(htmlPath, 'utf8')
      : '<!doctype html><html><body><div id="pulse-app" class="pulse-app"><main id="app" class="pulse-main">Missing index.html</main></div></body></html>';
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': STRICT_CSP,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(html);
    return;
  }

  if (url.pathname === '/styles.css') {
    const cssPath = path.join(SIDECAR_DIR, 'styles.css');
    const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '';
    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(css);
    return;
  }

  if (url.pathname === '/dist/ui.js') {
    const jsPath = path.join(SIDECAR_DIR, 'dist', 'ui.js');
    const js = existsSync(jsPath) ? readFileSync(jsPath, 'utf8') : '';
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(js);
    return;
  }

  if (url.pathname === '/preload.js') {
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(PRELOAD_SHIM);
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: '0.1.0', preview: true }));
    return;
  }

  if (url.pathname === '/api/hud') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        etag: 'stage0',
        generatedAt: nowIso,
        hostConnected: false,
        activeConversationId: '198d5aa0-44bb-4273-9a52-b83805a34a3a',
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
        quota: createEmptyQuota(nowIso),
        warnings: ['Preview mode (Stage 0 stub)'],
      })
    );
    return;
  }

  if (url.pathname === '/api/timeline') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        etag: 'stage0',
        generatedAt: nowIso,
        rootCascadeId: null,
        scope: 'tree',
        turns: [],
      })
    );
    return;
  }

  if (url.pathname === '/api/fleet') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        etag: 'stage0',
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
        quota: createEmptyQuota(nowIso),
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr !== null ? addr.port : port;
  console.log(`[preview-ui] Listening on http://127.0.0.1:${actualPort}/hud (and /fleet)`);
});
