import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { CANONICAL_HUD_URI } from '../../src/core/formatters';
import { McpFrameDecoder, serializeJsonRpcMessage } from '../../src/mcp/server';
import {
  getStatePaths,
  type LiveSnapshotFile,
  readJsonSafe,
  writeJsonAtomic,
} from '../../src/state/state-dir';
import type {
  ComputeBudgetAdvice,
  HudSnapshotResponse,
  PulseUserConfig,
} from '../../src/types/telemetry';

const ROOT_CID = '11111111-1111-4111-8111-111111111111';
const SUB_CID = '22222222-2222-4222-8222-222222222222';
const CSRF_TOKEN = 'pulse-e2e-full-csrf';
const UI_TOKEN = 'pulse-e2e-full-ui-token';

function resolveRepoRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(__dirname, '..'),
    path.resolve(__dirname, '..', '..'),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'dist'))) {
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
  try {
    const agyBin = execFileSync('which', ['agy'], { encoding: 'utf8' }).trim();
    if (agyBin) {
      const derived = path.resolve(
        path.dirname(realpathSync(agyBin)),
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
    // Ignore PATH lookup errors
  }
  throw new Error('Unable to locate sidecar_sdk/register_loader.js for full-system E2E test');
}

const REPO_ROOT = resolveRepoRoot();

interface ControlledMockLs {
  address: string;
  calls: Array<{ method: string; body: Record<string, unknown> }>;
  setQuotaFraction(fraction: number): void;
  close(): Promise<void>;
}

async function startControlledMockLs(initialQuotaFraction: number): Promise<ControlledMockLs> {
  let quotaFraction = initialQuotaFraction;
  const baseNowMs = Date.now();
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];

  const server = http.createServer((req, res) => {
    if (req.headers['x-codeium-csrf-token'] !== CSRF_TOKEN) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid csrf' }));
      return;
    }
    const method = (req.url || '').split('/').pop() || '';
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      const body = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {};
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
              {
                label: 'Gemini 3.5 Flash',
                modelOrAlias: { model: 'MODEL_PLACEHOLDER_FLASH' },
              },
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
            response: {
              groups: [
                {
                  groupId: 'gemini',
                  displayName: 'Gemini',
                  buckets: [
                    {
                      bucketId: 'gemini-5h',
                      displayName: 'Gemini 5h',
                      window: '5h',
                      remainingFraction: quotaFraction,
                      resetTime: new Date(baseNowMs + 2 * 3600_000).toISOString(),
                    },
                    {
                      bucketId: 'gemini-weekly',
                      displayName: 'Gemini Weekly',
                      window: 'weekly',
                      remainingFraction: 0.92,
                      resetTime: new Date(baseNowMs + 4 * 86400_000).toISOString(),
                    },
                  ],
                },
                {
                  groupId: '3p',
                  displayName: 'Third Party',
                  buckets: [
                    {
                      bucketId: '3p-5h',
                      displayName: 'Claude 5h',
                      window: '5h',
                      remainingFraction: 0.95,
                      resetTime: new Date(baseNowMs + 3 * 3600_000).toISOString(),
                    },
                  ],
                },
              ],
            },
          })
        );
        return;
      }

      if (method === 'GetAllCascadeTrajectories') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            trajectorySummaries: {
              [ROOT_CID]: {
                summary: 'Full System Root',
                status: 'CASCADE_RUN_STATUS_RUNNING',
                stepCount: 6,
                lastModifiedTime: new Date(baseNowMs - 500).toISOString(),
                createdTime: new Date(baseNowMs - 30_000).toISOString(),
                workspaces: [{ workspaceFolderAbsoluteUri: `file://${REPO_ROOT}` }],
                requestedModel: { model: 'MODEL_PLACEHOLDER_M427' },
              },
              [SUB_CID]: {
                summary: 'Explorer Worker',
                status: 'CASCADE_RUN_STATUS_RUNNING',
                stepCount: 3,
                lastModifiedTime: new Date(baseNowMs - 700).toISOString(),
                createdTime: new Date(baseNowMs - 10_000).toISOString(),
                workspaces: [{ workspaceFolderAbsoluteUri: `file://${REPO_ROOT}` }],
                requestedModel: { model: 'MODEL_PLACEHOLDER_FLASH' },
                metadata: {
                  parentCascadeId: ROOT_CID,
                  subagentRole: 'Explorer',
                },
              },
            },
          })
        );
        return;
      }

      if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
        const cid = String(body.cascadeId || '');
        const isRoot = cid === ROOT_CID;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            generatorMetadata: [
              {
                stepIndices: [1, 2],
                chatModel: {
                  model: isRoot ? 'MODEL_PLACEHOLDER_M427' : 'MODEL_PLACEHOLDER_FLASH',
                  modelDisplayName: isRoot ? 'Gemini 4 Carbon (High)' : 'Gemini 3.5 Flash',
                  responseModel: isRoot ? 'gemini-4-carbon' : 'gemini-3-5-flash',
                  timeToFirstToken: '1.1s',
                  streamingDuration: '2.4s',
                  retryInfos: [{ attempt: 1 }],
                  chatStartMetadata: {
                    createdAt: new Date(baseNowMs - 5_000).toISOString(),
                    contextWindowMetadata: {
                      estimatedTokensUsed: isRoot ? '64000' : '16000',
                      maxContextTokens: '256000',
                    },
                  },
                  usage: {
                    inputTokens: '4000',
                    cacheReadTokens: '12000',
                    outputTokens: '900',
                    thinkingOutputTokens: '300',
                    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                  },
                },
              },
            ],
          })
        );
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

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');

  return {
    address: `127.0.0.1:${addr.port}`,
    calls,
    setQuotaFraction(fraction: number) {
      quotaFraction = fraction;
    },
    close(): Promise<void> {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const force = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 2000);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function waitForSidecarUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`Sidecar startup timed out. stdout=${stdout} stderr=${stderr}`));
    }, 8000);

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
      reject(new Error(`Sidecar exited prematurely (${code}): ${stderr}`));
    });
  });
}

function isolatedEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ANTIGRAVITY_') || key.startsWith('PULSE_') || key === 'CLAUDE_PLUGIN_DATA') {
      delete env[key];
    }
  }
  return { ...env, ...overrides };
}

function runHookProbe(
  stateDir: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const out = execFileSync(process.execPath, [path.join(REPO_ROOT, 'dist', 'hook-probe.cjs')], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: isolatedEnv({
      ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
    }),
  });
  return JSON.parse(out.trim()) as Record<string, unknown>;
}

async function runMcpStdioSession(options: {
  framing: 'ndjson' | 'content-length';
  env: Record<string, string>;
  requests: Array<Record<string, unknown>>;
  chunkSize?: number;
}): Promise<{
  responses: Array<{ id: number | string | null; result?: unknown; error?: unknown }>;
  stderr: string;
}> {
  const mcpPath = path.join(REPO_ROOT, 'dist', 'mcp.cjs');
  const child = spawn(process.execPath, [mcpPath], {
    cwd: REPO_ROOT,
    env: isolatedEnv(options.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (c: Buffer) => stdoutChunks.push(Buffer.from(c)));
  child.stderr.on('data', (c: Buffer) => stderrChunks.push(Buffer.from(c)));

  const rawPayload = Buffer.concat(
    options.requests.map((r) => Buffer.from(serializeJsonRpcMessage(r, options.framing), 'utf8'))
  );

  if (options.chunkSize && options.chunkSize > 0) {
    for (let i = 0; i < rawPayload.length; i += options.chunkSize) {
      child.stdin.write(rawPayload.subarray(i, Math.min(rawPayload.length, i + options.chunkSize)));
      await new Promise((r) => setTimeout(r, 2));
    }
    child.stdin.end();
  } else {
    child.stdin.end(rawPayload);
  }

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('dist/mcp.cjs timed out waiting to exit'));
    }, 8000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, `dist/mcp.cjs exited with ${exitCode}: ${Buffer.concat(stderrChunks).toString('utf8')}`);

  const fullStdout = Buffer.concat(stdoutChunks);
  const decoder = new McpFrameDecoder();
  const frames = [...decoder.push(fullStdout), ...decoder.flushEnd()];
  const responses = frames.map((f) => {
    assert.equal(f.framing, options.framing, `Expected ${options.framing} response framing`);
    assert.equal(f.parseError, undefined);
    return JSON.parse(f.rawJson ?? '') as {
      id: number | string | null;
      result?: unknown;
      error?: unknown;
    };
  });

  return {
    responses,
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
}

function findPosixBin(name: string): string {
  for (const dir of ['/usr/bin', '/bin', '/usr/local/bin']) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return execFileSync('which', [name], { encoding: 'utf8' }).trim();
}

