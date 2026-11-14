#!/usr/bin/env node
import { createHash } from 'node:crypto';
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
const UUID_REGEX = /^[0-9a-f-]{36}$/i;
const VALID_SCENARIOS = new Set(['dense', 'alert', 'idle', 'live']);

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

function resolveScenario(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scenario' && i + 1 < argv.length) {
      const val = argv[i + 1].trim().toLowerCase();
      if (VALID_SCENARIOS.has(val)) return val;
    }
    if (argv[i].startsWith('--scenario=')) {
      const val = argv[i].slice('--scenario='.length).trim().toLowerCase();
      if (VALID_SCENARIOS.has(val)) return val;
    }
  }
  const envScenario = (process.env.PREVIEW_SCENARIO || '').trim().toLowerCase();
  return VALID_SCENARIOS.has(envScenario) ? envScenario : 'dense';
}

const CIDS = {
  root: '198d5aa0-44bb-4273-9a52-b83805a34a3a',
  sub1: '2a11c001-1111-4111-8111-111111111101',
  sub2: '2a11c002-2222-4222-8222-222222222202',
  sub3: '2a11c003-3333-4333-8333-333333333303',
  sub4: '2a11c004-4444-4444-8444-444444444404',
  sub5: '2a11c005-5555-4555-8555-555555555505',
  swarm1: '3b22d001-6666-4666-8666-666666666606',
  swarm2: '3b22d002-7777-4777-8777-777777777707',
  root2: '4c33e001-8888-4888-8888-888888888808',
  sub6: '4c33e002-9999-4999-8999-899989998909',
  root3: '5d44f001-aaaa-4aaa-8aaa-aaaaaaaaaa10',
  hist1: '6e550001-bbbb-4bbb-8bbb-bbbbbbbbbb11',
  hist2: '7f661001-cccc-4ccc-8ccc-ccccccccbb12',
};

const PREVIEW_BASE_MS = Date.now();
const PREVIEW_BASE_ISO = new Date(PREVIEW_BASE_MS).toISOString();

function makeNode(overrides) {
  const base = {
    cascadeId: CIDS.root,
    rootCascadeId: CIDS.root,
    parentCascadeId: null,
    kind: 'root',
    title: 'Refactor Telemetry & Auth Pipeline',
    role: null,
    typeName: null,
    depth: 0,
    status: 'CASCADE_RUN_STATUS_RUNNING',
    phase: 'THINKING',
    phaseStartedAt: new Date(PREVIEW_BASE_MS - 8400).toISOString(),
    phaseElapsedMs: 8400,
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
    stepCount: 18,
    turnCount: 6,
    streamingTokPerSec: null,
    contextWindow: {
      estimatedTokensUsed: 38800,
      maxContextTokens: 256000,
      pct: 15.16,
      level: 'normal',
    },
    cacheHitPct: 91.8,
    tokens: {
      inputTokens: 12400,
      cacheReadTokens: 138800,
      outputTokens: 6420,
      thinkingOutputTokens: 3910,
      responseOutputTokens: 2510,
    },
    deltaQuota5hPct: 0.48,
    lastTtftMs: 4200,
    lastStreamingMs: 3100,
    lastModifiedTime: new Date(PREVIEW_BASE_MS - 1200).toISOString(),
    spawnStepIndex: null,
    childrenIds: [],
  };
  return { ...base, ...overrides };
}

function makeQuota({ gemini5hPct, gemini5hLabel, isLowAlert, treeDelta, burnRate }, nowIso) {
  const resetAt = new Date(PREVIEW_BASE_MS + 2 * 3600 * 1000 + 21 * 60 * 1000).toISOString();
  const weekReset = new Date(PREVIEW_BASE_MS + 4 * 86400 * 1000).toISOString();
  const gemini5h = {
    bucketId: 'gemini-5h',
    groupId: 'gemini',
    displayName: 'Gemini 5h',
    window: '5h',
    remainingFraction: gemini5hPct / 100,
    remainingPct: gemini5hPct,
    resetTime: resetAt,
    resetInSeconds: 8460,
    resetInLabel: gemini5hLabel,
    isLowAlert,
  };
  const geminiWeekly = {
    bucketId: 'gemini-weekly',
    groupId: 'gemini',
    displayName: 'Gemini Weekly',
    window: 'weekly',
    remainingFraction: 0.965,
    remainingPct: 96.5,
    resetTime: weekReset,
    resetInSeconds: 345600,
    resetInLabel: '4d 0h',
    isLowAlert: false,
  };
  const thirdParty5h = {
    bucketId: '3p-5h',
    groupId: '3p',
    displayName: 'Claude / 3P 5h',
    window: '5h',
    remainingFraction: 1,
    remainingPct: 100,
    resetTime: resetAt,
    resetInSeconds: 8460,
    resetInLabel: '5h 0m',
    isLowAlert: false,
  };
  const thirdPartyWeekly = {
    bucketId: '3p-weekly',
    groupId: '3p',
    displayName: 'Claude / 3P Weekly',
    window: 'weekly',
    remainingFraction: 0.992,
    remainingPct: 99.2,
    resetTime: weekReset,
    resetInSeconds: 345600,
    resetInLabel: '4d 0h',
    isLowAlert: false,
  };

  return {
    fetchedAt: PREVIEW_BASE_ISO,
    buckets: [gemini5h, geminiWeekly, thirdParty5h, thirdPartyWeekly],
    gemini5h,
    geminiWeekly,
    thirdParty5h,
    thirdPartyWeekly,
    treeNetDelta5hPct: treeDelta,
    burnRate5hPctPerMin: burnRate,
  };
}

