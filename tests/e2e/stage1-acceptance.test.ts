import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
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
  const agyBin = execFileSync('which', ['agy'], { encoding: 'utf8' }).trim();
  const derived = path.resolve(
    path.dirname(realpathSync(agyBin)),
    '..',
    'lib',
    'node_modules',
    'sidecar_sdk',
    'register_loader.js'
  );
  assert.ok(existsSync(derived), 'Missing sidecar_sdk/register_loader.js');
  return derived;
}

const REPO_ROOT = resolveRepoRoot();
const HOOK_PROBE_BIN = path.join(REPO_ROOT, 'dist', 'hook-probe.cjs');
const SIDECAR_SERVER_BIN = path.join(REPO_ROOT, 'sidecars', 'pulse_cockpit', 'dist', 'server.mjs');
const PREVIEW_SCRIPT = path.join(REPO_ROOT, 'scripts', 'preview-ui.mjs');

const ROOT_CID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUB_CID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SWARM_CID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CSRF = 'accept-csrf-token';
const UI_TOKEN = 'accept-ui-token';

function runHookProbe(stateDir: string, payload: Record<string, unknown>): string {
  return execFileSync(process.execPath, [HOOK_PROBE_BIN], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
    },
  }).trim();
}

async function waitFor<T>(
  check: () => Promise<T | null>,
  timeoutMs = 5000,
  intervalMs = 80
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await check();
    if (val !== null) {
      return val;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

describe('Stage 1 end-to-end acceptance gate', () => {
  const cleanupDirs: string[] = [];

  after(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('connects real hook-probe.cjs -> $PULSE_STATE_DIR ring -> real SidecarApp/TelemetryEngine -> mock LS -> /api/hud & inline stamp', async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-stage1-accept-'));
    cleanupDirs.push(tmpRoot);
    const stateDir = path.join(tmpRoot, 'pulse-state');
    const agyDir = path.join(tmpRoot, 'antigravity');
    mkdirSync(path.join(agyDir, 'brain', ROOT_CID, '.system_generated', 'subagents'), { recursive: true });
    mkdirSync(path.join(agyDir, 'brain', ROOT_CID, '.system_generated', 'swarm'), { recursive: true });
    mkdirSync(path.join(agyDir, 'annotations'), { recursive: true });

    writeFileSync(
      path.join(agyDir, 'brain', ROOT_CID, '.system_generated', 'subagents', `${SUB_CID}.json`),
      JSON.stringify({
        conversationId: SUB_CID,
        subagentDescriptor: { typeName: 'builder', role: 'Builder' },
        state: 'running',
        spawnStepIndex: 2,
      }),
      'utf8'
    );
    writeFileSync(
      path.join(agyDir, 'brain', ROOT_CID, '.system_generated', 'swarm', 'members.json'),
      JSON.stringify({
        title: 'Acceptance Swarm',
        members: {
          auditor: {
            conversation_id: SWARM_CID,
            role: 'Auditor',
            desired_state: 'running',
            applied_model: 'MODEL_PLACEHOLDER_M427',
            phase: 'thinking',
          },
        },
      }),
      'utf8'
    );
    writeFileSync(
      path.join(agyDir, 'annotations', `${ROOT_CID}.pbtxt`),
      'title: "Stage 1 Acceptance Cascade"\n',
      'utf8'
    );

    let rootStatus: string = 'CASCADE_RUN_STATUS_RUNNING';
    let rootStepCount = 8;
    let rootStepStatus = 'CORTEX_STEP_STATUS_GENERATING';
    let quotaFraction = 0.85;
    let viewableAt: string | undefined;

    const lsServer = http.createServer((req, res) => {
      if (req.headers['x-codeium-csrf-token'] !== CSRF) {
        res.writeHead(401);
        res.end();
        return;
      }
      const method = (req.url || '').split('/').pop() || '';
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const parsed = body ? (JSON.parse(body) as Record<string, unknown>) : {};
        res.writeHead(200, { 'Content-Type': 'application/json' });

        if (method === 'GetCascadeModelConfigData') {
          const payload: GetCascadeModelConfigDataResponse = {
            defaultOverrideModelConfig: {
              modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
              modelId: 'gemini-4-carbon-high',
              label: 'Gemini 4 Carbon (High)',
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
          };
          res.end(JSON.stringify(payload));
          return;
        }
        if (method === 'RetrieveUserQuotaSummary') {
          const payload: RetrieveUserQuotaSummaryResponse = {
            response: {
              groups: [
                {
                  groupId: 'gemini',
                  buckets: [
                    {
                      bucketId: 'gemini-5h',
                      displayName: 'Gemini 5h',
                      window: '5h',
                      remainingFraction: quotaFraction,
                      resetTime: new Date(Date.now() + 7200_000).toISOString(),
                    },
                  ],
                },
              ],
            },
          };
          res.end(JSON.stringify(payload));
          return;
        }
        if (method === 'GetAllCascadeTrajectories') {
          const payload: GetAllCascadeTrajectoriesResponse = {
            trajectorySummaries: {
              [ROOT_CID]: {
                trajectoryId: ROOT_CID,
                status: rootStatus,
                stepCount: rootStepCount,
                summary: null, // tests .pbtxt fallback
                lastModifiedTime: new Date().toISOString(),
              },
              [SUB_CID]: {
                trajectoryId: SUB_CID,
                status: 'CASCADE_RUN_STATUS_IDLE',
                stepCount: 4,
                summary: 'Builder Child',
                lastModifiedTime: new Date().toISOString(),
              },
            },
          };
          res.end(JSON.stringify(payload));
          return;
        }
        if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
          const cid = String(parsed.cascadeId ?? '');
          const payload: GetCascadeTrajectoryGeneratorMetadataResponse =
            cid === ROOT_CID
              ? {
                  generatorMetadata: [
                    {
                      stepIndices: [1, 2],
                      chatModel: {
                        model: 'MODEL_PLACEHOLDER_M427',
                        responseModel: 'gemini-4-carbon',
                        modelDisplayName: 'Gemini 4 Carbon (High)',
                        timeToFirstToken: '2.1s',
                        streamingDuration: '1.2s',
                        retryInfos: [{}],
                        chatStartMetadata: {
                          contextWindowMetadata: { estimatedTokensUsed: '51200', maxContextTokens: '256000' },
                        },
                        usage: {
                          inputTokens: '2000',
                          cacheReadTokens: '18000',
                          outputTokens: '600',
                          thinkingOutputTokens: '400',
                          responseOutputTokens: '200',
                        },
                      },
                    },
                  ],
                }
              : { generatorMetadata: [] };
          res.end(JSON.stringify(payload));
          return;
        }
        if (method === 'GetCascadeTrajectorySteps') {
          const payload: GetCascadeTrajectoryStepsResponse = {
            steps: [
              {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                status: rootStepStatus,
                metadata: {
                  createdAt: new Date(Date.now() - 1500).toISOString(),
                  ...(viewableAt ? { viewableAt } : {}),
                },
              },
            ],
          };
          res.end(JSON.stringify(payload));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => lsServer.listen(0, '127.0.0.1', () => resolve()));
    const lsAddr = lsServer.address();
    assert.ok(lsAddr && typeof lsAddr === 'object');

    const loaderPath = resolveSidecarLoader();
    const child: ChildProcess = spawn(process.execPath, ['--import', loaderPath, SIDECAR_SERVER_BIN], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ANTIGRAVITY_LS_ADDRESS: `http://127.0.0.1:${lsAddr.port}`,
        ANTIGRAVITY_CSRF_TOKEN: CSRF,
        ANTIGRAVITY_SIDECAR_WEB_PORT: '0',
        ANTIGRAVITY_SIDECAR_UI_TOKEN: UI_TOKEN,
        ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
        ANTIGRAVITY_DATA_DIR: agyDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const baseUrl = await new Promise<string>((resolve, reject) => {
      let stdout = '';
      const timer = setTimeout(() => reject(new Error('Sidecar startup timeout')), 8000);
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
        const match = /listening on (127\.0\.0\.1:\d+)/.exec(stdout);
        if (match) {
          clearTimeout(timer);
          resolve(`http://${match[1]}`);
        }
      });
    });

    try {
      // 1. Seed initial caches and check THINKING phase + .pbtxt fallback title
      const firstHud = (await (
        await fetch(`${baseUrl}/api/hud?conversationId=${ROOT_CID}`)
      ).json()) as HudSnapshotResponse;
      assert.equal(firstHud.activeNode?.title, 'Stage 1 Acceptance Cascade');
      assert.equal(firstHud.activeNode?.phase, 'THINKING');
      assert.equal(firstHud.activeNode?.cacheHitPct, 90);
      assert.ok(firstHud.treeNodes.some((n) => n.cascadeId === SWARM_CID && n.kind === 'swarm_member'));

      // 2. Fire real hook-probe.cjs PreToolUse (T=0ms TOOL_RUNNING acceleration + {"decision":"allow"})
      const preToolStdout = runHookProbe(stateDir, {
        hook_event_name: 'PreToolUse',
        conversation_id: ROOT_CID,
        tool_name: 'run_command',
        tool_call_id: 'call-accept-1',
        tool_input: { CommandLine: 'npm run build' },
      });
      assert.equal(preToolStdout, '{"decision":"allow"}');

      const toolHud = await waitFor(async () => {
        const res = await fetch(`${baseUrl}/api/hud?conversationId=${ROOT_CID}`);
        const data = (await res.json()) as HudSnapshotResponse;
        return data.activeNode?.phase === 'TOOL_RUNNING' ? data : null;
      });
      assert.equal(toolHud.activeNode?.lastTool?.name, 'run_command');

      // 3. Fire PostToolUse ({}) + PostInvocation (zero-token user_markdown stamp) + Stop ({})
      const postToolStdout = runHookProbe(stateDir, {
        hook_event_name: 'PostToolUse',
        conversation_id: ROOT_CID,
        tool_name: 'run_command',
        tool_call_id: 'call-accept-1',
      });
      assert.equal(postToolStdout, '{}');

      const postInvStdout = runHookProbe(stateDir, {
        hook_event_name: 'PostInvocation',
        conversation_id: ROOT_CID,
        invocation_num: 1,
        model: 'MODEL_PLACEHOLDER_M427',
      });
      const stampJson = JSON.parse(postInvStdout) as {
        injectSteps: Array<{
          systemMessage: { systemMessage: string; metadata: { user_markdown: string } };
        }>;
      };
      assert.equal(stampJson.injectSteps.length, 1);
      assert.equal(stampJson.injectSteps[0]!.systemMessage.systemMessage, '');
      assert.ok(
        stampJson.injectSteps[0]!.systemMessage.metadata.user_markdown.includes(
          'sidecar://antigravity-pulse/pulse_cockpit/hud'
        )
      );

      // 4. LS finishes turn (RUNNING -> IDLE) + quota drops -> Anti-Stale Reconciler converges to IDLE
      rootStatus = 'CASCADE_RUN_STATUS_IDLE';
      rootStepCount = 9;
      quotaFraction = 0.845;
      viewableAt = new Date().toISOString();

      const stopStdout = runHookProbe(stateDir, {
        hook_event_name: 'Stop',
        conversation_id: ROOT_CID,
        stop_reason: 'end_turn',
      });
      assert.equal(stopStdout, '{}');

      const idleHud = await waitFor(async () => {
        const res = await fetch(`${baseUrl}/api/hud?conversationId=${ROOT_CID}`);
        const data = (await res.json()) as HudSnapshotResponse;
        return data.activeNode?.phase === 'IDLE' ? data : null;
      });
      assert.equal(idleHud.activeNode?.phase, 'IDLE');
      assert.ok(idleHud.quota.treeNetDelta5hPct !== null);
      assert.ok(Math.abs(idleHud.quota.treeNetDelta5hPct - 0.5) < 0.01);

      // 5. ETag unchanged hit = 34 bytes
      const etagHit = await (
        await fetch(
          `${baseUrl}/api/hud?conversationId=${ROOT_CID}&etag=${encodeURIComponent(idleHud.etag)}`
        )
      ).text();
      assert.equal(Buffer.byteLength(etagHit, 'utf8'), 34);
      assert.equal((JSON.parse(etagHit) as UnchangedEtagResponse).unchanged, true);

      // 6. Config update persisted on disk
      const cfgRes = await fetch(`${baseUrl}/api/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sidecar-token': UI_TOKEN,
        },
        body: JSON.stringify({ inlineStampMode: 'every-turn' }),
      });
      assert.equal(cfgRes.status, 200);
      assert.ok(existsSync(path.join(stateDir, 'config.json')));
      assert.ok(existsSync(path.join(stateDir, 'events.ring.jsonl')));
      assert.ok(existsSync(path.join(stateDir, 'stamp-dedup.json')));
      const ringLines = readFileSync(path.join(stateDir, 'events.ring.jsonl'), 'utf8')
        .trim()
        .split('\n');
      assert.ok(ringLines.length >= 4);
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 1500);
      });
      await new Promise<void>((resolve) => lsServer.close(() => resolve()));
    }
  });

  it('serves all preview-ui.mjs Stage 1 scenarios (alert, idle, live) and interactive POST /api/config', async () => {
    for (const scenario of ['alert', 'idle', 'live'] as const) {
      const child = spawn(process.execPath, [PREVIEW_SCRIPT, '--port', '0', '--scenario', scenario], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const baseUrl = await new Promise<string>((resolve, reject) => {
        let out = '';
        const t = setTimeout(() => reject(new Error(`Preview timeout for ${scenario}`)), 5000);
        child.stdout?.on('data', (c) => {
          out += String(c);
          const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
          if (m) {
            clearTimeout(t);
            resolve(`http://127.0.0.1:${m[1]}`);
          }
        });
      });

      try {
        const hud = (await (await fetch(`${baseUrl}/api/hud`)).json()) as HudSnapshotResponse;
        if (scenario === 'alert') {
          assert.equal(hud.smartGovernanceBanner.active, true);
          assert.ok(hud.smartGovernanceBanner.heavyConcurrentCount >= 3);
          assert.equal(hud.quota.gemini5h?.isLowAlert, true);
          assert.equal(hud.activeNode?.contextWindow.level, 'critical_85');
        } else if (scenario === 'idle') {
          assert.ok(hud.treeNodes.length > 0);
          assert.ok(hud.treeNodes.every((n) => n.phase === 'IDLE'));
        } else {
          assert.ok(hud.treeNodes.length >= 5);
        }

        const etagHit = await (
          await fetch(`${baseUrl}/api/hud?etag=${encodeURIComponent(hud.etag)}`)
        ).text();
        assert.equal(Buffer.byteLength(etagHit, 'utf8'), 34);

        const cfgRes = await fetch(`${baseUrl}/api/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hudSortMode: 'topology-tree', inlineStampMode: 'every-turn' }),
        });
        assert.equal(cfgRes.status, 200);
        const updatedHud = (await (await fetch(`${baseUrl}/api/hud`)).json()) as HudSnapshotResponse;
        assert.equal(updatedHud.config.hudSortMode, 'topology-tree');
        assert.equal(updatedHud.config.inlineStampMode, 'every-turn');
      } finally {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          setTimeout(() => resolve(), 1000);
        });
      }
    }
  });

  it('resolves per-request ?scenario= and Referer scenario overrides cleanly without clashing preload styles', async () => {
    const child = spawn(process.execPath, [PREVIEW_SCRIPT, '--port', '0', '--scenario', 'dense'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const baseUrl = await new Promise<string>((resolve, reject) => {
      let out = '';
      const t = setTimeout(() => reject(new Error('Preview timeout for query override test')), 5000);
      child.stdout?.on('data', (c) => {
        out += String(c);
        const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
        if (m) {
          clearTimeout(t);
          resolve(`http://127.0.0.1:${m[1]}`);
        }
      });
    });

    try {
      // 1. Default falls back to startup --scenario dense
      const denseHud = (await (await fetch(`${baseUrl}/api/hud`)).json()) as HudSnapshotResponse;
      assert.equal(denseHud.smartGovernanceBanner.active, false);
      assert.ok(denseHud.treeNodes.length >= 5);

      // 2. Explicit ?scenario=alert query overrides startup dense across HUD, Timeline, Fleet & Health
      const alertHud = (await (
        await fetch(`${baseUrl}/api/hud?scenario=alert`)
      ).json()) as HudSnapshotResponse;
      assert.equal(alertHud.smartGovernanceBanner.active, true);
      assert.equal(alertHud.quota.gemini5h?.isLowAlert, true);

      const alertHealth = (await (await fetch(`${baseUrl}/api/health?scenario=alert`)).json()) as {
        scenario: string;
      };
      assert.equal(alertHealth.scenario, 'alert');

      const alertTimeline = (await (
        await fetch(`${baseUrl}/api/timeline?scenario=alert`)
      ).json()) as { etag: string; rootCascadeId: string; turns: unknown[] };
      assert.equal(typeof alertTimeline.etag, 'string');
      assert.equal(alertTimeline.rootCascadeId, alertHud.rootCascadeId);
      assert.ok(Array.isArray(alertTimeline.turns));

      const alertFleet = (await (await fetch(`${baseUrl}/api/fleet?scenario=alert`)).json()) as {
        topQuotaBurners: unknown[];
        quota: { gemini5h?: { isLowAlert: boolean } };
      };
      assert.ok(Array.isArray(alertFleet.topQuotaBurners));
      assert.equal(alertFleet.quota.gemini5h?.isLowAlert, true);

      // 3. Referer ?scenario=idle overrides startup dense when endpoint URL omits ?scenario=
      const idleRefererHeaders = { Referer: `${baseUrl}/hud?scenario=idle&theme=dark` };
      const idleHud = (await (
        await fetch(`${baseUrl}/api/hud`, { headers: idleRefererHeaders })
      ).json()) as HudSnapshotResponse;
      assert.ok(idleHud.treeNodes.length > 0);
      assert.ok(idleHud.treeNodes.every((n) => n.phase === 'IDLE'));

      const idleHealth = (await (
        await fetch(`${baseUrl}/api/health`, { headers: idleRefererHeaders })
      ).json()) as { scenario: string };
      assert.equal(idleHealth.scenario, 'idle');

      // 4. /preload.js injects no inline --background / #fafafa theme styles; CSS & UI bundle support dark theme & narrow widths
      const preloadBody = await (await fetch(`${baseUrl}/preload.js?scenario=alert`)).text();
      assert.equal(preloadBody.includes('--background'), false);
      assert.equal(preloadBody.includes('#fafafa'), false);

      const hudPageRes = await fetch(`${baseUrl}/hud?theme=dark&scenario=alert`);
      assert.equal(hudPageRes.status, 200);
      assert.ok((hudPageRes.headers.get('content-type') || '').includes('text/html'));

      const uiBundle = await (await fetch(`${baseUrl}/dist/ui.js`)).text();
      assert.ok(uiBundle.includes('getThemeQueryOverride'));
      assert.ok(uiBundle.includes('pulse-tier-'));
      assert.ok(uiBundle.includes('pulse-btn-label'));

      const cssBody = await (await fetch(`${baseUrl}/styles.css`)).text();
      assert.ok(cssBody.includes('[data-resolved-theme="dark"]'));
      assert.ok(cssBody.includes('max-width: 420px'));
      assert.ok(cssBody.includes('max-width: 390px'));
      assert.equal(cssBody.includes('scrollbar-gutter'), false);
      assert.equal(
        /::-webkit-progress-value\s*,\s*::-moz-progress-bar/i.test(cssBody),
        false,
        '::-webkit-progress-value and ::-moz-progress-bar must remain in separate CSS rule blocks'
      );

      for (const tier of ['apex', 'workhorse', 'fast', 'orchestrator', 'alert']) {
        assert.ok(cssBody.includes(`[data-tier="${tier}"]`), `Missing [data-tier="${tier}"] rule`);
      }
      assert.ok(cssBody.includes('.pulse-node-card[data-tier]'));
      assert.ok(cssBody.includes('.pulse-pill[data-tier]'));
      assert.ok(cssBody.includes('.pulse-banner[data-tier]'));
      assert.ok(cssBody.includes('[data-level="warn_70"]'));
      assert.ok(cssBody.includes('[data-level="critical_85"]'));
      for (const phase of ['idle', 'pre_flight', 'thinking', 'streaming', 'scanning', 'waiting', 'error']) {
        assert.ok(
          cssBody.includes(`[data-phase="${phase}"]`),
          `Missing [data-phase="${phase}"] color rule`
        );
      }
      assert.ok(cssBody.includes('.pulse-btn-label'));
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(() => resolve(), 1000);
      });
    }
  });
});