describe('Stage 3 full 4-surface E2E loop (Hooks -> Sidecar -> CLI & Launcher -> Dual-Framing MCP)', () => {
  const tempDirs: string[] = [];

  after(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('connects all 4 surfaces across live telemetry, watch mode, agy-node fallback, and NDJSON + Content-Length MCP', async () => {
    const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'pulse-e2e-full-'));
    tempDirs.push(tmpRoot);
    const stateDir = path.join(tmpRoot, 'state');
    const agyDataDir = path.join(tmpRoot, 'agy-data');
    const subagentsDir = path.join(agyDataDir, 'brain', ROOT_CID, '.system_generated', 'subagents');
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    mkdirSync(subagentsDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(subagentsDir, `${SUB_CID}.json`),
      JSON.stringify({
        conversationId: SUB_CID,
        subagentDescriptor: {
          typeName: 'explorer',
          role: 'Explorer',
        },
        state: 'running',
        spawnStepIndex: 3,
        workspaceUris: [`file://${REPO_ROOT}`],
      }),
      'utf8'
    );

    const mockLs = await startControlledMockLs(0.8);
    const loaderPath = resolveSidecarLoader();
    const serverEntry = path.join(REPO_ROOT, 'sidecars', 'pulse_cockpit', 'dist', 'server.mjs');
    const sidecarChild = spawn(process.execPath, ['--import', loaderPath, serverEntry], {
      cwd: REPO_ROOT,
      env: isolatedEnv({
        ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
        ANTIGRAVITY_DATA_DIR: agyDataDir,
        ANTIGRAVITY_LS_ADDRESS: `http://${mockLs.address}`,
        ANTIGRAVITY_CSRF_TOKEN: CSRF_TOKEN,
        ANTIGRAVITY_SIDECAR_WEB_PORT: '0',
        ANTIGRAVITY_SIDECAR_UI_TOKEN: UI_TOKEN,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
      // 1. Hook Probe PreInvocation & PreToolUse write ring events cleanly
      const preInv = runHookProbe(stateDir, {
        hookEventName: 'PreInvocation',
        conversationId: ROOT_CID,
        invocationNum: 1,
      });
      assert.deepEqual(preInv, {});

      const preTool = runHookProbe(stateDir, {
        hookEventName: 'PreToolUse',
        conversationId: ROOT_CID,
        toolName: 'grep_search',
      });
      assert.deepEqual(preTool, { decision: 'allow' });

      const ringPath = getStatePaths(stateDir).eventsRing;
      assert.equal(existsSync(ringPath), true);
      assert.ok(readFileSync(ringPath, 'utf8').trim().split('\n').length >= 2);

      // 2. Sidecar polls Mock LS and populates live-snapshot.json & quota-cache.json
      const baseUrl = await waitForSidecarUrl(sidecarChild);
      const hudRes = await fetch(`${baseUrl}/api/hud?conversationId=${ROOT_CID}`);
      assert.equal(hudRes.status, 200);
      const hud = (await hudRes.json()) as HudSnapshotResponse;
      assert.equal(hud.hostConnected, true);
      assert.ok(hud.treeNodes.length >= 2);

      const snapshotPath = getStatePaths(stateDir).liveSnapshot;
      let snapshotOnDisk: LiveSnapshotFile | null = null;
      const snapDeadline = Date.now() + 2500;
      while (Date.now() < snapDeadline) {
        snapshotOnDisk = readJsonSafe<LiveSnapshotFile | null>(snapshotPath, null);
        if (snapshotOnDisk && snapshotOnDisk.hostConnected && snapshotOnDisk.quota?.gemini5h?.remainingPct === 80) {
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!snapshotOnDisk) {
        assert.fail('Expected live-snapshot.json to be written by sidecar');
      }
      assert.equal(snapshotOnDisk.hostConnected, true);
      assert.equal(snapshotOnDisk.quota?.gemini5h?.remainingPct, 80);

      // PostInvocation turn 1 -> emits ⚡ zero-token stamp; turn 2 (smart unchanged) -> {}
      const post1 = runHookProbe(stateDir, {
        hookEventName: 'PostInvocation',
        conversationId: ROOT_CID,
        invocationNum: 1,
      }) as { injectSteps?: Array<{ systemMessage?: { systemMessage?: string; metadata?: { user_markdown?: string } } }> };
      assert.ok(post1.injectSteps && post1.injectSteps.length === 1);
      assert.equal(post1.injectSteps[0].systemMessage?.systemMessage, '');
      assert.ok((post1.injectSteps[0].systemMessage?.metadata?.user_markdown ?? '').startsWith('⚡'));

      const post2 = runHookProbe(stateDir, {
        hookEventName: 'PostInvocation',
        conversationId: ROOT_CID,
        invocationNum: 2,
      });
      assert.deepEqual(post2, {});

      // 3. CLI surface: --version, status (waybar, tmux, json), top --once --no-color
      const cliPath = path.join(REPO_ROOT, 'dist', 'cli.cjs');
      const cliEnv = isolatedEnv({
        ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
      });

      const cliVer = execFileSync(process.execPath, [cliPath, '--version'], {
        encoding: 'utf8',
        env: cliEnv,
      }).trim();
      assert.equal(cliVer, 'antigravity-pulse v0.1.0');

      const waybarRaw = execFileSync(process.execPath, [cliPath, 'status', '--format', 'waybar'], {
        encoding: 'utf8',
        env: cliEnv,
      }).trim();
      assert.equal(waybarRaw.includes('\n'), false, 'Waybar output must be single-line');
      const waybar = JSON.parse(waybarRaw) as {
        text: string;
        tooltip: string;
        class: string;
        percentage: number;
      };
      assert.ok(waybar.text.includes('80%'));
      assert.equal(waybar.percentage, 80);
      assert.ok(waybar.tooltip.length > 0);

      const tmuxRaw = execFileSync(process.execPath, [cliPath, 'status', '--format', 'tmux'], {
        encoding: 'utf8',
        env: cliEnv,
      }).trim();
      assert.equal(tmuxRaw.includes('\n'), false, 'Tmux output must be single-line');
      assert.ok(tmuxRaw.length > 0);

      const jsonRaw = execFileSync(process.execPath, [cliPath, 'status', '--format', 'json'], {
        encoding: 'utf8',
        env: cliEnv,
      });
      const jsonStatus = JSON.parse(jsonRaw) as {
        schemaVersion: number;
        hostConnected: boolean;
        activeSubagentCount: number;
        treeNodes: unknown[];
        quota: { gemini5h?: { remainingPct: number } } | null;
      };
      assert.equal(jsonStatus.schemaVersion, 1);
      assert.equal(jsonStatus.hostConnected, true);
      assert.equal(jsonStatus.activeSubagentCount, 1);
      assert.ok(jsonStatus.treeNodes.length >= 2);
      assert.equal(jsonStatus.quota?.gemini5h?.remainingPct, 80);

      const topOut = execFileSync(process.execPath, [cliPath, 'top', '--once', '--no-color'], {
        encoding: 'utf8',
        env: cliEnv,
      });
      assert.equal(/\x1b\[/.test(topOut), false, 'top --no-color must emit zero ANSI escapes');
      assert.ok(topOut.includes('Gemini 4 Carbon'));
      assert.ok(topOut.includes('80.0%'));

      // Stop sidecar background polling before deterministic --watch & snapshot-only MCP steps
      await stopChild(sidecarChild);

      // CLI --watch emits live snapshot update and exits cleanly on SIGTERM
      const watchChild = spawn(
        process.execPath,
        [cliPath, 'status', '--format', 'json', '--watch', '--interval', '120'],
        { env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'] }
      );
      try {
        const watchLines: string[] = [];
        let watchBuf = '';
        watchChild.stdout.on('data', (chunk: Buffer) => {
          watchBuf += chunk.toString('utf8');
          let idx = watchBuf.indexOf('\n');
          while (idx !== -1) {
            const line = watchBuf.slice(0, idx).trim();
            watchBuf = watchBuf.slice(idx + 1);
            if (line) watchLines.push(line);
            idx = watchBuf.indexOf('\n');
          }
        });

        const waitWatchLines = async (count: number) => {
          const deadline = Date.now() + 4000;
          while (watchLines.length < count && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 40));
          }
          assert.ok(watchLines.length >= count, `Expected >=${count} watch lines, got ${watchLines.length}`);
        };

        await waitWatchLines(1);
        assert.equal((JSON.parse(watchLines[0]) as { quota?: { gemini5h?: { remainingPct: number } } }).quota?.gemini5h?.remainingPct, 80);

        // Update live-snapshot.json to 35% to trigger watcher update
        if (!snapshotOnDisk.quota.gemini5h) {
          assert.fail('Expected gemini5h quota bucket in live-snapshot.json');
        }
        const updatedSnapshot: LiveSnapshotFile = {
          ...snapshotOnDisk,
          updatedAt: new Date(Date.now() + 500).toISOString(),
          quota: {
            ...snapshotOnDisk.quota,
            gemini5h: {
              ...snapshotOnDisk.quota.gemini5h,
              remainingFraction: 0.35,
              remainingPct: 35,
            },
          },
        };
        writeJsonAtomic(snapshotPath, updatedSnapshot);
        await waitWatchLines(2);
        assert.equal(
          (JSON.parse(watchLines[watchLines.length - 1]) as { quota?: { gemini5h?: { remainingPct: number } } }).quota?.gemini5h?.remainingPct,
          35
        );

        const watchExit = await new Promise<number | null>((resolve) => {
          const killTimer = setTimeout(() => {
            watchChild.kill('SIGKILL');
          }, 2000);
          watchChild.once('exit', (code) => {
            clearTimeout(killTimer);
            resolve(code);
          });
          watchChild.kill('SIGTERM');
        });
        assert.equal(watchExit, 0);
      } finally {
        await stopChild(watchChild);
      }

      // RTM-20: bin/agy-pulse normal launch + isolated PATH mock agy-node fallback
      if (process.platform !== 'win32') {
        const binLauncher = path.join(REPO_ROOT, 'bin', 'agy-pulse');
        const directBinVer = execFileSync(binLauncher, ['--version'], { encoding: 'utf8' }).trim();
        assert.equal(directBinVer, 'antigravity-pulse v0.1.0');

        const isoBinDir = path.join(tmpRoot, 'iso-bin');
        mkdirSync(isoBinDir, { recursive: true });
        const markerFile = path.join(tmpRoot, 'agy-node-ran');
        const agyNodeShim = path.join(isoBinDir, 'agy-node');
        writeFileSync(
          agyNodeShim,
          `#!/bin/sh\necho invoked > "${markerFile}"\nexec "${process.execPath}" "$@"\n`,
          'utf8'
        );
        chmodSync(agyNodeShim, 0o755);
        symlinkSync(findPosixBin('dirname'), path.join(isoBinDir, 'dirname'));
        symlinkSync(findPosixBin('readlink'), path.join(isoBinDir, 'readlink'));

        const linkedLauncher = path.join(tmpRoot, 'agy-pulse-link');
        symlinkSync(binLauncher, linkedLauncher);

        const fallbackVer = execFileSync(linkedLauncher, ['--version'], {
          encoding: 'utf8',
          env: {
            PATH: isoBinDir,
            HOME: tmpRoot,
          },
        }).trim();
        assert.equal(fallbackVer, 'antigravity-pulse v0.1.0');
        assert.equal(existsSync(markerFile), true, 'Expected isolated agy-node shim fallback to execute');
      }

      // 4A. MCP over NDJSON stdio: 35% snapshot -> 'argon', set preference, generate HTML card
      const ndjsonSession = await runMcpStdioSession({
        framing: 'ndjson',
        env: { ANTIGRAVITY_PULSE_STATE_DIR: stateDir },
        requests: [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'pulse_get_compute_budget', arguments: { conversationId: ROOT_CID } },
          },
          {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
              name: 'pulse_set_preference',
              arguments: { inlineStampMode: 'every-turn', hudSortMode: 'topology-tree' },
            },
          },
          {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: { name: 'pulse_status_card', arguments: { conversationId: ROOT_CID, theme: 'dark' } },
          },
        ],
      });
      assert.equal(ndjsonSession.stderr, '');
      assert.equal(ndjsonSession.responses.length, 5);

      const listTools = (ndjsonSession.responses[1].result as { tools: Array<{ name: string }> }).tools;
      assert.deepEqual(
        listTools.map((t) => t.name),
        ['pulse_status_card', 'pulse_get_compute_budget', 'pulse_set_preference']
      );

      const budget35 = JSON.parse(
        (ndjsonSession.responses[2].result as { content: Array<{ text: string }> }).content[0].text
      ) as ComputeBudgetAdvice;
      assert.equal(budget35.recommendedSubagentModel, 'argon');

      const prefResult = JSON.parse(
        (ndjsonSession.responses[3].result as { content: Array<{ text: string }> }).content[0].text
      ) as { ok: boolean; config: PulseUserConfig; sidecarPill: string };
      assert.equal(prefResult.ok, true);
      assert.equal(prefResult.config.inlineStampMode, 'every-turn');
      assert.equal(prefResult.config.hudSortMode, 'topology-tree');

      // Cross-surface verification: CLI config get & hook-probe PostInvocation see MCP update
      const cliCfgMode = execFileSync(
        process.execPath,
        [cliPath, 'config', 'get', 'inlineStampMode'],
        { encoding: 'utf8', env: cliEnv }
      ).trim();
      assert.equal(cliCfgMode, 'every-turn');

      const post3 = runHookProbe(stateDir, {
        hookEventName: 'PostInvocation',
        conversationId: ROOT_CID,
        invocationNum: 3,
      }) as { injectSteps?: Array<{ systemMessage?: { systemMessage?: string; metadata?: { user_markdown?: string } } }> };
      assert.ok(post3.injectSteps && post3.injectSteps.length === 1);
      assert.ok((post3.injectSteps[0].systemMessage?.metadata?.user_markdown ?? '').includes(CANONICAL_HUD_URI));

      const cardResult = JSON.parse(
        (ndjsonSession.responses[4].result as { content: Array<{ text: string }> }).content[0].text
      ) as {
        ok: boolean;
        conversationId: string;
        outputPath: string;
        fileUri: string;
        embedTag: string;
        sidecarPill: string;
        nodeCount: number;
      };
      assert.equal(cardResult.ok, true);
      assert.equal(cardResult.conversationId, ROOT_CID);
      assert.equal(cardResult.sidecarPill, `[Model Pulse](${CANONICAL_HUD_URI})`);
      assert.equal(cardResult.embedTag, `<agent-embed src="${cardResult.fileUri}"></agent-embed>`);
      assert.ok(cardResult.nodeCount >= 2);
      assert.equal(existsSync(cardResult.outputPath), true);
      const cardHtml = readFileSync(cardResult.outputPath, 'utf8');
      assert.ok(cardHtml.includes('data-theme="dark"'));
      assert.ok(cardHtml.includes('Gemini 4 Carbon'));
      assert.equal(/<script\b/i.test(cardHtml), false);
      assert.equal(/https?:\/\//i.test(cardHtml), false);

      // 4B. MCP over Content-Length stdio with chunked UTF-8 + live LS quota < 25% -> flash
      mockLs.setQuotaFraction(0.2);
      const clSession = await runMcpStdioSession({
        framing: 'content-length',
        chunkSize: 11,
        env: {
          ANTIGRAVITY_PULSE_STATE_DIR: stateDir,
          ANTIGRAVITY_LS_ADDRESS: `http://${mockLs.address}`,
          ANTIGRAVITY_CSRF_TOKEN: CSRF_TOKEN,
        },
        requests: [
          {
            jsonrpc: '2.0',
            id: 'init-utf8',
            method: 'initialize',
            params: { clientInfo: { name: 'antigravity-中文客户端 🚀' } },
          },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          {
            jsonrpc: '2.0',
            id: 10,
            method: 'tools/call',
            params: { name: 'pulse_get_compute_budget', arguments: { conversationId: ROOT_CID } },
          },
          {
            jsonrpc: '2.0',
            id: 11,
            method: 'tools/call',
            params: { name: 'pulse_status_card', arguments: { conversationId: '../evil' } },
          },
        ],
      });
      assert.equal(clSession.stderr, '');
      assert.equal(clSession.responses.length, 3);

      const budget20 = JSON.parse(
        (clSession.responses[1].result as { content: Array<{ text: string }> }).content[0].text
      ) as ComputeBudgetAdvice;
      assert.equal(budget20.quota.gemini5hRemainingPct, 20);
      assert.equal(budget20.recommendedSubagentModel, 'flash');

      const traversalRes = clSession.responses[2].result as { isError?: boolean };
      assert.equal(traversalRes.isError, true);

      // Confirm zero forbidden GetCascadeTrajectory RPCs occurred across the entire live run
      assert.equal(
        mockLs.calls.some((c) => c.method === 'GetCascadeTrajectory'),
        false
      );
    } finally {
      await stopChild(sidecarChild);
      await mockLs.close();
    }
  });
});