function buildScenarioSnapshot(scenario, liveStep, config, requestedCid, nowIso) {
  const root = makeNode({
    childrenIds: [CIDS.sub1, CIDS.sub2, CIDS.sub3, CIDS.swarm1, CIDS.swarm2],
  });

  if (scenario === 'alert') {
    const sub1 = makeNode({
      cascadeId: CIDS.sub1,
      parentCascadeId: CIDS.root,
      kind: 'subagent',
      title: 'Heavy Security Audit',
      role: 'Auditor',
      typeName: 'security_auditor',
      depth: 1,
      phase: 'THINKING',
      phaseElapsedMs: 19200,
      stepCount: 22,
      retryCount: 2,
      routingStatus: 'retrying',
      contextWindow: {
        estimatedTokensUsed: 226304,
        maxContextTokens: 256000,
        pct: 88.4,
        level: 'critical_85',
      },
      deltaQuota5hPct: 0.91,
      spawnStepIndex: 6,
    });
    const sub2 = makeNode({
      cascadeId: CIDS.sub2,
      parentCascadeId: CIDS.root,
      kind: 'subagent',
      title: 'Schema Migration Runner',
      role: 'Migrator',
      typeName: 'code_editor',
      depth: 1,
      phase: 'STREAMING',
      phaseElapsedMs: 6500,
      streamingTokPerSec: 52,
      stepCount: 15,
      deltaQuota5hPct: 0.74,
      spawnStepIndex: 9,
    });
    const sub3 = makeNode({
      cascadeId: CIDS.sub3,
      parentCascadeId: CIDS.root,
      kind: 'subagent',
      title: 'Deep Dependency Graph Probe',
      role: 'Explorer',
      typeName: 'explorer',
      depth: 1,
      phase: 'IDLE',
      status: 'CASCADE_RUN_STATUS_IDLE',
      phaseStartedAt: null,
      phaseElapsedMs: 0,
      servedModel: {
        responseModel: 'gemini-3.5-flash',
        displayName: 'Gemini 3.5 Flash',
        modelEnum: 'flash',
        family: 'gemini',
        effortTier: 'flash',
        tier: 'fast',
      },
      deltaQuota5hPct: 0.08,
      spawnStepIndex: 12,
    });

    root.phase = 'TOOL_RUNNING';
    root.lastTool = { name: 'run_command', summary: 'npm test -- --grep security' };
    root.retryCount = 2;
    root.routingStatus = 'retrying';
    root.contextWindow = {
      estimatedTokensUsed: 226304,
      maxContextTokens: 256000,
      pct: 88.4,
      level: 'critical_85',
    };

    const treeNodes = [root, sub1, sub2, sub3];
    const activeNode =
      (requestedCid && treeNodes.find((n) => n.cascadeId === requestedCid)) || sub1;
    const breadcrumb =
      activeNode.parentCascadeId === null
        ? [{ cascadeId: root.cascadeId, title: root.title, role: root.role }]
        : [
            { cascadeId: root.cascadeId, title: root.title, role: root.role },
            { cascadeId: activeNode.cascadeId, title: activeNode.title, role: activeNode.role },
          ];
    return {
      hostConnected: true,
      activeConversationId: activeNode.cascadeId,
      rootCascadeId: CIDS.root,
      breadcrumb,
      activeNode,
      treeNodes,
      smartGovernanceBanner: {
        active: true,
        heavyConcurrentCount: 3,
        gemini5hRemainingPct: 14.2,
        estimatedBurnPctPerMin: 1.45,
        message: '3 个 Apex 节点并发消耗 5h 配额 (14.2%)，建议将探索节点切换为 Argon / Flash',
      },
      quota: makeQuota(
        {
          gemini5hPct: 14.2,
          gemini5hLabel: '1h 18m',
          isLowAlert: true,
          treeDelta: 2.21,
          burnRate: 1.45,
        },
        nowIso
      ),
      config,
      warnings: [],
    };
  }

  if (scenario === 'idle') {
    const idleRoot = makeNode({
      status: 'CASCADE_RUN_STATUS_IDLE',
      phase: 'IDLE',
      phaseStartedAt: null,
      phaseElapsedMs: 0,
      lastModifiedTime: new Date(PREVIEW_BASE_MS - 42_000).toISOString(),
      childrenIds: [CIDS.sub1, CIDS.sub2, CIDS.swarm1],
    });
    const sub1 = makeNode({
      cascadeId: CIDS.sub1,
      parentCascadeId: CIDS.root,
      kind: 'subagent',
      title: 'Auth Trace Verification',
      role: 'Verifier',
      typeName: 'verifier',
      depth: 1,
      status: 'CASCADE_RUN_STATUS_IDLE',
      phase: 'IDLE',
      phaseStartedAt: null,
      phaseElapsedMs: 0,
      lastModifiedTime: new Date(PREVIEW_BASE_MS - 65_000).toISOString(),
      spawnStepIndex: 4,
    });
    const sub2 = makeNode({
      cascadeId: CIDS.sub2,
      parentCascadeId: CIDS.root,
      kind: 'subagent',
      title: 'Docs Link Audit',
      role: 'Explorer',
      typeName: 'explorer',
      depth: 1,
      status: 'CASCADE_RUN_STATUS_IDLE',
      phase: 'IDLE',
      phaseStartedAt: null,
      phaseElapsedMs: 0,
      servedModel: {
        responseModel: 'gemini-3.5-flash',
        displayName: 'Gemini 3.5 Flash',
        modelEnum: 'flash',
        family: 'gemini',
        effortTier: 'flash',
        tier: 'fast',
      },
      lastModifiedTime: new Date(PREVIEW_BASE_MS - 120_000).toISOString(),
      spawnStepIndex: 7,
    });
    const swarm1 = makeNode({
      cascadeId: CIDS.swarm1,
      parentCascadeId: CIDS.root,
      kind: 'swarm_member',
      title: 'qa-worker',
      role: 'QA',
      typeName: null,
      depth: 1,
      status: 'CASCADE_RUN_STATUS_IDLE',
      phase: 'IDLE',
      phaseStartedAt: null,
      phaseElapsedMs: 0,
      swarmState: { memberName: 'qa-worker', desiredState: 'idle', phase: 'done' },
      lastModifiedTime: new Date(PREVIEW_BASE_MS - 95_000).toISOString(),
      spawnStepIndex: 10,
    });

    const treeNodes = [idleRoot, sub1, sub2, swarm1];
    const activeNode =
      (requestedCid && treeNodes.find((n) => n.cascadeId === requestedCid)) || idleRoot;
    return {
      hostConnected: true,
      activeConversationId: activeNode.cascadeId,
      rootCascadeId: CIDS.root,
      breadcrumb: [{ cascadeId: idleRoot.cascadeId, title: idleRoot.title, role: null }],
      activeNode,
      treeNodes,
      smartGovernanceBanner: {
        active: false,
        heavyConcurrentCount: 0,
        gemini5hRemainingPct: 88.6,
        estimatedBurnPctPerMin: null,
        message: null,
      },
      quota: makeQuota(
        {
          gemini5hPct: 88.6,
          gemini5hLabel: '3h 40m',
          isLowAlert: false,
          treeDelta: 0.64,
          burnRate: null,
        },
        nowIso
      ),
      config,
      warnings: [],
    };
  }

  // 'dense' or 'live'
  const livePhases = ['PRE_FLIGHT', 'THINKING', 'STREAMING', 'TOOL_RUNNING', 'IDLE'];
  const currentLivePhase = scenario === 'live' ? livePhases[liveStep % livePhases.length] : 'THINKING';

  const sub1 = makeNode({
    cascadeId: CIDS.sub1,
    parentCascadeId: CIDS.root,
    kind: 'subagent',
    title: 'Telemetry Graph Explorer',
    role: 'Explorer',
    typeName: 'explorer',
    depth: 1,
    status: currentLivePhase === 'IDLE' ? 'CASCADE_RUN_STATUS_IDLE' : 'CASCADE_RUN_STATUS_RUNNING',
    phase: currentLivePhase,
    phaseStartedAt: currentLivePhase === 'IDLE' ? null : new Date(PREVIEW_BASE_MS - 12_400).toISOString(),
    phaseElapsedMs: currentLivePhase === 'IDLE' ? 0 : 12_400,
    requestedModel: {
      raw: 'auto',
      displayName: 'Auto',
      modelId: 'auto',
      source: 'orchestrator',
    },
    servedModel: {
      responseModel: 'gemini-4-argon',
      displayName: 'Gemini 4 Argon (Medium)',
      modelEnum: 'MODEL_PLACEHOLDER_M418',
      family: 'gemini',
      effortTier: 'medium',
      tier: 'workhorse',
    },
    routingStatus: 'routed',
    streamingTokPerSec: currentLivePhase === 'STREAMING' ? 48 : null,
    lastTool:
      currentLivePhase === 'TOOL_RUNNING'
        ? { name: 'grep_search', summary: 'BuildTopologyGraph' }
        : null,
    stepCount: 14 + (scenario === 'live' ? liveStep : 0),
    deltaQuota5hPct: 0.41,
    spawnStepIndex: 3,
    childrenIds: [CIDS.sub4],
  });

  const sub2 = makeNode({
    cascadeId: CIDS.sub2,
    parentCascadeId: CIDS.root,
    kind: 'subagent',
    title: 'Core Typecheck & Build Runner',
    role: 'Builder',
    typeName: 'command_runner',
    depth: 1,
    phase: 'TOOL_RUNNING',
    phaseElapsedMs: 4100,
    lastTool: { name: 'run_command', summary: 'npm run typecheck && npm test' },
    stepCount: 9,
    deltaQuota5hPct: 0.22,
    spawnStepIndex: 5,
  });

  const sub3 = makeNode({
    cascadeId: CIDS.sub3,
    parentCascadeId: CIDS.root,
    kind: 'subagent',
    title: 'UI Accessibility Reviewer',
    role: 'Reviewer',
    typeName: 'reviewer',
    depth: 1,
    phase: 'STREAMING',
    phaseElapsedMs: 3200,
    streamingTokPerSec: 64,
    servedModel: {
      responseModel: 'gemini-3.5-flash',
      displayName: 'Gemini 3.5 Flash',
      modelEnum: 'flash',
      family: 'gemini',
      effortTier: 'flash',
      tier: 'fast',
    },
    stepCount: 7,
    deltaQuota5hPct: 0.09,
    spawnStepIndex: 8,
  });

  const sub4 = makeNode({
    cascadeId: CIDS.sub4,
    parentCascadeId: CIDS.sub1,
    kind: 'subagent',
    title: 'Grandchild AST Inspector',
    role: 'Inspector',
    typeName: 'ast_inspector',
    depth: 2,
    phase: 'BLOCKED_APPROVAL',
    phaseElapsedMs: 6200,
    lastTool: { name: 'run_command', summary: 'rm -rf .test-dist' },
    servedModel: {
      responseModel: 'gemini-pro-orchestrator',
      displayName: 'Orchestrator (Carbon)',
      modelEnum: 'MODEL_PLACEHOLDER_M667',
      family: 'auto',
      effortTier: 'auto',
      tier: 'orchestrator',
    },
    stepCount: 5,
    deltaQuota5hPct: 0.14,
    spawnStepIndex: 2,
  });

  const sub5 = makeNode({
    cascadeId: CIDS.sub5,
    parentCascadeId: CIDS.root,
    kind: 'subagent',
    title: 'Done Snapshot Diff Check',
    role: 'Differ',
    typeName: 'verifier',
    depth: 1,
    status: 'CASCADE_RUN_STATUS_IDLE',
    phase: 'IDLE',
    phaseStartedAt: null,
    phaseElapsedMs: 0,
    lastModifiedTime: new Date(PREVIEW_BASE_MS - 25_000).toISOString(),
    stepCount: 11,
    deltaQuota5hPct: 0.11,
    spawnStepIndex: 10,
  });

  const swarm1 = makeNode({
    cascadeId: CIDS.swarm1,
    parentCascadeId: CIDS.root,
    kind: 'swarm_member',
    title: 'frontend-cockpit',
    role: 'Frontend',
    typeName: null,
    depth: 1,
    phase: 'THINKING',
    phaseElapsedMs: 9100,
    swarmState: { memberName: 'frontend-cockpit', desiredState: 'running', phase: 'coding' },
    stepCount: 16,
    deltaQuota5hPct: 0.19,
    spawnStepIndex: 11,
  });

  const swarm2 = makeNode({
    cascadeId: CIDS.swarm2,
    parentCascadeId: CIDS.root,
    kind: 'swarm_member',
    title: 'hook-benchmarker',
    role: 'Benchmark',
    typeName: null,
    depth: 1,
    status: 'CASCADE_RUN_STATUS_IDLE',
    phase: 'IDLE',
    phaseStartedAt: null,
    phaseElapsedMs: 0,
    servedModel: {
      responseModel: 'gemini-3.5-flash',
      displayName: 'Gemini 3.5 Flash',
      modelEnum: 'flash',
      family: 'gemini',
      effortTier: 'flash',
      tier: 'fast',
    },
    swarmState: { memberName: 'hook-benchmarker', desiredState: 'idle', phase: 'done' },
    lastModifiedTime: new Date(PREVIEW_BASE_MS - 55_000).toISOString(),
    stepCount: 6,
    deltaQuota5hPct: 0.04,
    spawnStepIndex: 12,
  });

  const treeNodes = [root, sub1, sub4, sub2, sub3, sub5, swarm1, swarm2];
  const activeNode =
    (requestedCid && treeNodes.find((n) => n.cascadeId === requestedCid)) || sub1;
  const breadcrumb =
    activeNode.cascadeId === CIDS.sub4
      ? [
          { cascadeId: root.cascadeId, title: root.title, role: root.role },
          { cascadeId: sub1.cascadeId, title: sub1.title, role: sub1.role },
          { cascadeId: sub4.cascadeId, title: sub4.title, role: sub4.role },
        ]
      : activeNode.parentCascadeId
        ? [
            { cascadeId: root.cascadeId, title: root.title, role: root.role },
            { cascadeId: activeNode.cascadeId, title: activeNode.title, role: activeNode.role },
          ]
        : [{ cascadeId: root.cascadeId, title: root.title, role: root.role }];

  return {
    hostConnected: true,
    activeConversationId: activeNode.cascadeId,
    rootCascadeId: CIDS.root,
    breadcrumb,
    activeNode,
    treeNodes,
    smartGovernanceBanner: {
      active: false,
      heavyConcurrentCount: 2,
      gemini5hRemainingPct: 84.3,
      estimatedBurnPctPerMin: 0.32,
      message: null,
    },
    quota: makeQuota(
      {
        gemini5hPct: 84.3,
        gemini5hLabel: '2h 21m',
        isLowAlert: false,
        treeDelta: 1.68,
        burnRate: 0.32,
      },
      nowIso
    ),
    config,
    warnings: [],
  };
}

