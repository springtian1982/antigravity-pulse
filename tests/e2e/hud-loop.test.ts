import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ReadOnlyLsClient } from '../../src/rpc/ls-client';
import { TelemetryEngine } from '../../src/sidecar/telemetry-engine';
import type {
  GetAllCascadeTrajectoriesResponse,
  GetCascadeModelConfigDataResponse,
  GetCascadeTrajectoryGeneratorMetadataResponse,
  GetCascadeTrajectoryStepsResponse,
  RetrieveUserQuotaSummaryResponse,
} from '../../src/types/rpc';
import type { HudSnapshotResponse, UnchangedEtagResponse } from '../../src/types/telemetry';

function resolveRepoRoot(): string {
  const candidates = [path.resolve(__dirname, '..'), path.resolve(__dirname, '..', '..')];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'sidecars'))) {
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
  const canonical = '/home/springtian/.gemini/antigravity/lib/node_modules/sidecar_sdk/register_loader.js';
  if (existsSync(canonical)) {
    return canonical;
  }
  try {
    const agyBin = execFileSync('which', ['agy'], { encoding: 'utf8' }).trim();
    if (agyBin) {
      const realAgy = realpathSync(agyBin);
      const derived = path.resolve(
        path.dirname(realAgy),
        '..',
        'lib',
        'node_modules',
        'sidecar_sdk',
        'register_loader.js'
      );
      if (existsSync(derived)) {
        return derived;
      }
    }
  } catch {
    // Ignore PATH lookup failures
  }
  throw new Error('Unable to locate sidecar_sdk/register_loader.js for real SidecarApp E2E test');
}

const REPO_ROOT = resolveRepoRoot();
const ROOT_CID = '11111111-1111-4111-8111-111111111111';
const SUB_CID = '22222222-2222-4222-8222-222222222222';
const SWARM_CID = '33333333-3333-4333-8333-333333333333';
const CSRF_TOKEN = 'test-csrf-token-stage1';
const UI_TOKEN = 'test-ui-token-stage1';

interface MockLsState {
  trajectories: GetAllCascadeTrajectoriesResponse;
  modelConfig: GetCascadeModelConfigDataResponse;
  quota: RetrieveUserQuotaSummaryResponse;
  genMetaByCid: Record<string, GetCascadeTrajectoryGeneratorMetadataResponse>;
  stepsByCid: Record<string, GetCascadeTrajectoryStepsResponse>;
  calls: Array<{ method: string; body: Record<string, unknown> }>;
}

