import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { CliTelemetryView } from '../../src/cli/snapshot-reader';
import {
  codePointDisplayWidth,
  displayWidth,
  renderTopFrame,
  runTopCommand,
} from '../../src/cli/top-tui';
import { buildFleetSnapshot } from '../../src/core/fleet-builder';
import { buildModelCatalog, decodeModelDescriptor } from '../../src/core/model-catalog';
import { DEFAULT_PULSE_USER_CONFIG } from '../../src/state/config-store';
import { writeJsonAtomic, type LiveSnapshotFile } from '../../src/state/state-dir';
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pulse-cli-top-'));
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

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

function makeServedModel(
  displayName = 'Claude Opus 4.6 (Thinking)',
  tier: ModelTier = 'apex'
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
    resetTime: new Date(Date.now() + 2 * 3600_000).toISOString(),
    resetInSeconds: 2 * 3600,
    resetInLabel,
    isLowAlert: remainingPct < 25,
  };
}

function makeQuota(gemini5hPct = 76.5): QuotaSummaryView {
  return {
    fetchedAt: new Date().toISOString(),
    buckets: [],
    gemini5h: makeBucket(gemini5hPct, 'Gemini 3.1 Pro', '2h 15m', '5h'),
    geminiWeekly: makeBucket(88, 'Gemini 3.1 Pro', '4d 0h', 'weekly'),
    thirdParty5h: makeBucket(84, 'Claude Sonnet 4.6', '2h 0m', '5h'),
    thirdPartyWeekly: makeBucket(90, 'Claude Sonnet 4.6', '4d 0h', 'weekly'),
    treeNetDelta5hPct: -0.125,
    burnRate5hPctPerMin: 0.4,
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
    title: 'Root Cascade',
    role: 'Architect',
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
    stepCount: 15,
    turnCount: 4,
    lastTool: {
      name: 'view_file',
      summary: 'src/cli/top-tui.ts',
    },
    phaseElapsedMs: 5100,
    lastTtftMs: 420,
    lastStreamingMs: 1800,
    streamingTokPerSec: 55,
    contextWindow: {
      estimatedTokensUsed: 64_000,
      maxContextTokens: 200_000,
      pct: 32,
      level: 'normal',
    },
    tokens: {
      inputTokens: 12_000,
      cacheReadTokens: 52_000,
      outputTokens: 2_400,
      thinkingOutputTokens: 900,
      responseOutputTokens: 1_500,
    },
    cacheHitPct: 81.25,
    retryCount: 0,
    deltaQuota5hPct: -0.125,
    lastModifiedTime: new Date().toISOString(),
  };
  return {
    ...base,
    ...overrides,
  };
}

function makeView(overrides: Partial<CliTelemetryView> = {}): CliTelemetryView {
  const root = makeNode();
  const subIdle = makeNode({
    cascadeId: '22222222-2222-4222-8222-222222222222',
    parentCascadeId: root.cascadeId,
    rootCascadeId: root.cascadeId,
    kind: 'subagent',
    depth: 1,
    spawnStepIndex: 2,
    role: 'IdleScout',
    phase: 'IDLE',
    status: 'CASCADE_RUN_STATUS_IDLE',
    servedModel: makeServedModel('Gemini 3 Flash', 'fast'),
    lastTool: null,
    phaseElapsedMs: 1200,
  });
  const subRunning = makeNode({
    cascadeId: '33333333-3333-4333-8333-333333333333',
    parentCascadeId: root.cascadeId,
    rootCascadeId: root.cascadeId,
    kind: 'subagent',
    depth: 1,
    spawnStepIndex: 5,
    role: 'HotRunner',
    phase: 'TOOL_RUNNING',
    status: 'CASCADE_RUN_STATUS_RUNNING',
    servedModel: makeServedModel('Claude Opus 4.6 (Thinking)', 'apex'),
    lastTool: {
      name: 'run_command',
      summary: 'npm run typecheck',
    },
    phaseElapsedMs: 3200,
  });

  const treeNodes = overrides.treeNodes ?? [root, subIdle, subRunning];
  const quota = overrides.quota !== undefined ? overrides.quota : makeQuota(76.5);
  const nodesMap = Object.fromEntries(treeNodes.map((n) => [n.cascadeId, n]));
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const fleetCore = buildFleetSnapshot({
    nowMs,
    hostConnected: overrides.hostConnected ?? true,
    trajectories: {},
    nodesByCascadeId: nodesMap,
    quota: quota ?? makeQuota(76.5),
    cascadeBaselines: {},
  });

  return {
    generatedAt: nowIso,
    stateDir: '/tmp/pulse-state-test',
    source: 'snapshot',
    snapshotUpdatedAt: nowIso,
    hostConnected: true,
    stale: false,
    staleAgeMs: 500,
    statusClass: 'active',
    activeConversationId: root.cascadeId,
    rootCascadeId: root.cascadeId,
    breadcrumb: [{ cascadeId: root.cascadeId, title: root.title, role: root.role }],
    activeNode: root,
    treeNodes,
    activeSubagentCount: 1,
    fleetHeadline: fleetCore.activeHeadline,
    fleet: {
      etag: 'fleet-etag-top',
      ...fleetCore,
    },
    quota,
    smartGovernanceBanner: {
      active: false,
      heavyConcurrentCount: 0,
      gemini5hRemainingPct: 76.5,
      estimatedBurnPctPerMin: 0.4,
      message: '',
    },
    config: DEFAULT_PULSE_USER_CONFIG,
    warnings: [],
    ...overrides,
  };
}