function computePreviewEtag(semantic) {
  let clean = semantic;
  if (semantic && Array.isArray(semantic.treeNodes)) {
    clean = {
      ...semantic,
      activeNode: semantic.activeNode
        ? { ...semantic.activeNode, phaseElapsedMs: undefined }
        : null,
      treeNodes: semantic.treeNodes.map((n) => ({ ...n, phaseElapsedMs: undefined })),
    };
  } else if (semantic && Array.isArray(semantic.projects)) {
    clean = {
      ...semantic,
      projects: semantic.projects.map((p) => ({
        ...p,
        trees: Array.isArray(p.trees)
          ? p.trees.map((t) => ({
              ...t,
              elapsedMs: undefined,
              nodes: Array.isArray(t.nodes)
                ? t.nodes.map((n) => ({ ...n, phaseElapsedMs: undefined }))
                : [],
            }))
          : [],
      })),
    };
  }
  return createHash('sha256').update(JSON.stringify(clean)).digest('base64url').slice(0, 6);
}

function makeTurn(overrides) {
  const ttftMs = overrides.ttftMs ?? 1200;
  const streamingMs = overrides.streamingMs ?? 3200;
  const inputTokens = overrides.inputTokens ?? 8400;
  const cacheReadTokens = overrides.cacheReadTokens ?? 42000;
  const thinkingOutputTokens = overrides.thinkingOutputTokens ?? 620;
  const responseOutputTokens = overrides.responseOutputTokens ?? 980;
  const outputTokens = overrides.outputTokens ?? thinkingOutputTokens + responseOutputTokens;
  const totalIn = inputTokens + cacheReadTokens;
  const cacheHitPct = totalIn > 0 ? Number(((cacheReadTokens / totalIn) * 100).toFixed(1)) : 0;
  const thinkingRatioPct =
    outputTokens > 0 ? Number(((thinkingOutputTokens / outputTokens) * 100).toFixed(1)) : 0;
  const turnIndex = overrides.turnIndex ?? 1;

  return {
    turnIndex,
    cascadeId: CIDS.root,
    cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
    role: null,
    stepIndices: [Math.max(1, (turnIndex - 1) * 2 + 1), turnIndex * 2],
    timestamp: new Date(PREVIEW_BASE_MS - (15 - turnIndex) * 18_000).toISOString(),
    requestedLabel: 'Argon (Medium)',
    servedModelDisplayName: 'Argon (Medium)',
    responseModel: 'gemini-3.8-argon',
    tier: 'workhorse',
    routingChangedFromPrevTurn: false,
    ttftMs,
    streamingMs,
    totalMs: ttftMs + streamingMs,
    inputTokens,
    cacheReadTokens,
    cacheHitPct,
    outputTokens,
    thinkingOutputTokens,
    responseOutputTokens,
    thinkingRatioPct,
    retryCount: 0,
    contextUsedTokens: 48000 + turnIndex * 3600,
    contextMaxTokens: 200000,
    contextPct: Number((((48000 + turnIndex * 3600) / 200000) * 100).toFixed(1)),
    deltaQuota5hPct: 0.14,
    apiProvider: 'google_cloud_code_pa',
    ...overrides,
  };
}

