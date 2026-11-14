import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { buildModelCatalog } from '../../src/core/model-catalog';
import {
  buildBreadcrumb,
  buildTopologyGraph,
  readFallbackTitleFromAnnotations,
  resolveCascadeTitle,
} from '../../src/core/topology-builder';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'pulse-topo-test-'): string {
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

describe('core/topology-builder — 3-source fusion, title fallback, preflight & cycle guard', () => {
  it('RTM-06: executes 4-step title fallback chain (summary -> .pbtxt -> workspace basename -> role/id)', () => {
    const dataDir = makeTempDir();
    const annotationsDir = path.join(dataDir, 'annotations');
    mkdirSync(annotationsDir, { recursive: true });

    const cidWithPbtxt = '22222222-2222-4222-8222-222222222222';
    writeFileSync(
      path.join(annotationsDir, `${cidWithPbtxt}.pbtxt`),
      'title: "Fix \\"Auth\\" & Cache\\\\Layer"\ncreated_at: 123\n',
      'utf8'
    );

    assert.equal(
      readFallbackTitleFromAnnotations(dataDir, cidWithPbtxt),
      'Fix "Auth" & Cache\\Layer'
    );
    assert.equal(readFallbackTitleFromAnnotations(dataDir, '../escape'), null);

    // 1. summary wins
    assert.equal(
      resolveCascadeTitle({ summary: 'Primary Title' }, dataDir, cidWithPbtxt, 'worker'),
      'Primary Title'
    );

    // 2. summary: null -> .pbtxt
    assert.equal(
      resolveCascadeTitle({ summary: null }, dataDir, cidWithPbtxt, 'worker'),
      'Fix "Auth" & Cache\\Layer'
    );

    // 3. no .pbtxt -> workspace URI basename (POSIX + Windows)
    const cidWs = '33333333-3333-4333-8333-333333333333';
    assert.equal(
      resolveCascadeTitle(
        {
          summary: null,
          workspaces: [{ workspaceFolderAbsoluteUri: 'file:///home/user/antigravity-pulse/' }],
        },
        dataDir,
        cidWs,
        'worker'
      ),
      'antigravity-pulse'
    );

    // 4. fallback to role, else Cascade <8 chars>
    assert.equal(resolveCascadeTitle({ summary: '' }, dataDir, cidWs, 'Security Auditor'), 'Security Auditor');
    assert.equal(resolveCascadeTitle(undefined, dataDir, cidWs, null), 'Cascade 33333333');
  });

  it('RTM-09 / L-005: fuses multi-level subagents/*.json, swarm/members.json object map, and customMetadata', () => {
    const dataDir = makeTempDir();
    const rootCid = '11111111-1111-4111-8111-111111111111';
    const subCid = '22222222-2222-4222-8222-222222222222';
    const grandCid = '33333333-3333-4333-8333-333333333333';
    const swarmCid = '44444444-4444-4444-8444-444444444444';

    // Subagent JSON under root
    const rootSubDir = path.join(dataDir, 'brain', rootCid, '.system_generated', 'subagents');
    mkdirSync(rootSubDir, { recursive: true });
    writeFileSync(
      path.join(rootSubDir, 'sub-1.json'),
      JSON.stringify({
        conversationId: subCid,
        subagentDescriptor: { typeName: 'self', role: 'Core Implementer' },
        spawnStepIndex: 4,
        workspaceUris: ['file:///tmp/demo-project'],
      }),
      'utf8'
    );

    // Swarm members object map (L-005) under root
    const swarmDir = path.join(dataDir, 'brain', rootCid, '.system_generated', 'swarm');
    mkdirSync(swarmDir, { recursive: true });
    writeFileSync(
      path.join(swarmDir, 'members.json'),
      JSON.stringify({
        title: 'Swarm Team',
        members: {
          'alpha-tester': {
            conversation_id: swarmCid,
            role: 'Verification Specialist',
            desired_state: 'running',
            desired_model: 'flash',
            applied_model: 'MODEL_PLACEHOLDER_M667',
            phase: 'thinking',
            wake_mode: 'auto',
            killed: false,
          },
        },
      }),
      'utf8'
    );

    // Annotation fallback for subCid
    mkdirSync(path.join(dataDir, 'annotations'), { recursive: true });
    writeFileSync(path.join(dataDir, 'annotations', `${subCid}.pbtxt`), 'title: "Subagent Pbtxt Title"\n');

    const catalog = buildModelCatalog(null);
    const out = buildTopologyGraph({
      antigravityDataDir: dataDir,
      lsConnected: true,
      modelCatalog: catalog,
      trajectories: {
        [rootCid]: {
          status: 'CASCADE_RUN_STATUS_RUNNING',
          stepCount: 8,
          summary: 'Root Orchestration',
        },
        [subCid]: {
          status: 'CASCADE_RUN_STATUS_RUNNING',
          stepCount: 3,
          summary: null,
        },
        [grandCid]: {
          status: 'CASCADE_RUN_STATUS_IDLE',
          stepCount: 2,
          summary: 'Grandchild Search',
        },
        [swarmCid]: {
          status: 'CASCADE_RUN_STATUS_RUNNING',
          stepCount: 1,
          summary: 'Swarm QA',
        },
      },
      generatorMetadataByCascade: {
        [rootCid]: [
          {
            stepIndices: [0, 1],
            chatModel: {
              model: 'MODEL_PLACEHOLDER_M427',
              modelDisplayName: 'Gemini 4 Carbon (High)',
              responseModel: 'gemini-4-carbon',
              usage: { inputTokens: '1000', cacheReadTokens: '9000', outputTokens: '500' },
              timeToFirstToken: '12.1s',
            },
          },
        ],
        [grandCid]: [
          {
            stepIndices: [0],
            chatModel: {
              modelDisplayName: 'Gemini 3.8 Flash',
              responseModel: 'gemini-3.8-flash',
              customMetadata: {
                parent_cascade_id: subCid,
                root_cascade_id: rootCid,
              },
              usage: { inputTokens: '200', cacheReadTokens: '800', outputTokens: '100' },
            },
          },
        ],
      },
    });

    const root = out.nodesByCascadeId[rootCid];
    const sub = out.nodesByCascadeId[subCid];
    const grand = out.nodesByCascadeId[grandCid];
    const swarm = out.nodesByCascadeId[swarmCid];

    assert.equal(root.depth, 0);
    assert.equal(root.cacheHitPct, 90);
    assert.equal(root.lastTtftMs, 12100);
    assert.deepEqual(root.childrenIds.sort(), [subCid, swarmCid].sort());

    assert.equal(sub.depth, 1);
    assert.equal(sub.parentCascadeId, rootCid);
    assert.equal(sub.rootCascadeId, rootCid);
    assert.equal(sub.title, 'Subagent Pbtxt Title');
    assert.equal(sub.kind, 'subagent');
    assert.deepEqual(sub.childrenIds, [grandCid]);

    assert.equal(grand.depth, 2);
    assert.equal(grand.parentCascadeId, subCid);
    assert.equal(grand.rootCascadeId, rootCid);

    assert.equal(swarm.depth, 1);
    assert.equal(swarm.kind, 'swarm_member');
    assert.equal(swarm.swarmState?.memberName, 'alpha-tester');
    assert.equal(swarm.requestedModel.source, 'swarm');

    const breadcrumb = buildBreadcrumb(rootCid, grandCid, out.nodesByCascadeId);
    assert.deepEqual(
      breadcrumb.map((b) => b.cascadeId),
      [rootCid, subCid, grandCid]
    );
  });

  it('supports optional strictly read-only SQLite parent fallback when metadata omits parent_cascade_id', () => {
    const sqlite = typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('node:sqlite') : undefined;
    if (!sqlite?.DatabaseSync) {
      return;
    }

    const dataDir = makeTempDir();
    const convDir = path.join(dataDir, 'conversations');
    mkdirSync(convDir, { recursive: true });

    const rootCid = 'aaaa1111-1111-4111-8111-111111111111';
    const childCid = 'bbbb2222-2222-4222-8222-222222222222';
    const dbPath = path.join(convDir, `${childCid}.db`);

    const db = new sqlite.DatabaseSync(dbPath);
    db.exec('CREATE TABLE cascade_meta (parent_cascade_id TEXT, root_cascade_id TEXT);');
    db.prepare('INSERT INTO cascade_meta (parent_cascade_id, root_cascade_id) VALUES (?, ?)').run(
      rootCid,
      rootCid
    );
    db.close();

    const out = buildTopologyGraph({
      antigravityDataDir: dataDir,
      modelCatalog: buildModelCatalog(null),
      trajectories: {
        [rootCid]: { summary: 'Parent Root', status: 'CASCADE_RUN_STATUS_IDLE' },
        [childCid]: { summary: 'SQLite Linked Child', status: 'CASCADE_RUN_STATUS_IDLE' },
      },
      generatorMetadataByCascade: {},
    });

    assert.equal(out.nodesByCascadeId[childCid].parentCascadeId, rootCid);
    assert.equal(out.nodesByCascadeId[childCid].rootCascadeId, rootCid);
    assert.equal(out.nodesByCascadeId[childCid].depth, 1);
  });

  it('synthesizes T=0ms preflight subagent node and deduplicates once real subagents/*.json materializes', () => {
    const dataDir = makeTempDir();
    const rootCid = '11111111-1111-4111-8111-111111111111';
    const nowMs = Date.parse('2026-11-14T10:00:10.000Z');

    const preflightOut = buildTopologyGraph({
      antigravityDataDir: dataDir,
      modelCatalog: buildModelCatalog(null),
      trajectories: {
        [rootCid]: { summary: 'Root', status: 'CASCADE_RUN_STATUS_RUNNING' },
      },
      generatorMetadataByCascade: {},
      recentHookEvents: [
        {
          ts: nowMs - 1000,
          iso: new Date(nowMs - 1000).toISOString(),
          event: 'PreToolUse',
          conversationId: rootCid,
          toolName: 'invoke_subagent',
          toolCallId: 'tc-spawn-1',
          subagentRequest: {
            role: 'Code Explorer',
            typeName: 'research',
            model: 'flash',
          },
        },
      ],
      nowMs,
    });

    const preNode = preflightOut.nodesByCascadeId[`preflight:${rootCid}:tc-spawn-1`];
    assert.ok(preNode);
    assert.equal(preNode.phase, 'PRE_FLIGHT');
    assert.equal(preNode.role, 'Code Explorer');
    assert.equal(preNode.requestedModel.raw, 'flash');

    // Materialize real subagent descriptor -> preflight node must deduplicate automatically
    const realSubCid = '55555555-5555-4555-8555-555555555555';
    const subDir = path.join(dataDir, 'brain', rootCid, '.system_generated', 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(subDir, 'explorer.json'),
      JSON.stringify({
        conversationId: realSubCid,
        subagentDescriptor: { typeName: 'research', role: 'Code Explorer' },
      }),
      'utf8'
    );

    const dedupOut = buildTopologyGraph({
      antigravityDataDir: dataDir,
      modelCatalog: buildModelCatalog(null),
      trajectories: {
        [rootCid]: { summary: 'Root', status: 'CASCADE_RUN_STATUS_RUNNING' },
        [realSubCid]: {
          summary: 'Code Explorer Run',
          status: 'CASCADE_RUN_STATUS_RUNNING',
          createdTime: new Date(nowMs - 500).toISOString(),
        },
      },
      generatorMetadataByCascade: {},
      recentHookEvents: [
        {
          ts: nowMs - 1000,
          iso: new Date(nowMs - 1000).toISOString(),
          event: 'PreToolUse',
          conversationId: rootCid,
          toolName: 'invoke_subagent',
          toolCallId: 'tc-spawn-1',
          subagentRequest: {
            role: 'Code Explorer',
            typeName: 'research',
            model: 'flash',
          },
        },
      ],
      nowMs,
    });

    assert.equal(dedupOut.nodesByCascadeId[`preflight:${rootCid}:tc-spawn-1`], undefined);
    assert.ok(dedupOut.nodesByCascadeId[realSubCid]);
  });

  it('guards against cyclic parent_cascade_id metadata without infinite recursion', () => {
    const dataDir = makeTempDir();
    const cidA = 'aaaa0000-0000-4000-8000-000000000001';
    const cidB = 'bbbb0000-0000-4000-8000-000000000002';

    const out = buildTopologyGraph({
      antigravityDataDir: dataDir,
      modelCatalog: buildModelCatalog(null),
      trajectories: {
        [cidA]: { summary: 'Node A', status: 'CASCADE_RUN_STATUS_IDLE' },
        [cidB]: { summary: 'Node B', status: 'CASCADE_RUN_STATUS_IDLE' },
      },
      generatorMetadataByCascade: {
        [cidA]: [{ chatModel: { customMetadata: { parent_cascade_id: cidB } } }],
        [cidB]: [{ chatModel: { customMetadata: { parent_cascade_id: cidA } } }],
      },
    });

    assert.ok(out.warnings.some((w) => w.includes('Cycle detected')));
    assert.ok(out.nodesByCascadeId[cidA]);
    assert.ok(out.nodesByCascadeId[cidB]);
    assert.ok(out.nodesByCascadeId[cidA].depth <= 2);
  });
});