async function startMockLsServer(state: MockLsState): Promise<{
  address: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (req.headers['x-codeium-csrf-token'] !== CSRF_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid csrf' }));
      return;
    }
    const method = (req.url || '').split('/').pop() || '';
    let rawBody = '';
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      const parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
      state.calls.push({ method, body: parsedBody });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      switch (method) {
        case 'GetCascadeModelConfigData':
          res.end(JSON.stringify(state.modelConfig));
          return;
        case 'RetrieveUserQuotaSummary':
          res.end(JSON.stringify(state.quota));
          return;
        case 'GetAllCascadeTrajectories':
          res.end(JSON.stringify(state.trajectories));
          return;
        case 'GetCascadeTrajectoryGeneratorMetadata': {
          const cid = String(parsedBody.cascadeId ?? '');
          res.end(JSON.stringify(state.genMetaByCid[cid] ?? { generatorMetadata: [] }));
          return;
        }
        case 'GetCascadeTrajectorySteps': {
          const cid = String(parsedBody.cascadeId ?? '');
          res.end(JSON.stringify(state.stepsByCid[cid] ?? { steps: [] }));
          return;
        }
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `unexpected method ${method}` }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return {
    address: `127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function createFixtureAntigravityDir(baseDir: string): string {
  const agyDir = path.join(baseDir, 'antigravity-data');
  const subagentsDir = path.join(agyDir, 'brain', ROOT_CID, '.system_generated', 'subagents');
  const swarmDir = path.join(agyDir, 'brain', ROOT_CID, '.system_generated', 'swarm');
  const annDir = path.join(agyDir, 'annotations');
  mkdirSync(subagentsDir, { recursive: true });
  mkdirSync(swarmDir, { recursive: true });
  mkdirSync(annDir, { recursive: true });

  writeFileSync(
    path.join(subagentsDir, `${SUB_CID}.json`),
    JSON.stringify({
      conversationId: SUB_CID,
      subagentDescriptor: {
        typeName: 'explorer',
        role: 'Explorer',
      },
      state: 'running',
      spawnStepIndex: 4,
      workspaceUris: ['file:///workspace/antigravity-pulse'],
    }),
    'utf8'
  );

  // L-005: swarm/members.json object map
  writeFileSync(
    path.join(swarmDir, 'members.json'),
    JSON.stringify({
      title: 'Pulse Swarm',
      members: {
        'worker-beta': {
          conversation_id: SWARM_CID,
          role: 'Verifier',
          desired_state: 'running',
          desired_model: 'MODEL_PLACEHOLDER_M418',
          applied_model: 'MODEL_PLACEHOLDER_M418',
          phase: 'thinking',
          wake_mode: 'auto',
          killed: false,
        },
      },
    }),
    'utf8'
  );

  // RTM-06: summary is null in LS -> fallback title from annotations/<cid>.pbtxt
  writeFileSync(
    path.join(annDir, `${SUB_CID}.pbtxt`),
    'title: "Annotated Fallback Title \\"Explorer\\""\nlast_user_view_time {\n  seconds: 1731570000\n}\n',
    'utf8'
  );

  return agyDir;
}

function createInitialMockLsState(): MockLsState {
  const nowIso = new Date().toISOString();
  const futureReset = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  return {
    calls: [],
    modelConfig: {
      defaultOverrideModelConfig: {
        modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
        label: 'Gemini 4 Carbon (High)',
        modelId: 'gemini-4-carbon-high',
      },
      clientModelConfigs: [
        {
          modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
          modelId: 'gemini-4-carbon-high',
          label: 'Gemini 4 Carbon (High)',
        },
        {
          modelOrAlias: { model: 'MODEL_PLACEHOLDER_M418' },
          modelId: 'gemini-4-argon-medium',
          label: 'Gemini 4 Argon (Medium)',
        },
      ],
    },
    quota: {
      response: {
        groups: [
          {
            groupId: 'gemini',
            buckets: [
              {
                bucketId: 'gemini-5h',
                displayName: 'Gemini 5h',
                window: '5h',
                remainingFraction: 0.84972906,
                resetTime: futureReset,
              },
              {
                bucketId: 'gemini-weekly',
                displayName: 'Gemini Weekly',
                window: 'weekly',
                remainingFraction: 0.965,
                resetTime: futureReset,
              },
            ],
          },
        ],
      },
    },
    trajectories: {
      trajectorySummaries: {
        [ROOT_CID]: {
          trajectoryId: ROOT_CID,
          status: 'CASCADE_RUN_STATUS_RUNNING',
          stepCount: 10,
          summary: 'Root Pipeline Session',
          lastModifiedTime: nowIso,
          workspaces: [{ workspaceFolderAbsoluteUri: 'file:///workspace/antigravity-pulse' }],
        },
        [SUB_CID]: {
          trajectoryId: SUB_CID,
          status: 'CASCADE_RUN_STATUS_RUNNING',
          stepCount: 6,
          summary: null, // Forces RTM-06 .pbtxt fallback
          lastModifiedTime: nowIso,
        },
        [SWARM_CID]: {
          trajectoryId: SWARM_CID,
          status: 'CASCADE_RUN_STATUS_IDLE',
          stepCount: 3,
          summary: null,
          lastModifiedTime: nowIso,
        },
      },
    },
    genMetaByCid: {
      [ROOT_CID]: {
        generatorMetadata: [
          {
            stepIndices: [1, 2],
            chatModel: {
              model: 'MODEL_PLACEHOLDER_M427',
              responseModel: 'gemini-4-carbon',
              modelDisplayName: 'Gemini 4 Carbon (High)',
              timeToFirstToken: '3.2s',
              streamingDuration: '1.8s',
              retryInfos: [{}], // L-003: 1 entry => 0 retries
              customMetadata: { model_enum: 'MODEL_PLACEHOLDER_M427' },
              chatStartMetadata: {
                contextWindowMetadata: { estimatedTokensUsed: '38800', maxContextTokens: '256000' },
              },
              usage: {
                inputTokens: '1000',
                cacheReadTokens: '9000',
                outputTokens: '500',
                thinkingOutputTokens: '300',
                responseOutputTokens: '200',
              },
            },
          },
        ],
      },
      [SUB_CID]: {
        generatorMetadata: [
          {
            stepIndices: [1],
            chatModel: {
              model: 'MODEL_PLACEHOLDER_M418',
              responseModel: 'gemini-4-argon',
              modelDisplayName: 'Gemini 4 Argon (Medium)',
              timeToFirstToken: '1.4s',
              streamingDuration: '0.9s',
              retryInfos: [{}],
              customMetadata: {
                parent_cascade_id: ROOT_CID,
                root_cascade_id: ROOT_CID,
                model_enum: 'auto',
              },
              chatStartMetadata: {
                contextWindowMetadata: { estimatedTokensUsed: '12000', maxContextTokens: '256000' },
              },
              usage: {
                inputTokens: '500',
                cacheReadTokens: '4500',
                outputTokens: '320',
                thinkingOutputTokens: '120',
                responseOutputTokens: '200',
              },
            },
          },
        ],
      },
      [SWARM_CID]: {
        generatorMetadata: [
          {
            stepIndices: [1],
            chatModel: {
              model: 'MODEL_PLACEHOLDER_M418',
              responseModel: 'gemini-4-argon',
              modelDisplayName: 'Gemini 4 Argon (Medium)',
              retryInfos: [{}],
              usage: { inputTokens: '400', cacheReadTokens: '1600', outputTokens: '150' },
            },
          },
        ],
      },
    },
    stepsByCid: {
      [ROOT_CID]: {
        steps: [
          {
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
            status: 'CORTEX_STEP_STATUS_GENERATING',
            metadata: { createdAt: new Date(Date.now() - 2500).toISOString() },
          },
        ],
      },
      [SUB_CID]: {
        steps: [
          {
            type: 'CORTEX_STEP_TYPE_TOOL_CALL',
            status: 'CORTEX_STEP_STATUS_RUNNING',
            metadata: {
              createdAt: new Date(Date.now() - 1200).toISOString(),
              toolCall: {
                id: 'tc-1',
                name: 'grep_search',
                argumentsJson: JSON.stringify({ query: 'TelemetryEngine' }),
              },
            },
          },
        ],
      },
    },
  };
}

async function startRealSidecarProcess(env: Record<string, string>): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const loaderPath = resolveSidecarLoader();
  const serverEntry = path.join(REPO_ROOT, 'sidecars', 'pulse_cockpit', 'dist', 'server.mjs');
  assert.ok(existsSync(serverEntry), `Expected built sidecar server at ${serverEntry}`);

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.ANTIGRAVITY_APP_DATA_DIR;
  delete childEnv.ANTIGRAVITY_DATA_DIR;
  delete childEnv.PLUGIN_DATA;
  delete childEnv.CLAUDE_PLUGIN_DATA;
  Object.assign(childEnv, env);

  const child: ChildProcess = spawn(process.execPath, ['--import', loaderPath, serverEntry], {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const baseUrl = await new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for SidecarApp startup. stdout=${stdout} stderr=${stderr}`));
    }, 8000);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
      const match = /listening on (127\.0\.0\.1:\d+)/.exec(stdout);
      if (match) {
        clearTimeout(timeout);
        resolve(`http://${match[1]}`);
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`SidecarApp exited prematurely (${code}). stdout=${stdout} stderr=${stderr}`));
    });
  });

  return {
    baseUrl,
    stop: async () => {
      if (child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2000);
        child.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });
        child.kill('SIGTERM');
      });
    },
  };
}