function buildScenarioTimeline(activeScenario, cfg, requestedCid, requestedScope) {
  const scope = requestedScope || cfg.timelineScope || 'tree';
  const focusCid = requestedCid || (activeScenario === 'dense' || activeScenario === 'live' ? CIDS.sub1 : CIDS.root);

  let allTurns;
  if (activeScenario === 'idle') {
    allTurns = [
      makeTurn({
        turnIndex: 3,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        ttftMs: 920,
        streamingMs: 2180,
        inputTokens: 4200,
        cacheReadTokens: 31800,
        thinkingOutputTokens: 210,
        responseOutputTokens: 690,
        deltaQuota5hPct: 0.03,
      }),
      makeTurn({
        turnIndex: 2,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Auth Trace Verification',
        role: 'Verifier',
        ttftMs: 640,
        streamingMs: 1420,
        requestedLabel: 'Flash',
        servedModelDisplayName: 'Gemini 3.5 Flash',
        responseModel: 'gemini-3.5-flash',
        tier: 'fast',
        thinkingOutputTokens: 110,
        responseOutputTokens: 490,
        deltaQuota5hPct: 0.01,
      }),
      makeTurn({
        turnIndex: 1,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        ttftMs: 1180,
        streamingMs: 2650,
        thinkingOutputTokens: 290,
        responseOutputTokens: 810,
        deltaQuota5hPct: 0.02,
      }),
    ];
  } else if (activeScenario === 'alert') {
    allTurns = [
      makeTurn({
        turnIndex: 6,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Auth Token Exchange Probe',
        role: 'Explorer',
        requestedLabel: 'Auto',
        servedModelDisplayName: 'Gemini 3.5 Flash',
        responseModel: 'gemini-3.5-flash',
        tier: 'fast',
        routingChangedFromPrevTurn: true,
        retryCount: 3,
        ttftMs: 4200,
        streamingMs: 1850,
        inputTokens: 24500,
        cacheReadTokens: 6200,
        thinkingOutputTokens: 280,
        responseOutputTokens: 540,
        contextUsedTokens: 174200,
        contextPct: 87.1,
        deltaQuota5hPct: 0.34,
      }),
      makeTurn({
        turnIndex: 5,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        requestedLabel: 'Carbon (High)',
        servedModelDisplayName: 'Gemini 4 Carbon (High)',
        responseModel: 'gemini-4-carbon',
        tier: 'apex',
        routingChangedFromPrevTurn: true,
        ttftMs: 28400,
        streamingMs: 2900,
        inputTokens: 16800,
        cacheReadTokens: 121000,
        thinkingOutputTokens: 1410,
        responseOutputTokens: 210,
        contextUsedTokens: 162400,
        contextPct: 81.2,
        deltaQuota5hPct: 0.58,
      }),
      makeTurn({
        turnIndex: 4,
        cascadeId: CIDS.sub2,
        cascadeTitle: 'Quota Guardrail Audit',
        role: 'Auditor',
        ttftMs: 2600,
        streamingMs: 5400,
        retryCount: 1,
        contextUsedTokens: 148000,
        contextPct: 74.0,
        deltaQuota5hPct: 0.22,
      }),
      makeTurn({
        turnIndex: 3,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        requestedLabel: 'Carbon (High)',
        servedModelDisplayName: 'Gemini 4 Carbon (High)',
        responseModel: 'gemini-4-carbon',
        tier: 'apex',
        ttftMs: 9100,
        streamingMs: 7400,
        thinkingOutputTokens: 980,
        responseOutputTokens: 1120,
        contextUsedTokens: 131000,
        contextPct: 65.5,
        deltaQuota5hPct: 0.45,
      }),
      makeTurn({
        turnIndex: 2,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Auth Token Exchange Probe',
        role: 'Explorer',
        ttftMs: 1400,
        streamingMs: 3900,
        contextUsedTokens: 92000,
        contextPct: 46.0,
        deltaQuota5hPct: 0.16,
      }),
      makeTurn({
        turnIndex: 1,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        ttftMs: 1850,
        streamingMs: 4100,
        contextUsedTokens: 64000,
        contextPct: 32.0,
        deltaQuota5hPct: 0.15,
      }),
    ];
  } else {
    allTurns = [
      makeTurn({
        turnIndex: 14,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Investigate Auth Token Exchange',
        role: 'Explorer',
        requestedLabel: 'Carbon (High)',
        servedModelDisplayName: 'Gemini 4 Carbon (High)',
        responseModel: 'gemini-4-carbon',
        tier: 'apex',
        routingChangedFromPrevTurn: true,
        ttftMs: 42600,
        streamingMs: 3400,
        inputTokens: 11200,
        cacheReadTokens: 181900,
        thinkingOutputTokens: 1682,
        responseOutputTokens: 238,
        contextUsedTokens: 203264,
        contextMaxTokens: 256000,
        contextPct: 79.4,
        deltaQuota5hPct: 0.42,
      }),
      makeTurn({
        turnIndex: 13,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        requestedLabel: 'Auto',
        servedModelDisplayName: 'Argon (Medium)',
        responseModel: 'gemini-3.8-argon',
        tier: 'workhorse',
        routingChangedFromPrevTurn: true,
        retryCount: 2,
        ttftMs: 5100,
        streamingMs: 14800,
        inputTokens: 48200,
        cacheReadTokens: 10940,
        thinkingOutputTokens: 1180,
        responseOutputTokens: 2840,
        contextUsedTokens: 174336,
        contextMaxTokens: 256000,
        contextPct: 68.1,
        deltaQuota5hPct: 0.28,
      }),
      makeTurn({
        turnIndex: 12,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Investigate Auth Token Exchange',
        role: 'Explorer',
        requestedLabel: 'Argon (Medium)',
        servedModelDisplayName: 'Argon (Medium)',
        tier: 'workhorse',
        ttftMs: 680,
        streamingMs: 8400,
        inputTokens: 8900,
        cacheReadTokens: 99600,
        thinkingOutputTokens: 420,
        responseOutputTokens: 1640,
        contextUsedTokens: 168400,
        contextMaxTokens: 256000,
        contextPct: 65.8,
        deltaQuota5hPct: 0.14,
      }),
      makeTurn({
        turnIndex: 11,
        cascadeId: CIDS.sub2,
        cascadeTitle: 'Patch State Bus Ring Buffer',
        role: 'Builder',
        requestedLabel: 'Flash',
        servedModelDisplayName: 'Gemini 3.5 Flash',
        responseModel: 'gemini-3.5-flash',
        tier: 'fast',
        ttftMs: 410,
        streamingMs: 1850,
        inputTokens: 6400,
        cacheReadTokens: 20260,
        thinkingOutputTokens: 120,
        responseOutputTokens: 540,
        contextUsedTokens: 78200,
        contextMaxTokens: 256000,
        contextPct: 30.5,
        deltaQuota5hPct: 0.04,
      }),
      makeTurn({
        turnIndex: 10,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Investigate Auth Token Exchange',
        role: 'Explorer',
        requestedLabel: 'Orchestrator (Carbon)',
        servedModelDisplayName: 'Orchestrator (Carbon)',
        responseModel: 'gemini-pro-orchestrator',
        tier: 'orchestrator',
        routingChangedFromPrevTurn: true,
        ttftMs: 3900,
        streamingMs: 6100,
        inputTokens: 14100,
        cacheReadTokens: 86500,
        thinkingOutputTokens: 920,
        responseOutputTokens: 780,
        contextUsedTokens: 158100,
        contextMaxTokens: 256000,
        contextPct: 61.8,
        deltaQuota5hPct: 0.21,
      }),
      makeTurn({
        turnIndex: 9,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        ttftMs: 1450,
        streamingMs: 5300,
        contextUsedTokens: 149200,
        contextMaxTokens: 256000,
        contextPct: 58.3,
        deltaQuota5hPct: 0.17,
      }),
      makeTurn({
        turnIndex: 8,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Investigate Auth Token Exchange',
        role: 'Explorer',
        ttftMs: 920,
        streamingMs: 4100,
        contextUsedTokens: 141800,
        contextMaxTokens: 256000,
        contextPct: 55.4,
        deltaQuota5hPct: 0.13,
      }),
      makeTurn({
        turnIndex: 7,
        cascadeId: CIDS.sub2,
        cascadeTitle: 'Patch State Bus Ring Buffer',
        role: 'Builder',
        requestedLabel: 'Flash',
        servedModelDisplayName: 'Gemini 3.5 Flash',
        responseModel: 'gemini-3.5-flash',
        tier: 'fast',
        ttftMs: 520,
        streamingMs: 2400,
        contextUsedTokens: 69100,
        contextMaxTokens: 256000,
        contextPct: 27.0,
        deltaQuota5hPct: 0.05,
      }),
      makeTurn({
        turnIndex: 6,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        requestedLabel: 'Carbon (High)',
        servedModelDisplayName: 'Gemini 4 Carbon (High)',
        responseModel: 'gemini-4-carbon',
        tier: 'apex',
        ttftMs: 8400,
        streamingMs: 7900,
        thinkingOutputTokens: 1120,
        responseOutputTokens: 1480,
        contextUsedTokens: 129500,
        contextMaxTokens: 256000,
        contextPct: 50.6,
        deltaQuota5hPct: 0.36,
      }),
      makeTurn({
        turnIndex: 5,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Investigate Auth Token Exchange',
        role: 'Explorer',
        ttftMs: 1100,
        streamingMs: 3600,
        contextUsedTokens: 118000,
        contextMaxTokens: 256000,
        contextPct: 46.1,
        deltaQuota5hPct: 0.12,
      }),
      makeTurn({
        turnIndex: 4,
        cascadeId: CIDS.sub2,
        cascadeTitle: 'Patch State Bus Ring Buffer',
        role: 'Builder',
        ttftMs: 760,
        streamingMs: 2950,
        contextUsedTokens: 54000,
        contextMaxTokens: 256000,
        contextPct: 21.1,
        deltaQuota5hPct: 0.08,
      }),
      makeTurn({
        turnIndex: 3,
        cascadeId: CIDS.sub1,
        cascadeTitle: 'Investigate Auth Token Exchange',
        role: 'Explorer',
        ttftMs: 1320,
        streamingMs: 3150,
        contextUsedTokens: 96000,
        contextMaxTokens: 256000,
        contextPct: 37.5,
        deltaQuota5hPct: 0.11,
      }),
      makeTurn({
        turnIndex: 2,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        ttftMs: 1050,
        streamingMs: 2800,
        contextUsedTokens: 61000,
        contextMaxTokens: 256000,
        contextPct: 23.8,
        deltaQuota5hPct: 0.09,
      }),
      makeTurn({
        turnIndex: 1,
        cascadeId: CIDS.root,
        cascadeTitle: 'Refactor Telemetry & Auth Pipeline',
        ttftMs: 890,
        streamingMs: 1940,
        contextUsedTokens: 32000,
        contextMaxTokens: 256000,
        contextPct: 12.5,
        deltaQuota5hPct: 0.06,
      }),
    ];
  }

  const turns =
    scope === 'conversation'
      ? allTurns.filter((turn) => turn.cascadeId === focusCid)
      : allTurns;

  return {
    rootCascadeId: CIDS.root,
    scope,
    turns,
  };
}

