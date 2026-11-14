import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { isOverthinkingTurn } from '../../src/core/timeline-builder';
import type {
  CascadeNodeView,
  FleetSnapshotResponse,
  HudSnapshotResponse,
  PulseUserConfig,
  QuotaSummaryView,
  TimelineSnapshotResponse,
  TimelineTurnItem,
  UnchangedEtagResponse,
} from '../../src/types/telemetry';
import { createFleetView, type FleetUiLocalState } from '../../src/ui/fleet-view';
import { createHudView, type HudUiLocalState } from '../../src/ui/hud-view';

const CID_ALPHA_ROOT = 'a1111111-1111-4111-8111-111111111111';
const CID_ALPHA_SUB = 'a2222222-2222-4222-8222-222222222222';
const CID_BETA_ROOT = 'b3333333-3333-4333-8333-333333333333';
const CID_ORPHAN_ROOT = 'c4444444-4444-4444-8444-444444444444';
const CID_EXTRA_1 = 'd5555555-5555-4555-8555-555555555555';
const CID_EXTRA_2 = 'e6666666-6666-4666-8666-666666666666';
const CID_EXTRA_3 = 'f7777777-7777-4777-8777-777777777777';

const cleanupDirs: string[] = [];
const cleanupServers: Array<() => Promise<void>> = [];

after(async () => {
  for (const closeFn of cleanupServers.splice(0)) {
    await closeFn().catch(() => {});
  }
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function resolveRepoRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', '..'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'src'))) {
      return dir;
    }
  }
  return process.cwd();
}

function resolveSidecarLoader(): string {
  const explicit = process.env.ANTIGRAVITY_SIDECAR_LOADER?.trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }
  const canonical =
    '/home/springtian/.gemini/antigravity/lib/node_modules/sidecar_sdk/register_loader.js';
  if (existsSync(canonical)) {
    return canonical;
  }
  const agyBin = execFileSync('which', ['agy'], { encoding: 'utf8' }).trim();
  const derived = path.resolve(
    path.dirname(realpathSync(agyBin)),
    '..',
    'lib',
    'node_modules',
    'sidecar_sdk',
    'register_loader.js'
  );
  assert.ok(existsSync(derived), `Missing sidecar_sdk register_loader.js at ${derived}`);
  return derived;
}

function makeRpcRequestBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function startE2eMockLanguageServer() {
  const csrf = 'e2e-mock-csrf-token';
  const baseNowMs = Date.now();
  let quotaFraction = 0.88;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];

  const server = http.createServer((req, res) => {
    if (req.headers['x-codeium-csrf-token'] !== csrf) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const method = (req.url || '').split('/').pop() || '';
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk.toString('utf8');
    });
    req.on('end', () => {
      const body = makeRpcRequestBody(rawBody);
      calls.push({ method, body });

      if (method === 'GetCascadeModelConfigData') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            defaultOverrideModelConfig: { modelOrAlias: { model: 'auto' } },
            clientModelConfigs: [
              { label: 'Auto', modelOrAlias: { model: 'auto' } },
              {
                label: 'Gemini 4 Carbon (High)',
                modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
              },
              { label: 'Argon (Medium)', modelOrAlias: { model: 'MODEL_GOOGLE_GEMINI_3_8_ARGON' } },
              { label: 'Gemini 3.5 Flash', modelOrAlias: { model: 'MODEL_PLACEHOLDER_FLASH' } },
            ],
            clientModelSorts: [],
          })
        );
        return;
      }

      if (method === 'RetrieveUserQuotaSummary') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            quotaInfo: { remainingFraction: quotaFraction },
            modelGroups: [
              {
                groupId: 'gemini',
                displayName: 'Gemini',
                buckets: [
                  {
                    bucketId: 'gemini-5h',
                    displayName: 'Gemini 5h',
                    remainingFraction: quotaFraction,
                    resetTime: new Date(baseNowMs + 2 * 3600 * 1000 + 30_000).toISOString(),
                  },
                  {
                    bucketId: 'gemini-weekly',
                    displayName: 'Gemini Weekly',
                    remainingFraction: 0.91,
                    resetTime: new Date(baseNowMs + 3 * 86400 * 1000 + 30_000).toISOString(),
                  },
                ],
              },
              {
                groupId: 'third-party',
                displayName: 'Third Party',
                buckets: [
                  {
                    bucketId: '3p-5h',
                    displayName: '3P 5h',
                    remainingFraction: 0.95,
                    resetTime: new Date(baseNowMs + 4 * 3600 * 1000 + 30_000).toISOString(),
                  },
                ],
              },
            ],
          })
        );
        return;
      }

      if (method === 'GetAllCascadeTrajectories') {
        const now = baseNowMs;
        const mkTrajectory = (
          summary: string,
          status: string,
          stepCount: number,
          workspaces: string[],
          createdOffsetMs: number,
          parentCid?: string,
          role?: string
        ) => ({
          summary,
          stepCount,
          status,
          lastModifiedTime: new Date(now - createdOffsetMs).toISOString(),
          createdTime: new Date(now - createdOffsetMs - 30_000).toISOString(),
          workspaces: workspaces.map((uri) => ({ workspaceFolderAbsoluteUri: uri })),
          ...(parentCid
            ? {
                requestedModel: { model: 'MODEL_GOOGLE_GEMINI_3_8_ARGON' },
                metadata: {
                  parentCascadeId: parentCid,
                  subagentRole: role || 'Explorer',
                },
              }
            : { requestedModel: { model: 'MODEL_PLACEHOLDER_M427' } }),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            trajectorySummaries: {
              [CID_ALPHA_ROOT]: mkTrajectory(
                'Alpha Repo Telemetry Refactor',
                'CASCADE_RUN_STATUS_RUNNING',
                4,
                ['file:///workspace/alpha-repo'],
                1_000
              ),
              [CID_ALPHA_SUB]: mkTrajectory(
                'Alpha Repo Auth Verifier',
                'CASCADE_RUN_STATUS_RUNNING',
                2,
                ['file:///workspace/alpha-repo'],
                1_200,
                CID_ALPHA_ROOT,
                'Verifier'
              ),
              [CID_BETA_ROOT]: mkTrajectory(
                'Beta Repo SSA Compiler',
                'CASCADE_RUN_STATUS_RUNNING',
                2,
                ['file:///workspace/beta-repo'],
                2_000
              ),
              [CID_ORPHAN_ROOT]: mkTrajectory(
                'Orphan Scratchpad Session',
                'CASCADE_RUN_STATUS_IDLE',
                2,
                [],
                25_000
              ),
              [CID_EXTRA_1]: mkTrajectory(
                'Gamma Billing Sync',
                'CASCADE_RUN_STATUS_IDLE',
                2,
                ['file:///workspace/gamma-service'],
                35_000
              ),
              [CID_EXTRA_2]: mkTrajectory(
                'Delta Indexer',
                'CASCADE_RUN_STATUS_IDLE',
                2,
                ['file:///workspace/delta-indexer'],
                45_000
              ),
              [CID_EXTRA_3]: mkTrajectory(
                'Epsilon Fuzzing',
                'CASCADE_RUN_STATUS_IDLE',
                2,
                ['file:///workspace/epsilon-fuzz'],
                55_000
              ),
            },
          })
        );
        return;
      }

      if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
        const cid = String(body.cascadeId || '');
        const mkGenEntry = (
          steps: number[],
          modelEnum: string,
          display: string,
          ttftSec: string,
          streamSec: string,
          retryCountRaw: number,
          usage: { inTok: string; cacheTok: string; outTok: string; thinkTok: string },
          createdOffsetMs: number
        ) => ({
          stepIndices: steps,
          chatModel: {
            model: modelEnum,
            modelDisplayName: display,
            responseModel: modelEnum.toLowerCase(),
            timeToFirstToken: ttftSec,
            streamingDuration: streamSec,
            retryInfos: Array.from({ length: retryCountRaw }, (_, i) => ({ attempt: i + 1 })),
            chatStartMetadata: {
              createdAt: new Date(baseNowMs - createdOffsetMs).toISOString(),
              contextWindowMetadata: {
                estimatedTokensUsed: '96000',
                maxContextTokens: '256000',
              },
            },
            customMetadata: {
              model_enum: modelEnum,
            },
            usage: {
              inputTokens: usage.inTok,
              cacheReadTokens: usage.cacheTok,
              outputTokens: usage.outTok,
              thinkingOutputTokens: usage.thinkTok,
              apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
            },
          },
        });

        let entries: unknown[] = [];
        if (cid === CID_ALPHA_ROOT) {
          entries = [
            mkGenEntry(
              [1, 2],
              'MODEL_PLACEHOLDER_M427',
              'Gemini 4 Carbon (High)',
              '14.2s',
              '2.4s',
              1,
              { inTok: '2000', cacheTok: '18000', outTok: '1500', thinkTok: '1250' },
              24_000
            ),
            mkGenEntry(
              [3, 4],
              'MODEL_GOOGLE_GEMINI_3_8_ARGON',
              'Argon (Medium)',
              '1.8s',
              '6.4s',
              3, // L-003 -> retryCount === 2
              { inTok: '4000', cacheTok: '16000', outTok: '1200', thinkTok: '300' },
              8_000
            ),
          ];
        } else if (cid === CID_ALPHA_SUB) {
          entries = [
            mkGenEntry(
              [1, 2],
              'MODEL_PLACEHOLDER_FLASH',
              'Gemini 3.5 Flash',
              '0.6s',
              '1.9s',
              1,
              { inTok: '1500', cacheTok: '6500', outTok: '640', thinkTok: '120' },
              4_000
            ),
          ];
        } else {
          entries = [
            mkGenEntry(
              [1, 2],
              'MODEL_PLACEHOLDER_M427',
              'Gemini 4 Carbon (High)',
              '3.1s',
              '4.2s',
              1,
              { inTok: '3000', cacheTok: '9000', outTok: '900', thinkTok: '350' },
              12_000
            ),
          ];
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ generatorMetadata: entries }));
        return;
      }

      if (method === 'GetCascadeTrajectorySteps') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            steps: [
              {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                status: 'CORTEX_STEP_STATUS_RUNNING',
              },
            ],
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Unexpected method: ${method}` }));
    });
  });

  return {
    csrf,
    calls,
    setQuota(nextFraction: number) {
      quotaFraction = nextFraction;
    },
    start(): Promise<string> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          assert.ok(addr && typeof addr !== 'string');
          resolve(`http://127.0.0.1:${addr.port}`);
        });
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function waitForListeningUrl(child: ReturnType<typeof spawn>, label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`${label} startup timed out. stdout=${stdout} stderr=${stderr}`));
    }, 6000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const m = /(?:listening on|Model Pulse UI Preview listening at)\s+(?:http:\/\/)?(127\.0\.0\.1:\d+)/i.exec(
        stdout
      );
      if (m?.[1]) {
        clearTimeout(timer);
        resolve(`http://${m[1]}`);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited prematurely with code ${code}: ${stderr}`));
    });
  });
}

async function stopChildProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 1500);
    child.once('exit', () => {
      clearTimeout(forceTimer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

interface MockDomElement {
  id: string;
  innerHTML: string;
  textContent: string;
  hidden: boolean;
  tabIndex: number;
  scrollTop: number;
  attributes: Map<string, string>;
  style: {
    removeProperty(name: string): void;
    setProperty(name: string, val: string): void;
    position: string;
    left: string;
    top: string;
    right: string;
    bottom: string;
  };
  listeners: Map<string, Array<(ev: unknown) => void>>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  removeEventListener(type: string, fn: (ev: unknown) => void): void;
  querySelector<T = MockDomElement>(selector: string): T | null;
  querySelectorAll<T = MockDomElement>(selector: string): T[];
  closest(selector: string): MockDomElement | null;
  matches(selector: string): boolean;
  getBoundingClientRect(): { width: number; height: number; left: number; top: number; right: number; bottom: number };
}

function makeMockElement(id = ''): MockDomElement {
  const slots = new Map<string, MockDomElement>();
  const ensureSlot = (sel: string): MockDomElement => {
    let existing = slots.get(sel);
    if (!existing) {
      existing = makeMockElement(sel);
      slots.set(sel, existing);
    }
    return existing;
  };
  const el: MockDomElement = {
    id,
    innerHTML: '',
    textContent: '',
    hidden: false,
    tabIndex: 0,
    scrollTop: 0,
    attributes: new Map<string, string>(),
    style: {
      position: '',
      left: '',
      top: '',
      right: '',
      bottom: '',
      removeProperty() {},
      setProperty() {},
    },
    listeners: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    addEventListener(type, fn) {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        list.filter((item) => item !== fn)
      );
    },
    querySelector<T = MockDomElement>(selector: string): T | null {
      return ensureSlot(selector) as unknown as T;
    },
    querySelectorAll<T = MockDomElement>(selector: string): T[] {
      if (selector === '[data-live-timer="true"]') {
        const html = [
          el.innerHTML,
          ...Array.from(slots.values()).map((s) => s.innerHTML),
        ].join('\n');
        const matches: MockDomElement[] = [];
        const re =
          /<span[^>]*data-live-timer="true"[^>]*data-running="true"[^>]*data-server-elapsed-ms="(\d+)"[^>]*>([^<]*)<\/span>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
          const timerEl = makeMockElement('timer');
          timerEl.setAttribute('data-live-timer', 'true');
          timerEl.setAttribute('data-running', 'true');
          timerEl.setAttribute('data-server-elapsed-ms', m[1]);
          timerEl.textContent = m[2];
          matches.push(timerEl);
        }
        return matches as unknown as T[];
      }
      return [];
    },
    closest(selector) {
      if (selector === '[data-action]' && el.attributes.has('data-action')) {
        return el;
      }
      return null;
    },
    matches() {
      return false;
    },
    getBoundingClientRect() {
      return { width: 120, height: 32, left: 0, top: 0, right: 120, bottom: 32 };
    },
  };
  return el;
}

function dispatchSyntheticAction(
  root: MockDomElement,
  attrs: Record<string, string>
): void {
  const target = makeMockElement('synthetic-target');
  for (const [k, v] of Object.entries(attrs)) {
    target.setAttribute(k, v);
  }
  const clickHandlers = root.listeners.get('click') ?? [];
  for (const fn of clickHandlers) {
    fn({ target, preventDefault() {}, stopPropagation() {} });
  }
}

describe('e2e/fleet-timeline — Stage 2 Real Sidecar, Preview Server & DOM Contracts', () => {
  it('runs built sidecar server.mjs end-to-end across /hud, /fleet, /api/timeline, /api/fleet, and POST /api/config', async () => {
    const repoRoot = resolveRepoRoot();
    const serverMjs = path.join(repoRoot, 'sidecars', 'pulse_cockpit', 'dist', 'server.mjs');
    assert.ok(existsSync(serverMjs), `Expected built sidecar bundle at ${serverMjs}`);

    const loaderPath = resolveSidecarLoader();
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-s2b-e2e-'));
    cleanupDirs.push(tmpRoot);

    const stateDir = path.join(tmpRoot, 'pulse-state');
    const agyDir = path.join(tmpRoot, 'antigravity');
    const subagentsDir = path.join(agyDir, 'brain', CID_ALPHA_ROOT, '.system_generated', 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      path.join(subagentsDir, `${CID_ALPHA_SUB}.json`),
      JSON.stringify({
        conversationId: CID_ALPHA_SUB,
        spawnStepIndex: 2,
        workspaceUris: ['file:///workspace/alpha-repo'],
        subagentDescriptor: {
          role: 'Verifier',
          typeName: 'verifier',
        },
      }),
      'utf8'
    );

    const mockLs = startE2eMockLanguageServer();
    const lsUrl = await mockLs.start();
    cleanupServers.push(() => mockLs.close());

    const uiToken = 'e2e-sidecar-token';
    const child = spawn(process.execPath, ['--import', loaderPath, serverMjs], {
      env: {
        ...process.env,
        ANTIGRAVITY_LS_ADDRESS: lsUrl,
        ANTIGRAVITY_CSRF_TOKEN: mockLs.csrf,
        ANTIGRAVITY_SIDECAR_WEB_PORT: '0',
        ANTIGRAVITY_SIDECAR_UI_TOKEN: uiToken,
        ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
        ANTIGRAVITY_DATA_DIR: agyDir,
        ANTIGRAVITY_CONVERSATION_ID: CID_ALPHA_ROOT,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanupServers.push(() => stopChildProcess(child));

    const baseUrl = await waitForListeningUrl(child, 'sidecar server.mjs');

    // Wait for initial Language Server polling loop to populate Fleet & Timeline
    let initialFleet: FleetSnapshotResponse | null = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/api/fleet`);
      if (res.status === 200) {
        const body = (await res.json()) as FleetSnapshotResponse;
        if (body.projects.length >= 2) {
          initialFleet = body;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.ok(initialFleet, 'Expected /api/fleet to populate multi-project data from mock LS');

    // Assert zero GetCascadeTrajectory calls and L-004 stepOffset on Steps calls
    assert.equal(mockLs.calls.some((c) => c.method === 'GetCascadeTrajectory'), false);
    const stepsCall = mockLs.calls.find((c) => c.method === 'GetCascadeTrajectorySteps');
    assert.ok(stepsCall, 'Expected GetCascadeTrajectorySteps for RUNNING cascades');
    assert.equal(typeof stepsCall.body.stepOffset, 'number');
    assert.equal('startIndex' in stepsCall.body, false);

    // /hud and /fleet HTML shells + strict CSP
    const hudRes = await fetch(`${baseUrl}/hud`);
    assert.equal(hudRes.status, 200);
    const hudHtml = await hudRes.text();
    assert.ok(hudHtml.includes('data-view="hud"'));
    const cspHeader = hudRes.headers.get('content-security-policy') || '';
    assert.ok(cspHeader.includes("script-src 'self'"));

    const fleetRes = await fetch(`${baseUrl}/fleet`);
    assert.equal(fleetRes.status, 200);
    const fleetHtml = await fleetRes.text();
    assert.ok(fleetHtml.includes('data-view="fleet"'));
    assert.ok(fleetHtml.includes('/dist/ui.js'));

    // /api/timeline tree scope: reverse-chronological turns across root & subagent
    const tlTreeRes = await fetch(
      `${baseUrl}/api/timeline?conversationId=${CID_ALPHA_ROOT}&scope=tree`
    );
    assert.equal(tlTreeRes.status, 200);
    const tlTree = (await tlTreeRes.json()) as TimelineSnapshotResponse;
    assert.equal(tlTree.scope, 'tree');
    assert.equal(tlTree.turns.length, 3);
    // Verify descending chronological order (newest turn first)
    const firstTs = tlTree.turns[0].timestamp;
    const lastTs = tlTree.turns[tlTree.turns.length - 1].timestamp;
    assert.ok(firstTs && lastTs);
    assert.ok(new Date(firstTs).getTime() >= new Date(lastTs).getTime());
    const argonTurn = tlTree.turns.find((t) => t.cascadeId === CID_ALPHA_ROOT && t.retryCount === 2);
    assert.ok(argonTurn, 'Expected L-003 retryInfos.length === 3 -> retryCount === 2');
    assert.equal(argonTurn.routingChangedFromPrevTurn, true);
    assert.equal(argonTurn.cacheHitPct, 80); // 16000 / (4000 + 16000)
    const carbonTurn = tlTree.turns.find(
      (t) => t.cascadeId === CID_ALPHA_ROOT && t.tier === 'apex'
    );
    assert.ok(carbonTurn && isOverthinkingTurn(carbonTurn), 'Expected Overthinking detection');

    // /api/timeline conversation scope filters strictly to focused subagent
    const tlConvRes = await fetch(
      `${baseUrl}/api/timeline?conversationId=${CID_ALPHA_SUB}&scope=conversation`
    );
    assert.equal(tlConvRes.status, 200);
    const tlConv = (await tlConvRes.json()) as TimelineSnapshotResponse;
    assert.equal(tlConv.scope, 'conversation');
    assert.equal(tlConv.turns.length, 1);
    assert.equal(tlConv.turns[0].cascadeId, CID_ALPHA_SUB);

    // Exact 34-byte ETag cache hit on /api/timeline & /api/fleet
    const tlEtagRes = await fetch(
      `${baseUrl}/api/timeline?conversationId=${CID_ALPHA_ROOT}&scope=tree&etag=${tlTree.etag}`
    );
    const tlEtagRaw = await tlEtagRes.text();
    assert.equal(Buffer.byteLength(tlEtagRaw, 'utf8'), 34);
    assert.deepEqual(JSON.parse(tlEtagRaw) as UnchangedEtagResponse, {
      unchanged: true,
      etag: tlTree.etag,
    });

    const fleetEtagRes = await fetch(`${baseUrl}/api/fleet?etag=${initialFleet.etag}`);
    const fleetEtagRaw = await fleetEtagRes.text();
    assert.equal(Buffer.byteLength(fleetEtagRaw, 'utf8'), 34);
    assert.deepEqual(JSON.parse(fleetEtagRaw) as UnchangedEtagResponse, {
      unchanged: true,
      etag: initialFleet.etag,
    });

    // POST /api/config updates timelineScope & persists across omitted ?scope query
    const cfgRes = await fetch(`${baseUrl}/api/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sidecar-token': uiToken,
      },
      body: JSON.stringify({ timelineScope: 'conversation' }),
    });
    assert.equal(cfgRes.status, 200);
    const updatedCfg = (await cfgRes.json()) as PulseUserConfig;
    assert.equal(updatedCfg.timelineScope, 'conversation');

    const tlDefaultScopeRes = await fetch(`${baseUrl}/api/timeline?conversationId=${CID_ALPHA_SUB}`);
    assert.equal(tlDefaultScopeRes.status, 200);
    const tlDefaultScope = (await tlDefaultScopeRes.json()) as TimelineSnapshotResponse;
    assert.equal(tlDefaultScope.scope, 'conversation');
    assert.equal(tlDefaultScope.turns.length, 1);

    // 400 validation guards on invalid conversationId or scope
    const badCidRes = await fetch(`${baseUrl}/api/timeline?conversationId=not-a-uuid`);
    assert.equal(badCidRes.status, 400);
    const badScopeRes = await fetch(`${baseUrl}/api/timeline?scope=invalid-scope`);
    assert.equal(badScopeRes.status, 400);

    // /api/fleet multi-project, Workspace Unavailable fallback, active counts, and Top 5 cap
    assert.equal(initialFleet.activeHeadline.runningRoots, 2);
    assert.equal(initialFleet.activeHeadline.runningSubagents, 1);
    assert.equal(initialFleet.activeHeadline.totalRunningNodes, 3);
    assert.ok(initialFleet.activeHeadline.modelHistogram.length >= 2);
    assert.ok(
      initialFleet.projects.some((p) => p.projectName === 'Workspace Unavailable'),
      'Expected orphan root cascade to group under Workspace Unavailable'
    );
    // Drop quota to ensure quota-burn deltas are observable when next refresh ticks, and verify max 5 cap
    assert.ok(initialFleet.topQuotaBurners.length <= 5);
  });

  it('validates built sidecar UI & CSS Stage 2 contracts and preview-ui.mjs scenarios', async () => {
    const repoRoot = resolveRepoRoot();
    const cssPath = path.join(repoRoot, 'sidecars', 'pulse_cockpit', 'styles.css');
    const uiJsPath = path.join(repoRoot, 'sidecars', 'pulse_cockpit', 'dist', 'ui.js');
    const previewScript = path.join(repoRoot, 'scripts', 'preview-ui.mjs');

    const css = readFileSync(cssPath, 'utf8');
    const uiJs = readFileSync(uiJsPath, 'utf8');

    // L-014 & DESIGN.md CSS invariants
    assert.equal(css.includes('scrollbar-gutter'), false, 'L-014 forbids scrollbar-gutter');
    assert.equal(
      /::-webkit-progress-value\s*,\s*::-moz-progress-bar/.test(css),
      false,
      'L-014 forbids comma-grouped progress pseudo-elements'
    );
    for (const selector of [
      '.pulse-timeline-seg-ttft',
      '.pulse-timeline-seg-stream',
      '.pulse-btn-label',
      '.pulse-fleet-grid',
      '.pulse-fleet-scroll',
      '.pulse-burner-row',
      '.pulse-fleet-drawer',
      'minmax(0, 1.35fr) minmax(300px, 1fr)',
    ]) {
      assert.ok(css.includes(selector), `Expected styles.css to include ${selector}`);
    }
    for (const tier of ['apex', 'workhorse', 'fast', 'orchestrator', 'alert']) {
      assert.ok(css.includes(`[data-tier="${tier}"]`), `Missing [data-tier="${tier}"] CSS`);
    }
    for (const level of ['normal', 'warn_70', 'critical_85']) {
      assert.ok(css.includes(`[data-level="${level}"]`), `Missing [data-level="${level}"] CSS`);
    }
    for (const phase of ['idle', 'pre_flight', 'thinking', 'streaming', 'scanning', 'waiting', 'error']) {
      assert.ok(css.includes(`[data-phase="${phase}"]`), `Missing [data-phase="${phase}"] CSS`);
    }

    // Built ui.js contains Stage 2 Timeline & Fleet hooks
    for (const marker of [
      'timeline-scope-conversation',
      'timeline-scope-tree',
      'pulse-timeline-seg-ttft',
      'pulse-timeline-seg-stream',
      'Overthinking',
      'fleet-headline',
      'fleet-project-card',
      'fleet-burner-row',
    ]) {
      assert.ok(uiJs.includes(marker), `Expected built dist/ui.js to include ${marker}`);
    }

    // Preview server Stage 2 routes & scenarios (dense, alert, idle + Referer honoring per L-015)
    const child = spawn(process.execPath, [previewScript, '--port', '0', '--scenario', 'dense'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanupServers.push(() => stopChildProcess(child));
    const previewUrl = await waitForListeningUrl(child, 'scripts/preview-ui.mjs');

    const fleetHtmlRes = await fetch(`${previewUrl}/fleet?scenario=dense`);
    assert.equal(fleetHtmlRes.status, 200);
    const fleetHtml = await fleetHtmlRes.text();
    assert.ok(fleetHtml.includes('data-view="fleet"'));

    // Dense /api/timeline tree (14 reverse-chronological turns) vs conversation scope
    const denseTlRes = await fetch(`${previewUrl}/api/timeline?scenario=dense&scope=tree`);
    assert.equal(denseTlRes.status, 200);
    const denseTl = (await denseTlRes.json()) as TimelineSnapshotResponse;
    assert.equal(denseTl.turns.length, 14);
    assert.equal(denseTl.turns[0].turnIndex, 14);
    assert.equal(denseTl.turns[denseTl.turns.length - 1].turnIndex, 1);
    assert.ok(denseTl.turns.some((t) => isOverthinkingTurn(t)), 'Dense fixture needs Overthinking turn');
    assert.ok(denseTl.turns.some((t) => t.retryCount === 2), 'Dense fixture needs Retried x2 turn');
    assert.ok(
      denseTl.turns.some((t) => t.routingChangedFromPrevTurn),
      'Dense fixture needs routingChangedFromPrevTurn'
    );

    const subCid = denseTl.turns[0].cascadeId;
    const denseConvRes = await fetch(
      `${previewUrl}/api/timeline?scenario=dense&scope=conversation&conversationId=${subCid}`
    );
    const denseConv = (await denseConvRes.json()) as TimelineSnapshotResponse;
    assert.equal(denseConv.scope, 'conversation');
    assert.ok(denseConv.turns.length > 0 && denseConv.turns.length < denseTl.turns.length);
    assert.ok(denseConv.turns.every((t) => t.cascadeId === subCid));

    // Preview 34B ETag & 400 validation
    const tlHitRaw = await (
      await fetch(`${previewUrl}/api/timeline?scenario=dense&scope=tree&etag=${denseTl.etag}`)
    ).text();
    assert.equal(Buffer.byteLength(tlHitRaw, 'utf8'), 34);
    assert.equal((await fetch(`${previewUrl}/api/timeline?scope=invalid`)).status, 400);
    assert.equal((await fetch(`${previewUrl}/api/timeline?conversationId=invalid`)).status, 400);

    // Dense /api/fleet
    const denseFleetRes = await fetch(`${previewUrl}/api/fleet?scenario=dense`);
    const denseFleet = (await denseFleetRes.json()) as FleetSnapshotResponse;
    assert.equal(denseFleet.projects.length, 4);
    assert.equal(denseFleet.activeHeadline.totalRunningNodes, 8);
    assert.equal(denseFleet.topQuotaBurners.length, 5);
    const fleetHitRaw = await (
      await fetch(`${previewUrl}/api/fleet?scenario=dense&etag=${denseFleet.etag}`)
    ).text();
    assert.equal(Buffer.byteLength(fleetHitRaw, 'utf8'), 34);

    // Alert scenario
    const alertFleet = (await (
      await fetch(`${previewUrl}/api/fleet?scenario=alert`)
    ).json()) as FleetSnapshotResponse;
    assert.equal(alertFleet.quota.gemini5h?.isLowAlert, true);

    // Idle scenario honored via Referer (L-015)
    const idleFleetRes = await fetch(`${previewUrl}/api/fleet`, {
      headers: { Referer: `${previewUrl}/fleet?scenario=idle` },
    });
    const idleFleet = (await idleFleetRes.json()) as FleetSnapshotResponse;
    assert.equal(idleFleet.activeHeadline.totalRunningNodes, 0);
    assert.equal(idleFleet.activeHeadline.modelHistogram.length, 0);
    assert.equal(idleFleet.topQuotaBurners.length, 0);
  });

  it('renders HUD Timeline & Fleet views safely (XSS escaping, non-reversed flame turns, drawer state & actions)', () => {
    const g = globalThis as unknown as {
      window?: Record<string, unknown>;
      document?: Record<string, unknown>;
    };
    const prevWindow = g.window;
    const prevDocument = g.document;
    g.window = {
      clearTimeout,
      setTimeout,
      requestAnimationFrame: () => 0,
      innerWidth: 360,
      innerHeight: 820,
    };
    g.document = {
      documentElement: { clientWidth: 360, clientHeight: 820 },
    };

    try {
      const rootHud = makeMockElement('hud-root');
      const scopeChanges: string[] = [];
      const hudJumps: string[] = [];
      const hudView = createHudView(rootHud as unknown as HTMLElement, {
        onTabChange() {},
        onSetSortMode() {},
        onToggleIdleGroup() {},
        onJumpConversation(cid) {
          hudJumps.push(cid);
        },
        onInspectNode() {},
        onCycleStampMode() {},
        onSetStampMode() {},
        onSetTimelineScope(scope) {
          scopeChanges.push(scope);
        },
      });

      const baseQuota: QuotaSummaryView = {
        fetchedAt: '2026-11-14T10:00:00.000Z',
        buckets: [],
        gemini5h: {
          bucketId: 'gemini-5h',
          displayName: 'Gemini 5h',
          window: '5h',
          remainingFraction: 0.72,
          remainingPct: 72,
          resetTime: '2026-11-14T12:00:00.000Z',
          resetInSeconds: 7200,
          resetInLabel: '2h 0m',
          isLowAlert: false,
        },
        geminiWeekly: null,
        thirdParty5h: null,
        thirdPartyWeekly: null,
        treeNetDelta5hPct: 1.4,
        burnRate5hPctPerMin: 0.12,
      };

      const nodeA: CascadeNodeView = {
        cascadeId: CID_ALPHA_ROOT,
        rootCascadeId: CID_ALPHA_ROOT,
        parentCascadeId: null,
        kind: 'root',
        title: '<script>alert("xss-title")</script>',
        role: null,
        typeName: null,
        depth: 0,
        status: 'CASCADE_RUN_STATUS_RUNNING',
        phase: 'THINKING',
        phaseStartedAt: '2026-11-14T10:00:00.000Z',
        phaseElapsedMs: 4200,
        requestedModel: {
          raw: 'MODEL_PLACEHOLDER_M427',
          displayName: 'Carbon',
          modelId: 'gemini-4-carbon-high',
          source: 'user',
        },
        servedModel: {
          responseModel: 'gemini-4-carbon',
          displayName: '<img src=x onerror=alert(1)>Carbon',
          modelEnum: 'MODEL_PLACEHOLDER_M427',
          family: 'gemini',
          effortTier: 'high',
          tier: 'apex',
        },
        routingStatus: 'matched',
        retryCount: 0,
        lastTool: null,
        stepCount: 4,
        turnCount: 2,
        streamingTokPerSec: null,
        contextWindow: { estimatedTokensUsed: 50000, maxContextTokens: 200000, pct: 25, level: 'normal' },
        cacheHitPct: 80,
        tokens: {
          inputTokens: 2000,
          cacheReadTokens: 8000,
          outputTokens: 1500,
          thinkingOutputTokens: 1200,
          responseOutputTokens: 300,
        },
        deltaQuota5hPct: 0.4,
        lastTtftMs: 1200,
        lastStreamingMs: 3000,
        lastModifiedTime: '2026-11-14T10:00:00.000Z',
        spawnStepIndex: null,
        childrenIds: [],
      };

      const hudSnap: HudSnapshotResponse = {
        etag: 'hud001',
        generatedAt: '2026-11-14T10:00:00.000Z',
        hostConnected: true,
        activeConversationId: CID_ALPHA_ROOT,
        rootCascadeId: CID_ALPHA_ROOT,
        breadcrumb: [{ cascadeId: CID_ALPHA_ROOT, title: nodeA.title, role: null }],
        activeNode: nodeA,
        treeNodes: [nodeA],
        smartGovernanceBanner: {
          active: false,
          heavyConcurrentCount: 0,
          gemini5hRemainingPct: 72,
          estimatedBurnPctPerMin: null,
          message: null,
        },
        quota: baseQuota,
        config: {
          version: 1,
          inlineStampMode: 'smart',
          hudSortMode: 'active-first',
          timelineScope: 'tree',
          smartThresholds: {
            contextWarnPct: 70,
            contextCriticalPct: 85,
            stampContextTriggerPct: 75,
            quotaLowTriggerPct: 20,
            heavyConcurrentAlertCount: 3,
            heavyQuotaThresholdPct: 40,
          },
          pollIntervalsMs: { active: 1000, idle: 3000, quota: 30000, modelConfig: 30000 },
          updatedAt: '2026-11-14T10:00:00.000Z',
        },
        warnings: [],
      };

      const turnNewest: TimelineTurnItem = {
        turnIndex: 2,
        cascadeId: CID_ALPHA_SUB,
        cascadeTitle: 'Subagent <script>bad()</script>',
        role: 'Explorer',
        stepIndices: [3, 4],
        timestamp: '2026-11-14T10:02:00.000Z',
        requestedLabel: 'Auto',
        servedModelDisplayName: 'Argon (Medium)',
        responseModel: 'gemini-3.8-argon',
        tier: 'workhorse',
        routingChangedFromPrevTurn: true,
        ttftMs: 5000,
        streamingMs: 10000,
        totalMs: 15000,
        inputTokens: 2000,
        cacheReadTokens: 8000,
        cacheHitPct: 80,
        outputTokens: 1600,
        thinkingOutputTokens: 400,
        responseOutputTokens: 1200,
        thinkingRatioPct: 25,
        retryCount: 2,
        contextUsedTokens: 80000,
        contextMaxTokens: 200000,
        contextPct: 40,
        deltaQuota5hPct: 0.25,
        apiProvider: 'google',
      };

      const turnOldest: TimelineTurnItem = {
        ...turnNewest,
        turnIndex: 1,
        cascadeId: CID_ALPHA_ROOT,
        cascadeTitle: nodeA.title,
        role: null,
        stepIndices: [1, 2],
        timestamp: '2026-11-14T10:01:00.000Z',
        requestedLabel: 'Carbon (High)',
        servedModelDisplayName: 'Gemini 4 Carbon (High)',
        tier: 'apex',
        routingChangedFromPrevTurn: false,
        ttftMs: 30000,
        streamingMs: 2500,
        totalMs: 32500,
        outputTokens: 1600,
        thinkingOutputTokens: 1400,
        responseOutputTokens: 200,
        thinkingRatioPct: 87.5,
        retryCount: 0,
      };

      const hudUiState: HudUiLocalState = {
        activeTab: 'timeline',
        expandedIdleGroup: false,
        openPopoverNodeId: null,
        isUpdatingConfig: false,
        statusMessage: null,
        timelineScope: 'tree',
        timelineSnapshot: {
          etag: 'tl0001',
          generatedAt: '2026-11-14T10:02:00.000Z',
          rootCascadeId: CID_ALPHA_ROOT,
          scope: 'tree',
          turns: [turnNewest, turnOldest],
        },
        timelineLoading: false,
        timelineError: null,
      };

      hudView.render(hudSnap, hudUiState, Date.now());
      const timelineHtml = rootHud.querySelector('#pulse-panel-timeline')?.innerHTML || '';
      assert.ok(timelineHtml.includes('Turn #2') && timelineHtml.includes('Turn #1'));
      assert.ok(
        timelineHtml.indexOf('Turn #2') < timelineHtml.indexOf('Turn #1'),
        'Timeline must preserve backend reverse-chronological order without double-reversal'
      );
      assert.ok(timelineHtml.includes('pulse-timeline-seg-ttft'));
      assert.ok(timelineHtml.includes('pulse-timeline-seg-stream'));
      assert.ok(timelineHtml.includes('Overthinking'));
      assert.ok(timelineHtml.includes('⚠ Retried ×2'));
      assert.ok(timelineHtml.includes('Auto ➔ Argon (Medium)'));
      assert.equal(timelineHtml.includes('<script>'), false);
      assert.equal(timelineHtml.includes('<img '), false);

      dispatchSyntheticAction(rootHud, {
        'data-action': 'set-timeline-scope',
        'data-scope': 'conversation',
      });
      assert.deepEqual(scopeChanges, ['conversation']);
      dispatchSyntheticAction(rootHud, {
        'data-action': 'jump-node',
        'data-cid': CID_ALPHA_SUB,
      });
      assert.deepEqual(hudJumps, [CID_ALPHA_SUB]);
      hudView.destroy();

      // Fleet view DOM & XSS & drawer expansion + scrollTop preservation + jump action
      const rootFleet = makeMockElement('fleet-root');
      const toggledTrees: string[] = [];
      const jumpedCids: string[] = [];
      const expandedTreeIds = new Set<string>([CID_ALPHA_ROOT]);

      const fleetView = createFleetView(rootFleet as unknown as HTMLElement, {
        onToggleTree(rootCid) {
          toggledTrees.push(rootCid);
        },
        onJumpConversation(cid) {
          jumpedCids.push(cid);
        },
      });

      const fleetSnap: FleetSnapshotResponse = {
        etag: 'fl0001',
        generatedAt: '2026-11-14T10:02:00.000Z',
        hostConnected: true,
        activeHeadline: {
          runningRoots: 1,
          runningSubagents: 0,
          totalRunningNodes: 1,
          modelHistogram: [{ label: 'Carbon(H)', tier: 'apex', count: 1 }],
        },
        projects: [
          {
            projectKey: 'alpha',
            projectName: '<script>xss-proj</script>',
            workspaceUris: ['file:///workspace/alpha-repo'],
            runningCount: 1,
            trees: [
              {
                rootCascadeId: CID_ALPHA_ROOT,
                rootTitle: nodeA.title,
                rootPhase: 'THINKING',
                activeNodeCount: 1,
                totalNodeCount: 1,
                elapsedMs: 4200,
                modelMix: { Carbon: 1 },
                nodes: [nodeA],
                treeDeltaQuota5hPct: 1.4,
              },
            ],
          },
        ],
        topQuotaBurners: [
          {
            rank: 1,
            rootCascadeId: CID_ALPHA_ROOT,
            title: nodeA.title,
            projectName: '<script>xss-proj</script>',
            dominantModel: nodeA.servedModel.displayName,
            dominantTier: 'apex',
            consumed5hPct: 1.4,
            delta5hPct: 1.4,
            totalTokens: 11500,
            lastActiveAt: '2026-11-14T10:02:00.000Z',
            isRunning: true,
          },
        ],
        quota: baseQuota,
      };

      const fleetUiState: FleetUiLocalState = {
        expandedTreeIds,
        activeWorkspaceUris: ['file:///workspace/alpha-repo'],
        statusMessage: null,
        isLoading: false,
      };

      const scrollSlot = rootFleet.querySelector('.pulse-fleet-scroll')!;
      scrollSlot.scrollTop = 180;
      const receivedAt = Date.now();
      fleetView.render(fleetSnap, fleetUiState, receivedAt);

      const gridHtml = rootFleet.querySelector('.pulse-fleet-grid')?.innerHTML || '';
      assert.equal(scrollSlot.scrollTop, 180, 'Re-render preserves scrollTop');
      assert.ok(gridHtml.includes('data-testid="fleet-active-workspace-badge"'));
      assert.ok(gridHtml.includes('data-testid="fleet-tree-drawer"'));
      assert.ok(gridHtml.includes('data-testid="fleet-burner-row"'));
      assert.equal(gridHtml.includes('<script>'), false);
      assert.equal(gridHtml.includes('<img '), false);
      assert.ok(gridHtml.includes('&lt;script&gt;'));

      // Live stopwatch tick updates running node elapsed timer cleanly
      fleetView.tickTimers(receivedAt + 4200, receivedAt);

      dispatchSyntheticAction(rootFleet, {
        'data-action': 'toggle-tree',
        'data-root-cid': CID_ALPHA_ROOT,
      });
      dispatchSyntheticAction(rootFleet, {
        'data-action': 'jump-node',
        'data-cid': CID_ALPHA_ROOT,
      });
      assert.deepEqual(toggledTrees, [CID_ALPHA_ROOT]);
      assert.deepEqual(jumpedCids, [CID_ALPHA_ROOT]);
      fleetView.destroy();
    } finally {
      g.window = prevWindow;
      g.document = prevDocument;
    }
  });
});
