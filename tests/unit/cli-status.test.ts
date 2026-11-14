import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadCliTelemetry } from '../../src/cli/snapshot-reader';
import {
  formatStatusJson,
  formatStatusText,
  formatStatusTmux,
  formatStatusWaybar,
  runStatusCommand,
} from '../../src/cli/status-formatter';
import { buildFleetSnapshot } from '../../src/core/fleet-builder';
import { buildModelCatalog, decodeModelDescriptor } from '../../src/core/model-catalog';
import {
  writeJsonAtomic,
  type LiveSnapshotFile,
  type QuotaCacheFile,
} from '../../src/state/state-dir';
import type {
  CascadeNodeView,
  ModelTier,
  QuotaBucketView,
  QuotaSummaryView,
} from '../../src/types/telemetry';

const tempDirs: string[] = [];
const SAVED_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'ANTIGRAVITY_LS_ADDRESS',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ANTIGRAVITY_CONVERSATION_ID',
  'ANTIGRAVITY_PULSE_STATE_DIR',
];
const EMPTY_CATALOG = buildModelCatalog(null);

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pulse-cli-status-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    SAVED_ENV[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (SAVED_ENV[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = SAVED_ENV[key];
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeServedModel(
  displayName = 'Claude Sonnet 4.6 (Thinking)',
  tier: ModelTier = 'workhorse'
): CascadeNodeView['servedModel'] {
  const decoded = decodeModelDescriptor('MODEL_PLACEHOLDER_M26', EMPTY_CATALOG);
  return {
    responseModel: 'MODEL_PLACEHOLDER_M26',
    displayName,
    modelEnum: decoded?.modelEnum ?? 'MODEL_PLACEHOLDER_M26',
    family: decoded?.family ?? 'claude',
    effortTier: decoded?.effortTier ?? 'high',
    tier,
  };
}

function makeBucket(
  remainingPct: number,
  displayName: string,
  resetInLabel: string,
  window: '5h' | 'weekly' = '5h'
): QuotaBucketView {
  return {
    bucketId: `${displayName.toLowerCase().replace(/\s+/g, '-')}-${window}`,
    displayName,
    window,
    remainingFraction: remainingPct / 100,
    remainingPct,
    resetTime: new Date(Date.now() + 3 * 3600_000).toISOString(),
    resetInSeconds: 3 * 3600,
    resetInLabel,
    isLowAlert: remainingPct < 25,
  };
}

function makeQuota(gemini5hPct = 82.4): QuotaSummaryView {
  return {
    fetchedAt: new Date().toISOString(),
    buckets: [],
    gemini5h: makeBucket(gemini5hPct, 'Gemini 3.1 Pro', '3h 12m', '5h'),
    geminiWeekly: makeBucket(91, 'Gemini 3.1 Pro', '5d 0h', 'weekly'),
    thirdParty5h: makeBucket(88, 'Claude Sonnet 4.6', '3h 0m', '5h'),
    thirdPartyWeekly: makeBucket(92, 'Claude Sonnet 4.6', '5d 0h', 'weekly'),
    treeNetDelta5hPct: -0.042,
    burnRate5hPctPerMin: 0.25,
  };
}

function makeNode(overrides: Partial<CascadeNodeView> = {}): CascadeNodeView {
  const servedModel = overrides.servedModel ?? makeServedModel();
  const base: CascadeNodeView = {
    cascadeId: '11111111-1111-4111-8111-111111111111',
    parentCascadeId: null,
    rootCascadeId: '11111111-1111-4111-8111-111111111111',
    kind: 'root',
    depth: 0,
    spawnStepIndex: null,
    title: 'Main Task [Security]',
    role: 'Orchestrator',
    typeName: null,
    childrenIds: [],
    phase: 'THINKING',
    phaseStartedAt: new Date().toISOString(),
    status: 'CASCADE_RUN_STATUS_RUNNING',
    requestedModel: {
      raw: 'MODEL_PLACEHOLDER_M26',
      displayName: servedModel.displayName,
      modelId: servedModel.modelEnum,
      source: 'user',
    },
    servedModel,
    routingStatus: 'matched',
    stepCount: 12,
    turnCount: 3,
    lastTool: {
      name: 'read_file',
      summary: 'src/cli/main.ts',
    },
    phaseElapsedMs: 4200,
    lastTtftMs: 420,
    lastStreamingMs: 1800,
    streamingTokPerSec: 65,
    contextWindow: {
      estimatedTokensUsed: 48_000,
      maxContextTokens: 200_000,
      pct: 24,
      level: 'normal',
    },
    tokens: {
      inputTokens: 8_000,
      cacheReadTokens: 40_000,
      outputTokens: 1_200,
      thinkingOutputTokens: 400,
      responseOutputTokens: 800,
    },
    cacheHitPct: 83.33,
    retryCount: 0,
    deltaQuota5hPct: -0.042,
    lastModifiedTime: new Date().toISOString(),
  };
  return {
    ...base,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<LiveSnapshotFile> = {}): LiveSnapshotFile {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const rootNode = makeNode();
  const nodesByCascadeId = overrides.nodesByCascadeId ?? {
    [rootNode.cascadeId]: rootNode,
  };
  const quota = overrides.quota !== undefined ? overrides.quota : makeQuota(82.4);
  const fleetCore = buildFleetSnapshot({
    nowMs,
    hostConnected: overrides.hostConnected ?? true,
    trajectories: {},
    nodesByCascadeId,
    quota,
    cascadeBaselines: {},
  });
  return {
    schemaVersion: 1,
    updatedAt: nowIso,
    hostConnected: true,
    activeConversationId: rootNode.cascadeId,
    quota,
    nodesByCascadeId,
    fleet: {
      etag: 'fleet-etag-1',
      ...fleetCore,
    },
    ...overrides,
  };
}

function collectStream(): { stream: PassThrough; readText: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => {
    chunks.push(Buffer.from(chunk));
  });
  return {
    stream,
    readText: () => Buffer.concat(chunks).toString('utf8'),
  };
}

describe('cli status formatters & watch loop', () => {
  it('formats waybar JSON cleanly across all 5 status classes and missing state', async () => {
    const dir = createTempDir();

    // 1) Missing stateDir -> disconnected gracefully, exit 0
    const missingDir = path.join(dir, 'nonexistent');
    const missingOut = collectStream();
    const missingErr = collectStream();
    const exitMissing = await runStatusCommand(
      ['--format', 'waybar', '--state-dir', missingDir],
      {
        stdout: missingOut.stream,
        stderr: missingErr.stream,
        lsEnv: { address: '', csrfToken: '' },
      }
    );
    assert.equal(exitMissing, 0);
    assert.equal(missingErr.readText(), '');
    const missingLines = missingOut.readText().trim().split('\n');
    assert.equal(missingLines.length, 1);
    const missingJson = JSON.parse(missingLines[0]);
    assert.equal(missingJson.class, 'disconnected');
    assert.equal(missingJson.percentage, 0);
    assert.match(missingJson.text, /Offline/);

    // 2) Active with subagent -> class 'active', integer percentage
    const activeStateDir = path.join(dir, 'active');
    const root = makeNode({ phase: 'TOOL_RUNNING' });
    const sub = makeNode({
      cascadeId: '22222222-2222-4222-8222-222222222222',
      parentCascadeId: root.cascadeId,
      rootCascadeId: root.cascadeId,
      kind: 'subagent',
      depth: 1,
      role: 'Scout',
      phase: 'STREAMING',
      servedModel: makeServedModel('Gemini 3 Flash', 'fast'),
    });
    writeJsonAtomic(
      path.join(activeStateDir, 'live-snapshot.json'),
      makeSnapshot({
        quota: makeQuota(81.6),
        nodesByCascadeId: { [root.cascadeId]: root, [sub.cascadeId]: sub },
      })
    );
    const activeView = await loadCliTelemetry({
      stateDir: activeStateDir,
      lsEnv: { address: '', csrfToken: '' },
    });
    const activeWaybar = formatStatusWaybar(activeView);
    assert.equal(activeWaybar.class, 'active');
    assert.equal(activeWaybar.percentage, 82);
    assert.match(activeWaybar.text, /\+1 sub/);
    assert.match(activeWaybar.tooltip, /➔/);
    assert.match(activeWaybar.tooltip, /CTX:/);

    // 3) Idle -> class 'idle'
    writeJsonAtomic(
      path.join(activeStateDir, 'live-snapshot.json'),
      makeSnapshot({
        nodesByCascadeId: { [root.cascadeId]: makeNode({ phase: 'IDLE' }) },
      })
    );
    const idleWaybar = formatStatusWaybar(
      await loadCliTelemetry({
        stateDir: activeStateDir,
        lsEnv: { address: '', csrfToken: '' },
      })
    );
    assert.equal(idleWaybar.class, 'idle');

    // 4) Warning via BLOCKED_APPROVAL and 5h < 25%
    writeJsonAtomic(
      path.join(activeStateDir, 'live-snapshot.json'),
      makeSnapshot({
        quota: makeQuota(22.1),
        nodesByCascadeId: {
          [root.cascadeId]: makeNode({ phase: 'BLOCKED_APPROVAL' }),
        },
      })
    );
    const warnWaybar = formatStatusWaybar(
      await loadCliTelemetry({
        stateDir: activeStateDir,
        lsEnv: { address: '', csrfToken: '' },
      })
    );
    assert.equal(warnWaybar.class, 'warning');

    // 5) Alert via quota < 15% and CTX >= 85%
    writeJsonAtomic(
      path.join(activeStateDir, 'live-snapshot.json'),
      makeSnapshot({
        quota: makeQuota(11.4),
        nodesByCascadeId: {
          [root.cascadeId]: makeNode({
            contextWindow: {
              estimatedTokensUsed: 176_000,
              maxContextTokens: 200_000,
              pct: 88,
              level: 'critical_85',
            },
          }),
        },
      })
    );
    const alertWaybar = formatStatusWaybar(
      await loadCliTelemetry({
        stateDir: activeStateDir,
        lsEnv: { address: '', csrfToken: '' },
      })
    );
    assert.equal(alertWaybar.class, 'alert');
    assert.equal(alertWaybar.percentage, 11);

    // 6) Stale snapshot (> 30s) -> disconnected
    const staleIso = new Date(Date.now() - 45_000).toISOString();
    writeJsonAtomic(
      path.join(activeStateDir, 'live-snapshot.json'),
      makeSnapshot({ updatedAt: staleIso })
    );
    const staleView = await loadCliTelemetry({
      stateDir: activeStateDir,
      lsEnv: { address: '', csrfToken: '' },
    });
    assert.equal(staleView.stale, true);
    assert.equal(staleView.statusClass, 'disconnected');

    // 7) Missing live-snapshot.json with quota-cache.json fallback
    const cacheOnlyDir = path.join(dir, 'cache-only');
    const cacheFile: QuotaCacheFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      quota: makeQuota(64.2),
      cascadeBaselines: {},
    };
    writeJsonAtomic(path.join(cacheOnlyDir, 'quota-cache.json'), cacheFile);
    const cacheView = await loadCliTelemetry({
      stateDir: cacheOnlyDir,
      lsEnv: { address: '', csrfToken: '' },
    });
    assert.equal(cacheView.source, 'cache-only');
    assert.equal(cacheView.statusClass, 'disconnected');
    assert.equal(formatStatusWaybar(cacheView).percentage, 64);
  });

  it('formats tmux color tags across tiers and sanitizes brackets/hashes', async () => {
    const dir = createTempDir();
    const tiers: Array<{ tier: ModelTier; hex: string }> = [
      { tier: 'apex', hex: '#8b7ec8' },
      { tier: 'workhorse', hex: '#4385be' },
      { tier: 'fast', hex: '#3aa99f' },
      { tier: 'orchestrator', hex: '#d0a215' },
      { tier: 'alert', hex: '#d14d41' },
    ];

    for (const item of tiers) {
      const node = makeNode({
        servedModel: makeServedModel(`Model#[${item.tier}]`, item.tier),
      });
      writeJsonAtomic(
        path.join(dir, 'live-snapshot.json'),
        makeSnapshot({ nodesByCascadeId: { [node.cascadeId]: node } })
      );
      const view = await loadCliTelemetry({
        stateDir: dir,
        lsEnv: { address: '', csrfToken: '' },
      });
      const tmux = formatStatusTmux(view);
      assert.ok(!tmux.includes('\n'));
      assert.ok(tmux.includes(`#[fg=${item.hex},bold]`));
      assert.ok(!tmux.includes('Model#['));
    }

    writeJsonAtomic(
      path.join(dir, 'live-snapshot.json'),
      makeSnapshot({ hostConnected: false })
    );
    const offlineTmux = formatStatusTmux(
      await loadCliTelemetry({
        stateDir: dir,
        lsEnv: { address: '', csrfToken: '' },
      })
    );
    assert.ok(offlineTmux.includes('#[fg=#878580]'));
    assert.ok(offlineTmux.includes('offline'));
  });

  it('formats exact json schema and text output and validates bad CLI flags', async () => {
    const dir = createTempDir();
    writeJsonAtomic(path.join(dir, 'live-snapshot.json'), makeSnapshot());
    const view = await loadCliTelemetry({
      stateDir: dir,
      lsEnv: { address: '', csrfToken: '' },
    });

    const pretty = formatStatusJson(view, true);
    const compact = formatStatusJson(view, false);
    assert.ok(pretty.includes('\n'));
    assert.ok(!compact.includes('\n'));

    const parsed = JSON.parse(pretty);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.hostConnected, true);
    assert.equal(parsed.statusClass, 'active');
    assert.equal(parsed.activeConversationId, view.activeConversationId);
    assert.ok(Array.isArray(parsed.treeNodes));
    assert.ok(Array.isArray(parsed.warnings));

    const text = formatStatusText(view);
    assert.ok(!text.includes('\n'));
    assert.match(text, /Claude|Sonnet/);
    assert.match(text, /5h:/);

    const errOut = collectStream();
    const out = collectStream();
    const badUuidCode = await runStatusCommand(
      ['--conversation', 'invalid-uuid'],
      { stdout: out.stream, stderr: errOut.stream, stateDir: dir }
    );
    assert.equal(badUuidCode, 2);
    assert.match(errOut.readText(), /Invalid --conversation/);

    const errFmt = collectStream();
    const badFmtCode = await runStatusCommand(
      ['--format', 'yaml'],
      { stdout: out.stream, stderr: errFmt.stream, stateDir: dir }
    );
    assert.equal(badFmtCode, 2);
    assert.match(errFmt.readText(), /Invalid --format/);
  });

  it('refreshes live read-only LS RPC using L-004 stepOffset only when RUNNING and falls back cleanly on RPC error', async () => {
    const dir = createTempDir();
    const cid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const seenMethods: string[] = [];
    let capturedStepsPayload: Record<string, unknown> | null = null;

    const mockFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      const method = urlStr.split('/').pop() ?? '';
      seenMethods.push(method);
      const bodyObj = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : {};

      if (method === 'GetCascadeModelConfigData') {
        return new Response(
          JSON.stringify({
            clientModelConfigs: [
              {
                label: 'Claude Opus 4.6 (Thinking)',
                modelOrAlias: { model: 'MODEL_PLACEHOLDER_M26' },
                supportsImages: true,
                maxTokens: 200000,
              },
            ],
            defaultOverrideModelConfig: {
              modelOrAlias: { model: 'MODEL_PLACEHOLDER_M26' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'RetrieveUserQuotaSummary') {
        return new Response(
          JSON.stringify({
            userTier: { id: 'pro', name: 'Pro' },
            quotaSummary: {
              remainingQuotaFraction: 0.77,
              resetTime: new Date(Date.now() + 3600_000).toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'GetAllCascadeTrajectories') {
        return new Response(
          JSON.stringify({
            trajectorySummaries: {
              [cid]: {
                summary: 'Live CLI Test',
                stepCount: 10,
                status: 'CASCADE_RUN_STATUS_RUNNING',
                lastModifiedTime: new Date().toISOString(),
                requestedModel: { model: 'MODEL_PLACEHOLDER_M26' },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
        return new Response(
          JSON.stringify({
            generatorMetadata: [
              {
                stepIndex: 9,
                chatModel: {
                  model: 'MODEL_PLACEHOLDER_M26',
                  usage: {
                    inputTokens: '4000',
                    outputTokens: '600',
                    cacheReadTokens: '16000',
                  },
                  responseModel: 'MODEL_PLACEHOLDER_M26',
                  retryInfos: [{ attempt: 1 }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (method === 'GetCascadeTrajectorySteps') {
        capturedStepsPayload = bodyObj;
        return new Response(
          JSON.stringify({
            steps: [
              {
                type: 'CORTEX_STEP_TYPE_TOOL_CALL',
                status: 'CORTEX_STEP_STATUS_RUNNING',
                toolCall: {
                  name: 'run_command',
                  argumentsJson: '{"CommandLine":"npm test"}',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response('{}', { status: 404 });
    };

    const liveView = await loadCliTelemetry({
      stateDir: dir,
      live: true,
      conversationId: cid,
      lsEnv: {
        address: '127.0.0.1:41234',
        csrfToken: 'secret-csrf',
        antigravityDataDir: dir,
      },
      fetchFn: mockFetch,
    });

    assert.equal(liveView.source, 'live-ls');
    assert.equal(liveView.hostConnected, true);
    assert.ok(seenMethods.includes('GetCascadeTrajectorySteps'));
    assert.ok(capturedStepsPayload !== null);
    const verifiedStepsPayload: Record<string, unknown> = capturedStepsPayload;
    assert.equal(verifiedStepsPayload.stepOffset, 6);
    assert.equal(verifiedStepsPayload.disableRehydration, true);
    assert.equal('startIndex' in verifiedStepsPayload, false);

    // Fallback to cached snapshot when RPC fails
    writeJsonAtomic(path.join(dir, 'live-snapshot.json'), makeSnapshot());
    const failingFetch: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const fallbackView = await loadCliTelemetry({
      stateDir: dir,
      live: true,
      lsEnv: {
        address: '127.0.0.1:41234',
        csrfToken: 'secret-csrf',
        antigravityDataDir: dir,
      },
      fetchFn: failingFetch,
    });
    assert.equal(fallbackView.source, 'snapshot');
    assert.equal(fallbackView.hostConnected, true);
  });

  it('streams deduplicated NDJSON updates in --watch mode and exits 0 cleanly on abort', async () => {
    const dir = createTempDir();
    const out = collectStream();
    const err = collectStream();
    const controller = new AbortController();

    writeJsonAtomic(
      path.join(dir, 'live-snapshot.json'),
      makeSnapshot({ quota: makeQuota(80) })
    );

    const watchPromise = runStatusCommand(
      ['--format', 'json', '--watch', '--interval', '200', '--state-dir', dir],
      {
        stdout: out.stream,
        stderr: err.stream,
        lsEnv: { address: '', csrfToken: '' },
        signal: controller.signal,
        registerProcessSignals: false,
      }
    );

    try {
      // Wait past one 200ms poll interval: duplicate must be suppressed
      await new Promise((r) => setTimeout(r, 300));
      const linesBeforeChange = out
        .readText()
        .trim()
        .split('\n')
        .filter(Boolean);
      assert.equal(linesBeforeChange.length, 1);
      const firstObj = JSON.parse(linesBeforeChange[0]);
      assert.equal(firstObj.quota.gemini5h.remainingPct, 80);

      // Update live-snapshot.json -> watcher / poll emits second NDJSON line
      writeJsonAtomic(
        path.join(dir, 'live-snapshot.json'),
        makeSnapshot({ quota: makeQuota(55) })
      );
      await new Promise((r) => setTimeout(r, 320));
    } finally {
      controller.abort();
    }

    const code = await watchPromise;
    assert.equal(code, 0);
    assert.equal(err.readText(), '');

    const allLines = out
      .readText()
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.ok(allLines.length >= 2, `Expected >=2 NDJSON lines, got ${allLines.length}`);
    const lastObj = JSON.parse(allLines[allLines.length - 1]);
    assert.equal(lastObj.quota.gemini5h.remainingPct, 55);
  });
});
