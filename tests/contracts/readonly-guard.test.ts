import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import ts from 'typescript';
import {
  FORBIDDEN_LS_METHODS,
  LsConnectionError,
  READONLY_LS_METHODS,
  ReadOnlyLsClient,
  ReadonlyRpcViolationError,
} from '../../src/rpc/ls-client';
import { TelemetryEngine } from '../../src/sidecar/telemetry-engine';
import { getStatePaths } from '../../src/state/state-dir';

const REPO_ROOT = existsSync(path.resolve(__dirname, '..', 'package.json'))
  ? path.resolve(__dirname, '..')
  : path.resolve(__dirname, '../..');

const SRC_DIR = path.join(REPO_ROOT, 'src');

const BANNED_RPC_NAMES = [
  'DeleteCascadeTrajectory',
  'UpdateConversationAnnotations',
  'JetboxWriteState',
  'DeletePlugin',
  'InstallCustomization',
  'GetCascadeTrajectory',
] as const;

const FORBIDDEN_HOOK_MODULES = new Set([
  'http',
  'https',
  'http2',
  'net',
  'dgram',
  'tls',
  'undici',
  'node:http',
  'node:https',
  'node:http2',
  'node:net',
  'node:dgram',
  'node:tls',
]);

const FORBIDDEN_HOOK_IDENTIFIERS = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'readdirSync',
  'readdir',
  'opendirSync',
]);

const tempDirs: string[] = [];

