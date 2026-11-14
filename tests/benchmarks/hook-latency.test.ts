import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { processHookPayload } from '../../src/hook/hook-probe';
import { saveConfig, DEFAULT_PULSE_USER_CONFIG } from '../../src/state/config-store';
import {
  getStatePaths,
  writeJsonAtomic,
  type LiveSnapshotFile,
  type ModelMapFile,
} from '../../src/state/state-dir';
import type { CascadeNodeView, QuotaSummaryView } from '../../src/types/telemetry';

const REPO_ROOT = existsSync(path.resolve(__dirname, '..', 'package.json'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '../..');

const tempDirs: string[] = [];

function makeTempDir(prefix = 'pulse-hook-bench-'): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function percentile(sorted: number[], p: number): number {
  assert.ok(sorted.length > 0, 'Cannot compute percentile of empty array');
  if (p === 0.5) {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function seedRealisticStateDir(stateDir: string, cid: string): void {
  const paths = getStatePaths(stateDir);
  saveConfig({ ...DEFAULT_PULSE_USER_CONFIG, inlineStampMode: 'smart' }, stateDir);

  const modelMap: ModelMapFile = {
    schemaVersion: 1,
    updatedAt: '2026-11-14T10:00:00.000Z',
    defaultModelEnum: 'MODEL_PLACEHOLDER_M427',
    modelsByEnum: {
      MODEL_PLACEHOLDER_M427: {
        modelEnum: 'MODEL_PLACEHOLDER_M427',
        modelId: 'gemini-4-carbon-high',
        label: 'Gemini 4 Carbon (High)',
        family: 'gemini',
        effortTier: 'high',
        tier: 'apex',
        isOrchestrator: false,
      },
    },
  };
  writeJsonAtomic(paths.modelMap, modelMap);

  const quota: QuotaSummaryView = {
    fetchedAt: '2026-11-14T10:00:00.000Z',
    buckets: [],
    gemini5h: {
      bucketId: 'gemini-5h',
      displayName: 'Gemini 5h',
      window: '5h',
      remainingFraction: 0.843,
      remainingPct: 84.3,
      resetTime: '2026-11-14T15:00:00.000Z',
      resetInSeconds: 7200,
      resetInLabel: '2h 0m',
      isLowAlert: false,
    },
    geminiWeekly: null,
    thirdParty5h: null,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: 0.42,
    burnRate5hPctPerMin: null,
  };

  const node: CascadeNodeView = {
    cascadeId: cid,
    rootCascadeId: cid,
    parentCascadeId: null,
    kind: 'root',
    title: 'Benchmark Cascade',
    role: null,
    typeName: null,
    depth: 0,
    status: 'CASCADE_RUN_STATUS_RUNNING',
    phase: 'STREAMING',
    phaseStartedAt: '2026-11-14T10:00:00.000Z',
    phaseElapsedMs: 2500,
    requestedModel: {
      raw: 'MODEL_PLACEHOLDER_M427',
      displayName: 'Gemini 4 Carbon (High)',
      modelId: 'gemini-4-carbon-high',
      source: 'user',
    },
    servedModel: {
      responseModel: 'gemini-4-carbon',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier: 'apex',
    },
    routingStatus: 'matched',
    retryCount: 0,
    lastTool: null,
    stepCount: 8,
    turnCount: 2,
    streamingTokPerSec: 46,
    contextWindow: {
      estimatedTokensUsed: 40_000,
      maxContextTokens: 256_000,
      pct: 15.6,
      level: 'normal',
    },
    cacheHitPct: 91.8,
    tokens: {
      inputTokens: 1000,
      cacheReadTokens: 11200,
      outputTokens: 600,
      thinkingOutputTokens: 350,
      responseOutputTokens: 250,
    },
    deltaQuota5hPct: 0.42,
    lastTtftMs: 12_100,
    lastStreamingMs: 4_100,
    lastModifiedTime: '2026-11-14T10:00:00.000Z',
    spawnStepIndex: null,
    childrenIds: [],
  };

  const snapshot: LiveSnapshotFile = {
    schemaVersion: 1,
    updatedAt: '2026-11-14T10:00:00.000Z',
    hostConnected: true,
    activeConversationId: cid,
    nodesByCascadeId: { [cid]: node },
    fleet: {
      etag: 'bench1',
      generatedAt: '2026-11-14T10:00:00.000Z',
      hostConnected: true,
      activeHeadline: {
        runningRoots: 1,
        runningSubagents: 0,
        totalRunningNodes: 1,
        modelHistogram: [],
      },
      projects: [],
      topQuotaBurners: [],
      quota,
    },
    quota,
  };
  writeJsonAtomic(paths.liveSnapshot, snapshot);
}

describe('Dual-metric honest hook latency benchmarks (D-004, RTM-24)', () => {
  it('Metric 1: in-process JS processHookPayload x100 stays <= 8.0ms (median & p95) with zero network I/O', () => {
    const stateDir = makeTempDir('pulse-bench-inproc-');
    const cid = '198d5aa0-44bb-4273-9a52-b83805a34a3a';
    seedRealisticStateDir(stateDir, cid);

    // Static zero-network verification on hook source
    const hookSrc = readFileSync(path.join(REPO_ROOT, 'src/hook/hook-probe.ts'), 'utf8');
    for (const forbidden of [
      "from 'node:http'",
      "from 'http'",
      "from 'node:https'",
      "from 'https'",
      "from 'node:net'",
      "from 'net'",
      "from 'node:dgram'",
      "from 'dgram'",
      'fetch(',
    ]) {
      assert.equal(hookSrc.includes(forbidden), false, `Forbidden network primitive in hook-probe.ts: ${forbidden}`);
    }

    const durationsMs: number[] = [];
    for (let i = 1; i <= 100; i += 1) {
      const payload =
        i % 2 === 1
          ? JSON.stringify({
              hookEventName: 'PreToolUse',
              conversationId: cid,
              invocationNum: Math.ceil(i / 2),
              model: 'MODEL_PLACEHOLDER_M427',
              toolName: 'run_command',
              toolCallId: `call-${i}`,
              toolInput: { CommandLine: 'npm run typecheck' },
            })
          : JSON.stringify({
              hookEventName: 'PostInvocation',
              conversationId: cid,
              invocationNum: Math.ceil(i / 2),
              model: 'MODEL_PLACEHOLDER_M427',
            });

      const t0 = process.hrtime.bigint();
      const res = processHookPayload(payload, { overrideStateDir: stateDir });
      const elapsedMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
      durationsMs.push(elapsedMs);

      if (i % 2 === 1) {
        assert.deepEqual(res.stdout, { decision: 'allow' });
      } else if (i === 2) {
        assert.equal(res.stamped, true);
      } else {
        assert.deepEqual(res.stdout, {});
      }
    }

    const sorted = [...durationsMs].sort((a, b) => a - b);
    const medianMs = percentile(sorted, 0.5);
    const p95Ms = percentile(sorted, 0.95);
    const maxMs = sorted[sorted.length - 1];
    console.log(
      `[bench] Metric 1 in-process JS (n=${durationsMs.length}): median=${medianMs.toFixed(3)}ms p95=${p95Ms.toFixed(3)}ms max=${maxMs.toFixed(3)}ms`
    );

    assert.ok(medianMs <= 8.0, `In-process median ${medianMs.toFixed(3)}ms exceeded 8.0ms`);
    assert.ok(p95Ms <= 8.0, `In-process p95 ${p95Ms.toFixed(3)}ms exceeded 8.0ms`);
  });

  it('Metric 2: OS fork+exec dist/hook-probe.cjs x10 stays within D-004/D-010 calibrated budget (<= max(50ms, bareNode+20ms), delta <= 20ms, <= 100ms) and exits 0', () => {
    const distHookProbe = path.join(REPO_ROOT, 'dist/hook-probe.cjs');
    assert.equal(existsSync(distHookProbe), true, `Missing prebuilt bundle: ${distHookProbe}`);

    const stateDir = makeTempDir('pulse-bench-spawn-');
    const cid = '198d5aa0-44bb-4273-9a52-b83805a34a3a';
    seedRealisticStateDir(stateDir, cid);
    const env = { ...process.env, ANTIGRAVITY_PULSE_STATE_DIR: stateDir };

    // Unmeasured warmup pair so OS page cache settles after parallel suites exit
    spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8', env });
    spawnSync(process.execPath, [distHookProbe], {
      input: '{"hookEventName":"PreToolUse"}',
      encoding: 'utf8',
      env,
    });

    const bareDurationsMs: number[] = [];
    const durationsMs: number[] = [];
    const pairedDeltasMs: number[] = [];
    for (let i = 1; i <= 10; i += 1) {
      const tBare0 = process.hrtime.bigint();
      const bareProc = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8', env });
      const bareElapsedMs = Number(process.hrtime.bigint() - tBare0) / 1_000_000;
      assert.equal(bareProc.status, 0, `bare node exited ${String(bareProc.status)}: ${bareProc.stderr}`);

      const isPreTool = i % 2 === 1;
      const stdinPayload = isPreTool
        ? JSON.stringify({
            hookEventName: 'PreToolUse',
            conversationId: cid,
            invocationNum: Math.ceil(i / 2),
            toolName: 'invoke_subagent',
            toolCallId: `spawn-call-${i}`,
            toolInput: { Role: 'Benchmark Worker', TypeName: 'self', Model: 'flash' },
          })
        : JSON.stringify({
            hookEventName: 'PostInvocation',
            conversationId: cid,
            invocationNum: Math.ceil(i / 2),
            model: 'MODEL_PLACEHOLDER_M427',
          });

      const t0 = process.hrtime.bigint();
      const proc = spawnSync(process.execPath, [distHookProbe], {
        input: stdinPayload,
        encoding: 'utf8',
        env,
      });
      const elapsedMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
      bareDurationsMs.push(bareElapsedMs);
      durationsMs.push(elapsedMs);
      pairedDeltasMs.push(elapsedMs - bareElapsedMs);

      assert.equal(proc.status, 0, `hook-probe.cjs exited ${String(proc.status)}: ${proc.stderr}`);
      const parsed = JSON.parse(proc.stdout.trim()) as Record<string, unknown>;
      if (isPreTool) {
        assert.deepEqual(parsed, { decision: 'allow' });
      } else if (i === 2) {
        assert.ok(Array.isArray(parsed.injectSteps), 'Expected Turn 1 injectSteps from PostInvocation');
      } else {
        assert.deepEqual(parsed, {});
      }
    }

    const sortedBare = [...bareDurationsMs].sort((a, b) => a - b);
    const sortedProbes = [...durationsMs].sort((a, b) => a - b);
    const sortedDeltas = [...pairedDeltasMs].sort((a, b) => a - b);
    const bareMedianMs = percentile(sortedBare, 0.5);
    const medianMs = percentile(sortedProbes, 0.5);
    const pairedDeltaMedianMs = percentile(sortedDeltas, 0.5);
    const p95Ms = percentile(sortedProbes, 0.95);
    const maxMs = sortedProbes[sortedProbes.length - 1];
    const effectiveCapMs = Math.max(50.0, bareMedianMs + 20.0);
    console.log(
      `[bench] Metric 2 OS fork+exec (n=${durationsMs.length}): bare_median=${bareMedianMs.toFixed(3)}ms probe_median=${medianMs.toFixed(3)}ms paired_delta_median=${pairedDeltaMedianMs.toFixed(3)}ms effective_cap=${effectiveCapMs.toFixed(3)}ms p95=${p95Ms.toFixed(3)}ms max=${maxMs.toFixed(3)}ms`
    );

    assert.ok(
      pairedDeltaMedianMs <= 20.0,
      `Hook probe delta median ${pairedDeltaMedianMs.toFixed(3)}ms over bare Node exceeded 20.0ms`
    );
    assert.ok(
      medianMs <= effectiveCapMs,
      `OS fork+exec median ${medianMs.toFixed(3)}ms exceeded calibrated cap ${effectiveCapMs.toFixed(3)}ms (bare=${bareMedianMs.toFixed(3)}ms)`
    );
    assert.ok(
      medianMs <= 100.0,
      `OS fork+exec median ${medianMs.toFixed(3)}ms exceeded hard 100.0ms ceiling`
    );
  });
});