describe('Stage 1 HUD loop & SidecarApp E2E', () => {
  const cleanupDirs: string[] = [];

  after(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves real SidecarApp pages/assets with strict CSP, L-007 MIME/400/401 guards, and 34-byte ETag cache hits', async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-e2e-http-'));
    cleanupDirs.push(tmpRoot);
    const stateDir = path.join(tmpRoot, 'state');
    const agyDir = createFixtureAntigravityDir(tmpRoot);
    const lsState = createInitialMockLsState();
    const mockLs = await startMockLsServer(lsState);
    const sidecar = await startRealSidecarProcess({
      ANTIGRAVITY_LS_ADDRESS: `http://${mockLs.address}`,
      ANTIGRAVITY_CSRF_TOKEN: CSRF_TOKEN,
      ANTIGRAVITY_SIDECAR_WEB_PORT: '0',
      ANTIGRAVITY_SIDECAR_UI_TOKEN: UI_TOKEN,
      ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
      ANTIGRAVITY_DATA_DIR: agyDir,
      ANTIGRAVITY_CONVERSATION_ID: SUB_CID,
    });

    try {
      // Pages & CSP + data-view attributes
      for (const [route, expectedView] of [
        ['/', 'hud'],
        ['/hud', 'hud'],
        ['/fleet', 'fleet'],
      ] as const) {
        const res = await fetch(`${sidecar.baseUrl}${route}`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') ?? '', /^text\/html;\s*charset=utf-8/i);
        assert.equal(
          res.headers.get('content-security-policy'),
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors *"
        );
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        const html = await res.text();
        assert.ok(html.includes(`data-view="${expectedView}"`));
      }

      // L-007 explicit CSS & JS MIME types + preload
      const cssRes = await fetch(`${sidecar.baseUrl}/styles.css`);
      assert.equal(cssRes.status, 200);
      assert.match(cssRes.headers.get('content-type') ?? '', /^text\/css;\s*charset=utf-8/i);

      const jsRes = await fetch(`${sidecar.baseUrl}/dist/ui.js`);
      assert.equal(jsRes.status, 200);
      assert.match(jsRes.headers.get('content-type') ?? '', /^application\/javascript;\s*charset=utf-8/i);

      const preloadRes = await fetch(`${sidecar.baseUrl}/preload.js`);
      assert.equal(preloadRes.status, 200);

      // Health check
      const health = (await (await fetch(`${sidecar.baseUrl}/api/health`)).json()) as {
        ok: boolean;
        lsConnected: boolean;
        stateDir: string;
      };
      assert.equal(health.ok, true);
      assert.equal(health.lsConnected, true);
      assert.equal(health.stateDir, stateDir);

      // UUID validation -> 400 Response (L-007)
      const badHud = await fetch(`${sidecar.baseUrl}/api/hud?conversationId=../etc/passwd`);
      assert.equal(badHud.status, 400);
      assert.match(badHud.headers.get('content-type') ?? '', /^application\/json/i);

      const badTimeline = await fetch(`${sidecar.baseUrl}/api/timeline?conversationId=not-a-uuid`);
      assert.equal(badTimeline.status, 400);

      // x-sidecar-token auth check + 400 validation on POST /api/config
      const unauthConfig = await fetch(`${sidecar.baseUrl}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inlineStampMode: 'every-turn' }),
      });
      assert.equal(unauthConfig.status, 401);

      const badPatch = await fetch(`${sidecar.baseUrl}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sidecar-token': UI_TOKEN,
        },
        body: JSON.stringify({ inlineStampMode: 'invalid-mode' }),
      });
      assert.equal(badPatch.status, 400);
      const badPatchJson = (await badPatch.json()) as { error: string };
      assert.ok(badPatchJson.error.length > 0);

      const emptyPatch = await fetch(`${sidecar.baseUrl}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sidecar-token': UI_TOKEN,
        },
        body: JSON.stringify({}),
      });
      assert.equal(emptyPatch.status, 400);

      // Valid config update persists & reflects on /api/hud
      const goodPatch = await fetch(`${sidecar.baseUrl}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sidecar-token': UI_TOKEN,
        },
        body: JSON.stringify({ inlineStampMode: 'every-turn', hudSortMode: 'topology-tree' }),
      });
      assert.equal(goodPatch.status, 200);

      // Full /api/hud snapshot (subagent focused => breadcrumb + Requested->Served + .pbtxt fallback + L-005 swarm)
      const hudRes = await fetch(`${sidecar.baseUrl}/api/hud?conversationId=${SUB_CID}`);
      assert.equal(hudRes.status, 200);
      const hud = (await hudRes.json()) as HudSnapshotResponse;
      assert.equal(hud.hostConnected, true);
      assert.equal(hud.activeConversationId, SUB_CID);
      assert.equal(hud.rootCascadeId, ROOT_CID);
      assert.equal(hud.breadcrumb.length, 2);
      assert.equal(hud.activeNode?.title, 'Annotated Fallback Title "Explorer"');
      assert.equal(hud.activeNode?.routingStatus, 'routed');
      assert.equal(hud.activeNode?.servedModel.responseModel, 'gemini-4-argon');
      assert.equal(hud.config.inlineStampMode, 'every-turn');
      assert.equal(hud.config.hudSortMode, 'topology-tree');
      assert.ok(hud.treeNodes.some((n) => n.cascadeId === SWARM_CID && n.kind === 'swarm_member'));

      // Steady-state 34-byte ETag cache hit
      const etagHitRes = await fetch(
        `${sidecar.baseUrl}/api/hud?conversationId=${SUB_CID}&etag=${encodeURIComponent(hud.etag)}`
      );
      assert.equal(etagHitRes.status, 200);
      const etagRaw = await etagHitRes.text();
      assert.equal(Buffer.byteLength(etagRaw, 'utf8'), 34);
      const etagJson = JSON.parse(etagRaw) as UnchangedEtagResponse;
      assert.deepEqual(etagJson, { unchanged: true, etag: hud.etag });
    } finally {
      await sidecar.stop();
      await mockLs.close();
    }
  });

  it('enforces incremental RPC polling (RTM-25, L-004), Anti-Stale Reconciler, and 8-decimal quota delta tracking', async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-e2e-engine-'));
    cleanupDirs.push(tmpRoot);
    const stateDir = path.join(tmpRoot, 'state');
    const agyDir = createFixtureAntigravityDir(tmpRoot);
    const lsState = createInitialMockLsState();
    const mockLs = await startMockLsServer(lsState);

    const lsClient = new ReadOnlyLsClient({
      address: `http://${mockLs.address}`,
      csrfToken: CSRF_TOKEN,
    });
    const engine = new TelemetryEngine({
      lsClient,
      stateDir,
      antigravityDataDir: agyDir,
    });

    try {
      const t0 = Date.now();
      await engine.refreshOnce(t0);

      // Cycle 1 assertions: ZERO GetCascadeTrajectory; Steps ONLY for RUNNING cascades; L-004 stepOffset
      assert.equal(
        lsState.calls.some((c) => c.method === 'GetCascadeTrajectory'),
        false
      );
      const cycle1Steps = lsState.calls.filter((c) => c.method === 'GetCascadeTrajectorySteps');
      assert.equal(cycle1Steps.length, 2); // ROOT_CID + SUB_CID (not IDLE SWARM_CID)
      assert.equal(cycle1Steps.some((c) => c.body.cascadeId === SWARM_CID), false);
      for (const stepCall of cycle1Steps) {
        assert.equal(typeof stepCall.body.stepOffset, 'number');
        assert.equal(stepCall.body.disableRehydration, true);
        assert.equal('startIndex' in stepCall.body, false);
        assert.equal('endIndex' in stepCall.body, false);
      }

      // Cycle 2 (500ms later, stepCount unchanged): ZERO additional GeneratorMetadata & ZERO Quota RPC calls
      lsState.calls = [];
      await engine.refreshOnce(t0 + 500);
      assert.equal(
        lsState.calls.filter((c) => c.method === 'GetCascadeTrajectoryGeneratorMetadata').length,
        0
      );
      assert.equal(
        lsState.calls.filter((c) => c.method === 'RetrieveUserQuotaSummary').length,
        0
      );
      assert.equal(
        lsState.calls.filter((c) => c.method === 'GetCascadeTrajectorySteps').length,
        2
      );

      // Cycle 3: SUB_CID finishes RUNNING -> IDLE, ROOT_CID stepCount increments & quota drops 8-decimal fraction
      lsState.calls = [];
      lsState.trajectories.trajectorySummaries![ROOT_CID]!.stepCount = 11;
      lsState.trajectories.trajectorySummaries![SUB_CID]!.status = 'CASCADE_RUN_STATUS_IDLE';
      lsState.quota.response!.groups![0]!.buckets![0]!.remainingFraction = 0.84324217;

      await engine.refreshOnce(t0 + 1500);

      const metaCalls3 = lsState.calls.filter(
        (c) => c.method === 'GetCascadeTrajectoryGeneratorMetadata'
      );
      assert.equal(metaCalls3.length, 1);
      assert.equal(metaCalls3[0]!.body.cascadeId, ROOT_CID);

      const stepCalls3 = lsState.calls.filter((c) => c.method === 'GetCascadeTrajectorySteps');
      assert.equal(stepCalls3.length, 1); // Only ROOT_CID is RUNNING now
      assert.equal(stepCalls3[0]!.body.cascadeId, ROOT_CID);

      // Immediate quota refresh triggered by stepCount increment / RUNNING -> IDLE
      assert.equal(
        lsState.calls.filter((c) => c.method === 'RetrieveUserQuotaSummary').length,
        1
      );

      const snap = engine.getHudSnapshot(SUB_CID) as HudSnapshotResponse;
      assert.equal(snap.activeNode?.phase, 'IDLE'); // Anti-Stale Reconciler converged TOOL_RUNNING -> IDLE
      assert.ok(snap.quota.treeNetDelta5hPct !== null);
      assert.ok(Math.abs(snap.quota.treeNetDelta5hPct - 0.648689) < 0.0001);
      assert.ok(existsSync(path.join(stateDir, 'live-snapshot.json')));
      assert.ok(existsSync(path.join(stateDir, 'model-map.json')));
      assert.ok(existsSync(path.join(stateDir, 'quota-cache.json')));
    } finally {
      engine.stop();
      await mockLs.close();
    }
  });

  it('watchBundleForRestart detects atomic tmp + renameSync bundle replacement once and cleans up cleanly', async () => {
    const loaderPath = resolveSidecarLoader();
    await import(pathToFileURL(loaderPath).href);
    const serverEntry = path.join(REPO_ROOT, 'sidecars', 'pulse_cockpit', 'dist', 'server.mjs');
    assert.ok(existsSync(serverEntry), `Expected built sidecar server at ${serverEntry}`);

    type ServerModule = typeof import('../../src/sidecar/server');
    const { watchBundleForRestart } = (await import(
      pathToFileURL(serverEntry).href
    )) as ServerModule;

    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-bundle-watch-'));
    cleanupDirs.push(tmpRoot);

    const bundlePath = path.join(tmpRoot, 'server.mjs');
    writeFileSync(bundlePath, '// initial bundle v1\n', 'utf8');

    let calls = 0;
    const stopWatch = watchBundleForRestart(
      bundlePath,
      () => {
        calls += 1;
      },
      30
    );

    try {
      const tmpReplacement = `${bundlePath}.tmp`;
      writeFileSync(tmpReplacement, '// updated bundle v2 with new size and inode\n', 'utf8');
      renameSync(tmpReplacement, bundlePath);

      const deadlineMs = Date.now() + 1500;
      while (calls === 0 && Date.now() < deadlineMs) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(calls, 1);

      // Wait across several more poll ticks to confirm callback fires at most once
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(calls, 1);

      // Missing bundle path returns a safe no-op cleanup
      const stopMissing = watchBundleForRestart(
        path.join(tmpRoot, 'nonexistent-bundle.mjs'),
        () => {
          calls += 1;
        },
        30
      );
      stopMissing();
      assert.equal(calls, 1);
    } finally {
      stopWatch();
    }
  });
});