function collectStream(): { stream: PassThrough; readText: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  return {
    stream,
    readText: () => Buffer.concat(chunks).toString('utf8'),
  };
}

describe('cli top TUI renderer and once mode', () => {
  it('bounds every rendered line within 80x24 and 120x36 dimensions', () => {
    const view = makeView({
      smartGovernanceBanner: {
        active: true,
        heavyConcurrentCount: 3,
        gemini5hRemainingPct: 38.2,
        estimatedBurnPctPerMin: 0.9,
        message: '3 Apex agents active @ 38.2% 5h quota',
      },
    });

    for (const [cols, rows] of [
      [80, 24],
      [120, 36],
    ] as const) {
      const frame = renderTopFrame(view, { columns: cols, rows, noColor: false });
      const lines = frame.split('\n');
      assert.ok(lines.length <= rows, `Frame exceeded ${rows} rows: ${lines.length}`);
      for (const line of lines) {
        const visible = displayWidth(stripAnsi(line));
        assert.ok(
          visible <= cols,
          `Line display width ${visible} > ${cols}: ${stripAnsi(line)}`
        );
      }
      const plain = stripAnsi(frame);
      assert.match(plain, /Model Pulse/);
      assert.match(plain, /SMART GOVERNANCE: 3 Apex active/);
      assert.match(plain, /NODE \/ ROLE/);
      assert.match(plain, /\[q\] Quit/);
    }
  });

  it('orders rows differently between active-first and topology-tree modes', () => {
    const view = makeView();

    const activeFirst = stripAnsi(
      renderTopFrame(view, {
        columns: 120,
        rows: 30,
        sortMode: 'active-first',
        noColor: true,
      })
    );
    const topologyTree = stripAnsi(
      renderTopFrame(view, {
        columns: 120,
        rows: 30,
        sortMode: 'topology-tree',
        noColor: true,
      })
    );

    const activeHotIdx = activeFirst.indexOf('HotRunner');
    const activeIdleIdx = activeFirst.indexOf('IdleScout');
    assert.ok(activeHotIdx !== -1 && activeIdleIdx !== -1);
    assert.ok(
      activeHotIdx < activeIdleIdx,
      'active-first must promote running HotRunner above IdleScout'
    );

    assert.ok(topologyTree.includes('└ IdleScout'));
    assert.ok(topologyTree.includes('└ HotRunner'));
  });

  it('emits zero ANSI escape codes under noColor / NO_COLOR and supports scrollOffset', () => {
    const root = makeNode({ cascadeId: '00000000-0000-4000-8000-000000000000' });
    const manyNodes: CascadeNodeView[] = [root];
    for (let i = 1; i <= 12; i++) {
      manyNodes.push(
        makeNode({
          cascadeId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          parentCascadeId: root.cascadeId,
          rootCascadeId: root.cascadeId,
          kind: 'subagent',
          depth: 1,
          spawnStepIndex: i,
          role: `Worker_${String(i).padStart(2, '0')}`,
          phase: 'STREAMING',
        })
      );
    }

    const view = makeView({ treeNodes: manyNodes });
    const noColorFrame = renderTopFrame(view, {
      columns: 100,
      rows: 20,
      sortMode: 'topology-tree',
      scrollOffset: 4,
      noColor: true,
    });
    assert.equal(/\x1b\[/.test(noColorFrame), false);
    assert.ok(noColorFrame.includes('Worker_04'));
    assert.equal(noColorFrame.includes('Worker_01'), false);

    // NO_COLOR env support when --no-color not explicitly passed
    const prevNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      const envFrame = renderTopFrame(view, { columns: 100, rows: 20 });
      assert.equal(/\x1b\[/.test(envFrame), false);
    } finally {
      if (prevNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = prevNoColor;
      }
    }
  });

  it('renders empty/offline guidance box cleanly when no telemetry exists', () => {
    const emptyView = makeView({
      source: 'none',
      hostConnected: false,
      stale: false,
      statusClass: 'disconnected',
      activeConversationId: null,
      rootCascadeId: null,
      activeNode: null,
      treeNodes: [],
      activeSubagentCount: 0,
      quota: null,
    });

    const frame = stripAnsi(
      renderTopFrame(emptyView, { columns: 100, rows: 24, noColor: true })
    );
    assert.match(frame, /OFFLINE/);
    assert.match(frame, /No active Antigravity telemetry snapshot/);
    assert.match(frame, /Open Model Pulse sidecar/);
  });

  it('runs --once without alt-screen escape sequences and validates bad flags', async () => {
    const dir = createTempDir();
    const root = makeNode();
    const nodesByCascadeId = { [root.cascadeId]: root };
    const quota = makeQuota(75);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const snap: LiveSnapshotFile = {
      schemaVersion: 1,
      updatedAt: nowIso,
      hostConnected: true,
      activeConversationId: root.cascadeId,
      quota,
      nodesByCascadeId,
      fleet: {
        etag: 'fleet-once',
        ...buildFleetSnapshot({
          nowMs,
          hostConnected: true,
          trajectories: {},
          nodesByCascadeId,
          quota,
          cascadeBaselines: {},
        }),
      },
    };
    writeJsonAtomic(path.join(dir, 'live-snapshot.json'), snap);

    const out = collectStream();
    const err = collectStream();
    const code = await runTopCommand(
      ['--once', '--no-color', '--state-dir', dir],
      {
        stdout: out.stream,
        stderr: err.stream,
        lsEnv: { address: '', csrfToken: '' },
        registerProcessSignals: false,
      }
    );
    assert.equal(code, 0);
    assert.equal(err.readText(), '');
    const printed = out.readText();
    assert.equal(printed.includes('\x1b[?1049h'), false);
    assert.equal(/\x1b\[/.test(printed), false);
    assert.match(printed, /Model Pulse/);
    assert.match(printed, /Architect/);

    const errBad = collectStream();
    const badCode = await runTopCommand(
      ['--sort', 'random'],
      { stdout: out.stream, stderr: errBad.stream, registerProcessSignals: false }
    );
    assert.equal(badCode, 2);
    assert.match(errBad.readText(), /Invalid --sort/);
  });

  it('aligns CJK and emoji rows identically to ASCII rows by display width at columns=80', () => {
    assert.equal(displayWidth('产品设计分阶段实施规划'), 22);
    assert.equal(displayWidth('🚀🔧'), 4);
    assert.equal(displayWidth('e\u0301'), 1);
    assert.equal(codePointDisplayWidth(0x00), 0);

    const root = makeNode({
      title: '产品设计分阶段实施规划',
      role: '产品设计分阶段实施规划',
      servedModel: makeServedModel('Claude Opus 4.6 (Thinking)', 'apex'),
    });
    const cjkSub = makeNode({
      cascadeId: '44444444-4444-4444-8444-444444444444',
      parentCascadeId: root.cascadeId,
      rootCascadeId: root.cascadeId,
      kind: 'subagent',
      depth: 1,
      spawnStepIndex: 1,
      title: '中文子代理🚀测试名称',
      role: '中文子代理🚀测试名称',
      phase: 'STREAMING',
      servedModel: makeServedModel('Gemini 3 Flash', 'fast'),
      lastTool: { name: 'read_file', summary: 'docs/计划.md' },
    });
    const asciiSub = makeNode({
      cascadeId: '55555555-5555-4555-8555-555555555555',
      parentCascadeId: root.cascadeId,
      rootCascadeId: root.cascadeId,
      kind: 'subagent',
      depth: 1,
      spawnStepIndex: 2,
      title: 'ASCIIWorker',
      role: 'ASCIIWorker',
      phase: 'TOOL_RUNNING',
      servedModel: makeServedModel('Gemini 3 Flash', 'fast'),
      lastTool: { name: 'grep_search', summary: 'src/cli/top-tui.ts' },
    });

    const view = makeView({
      activeNode: root,
      treeNodes: [root, cjkSub, asciiSub],
    });

    for (const noColor of [true, false]) {
      const frame = renderTopFrame(view, {
        columns: 80,
        rows: 24,
        sortMode: 'topology-tree',
        noColor,
      });
      const lines = frame.split('\n');
      assert.ok(lines.length <= 24);
      for (const line of lines) {
        const plain = stripAnsi(line);
        assert.ok(
          displayWidth(plain) <= 80,
          `Line display width exceeded 80 (${displayWidth(plain)}): ${plain}`
        );
      }

      const plainLines = lines.map(stripAnsi);
      const headerIdx = plainLines.findIndex((l) => l.includes('SERVED MODEL'));
      assert.ok(headerIdx >= 0);
      const headerLine = plainLines[headerIdx];
      const tableLines = plainLines.slice(headerIdx + 1);
      const rootLine = tableLines.find((l) => l.includes('产品'));
      const cjkLine = tableLines.find((l) => l.includes('中文'));
      const asciiLine = tableLines.find((l) => l.includes('ASCII'));
      assert.ok(rootLine && cjkLine && asciiLine);

      const headerModelCol = displayWidth(
        headerLine.slice(0, headerLine.indexOf('SERVED MODEL'))
      );
      const headerCtxPctCol = displayWidth(
        headerLine.slice(0, headerLine.indexOf('CTX%') + 3)
      );
      const rootCtxCol = displayWidth(rootLine.slice(0, rootLine.indexOf('%')));
      const cjkCtxCol = displayWidth(cjkLine.slice(0, cjkLine.indexOf('%')));
      const asciiCtxCol = displayWidth(asciiLine.slice(0, asciiLine.indexOf('%')));
      const cjkModelCol = displayWidth(cjkLine.slice(0, cjkLine.indexOf('Flash')));
      const asciiModelCol = displayWidth(asciiLine.slice(0, asciiLine.indexOf('Flash')));
      assert.equal(cjkModelCol, headerModelCol);
      assert.equal(asciiModelCol, headerModelCol);
      assert.equal(rootCtxCol, headerCtxPctCol);
      assert.equal(cjkCtxCol, headerCtxPctCol);
      assert.equal(asciiCtxCol, headerCtxPctCol);
    }
  });

  it('respects COLUMNS and LINES env variables in non-TTY --once output', async () => {
    const dir = createTempDir();
    const root = makeNode();
    const nodesByCascadeId = { [root.cascadeId]: root };
    const quota = makeQuota(75);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const snap: LiveSnapshotFile = {
      schemaVersion: 1,
      updatedAt: nowIso,
      hostConnected: true,
      activeConversationId: root.cascadeId,
      quota,
      nodesByCascadeId,
      fleet: {
        etag: 'fleet-env-dims',
        ...buildFleetSnapshot({
          nowMs,
          hostConnected: true,
          trajectories: {},
          nodesByCascadeId,
          quota,
          cascadeBaselines: {},
        }),
      },
    };
    writeJsonAtomic(path.join(dir, 'live-snapshot.json'), snap);

    const prevColumns = process.env.COLUMNS;
    const prevLines = process.env.LINES;
    try {
      process.env.COLUMNS = '80';
      process.env.LINES = '24';
      const out80 = collectStream();
      assert.equal(
        await runTopCommand(['--once', '--no-color', '--state-dir', dir], {
          stdout: out80.stream,
          stderr: collectStream().stream,
          lsEnv: { address: '', csrfToken: '' },
          registerProcessSignals: false,
        }),
        0
      );
      const lines80 = out80.readText().replace(/\n$/, '').split('\n');
      assert.equal(lines80.length, 24);
      assert.ok(lines80.includes('─'.repeat(80)));
      for (const line of lines80) {
        assert.ok(displayWidth(line) <= 80);
      }

      process.env.COLUMNS = '120';
      process.env.LINES = '36';
      const out120 = collectStream();
      assert.equal(
        await runTopCommand(['--once', '--no-color', '--state-dir', dir], {
          stdout: out120.stream,
          stderr: collectStream().stream,
          lsEnv: { address: '', csrfToken: '' },
          registerProcessSignals: false,
        }),
        0
      );
      const lines120 = out120.readText().replace(/\n$/, '').split('\n');
      assert.equal(lines120.length, 36);
      assert.ok(lines120.includes('─'.repeat(120)));
      for (const line of lines120) {
        assert.ok(displayWidth(line) <= 120);
      }

      process.env.COLUMNS = 'invalid';
      process.env.LINES = '-5';
      const outFallback = collectStream();
      assert.equal(
        await runTopCommand(['--once', '--no-color', '--state-dir', dir], {
          stdout: outFallback.stream,
          stderr: collectStream().stream,
          lsEnv: { address: '', csrfToken: '' },
          registerProcessSignals: false,
        }),
        0
      );
      const linesFallback = outFallback.readText().replace(/\n$/, '').split('\n');
      assert.equal(linesFallback.length, 24);
      assert.ok(linesFallback.includes('─'.repeat(100)));
    } finally {
      if (prevColumns === undefined) {
        delete process.env.COLUMNS;
      } else {
        process.env.COLUMNS = prevColumns;
      }
      if (prevLines === undefined) {
        delete process.env.LINES;
      } else {
        process.env.LINES = prevLines;
      }
    }
  });
});