function summarizeTreeMix(nodes) {
  const modelMix = {};
  for (const node of nodes) {
    const label = node.servedModel.displayName;
    modelMix[label] = (modelMix[label] || 0) + 1;
  }
  return modelMix;
}

function buildScenarioFleet(activeScenario, semantic, nowIso) {
  if (activeScenario === 'idle') {
    const tree1 = {
      rootCascadeId: CIDS.root,
      rootTitle: semantic.treeNodes[0]?.title || 'Refactor Telemetry & Auth Pipeline',
      rootPhase: 'IDLE',
      activeNodeCount: 0,
      totalNodeCount: semantic.treeNodes.length,
      elapsedMs: 0,
      modelMix: summarizeTreeMix(semantic.treeNodes),
      nodes: semantic.treeNodes,
      treeDeltaQuota5hPct: 0.06,
    };

    return {
      hostConnected: true,
      activeHeadline: {
        runningRoots: 0,
        runningSubagents: 0,
        totalRunningNodes: 0,
        modelHistogram: [],
      },
      projects: [
        {
          projectKey: 'antigravity-pulse',
          projectName: 'antigravity-pulse',
          workspaceUris: ['file:///workspace/antigravity-pulse'],
          runningCount: 0,
          trees: [tree1],
        },
      ],
      topQuotaBurners: [],
      quota: semantic.quota,
    };
  }

  const root2 = makeNode({
    cascadeId: CIDS.root2,
    rootCascadeId: CIDS.root2,
    parentCascadeId: null,
    kind: 'root',
    title: 'SSA Register Allocator & IR Pass',
    phase: 'STREAMING',
    phaseElapsedMs: 14_200,
    servedModel: {
      responseModel: 'gemini-4-carbon',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier: 'apex',
    },
    streamingTokPerSec: 68.4,
    deltaQuota5hPct: 4.18,
    childrenIds: [CIDS.sub6],
  });
  const sub6 = makeNode({
    cascadeId: CIDS.sub6,
    rootCascadeId: CIDS.root2,
    parentCascadeId: CIDS.root2,
    kind: 'subagent',
    title: 'CFG Dominance Verifier',
    role: 'Verifier',
    typeName: 'verifier',
    depth: 1,
    phase: 'TOOL_RUNNING',
    phaseElapsedMs: 3900,
    lastTool: { name: 'cargo_test', summary: 'cargo test --package ssa-opt' },
    servedModel: {
      responseModel: 'gemini-3.5-flash',
      displayName: 'Gemini 3.5 Flash',
      modelEnum: 'flash',
      family: 'gemini',
      effortTier: 'flash',
      tier: 'fast',
    },
    deltaQuota5hPct: 0.64,
    spawnStepIndex: 6,
  });

  const hist2 = makeNode({
    cascadeId: CIDS.hist2,
    rootCascadeId: CIDS.hist2,
    parentCascadeId: null,
    kind: 'root',
    title: 'IR Fuzzing Corpus Triage',
    status: 'CASCADE_RUN_STATUS_IDLE',
    phase: 'IDLE',
    phaseStartedAt: null,
    phaseElapsedMs: 0,
    servedModel: {
      responseModel: 'gemini-3.5-flash',
      displayName: 'Gemini 3.5 Flash',
      modelEnum: 'flash',
      family: 'gemini',
      effortTier: 'flash',
      tier: 'fast',
    },
    deltaQuota5hPct: 0.74,
    lastModifiedTime: new Date(PREVIEW_BASE_MS - 180_000).toISOString(),
  });

  const root3 = makeNode({
    cascadeId: CIDS.root3,
    rootCascadeId: CIDS.root3,
    parentCascadeId: null,
    kind: 'root',
    title: 'Unassigned Scratchpad Refactor',
    status: 'CASCADE_RUN_STATUS_IDLE',
    phase: 'IDLE',
    phaseStartedAt: null,
    phaseElapsedMs: 0,
    servedModel: {
      responseModel: 'gemini-pro-orchestrator',
      displayName: 'Orchestrator (Carbon)',
      modelEnum: 'MODEL_PLACEHOLDER_M667',
      family: 'auto',
      effortTier: 'auto',
      tier: 'orchestrator',
    },
    deltaQuota5hPct: 1.21,
    lastModifiedTime: new Date(PREVIEW_BASE_MS - 320_000).toISOString(),
  });

  const hist1 = makeNode({
    cascadeId: CIDS.hist1,
    rootCascadeId: CIDS.hist1,
    parentCascadeId: null,
    kind: 'root',
    title: 'Ledger Reconciliation Audit',
    status: 'CASCADE_RUN_STATUS_IDLE',
    phase: 'IDLE',
    phaseStartedAt: null,
    phaseElapsedMs: 0,
    servedModel: {
      responseModel: 'gemini-4-carbon',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier: 'apex',
    },
    deltaQuota5hPct: 1.94,
    lastModifiedTime: new Date(PREVIEW_BASE_MS - 480_000).toISOString(),
  });

  const tree1Nodes = semantic.treeNodes;
  const tree1Active = tree1Nodes.filter(
    (n) => n.phase !== 'IDLE' && n.phase !== 'ERROR_OR_QUOTA'
  );
  const tree1 = {
    rootCascadeId: CIDS.root,
    rootTitle: tree1Nodes[0]?.title || 'Refactor Telemetry & Auth Pipeline',
    rootPhase: tree1Nodes[0]?.phase || 'THINKING',
    activeNodeCount: tree1Active.length,
    totalNodeCount: tree1Nodes.length,
    elapsedMs: Math.max(...tree1Active.map((n) => n.phaseElapsedMs || 0), 0),
    modelMix: summarizeTreeMix(tree1Nodes),
    nodes: tree1Nodes,
    treeDeltaQuota5hPct: semantic.quota.treeDeltaQuota5hPct ?? 3.15,
  };

  const tree2Nodes = [root2, sub6];
  const tree2 = {
    rootCascadeId: CIDS.root2,
    rootTitle: root2.title,
    rootPhase: root2.phase,
    activeNodeCount: 2,
    totalNodeCount: 2,
    elapsedMs: root2.phaseElapsedMs,
    modelMix: summarizeTreeMix(tree2Nodes),
    nodes: tree2Nodes,
    treeDeltaQuota5hPct: 4.82,
  };

  const tree3 = {
    rootCascadeId: CIDS.hist2,
    rootTitle: hist2.title,
    rootPhase: hist2.phase,
    activeNodeCount: 0,
    totalNodeCount: 1,
    elapsedMs: 0,
    modelMix: summarizeTreeMix([hist2]),
    nodes: [hist2],
    treeDeltaQuota5hPct: 0.74,
  };

  const tree4 = {
    rootCascadeId: CIDS.root3,
    rootTitle: root3.title,
    rootPhase: root3.phase,
    activeNodeCount: 0,
    totalNodeCount: 1,
    elapsedMs: 0,
    modelMix: summarizeTreeMix([root3]),
    nodes: [root3],
    treeDeltaQuota5hPct: 1.21,
  };

  const tree5 = {
    rootCascadeId: CIDS.hist1,
    rootTitle: hist1.title,
    rootPhase: hist1.phase,
    activeNodeCount: 0,
    totalNodeCount: 1,
    elapsedMs: 0,
    modelMix: summarizeTreeMix([hist1]),
    nodes: [hist1],
    treeDeltaQuota5hPct: 1.94,
  };

  const projects = [
    {
      projectKey: 'antigravity-pulse',
      projectName: 'antigravity-pulse',
      workspaceUris: ['file:///workspace/antigravity-pulse'],
      runningCount: tree1.activeNodeCount,
      trees: [tree1],
    },
    {
      projectKey: 'nebula-compiler',
      projectName: 'nebula-compiler',
      workspaceUris: ['file:///workspace/nebula-compiler'],
      runningCount: tree2.activeNodeCount,
      trees: [tree2, tree3],
    },
    {
      projectKey: 'payments-ledger',
      projectName: 'payments-ledger',
      workspaceUris: ['file:///workspace/payments-ledger'],
      runningCount: 0,
      trees: [tree5],
    },
    {
      projectKey: 'Workspace Unavailable',
      projectName: 'Workspace Unavailable',
      workspaceUris: [],
      runningCount: 0,
      trees: [tree4],
    },
  ];

  const allNodes = projects.flatMap((p) => p.trees.flatMap((t) => t.nodes));
  const runningNodes = allNodes.filter((n) => n.phase !== 'IDLE' && n.phase !== 'ERROR_OR_QUOTA');
  const runningRoots = runningNodes.filter((n) => n.parentCascadeId === null).length;
  const histMap = new Map();
  for (const node of runningNodes) {
    const key = node.servedModel.displayName;
    const prev = histMap.get(key);
    if (prev) {
      prev.count += 1;
    } else {
      histMap.set(key, {
        label: key,
        tier: node.servedModel.tier,
        count: 1,
      });
    }
  }
  const modelHistogram = [...histMap.values()].sort((a, b) => b.count - a.count);

  const topQuotaBurners = [
    {
      rank: 1,
      rootCascadeId: CIDS.root2,
      title: root2.title,
      projectName: 'nebula-compiler',
      dominantModel: 'Gemini 4 Carbon (High)',
      dominantTier: 'apex',
      consumed5hPct: 4.82,
      delta5hPct: 4.82,
      totalTokens: 1_248_000,
      lastActiveAt: nowIso,
      isRunning: true,
    },
    {
      rank: 2,
      rootCascadeId: CIDS.root,
      title: tree1.rootTitle,
      projectName: 'antigravity-pulse',
      dominantModel: 'Argon (Medium)',
      dominantTier: 'workhorse',
      consumed5hPct: 3.15,
      delta5hPct: 3.15,
      totalTokens: 842_500,
      lastActiveAt: nowIso,
      isRunning: true,
    },
    {
      rank: 3,
      rootCascadeId: CIDS.hist1,
      title: hist1.title,
      projectName: 'payments-ledger',
      dominantModel: 'Gemini 4 Carbon (High)',
      dominantTier: 'apex',
      consumed5hPct: 1.94,
      delta5hPct: 1.94,
      totalTokens: 518_200,
      lastActiveAt: hist1.lastModifiedTime,
      isRunning: false,
    },
    {
      rank: 4,
      rootCascadeId: CIDS.root3,
      title: root3.title,
      projectName: 'Workspace Unavailable',
      dominantModel: 'Orchestrator (Carbon)',
      dominantTier: 'orchestrator',
      consumed5hPct: 1.21,
      delta5hPct: 1.21,
      totalTokens: 312_400,
      lastActiveAt: root3.lastModifiedTime,
      isRunning: false,
    },
    {
      rank: 5,
      rootCascadeId: CIDS.hist2,
      title: hist2.title,
      projectName: 'nebula-compiler',
      dominantModel: 'Gemini 3.5 Flash',
      dominantTier: 'fast',
      consumed5hPct: 0.74,
      delta5hPct: 0.74,
      totalTokens: 194_600,
      lastActiveAt: hist2.lastModifiedTime,
      isRunning: false,
    },
  ];

  return {
    hostConnected: true,
    activeHeadline: {
      runningRoots,
      runningSubagents: Math.max(0, runningNodes.length - runningRoots),
      totalRunningNodes: runningNodes.length,
      modelHistogram,
    },
    projects,
    topQuotaBurners,
    quota: semantic.quota,
  };
}

