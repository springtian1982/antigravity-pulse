import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  buildStatusCardHtml,
  resolveSafeCardConversationSegment,
  writeStatusCardFile,
  type StatusCardInput,
} from '../../src/mcp/embed-card';
import type { CascadeNodeView, ModelTier, QuotaSummaryView } from '../../src/types/telemetry';

const CID_ROOT = '11111111-1111-4111-8111-111111111111';
const CID_SUB = '22222222-2222-4222-8222-222222222222';
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pulse-card-test-'));
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

function makeNode(overrides: Partial<CascadeNodeView> = {}): CascadeNodeView {
  return {
    cascadeId: CID_ROOT,
    rootCascadeId: CID_ROOT,
    parentCascadeId: null,
    kind: 'root',
    title: 'Root Refactor',
    role: 'orchestrator',
    typeName: null,
    depth: 0,
    status: 'CASCADE_RUN_STATUS_RUNNING',
    phase: 'THINKING',
    phaseStartedAt: '2026-11-14T10:00:00.000Z',
    phaseElapsedMs: 12_300,
    requestedModel: {
      raw: 'auto',
      displayName: 'Auto',
      modelId: 'auto',
      source: 'user',
    },
    servedModel: {
      responseModel: 'gemini-4-carbon',
      displayName: 'Gemini 4 Carbon (High)',
      modelEnum: 'MODEL_PLACEHOLDER_M427',
      family: 'gemini',
      effortTier: 'high',
      tier: 'apex' as ModelTier,
    },
    routingStatus: 'routed',
    retryCount: 0,
    lastTool: {
      name: 'grep_search',
      summary: 'scan mcp handlers',
    },
    stepCount: 4,
    turnCount: 2,
    streamingTokPerSec: null,
    contextWindow: {
      estimatedTokensUsed: 42_000,
      maxContextTokens: 256_000,
      pct: 16.4,
      level: 'normal',
    },
    cacheHitPct: 78.5,
    tokens: {
      inputTokens: 8_000,
      cacheReadTokens: 29_200,
      outputTokens: 1_240,
      thinkingOutputTokens: 640,
      responseOutputTokens: 600,
    },
    deltaQuota5hPct: 0.125,
    lastTtftMs: 420,
    lastStreamingMs: 1_850,
    lastModifiedTime: '2026-11-14T10:00:12.000Z',
    spawnStepIndex: null,
    childrenIds: [],
    ...overrides,
  };
}

function makeQuota(overrides: Partial<QuotaSummaryView> = {}): QuotaSummaryView {
  const g5h = {
    bucketId: 'gemini-5h',
    displayName: 'Gemini 5h',
    window: '5h',
    remainingFraction: 0.624,
    remainingPct: 62.4,
    resetTime: '2026-11-14T12:00:00.000Z',
    resetInSeconds: 7200,
    resetInLabel: '2h 0m',
    isLowAlert: false,
  };
  const gWk = {
    bucketId: 'gemini-weekly',
    displayName: 'Gemini Weekly',
    window: 'weekly',
    remainingFraction: 0.912,
    remainingPct: 91.2,
    resetTime: '2026-11-20T00:00:00.000Z',
    resetInSeconds: 480000,
    resetInLabel: '5d 13h',
    isLowAlert: false,
  };
  const p3 = {
    bucketId: '3p-5h',
    displayName: 'Claude 5h',
    window: '5h',
    remainingFraction: 0.85,
    remainingPct: 85.0,
    resetTime: null,
    resetInSeconds: null,
    resetInLabel: '—',
    isLowAlert: false,
  };
  return {
    fetchedAt: '2026-11-14T10:00:12.000Z',
    buckets: [g5h, gWk, p3],
    gemini5h: g5h,
    geminiWeekly: gWk,
    thirdParty5h: p3,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: 0.125,
    burnRate5hPctPerMin: 0.25,
    ...overrides,
  };
}