function makeTempDir(prefix = 'pulse-ro-guard-'): string {
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

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function isInsideForbiddenListDeclaration(node: ts.Node, relPath: string): boolean {
  if (relPath !== path.join('rpc', 'ls-client.ts')) {
    return false;
  }
  let curr: ts.Node | undefined = node.parent;
  while (curr) {
    if (
      ts.isVariableDeclaration(curr) &&
      ts.isIdentifier(curr.name) &&
      curr.name.text === 'FORBIDDEN_LS_METHODS'
    ) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

describe('contracts/readonly-guard — Static AST scan & Runtime Mock LS audit (RTM-24/25/26)', () => {
  it('Static AST scan: blocks forbidden RPCs, enforces ?mode=ro SQLite, and bans hook network/dir-scan APIs', () => {
    const tsFiles = collectTsFiles(SRC_DIR);
    assert.ok(tsFiles.length >= 10, 'Expected at least 10 source files under src/');

    let verifiedSqliteRoSite = false;

    for (const absPath of tsFiles) {
      const relPath = path.relative(SRC_DIR, absPath);
      const sourceText = readFileSync(absPath, 'utf8');
      const sourceFile = ts.createSourceFile(absPath, sourceText, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node) => {
        // 1. Check all string literals / templates for banned RPC names outside FORBIDDEN_LS_METHODS
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          for (const banned of BANNED_RPC_NAMES) {
            const wordBoundary = new RegExp(`\\b${banned}\\b`);
            if (node.text === banned || wordBoundary.test(node.text)) {
              assert.equal(
                isInsideForbiddenListDeclaration(node, relPath),
                true,
                `Disallowed RPC reference "${banned}" found in src/${relPath}`
              );
            }
          }
        }

        // 2. Check identifiers against banned RPC names and startIndex/endIndex outside types/rpc.ts
        if (ts.isIdentifier(node)) {
          for (const banned of BANNED_RPC_NAMES) {
            assert.notEqual(
              node.text,
              banned,
              `Disallowed RPC identifier "${banned}" found in src/${relPath}`
            );
          }
          if (
            (node.text === 'startIndex' || node.text === 'endIndex') &&
            relPath !== path.join('types', 'rpc.ts')
          ) {
            assert.fail(
              `Disallowed GetCascadeTrajectorySteps field "${node.text}" referenced in src/${relPath}`
            );
          }
        }

        // 3. Enforce ?mode=ro and { readOnly: true } on any DatabaseSync SQLite open call
        if (
          ts.isNewExpression(node) &&
          ((ts.isIdentifier(node.expression) && node.expression.text === 'DatabaseSync') ||
            (ts.isPropertyAccessExpression(node.expression) &&
              node.expression.name.text === 'DatabaseSync'))
        ) {
          const arg0Text = node.arguments?.[0]?.getText(sourceFile) ?? '';
          const arg1Text = node.arguments?.[1]?.getText(sourceFile) ?? '';
          assert.ok(
            arg0Text.includes('?mode=ro'),
            `SQLite DatabaseSync in src/${relPath} must enforce ?mode=ro URI directly`
          );
          assert.ok(
            /readOnly\s*:\s*true/.test(arg1Text),
            `SQLite DatabaseSync in src/${relPath} must pass { readOnly: true }`
          );
          verifiedSqliteRoSite = true;
        }

        // 4. Enforce zero network/dir-scan imports and calls in src/hook/**
        if (relPath.startsWith(`hook${path.sep}`)) {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            assert.equal(
              FORBIDDEN_HOOK_MODULES.has(node.moduleSpecifier.text),
              false,
              `Forbidden network import "${node.moduleSpecifier.text}" in src/${relPath}`
            );
          }
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'require' &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
          ) {
            assert.equal(
              FORBIDDEN_HOOK_MODULES.has(node.arguments[0].text),
              false,
              `Forbidden require("${node.arguments[0].text}") in src/${relPath}`
            );
          }
          if (ts.isIdentifier(node) && FORBIDDEN_HOOK_IDENTIFIERS.has(node.text)) {
            assert.fail(
              `Forbidden hook network/dir-scan identifier "${node.text}" in src/${relPath}`
            );
          }
        }

        // 5. Enforce zero node:* imports in src/core/formatters.ts (browser-shared)
        if (relPath === path.join('core', 'formatters.ts')) {
          if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            assert.equal(
              node.moduleSpecifier.text.startsWith('node:'),
              false,
              `Browser-shared src/core/formatters.ts must not import "${node.moduleSpecifier.text}"`
            );
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }

    assert.equal(
      verifiedSqliteRoSite,
      true,
      'Expected to inspect at least one ?mode=ro DatabaseSync call site in src/'
    );
  });

  it('ReadOnlyLsClient: synchronously blocks all forbidden/unknown RPCs before invoking fetch and enforces L-004 stepOffset', async () => {
    let fetchInvocations = 0;
    const capturedBodies: Array<{ url: string; body: object | null }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      fetchInvocations += 1;
      const parsedBody: unknown = init?.body ? JSON.parse(String(init.body)) : null;
      capturedBodies.push({
        url: String(input),
        body: parsedBody && typeof parsedBody === 'object' ? parsedBody : null,
      });
      return new Response(JSON.stringify({ steps: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new ReadOnlyLsClient({
      address: '127.0.0.1:42100',
      csrfToken: 'test-csrf',
      fetchFn: mockFetch,
    });

    assert.equal(READONLY_LS_METHODS.size, 5);
    assert.equal(FORBIDDEN_LS_METHODS.size, 6);

    for (const forbidden of [
      ...BANNED_RPC_NAMES,
      'WriteSomething',
      'CreateCascade',
      '',
    ]) {
      assert.throws(
        () => client.callReadonlyMethod(forbidden, {}),
        ReadonlyRpcViolationError
      );
    }
    assert.equal(fetchInvocations, 0, 'Forbidden RPCs must throw synchronously without calling fetch');

    // Unconfigured client throws LsConnectionError cleanly
    const unconfigured = new ReadOnlyLsClient({ address: '', csrfToken: '' });
    assert.equal(unconfigured.isConfigured(), false);
    await assert.rejects(() => unconfigured.getAllCascadeTrajectories(), LsConnectionError);

    // L-004 stepOffset + disableRehydration enforcement across step counts
    const cid = '11111111-1111-4111-8111-111111111111';
    await client.getCascadeTrajectorySteps(cid, 2);
    await client.getCascadeTrajectorySteps(cid, 15);

    assert.equal(fetchInvocations, 2);
    assert.deepEqual(capturedBodies[0].body, {
      cascadeId: cid,
      stepOffset: 0,
      disableRehydration: true,
    });
    assert.deepEqual(capturedBodies[1].body, {
      cascadeId: cid,
      stepOffset: 11,
      disableRehydration: true,
    });
    for (const call of capturedBodies) {
      const keys = Object.keys(call.body ?? {});
      assert.equal(keys.includes('startIndex'), false);
      assert.equal(keys.includes('endIndex'), false);
    }
  });

  it('Runtime Mock LS Audit: TelemetryEngine obeys incremental metadata caching (RTM-25) & RUNNING-only stepOffset (L-004)', async () => {
    const recordedCalls: Array<{
      method: string;
      csrf: string | undefined;
      body: Record<string, unknown>;
    }> = [];

    const cidRunning = '11111111-1111-4111-8111-111111111111';
    const cidIdle = '22222222-2222-4222-8222-222222222222';
    const expectedCsrf = 'pulse-audit-csrf-secret';

    let phaseCycle: 1 | 2 | 3 = 1;

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8').trim();
        const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        const method = (req.url ?? '').split('/').pop() ?? '';
        const csrfHeader = req.headers['x-codeium-csrf-token'];
        const csrf = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;

        recordedCalls.push({ method, csrf, body });

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');

        if (method === 'GetCascadeModelConfigData') {
          res.end(
            JSON.stringify({
              defaultOverrideModelConfig: { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M667' } },
              clientModelConfigs: [
                {
                  label: 'Gemini 4 Carbon (High)',
                  modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
                  modelId: 'gemini-4-carbon-high',
                },
                {
                  label: 'Orchestrator (Carbon)',
                  modelOrAlias: { model: 'MODEL_PLACEHOLDER_M667' },
                  modelId: 'gemini-pro-orchestrator',
                },
              ],
            })
          );
          return;
        }

        if (method === 'RetrieveUserQuotaSummary') {
          res.end(
            JSON.stringify({
              response: {
                groups: [
                  {
                    groupId: 'gemini',
                    buckets: [
                      {
                        bucketId: 'gemini-5h',
                        displayName: 'Gemini 5h',
                        window: '5h',
                        remainingFraction: phaseCycle === 3 ? 0.84324217 : 0.84972906,
                        resetTime: '2026-11-14T15:00:00Z',
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
          res.end(
            JSON.stringify({
              trajectorySummaries: {
                [cidRunning]: {
                  status:
                    phaseCycle === 3
                      ? 'CASCADE_RUN_STATUS_IDLE'
                      : 'CASCADE_RUN_STATUS_RUNNING',
                  stepCount: phaseCycle === 3 ? 11 : 10,
                  summary: 'Active Root',
                  lastModifiedTime: '2026-11-14T10:00:00.000Z',
                },
                [cidIdle]: {
                  status: 'CASCADE_RUN_STATUS_IDLE',
                  stepCount: 4,
                  summary: 'Dormant Cascade',
                  lastModifiedTime: '2026-11-14T09:00:00.000Z',
                },
              },
            })
          );
          return;
        }

        if (method === 'GetCascadeTrajectoryGeneratorMetadata') {
          res.end(
            JSON.stringify({
              generatorMetadata: [
                {
                  stepIndices: [0, 1],
                  chatModel: {
                    model: 'MODEL_PLACEHOLDER_M427',
                    modelDisplayName: 'Gemini 4 Carbon (High)',
                    responseModel: 'gemini-4-carbon',
                    customMetadata: { model_enum: 'MODEL_PLACEHOLDER_M427' },
                    retryInfos: [{ attempt: 1 }],
                    usage: { inputTokens: '1200', cacheReadTokens: '4800', outputTokens: '300' },
                  },
                },
              ],
            })
          );
          return;
        }

        if (method === 'GetCascadeTrajectorySteps') {
          res.end(
            JSON.stringify({
              steps: [
                {
                  status: 'CORTEX_STEP_STATUS_GENERATING',
                  metadata: { createdAt: '2026-11-14T10:00:01.000Z' },
                },
              ],
            })
          );
          return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: `Unexpected method ${method}` }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const addr = server.address();
      assert.ok(addr && typeof addr === 'object');

      const stateDir = makeTempDir('pulse-ro-state-');
      const dataDir = makeTempDir('pulse-ro-data-');
      mkdirSync(path.join(dataDir, 'brain'), { recursive: true });

      const lsClient = new ReadOnlyLsClient({
        address: `127.0.0.1:${addr.port}`,
        csrfToken: expectedCsrf,
        timeoutMs: 2000,
      });

      const engine = new TelemetryEngine({
        lsClient,
        statePaths: getStatePaths(stateDir),
        antigravityDataDir: dataDir,
      });

      // Cycle 1: uncached -> fetches genMeta for both, steps ONLY for cidRunning
      const t0 = Date.parse('2026-11-14T10:00:05.000Z');
      await engine.refreshOnce(t0);

      const cycle1MetaCids = recordedCalls
        .filter((c) => c.method === 'GetCascadeTrajectoryGeneratorMetadata')
        .map((c) => c.body.cascadeId);
      assert.deepEqual(cycle1MetaCids.sort(), [cidRunning, cidIdle].sort());

      const cycle1Steps = recordedCalls.filter((c) => c.method === 'GetCascadeTrajectorySteps');
      assert.equal(cycle1Steps.length, 1);
      assert.deepEqual(cycle1Steps[0].body, {
        cascadeId: cidRunning,
        stepOffset: 6,
        disableRehydration: true,
      });

      // Cycle 2: unchanged stepCount -> ZERO GetCascadeTrajectoryGeneratorMetadata calls; steps ONLY for cidRunning
      recordedCalls.length = 0;
      phaseCycle = 2;
      await engine.refreshOnce(t0 + 1000);

      const cycle2Meta = recordedCalls.filter(
        (c) => c.method === 'GetCascadeTrajectoryGeneratorMetadata'
      );
      assert.equal(
        cycle2Meta.length,
        0,
        'GetCascadeTrajectoryGeneratorMetadata must NOT be re-called when stepCount is unchanged'
      );

      const cycle2Steps = recordedCalls.filter((c) => c.method === 'GetCascadeTrajectorySteps');
      assert.equal(cycle2Steps.length, 1);
      assert.equal(cycle2Steps[0].body.cascadeId, cidRunning);
      assert.equal(cycle2Steps[0].body.stepOffset, 6);
      assert.equal(cycle2Steps[0].body.disableRehydration, true);

      // Cycle 3: cidRunning transitions to IDLE with stepCount 11 -> genMeta ONLY for cidRunning, ZERO step calls
      recordedCalls.length = 0;
      phaseCycle = 3;
      await engine.refreshOnce(t0 + 2000);

      const cycle3MetaCids = recordedCalls
        .filter((c) => c.method === 'GetCascadeTrajectoryGeneratorMetadata')
        .map((c) => c.body.cascadeId);
      assert.deepEqual(cycle3MetaCids, [cidRunning]);

      const cycle3Steps = recordedCalls.filter((c) => c.method === 'GetCascadeTrajectorySteps');
      assert.equal(cycle3Steps.length, 0, 'IDLE cascades must never invoke GetCascadeTrajectorySteps');

      // Anti-Stale Reconciler verified in live snapshot
      const hud = engine.getHudSnapshot(cidRunning);
      assert.equal('unchanged' in hud, false);
      if (!('unchanged' in hud)) {
        assert.equal(hud.activeNode?.phase, 'IDLE');
      }

      // Global invariants across all recorded RPC calls
      for (const call of recordedCalls) {
        assert.equal(call.csrf, expectedCsrf);
        assert.equal(READONLY_LS_METHODS.has(call.method), true);
        assert.equal(FORBIDDEN_LS_METHODS.has(call.method), false);
      }

      engine.stop();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