const args = process.argv.slice(2);
const port = resolvePort(args);
const scenario = resolveScenario(args);
let liveStep = 0;

const previewConfig = {
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
  pollIntervalsMs: {
    active: 1000,
    idle: 3000,
    quota: 30_000,
    modelConfig: 30_000,
  },
  updatedAt: new Date().toISOString(),
};

const liveTimer = setInterval(() => {
  liveStep += 1;
}, 1500);
liveTimer.unref();

function resolveRequestScenario(url, req, fallbackScenario) {
  const fromQuery = url.searchParams.get('scenario')?.trim().toLowerCase() || '';
  if (VALID_SCENARIOS.has(fromQuery)) {
    return fromQuery;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.trim()) {
    try {
      const refUrl = new URL(referer);
      const fromRef = refUrl.searchParams.get('scenario')?.trim().toLowerCase() || '';
      if (VALID_SCENARIOS.has(fromRef)) {
        return fromRef;
      }
    } catch {
      // Ignore malformed Referer header
    }
  }
  return fallbackScenario;
}

function renderPreloadShim(activeScenario) {
  const initialFocusedCid =
    activeScenario === 'dense' || activeScenario === 'live' ? CIDS.sub1 : CIDS.root;
  return `
(function () {
  window.__pulseDebug = { toggleCalls: [] };
  window.sidecar = {
    conversationId: ${JSON.stringify(initialFocusedCid)},
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
      toggleConversation: function (cid) {
        window.__pulseDebug.toggleCalls.push(cid);
      },
      addArtifactComment: function () {}
    }
  };
})();
`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const nowIso = new Date().toISOString();
  const effectiveScenario = resolveRequestScenario(url, req, scenario);

  if (url.pathname === '/' || url.pathname === '/hud' || url.pathname === '/fleet') {
    const view = url.pathname.startsWith('/fleet') ? 'fleet' : 'hud';
    const htmlPath = path.join(SIDECAR_DIR, 'index.html');
    const rawHtml = existsSync(htmlPath)
      ? readFileSync(htmlPath, 'utf8')
      : '<!doctype html><html><body><div id="pulse-app" class="pulse-app" data-view="hud"><main id="app" class="pulse-main">Missing index.html</main></div></body></html>';
    const html = rawHtml.replace(/data-view="(?:hud|fleet)"/, `data-view="${view}"`);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': STRICT_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
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
    res.end(renderPreloadShim(effectiveScenario));
    return;
  }

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        version: '0.1.0',
        preview: true,
        scenario: effectiveScenario,
      })
    );
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(previewConfig));
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const patch = body ? JSON.parse(body) : {};
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON patch' }));
          return;
        }
        if (patch.inlineStampMode !== undefined) {
          if (!['smart', 'every-turn', 'off'].includes(patch.inlineStampMode)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid inlineStampMode' }));
            return;
          }
          previewConfig.inlineStampMode = patch.inlineStampMode;
        }
        if (patch.hudSortMode !== undefined) {
          if (!['active-first', 'topology-tree'].includes(patch.hudSortMode)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid hudSortMode' }));
            return;
          }
          previewConfig.hudSortMode = patch.hudSortMode;
        }
        if (patch.timelineScope !== undefined) {
          if (!['conversation', 'tree'].includes(patch.timelineScope)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid timelineScope' }));
            return;
          }
          previewConfig.timelineScope = patch.timelineScope;
        }
        previewConfig.updatedAt = new Date().toISOString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(previewConfig));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Malformed JSON body' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/hud') {
    const rawCid = url.searchParams.get('conversationId')?.trim() || '';
    if (rawCid && !UUID_REGEX.test(rawCid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid conversationId UUID' }));
      return;
    }
    const clientEtag = url.searchParams.get('etag')?.trim() || '';
    const semantic = buildScenarioSnapshot(
      effectiveScenario,
      liveStep,
      previewConfig,
      rawCid || null,
      nowIso
    );
    const etag = computePreviewEtag(semantic);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (clientEtag && clientEtag === etag) {
      res.end(JSON.stringify({ unchanged: true, etag }));
      return;
    }
    res.end(JSON.stringify({ etag, generatedAt: nowIso, ...semantic }));
    return;
  }

  if (url.pathname === '/api/timeline') {
    const rawCid = url.searchParams.get('conversationId')?.trim() || '';
    if (rawCid && !UUID_REGEX.test(rawCid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid conversationId UUID' }));
      return;
    }
    const rawScope = url.searchParams.get('scope')?.trim() || '';
    if (rawScope && rawScope !== 'conversation' && rawScope !== 'tree') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid scope; expected conversation or tree' }));
      return;
    }
    const clientEtag = url.searchParams.get('etag')?.trim() || '';
    const semanticTimeline = buildScenarioTimeline(
      effectiveScenario,
      previewConfig,
      rawCid || null,
      rawScope || undefined
    );
    const etag = computePreviewEtag(semanticTimeline);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (clientEtag && clientEtag === etag) {
      res.end(JSON.stringify({ unchanged: true, etag }));
      return;
    }
    res.end(
      JSON.stringify({
        etag,
        generatedAt: nowIso,
        ...semanticTimeline,
      })
    );
    return;
  }

  if (url.pathname === '/api/fleet') {
    const clientEtag = url.searchParams.get('etag')?.trim() || '';
    const semantic = buildScenarioSnapshot(
      effectiveScenario,
      liveStep,
      previewConfig,
      null,
      nowIso
    );
    const fleetSemantic = buildScenarioFleet(effectiveScenario, semantic, PREVIEW_BASE_ISO);
    const etag = computePreviewEtag(fleetSemantic);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (clientEtag && clientEtag === etag) {
      res.end(JSON.stringify({ unchanged: true, etag }));
      return;
    }
    res.end(
      JSON.stringify({
        etag,
        generatedAt: nowIso,
        ...fleetSemantic,
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
  console.log(
    `[preview-ui] (${scenario}) Listening on http://127.0.0.1:${actualPort}/hud (and /fleet)`
  );
});