describe('mcp/embed-card — Flexoki CSS, XSS safety, and atomic persistence', () => {
  it('RTM-27: escapes XSS payloads across all dynamic fields and embeds zero <script> or external URLs', () => {
    const xssScript = '<script>alert(1)</script>';
    const xssImg = '<img src=x onerror=alert(1)>';
    const xssStyleBreak = '</style><script>alert(2)</script>';
    const xssAttr = '" onclick="alert(3)" data-x="';

    const root = makeNode({
      title: `Title ${xssScript}`,
      role: `Role ${xssAttr}`,
      requestedModel: {
        raw: 'req-raw',
        displayName: `Req ${xssImg}`,
        modelId: 'req-id',
        source: 'user',
      },
      servedModel: {
        responseModel: `gemini-4${xssStyleBreak}`,
        displayName: `Served ${xssScript}`,
        modelEnum: 'MODEL_PLACEHOLDER_M427',
        family: 'gemini',
        effortTier: 'xhigh',
        tier: 'apex',
      },
      lastTool: {
        name: `tool${xssImg}`,
        summary: `summary ${xssAttr} ${xssScript}`,
      },
      swarmState: {
        memberName: `worker${xssImg}`,
      },
    });

    const sub = makeNode({
      cascadeId: CID_SUB,
      parentCascadeId: CID_ROOT,
      kind: 'subagent',
      depth: 1,
      title: `Sub ${xssImg}`,
      role: `reviewer ${xssScript}`,
      phase: 'ERROR_OR_QUOTA',
      retryCount: 2,
    });

    const quota = makeQuota();
    if (quota.gemini5h) {
      quota.gemini5h.resetInLabel = `2h ${xssScript}`;
    }

    const input: StatusCardInput = {
      conversationId: CID_ROOT,
      generatedAt: '2026-11-14T10:00:12.000Z',
      hostConnected: true,
      stale: false,
      activeNode: root,
      treeNodes: [root, sub],
      quota,
      smartGovernanceBanner: {
        active: true,
        heavyConcurrentCount: 3,
        gemini5hRemainingPct: 35,
        estimatedBurnPctPerMin: 0.4,
        message: `Banner ${xssImg} ${xssScript}`,
      },
      warnings: [`Warn ${xssStyleBreak} ${xssAttr}`],
    };

    const html = buildStatusCardHtml(input);

    // Zero <script tags anywhere in HTML
    assert.equal(/<script\b/i.test(html), false, 'Must contain zero <script> tags');
    // Zero unescaped HTML injection tags
    assert.equal(html.includes('<img src=x'), false, '<img> payload must be HTML-escaped');
    assert.equal(html.includes('</style><script'), false, '</style> break must be HTML-escaped');
    assert.equal(html.includes('" onclick="alert(3)'), false, 'attribute quote must be HTML-escaped');
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(html.includes('&lt;/style&gt;&lt;script&gt;alert(2)&lt;/script&gt;'));
    assert.ok(html.includes('&quot; onclick=&quot;alert(3)&quot;'));

    // Zero external http://, https://, or protocol-relative CDN URLs
    assert.equal(/https?:\/\//i.test(html), false, 'Must not contain external http(s) URLs');
    assert.equal(/src=["']\/\//i.test(html), false, 'Must not contain protocol-relative URLs');
  });

  it('includes Flexoki Light/Dark palettes, 5 semantic tier colors, theme override, and compact layout', () => {
    const baseInput: StatusCardInput = {
      conversationId: CID_ROOT,
      generatedAt: '2026-11-14T10:00:12.000Z',
      hostConnected: true,
      stale: false,
      activeNode: makeNode(),
      treeNodes: [makeNode()],
      quota: makeQuota(),
    };

    const autoHtml = buildStatusCardHtml(baseInput);
    assert.match(autoHtml, /^<!doctype html>/i);
    assert.ok(autoHtml.includes('data-theme="auto"'));
    assert.ok(autoHtml.includes('max-width: 596px'));

    // Exact Flexoki Light & Dark surfaces + all 5 semantic tiers
    const requiredColors = [
      '#fffcf0',
      '#f2f0e5',
      '#100f0f',
      '#1c1b1a',
      '#5e409d',
      '#8b7ec8',
      '#205ea6',
      '#4385be',
      '#24837b',
      '#3aa99f',
      '#ad8301',
      '#d0a215',
      '#af3029',
      '#d14d41',
    ];
    for (const hex of requiredColors) {
      assert.ok(autoHtml.toLowerCase().includes(hex), `Missing Flexoki hex ${hex}`);
    }

    const lightHtml = buildStatusCardHtml({ ...baseInput, theme: 'light', includeTree: false });
    assert.ok(lightHtml.includes('data-theme="light"'));
    assert.equal(lightHtml.includes('Cascade Topology'), false);

    const darkHtml = buildStatusCardHtml({ ...baseInput, theme: 'dark' });
    assert.ok(darkHtml.includes('data-theme="dark"'));
    assert.ok(darkHtml.includes('Cascade Topology'));
    assert.ok(darkHtml.includes('display: inline-block;'));
    assert.ok(darkHtml.includes('.tree-list'));
    assert.equal(darkHtml.includes('.tree-table'), false);
  });

  it('renders responsive 2-tier child topology rows with explicit Fallback and Retry ×2 pills and uncrushed CTX/Δ labels', () => {
    const root = makeNode({
      cascadeId: CID_ROOT,
      title: 'Root Orchestrator',
      routingStatus: 'routed',
      retryCount: 0,
      contextWindow: {
        estimatedTokensUsed: 42_000,
        maxContextTokens: 256_000,
        pct: 16.4,
        level: 'normal',
      },
      deltaQuota5hPct: 0.125,
    });

    const child = makeNode({
      cascadeId: CID_SUB,
      rootCascadeId: CID_ROOT,
      parentCascadeId: CID_ROOT,
      kind: 'subagent',
      depth: 1,
      title: 'Child Explorer',
      role: 'Explorer',
      routingStatus: 'mismatch_or_fallback',
      retryCount: 2,
      servedModel: {
        responseModel: 'gemini-3-5-flash',
        displayName: 'Gemini 3.5 Flash',
        modelEnum: 'MODEL_PLACEHOLDER_FLASH',
        family: 'gemini',
        effortTier: 'flash',
        tier: 'fast',
      },
      contextWindow: {
        estimatedTokensUsed: 184_320,
        maxContextTokens: 256_000,
        pct: 72.0,
        level: 'warn_70',
      },
      deltaQuota5hPct: 0.42,
      lastTool: {
        name: 'view_file',
        summary: 'src/mcp/embed-card.ts',
      },
    });

    const html = buildStatusCardHtml({
      conversationId: CID_ROOT,
      generatedAt: '2026-11-14T10:00:12.000Z',
      hostConnected: true,
      stale: false,
      activeNode: root,
      treeNodes: [root, child],
      quota: makeQuota(),
    });

    const treeSectionStart = html.indexOf('class="tree-list"');
    assert.notEqual(treeSectionStart, -1);
    const treeSectionHtml = html.slice(treeSectionStart);

    assert.ok(treeSectionHtml.includes('<div class="tree-row-main">'));
    assert.ok(treeSectionHtml.includes('<div class="tree-row-sub"'));
    assert.ok(treeSectionHtml.includes('<span class="pill pill-xs" data-tier="alert">Fallback</span>'));
    assert.ok(treeSectionHtml.includes('<span class="pill pill-xs" data-tier="alert">Retry ×2</span>'));
    assert.ok(treeSectionHtml.includes('CTX 72% · Δ-0.42%'));
    assert.ok(treeSectionHtml.includes('CTX 16% · Δ-0.13%'));
    assert.ok(treeSectionHtml.includes('view_file: src/mcp/embed-card.ts'));
  });

  it('renders offline disconnected fallback cleanly when hostConnected=false and activeNode=null', () => {
    const html = buildStatusCardHtml({
      conversationId: null,
      generatedAt: '2026-11-14T10:00:00.000Z',
      hostConnected: false,
      stale: true,
      activeNode: null,
      treeNodes: [],
      quota: null,
      warnings: ['Host telemetry disconnected'],
    });
    assert.ok(html.includes('Model Pulse Offline'));
    assert.ok(html.includes('OFFLINE / STALE'));
    assert.ok(html.includes('Host: Disconnected'));
    assert.ok(html.includes('No active cascade nodes found'));
  });

  it('RTM-27: persists cards atomically with safe UUID filenames and rejects path traversal', () => {
    assert.equal(resolveSafeCardConversationSegment(null), 'global');
    assert.equal(resolveSafeCardConversationSegment(undefined), 'global');
    assert.equal(resolveSafeCardConversationSegment('global'), 'global');
    assert.equal(resolveSafeCardConversationSegment(CID_ROOT), CID_ROOT);

    assert.throws(() => resolveSafeCardConversationSegment('../evil'), RangeError);
    assert.throws(() => resolveSafeCardConversationSegment('foo/bar'), RangeError);
    assert.throws(() => resolveSafeCardConversationSegment('not-a-uuid'), RangeError);

    const stateDir = makeTempDir();
    const persisted = writeStatusCardFile(
      {
        conversationId: CID_ROOT,
        generatedAt: '2026-11-14T10:00:12.000Z',
        hostConnected: true,
        stale: false,
        activeNode: makeNode(),
        treeNodes: [makeNode()],
        quota: makeQuota(),
      },
      { stateDir, timestampMs: 1700000000123 }
    );

    assert.equal(persisted.safeConversationId, CID_ROOT);
    assert.equal(
      persisted.outputPath,
      path.join(stateDir, 'cards', `${CID_ROOT}-1700000000123.html`)
    );
    assert.ok(persisted.fileUri.startsWith('file://'));
    assert.equal(existsSync(persisted.outputPath), true);
    assert.equal(readFileSync(persisted.outputPath, 'utf8'), persisted.html);

    const cardFiles = readdirSync(path.join(stateDir, 'cards'));
    assert.deepEqual(cardFiles, [`${CID_ROOT}-1700000000123.html`]);

    if (process.platform !== 'win32') {
      assert.equal(statSync(stateDir).mode & 0o777, 0o700);
      assert.equal(statSync(path.join(stateDir, 'cards')).mode & 0o777, 0o700);
      assert.equal(statSync(persisted.outputPath).mode & 0o777, 0o600);
    }

    assert.throws(
      () =>
        writeStatusCardFile(
          {
            conversationId: '../escape',
            generatedAt: '2026-11-14T10:00:12.000Z',
            hostConnected: false,
            stale: true,
            activeNode: null,
            treeNodes: [],
            quota: null,
          },
          { stateDir }
        ),
      RangeError
    );
  });
});
