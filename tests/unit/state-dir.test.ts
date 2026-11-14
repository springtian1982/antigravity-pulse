import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  ConfigValidationError,
  DEFAULT_CONFIG,
  DEFAULT_PULSE_USER_CONFIG,
  loadConfig,
  mergeConfig,
  saveConfig,
  updateConfigPartial,
  validateConfigPatch,
} from '../../src/state/config-store';
import {
  appendRingLine,
  assertValidUuid,
  ensureStateDir,
  getStatePaths,
  isValidUuid,
  readJsonSafe,
  resolveStateDir,
  RING_MAX_BYTES,
  rotateRingIfNeeded,
  UUID_REGEX,
  writeJsonAtomic,
} from '../../src/state/state-dir';
import type { HookRingEvent } from '../../src/types/telemetry';

const tempDirs: string[] = [];

function makeTempDir(prefix = 'pulse-state-test-'): string {
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

describe('state-dir resolution, atomicity, permissions, UUIDs & ring rotation', () => {
  it('resolves $PULSE_STATE_DIR priority: override > ANTIGRAVITY_PULSE_STATE_DIR > PLUGIN_DATA > homedir fallback', () => {
    const prevPulse = process.env.ANTIGRAVITY_PULSE_STATE_DIR;
    const prevPluginData = process.env.PLUGIN_DATA;
    try {
      delete process.env.ANTIGRAVITY_PULSE_STATE_DIR;
      delete process.env.PLUGIN_DATA;
      assert.equal(
        resolveStateDir(),
        path.join(os.homedir(), '.gemini', 'antigravity', 'pulse-state')
      );

      process.env.PLUGIN_DATA = '/tmp/plugin-data-dir';
      assert.equal(resolveStateDir(), path.resolve('/tmp/plugin-data-dir'));

      process.env.ANTIGRAVITY_PULSE_STATE_DIR = '/tmp/pulse-override-dir';
      assert.equal(resolveStateDir(), path.resolve('/tmp/pulse-override-dir'));

      assert.equal(resolveStateDir('/tmp/explicit-arg-dir'), path.resolve('/tmp/explicit-arg-dir'));
    } finally {
      if (prevPulse === undefined) delete process.env.ANTIGRAVITY_PULSE_STATE_DIR;
      else process.env.ANTIGRAVITY_PULSE_STATE_DIR = prevPulse;

      if (prevPluginData === undefined) delete process.env.PLUGIN_DATA;
      else process.env.PLUGIN_DATA = prevPluginData;
    }
  });

  it('exposes exact frozen StateDirPaths keys', () => {
    const base = makeTempDir();
    const paths = getStatePaths(base);
    assert.deepEqual(Object.keys(paths).sort(), [
      'configPath',
      'eventsRing',
      'eventsRingPrev',
      'liveSnapshot',
      'modelMap',
      'quotaCache',
      'stampDedup',
      'stateDir',
    ]);
    assert.equal(paths.stateDir, base);
    assert.equal(paths.eventsRing, path.join(base, 'events.ring.jsonl'));
    assert.equal(paths.eventsRingPrev, path.join(base, 'events.ring.prev.jsonl'));
    assert.equal(paths.liveSnapshot, path.join(base, 'live-snapshot.json'));
    assert.equal(paths.modelMap, path.join(base, 'model-map.json'));
    assert.equal(paths.quotaCache, path.join(base, 'quota-cache.json'));
    assert.equal(paths.configPath, path.join(base, 'config.json'));
    assert.equal(paths.stampDedup, path.join(base, 'stamp-dedup.json'));
  });

  it('enforces 0700 dir / 0600 file permissions and atomic writes with zero residual .tmp files', () => {
    const base = path.join(makeTempDir(), 'nested-state');
    const createdDir = ensureStateDir(base);
    assert.equal(createdDir, base);

    const targetFile = getStatePaths(base).liveSnapshot;
    const payload = { schemaVersion: 1, hello: 'world', count: 42 };
    writeJsonAtomic(targetFile, payload);

    if (process.platform !== 'win32') {
      assert.equal(statSync(base).mode & 0o777, 0o700);
      assert.equal(statSync(targetFile).mode & 0o777, 0o600);
    }

    assert.deepEqual(readJsonSafe(targetFile, null), payload);
    const files = readdirSync(base);
    assert.deepEqual(
      files.filter((f) => f.endsWith('.tmp')),
      []
    );
  });

  it('readJsonSafe returns exact fallback on missing, empty, or corrupted JSON', () => {
    const base = makeTempDir();
    const missing = path.join(base, 'missing.json');
    const empty = path.join(base, 'empty.json');
    const corrupt = path.join(base, 'corrupt.json');

    writeFileSync(empty, '   \n', 'utf8');
    writeFileSync(corrupt, '{bad json', 'utf8');

    const fallback = { ok: false, items: [] as string[] };
    assert.equal(readJsonSafe(missing, fallback), fallback);
    assert.equal(readJsonSafe(empty, fallback), fallback);
    assert.equal(readJsonSafe(corrupt, fallback), fallback);
  });

  it('validates 36-char UUIDs strictly and rejects traversal / invalid strings', () => {
    assert.equal(UUID_REGEX.source, '^[0-9a-f-]{36}$');
    assert.equal(isValidUuid('198d5aa0-44bb-4273-9a52-b83805a34a3a'), true);
    assert.equal(isValidUuid('198D5AA0-44BB-4273-9A52-B83805A34A3A'), true);
    assert.equal(assertValidUuid('198d5aa0-44bb-4273-9a52-b83805a34a3a'), '198d5aa0-44bb-4273-9a52-b83805a34a3a');

    for (const bad of [
      '',
      '../escape',
      '198d5aa0-44bb-4273-9a52-b83805a34a3',   // 35 chars
      '198d5aa0-44bb-4273-9a52-b83805a34a3aa', // 37 chars
      '198d5aa0 44bb-4273-9a52-b83805a34a3a',  // whitespace
      '198d5aa0-44bb-4273-9a52-b83805a34a3z',  // non-hex
      null,
      undefined,
      123,
    ]) {
      assert.equal(isValidUuid(bad), false);
      assert.throws(() => assertValidUuid(bad), RangeError);
    }
  });

  it('appends NDJSON events and rotates only when exceeding 512 KiB', () => {
    const base = makeTempDir();
    const paths = getStatePaths(base);

    const sampleEvent: HookRingEvent = {
      ts: 1_700_000_000_000,
      iso: '2026-11-14T10:00:00.000Z',
      event: 'PreInvocation',
      conversationId: '198d5aa0-44bb-4273-9a52-b83805a34a3a',
      invocationNum: 1,
      modelRaw: 'MODEL_PLACEHOLDER_M427',
    };

    const writtenPath = appendRingLine(sampleEvent, base);
    assert.equal(writtenPath, paths.eventsRing);
    assert.deepEqual(JSON.parse(readFileSync(paths.eventsRing, 'utf8').trim()), sampleEvent);

    const smallCheck = rotateRingIfNeeded(base);
    assert.equal(smallCheck.rotated, false);
    assert.equal(existsSync(paths.eventsRingPrev), false);

    // Exceed 512 KiB
    assert.equal(RING_MAX_BYTES, 512 * 1024);
    writeFileSync(paths.eventsRing, Buffer.alloc(RING_MAX_BYTES + 64, 'a'));
    const rotated = rotateRingIfNeeded(base);
    assert.equal(rotated.rotated, true);
    assert.equal(rotated.prevPath, paths.eventsRingPrev);
    assert.equal(rotated.sizeBytes, RING_MAX_BYTES + 64);
    assert.equal(existsSync(paths.eventsRing), false);
    assert.equal(existsSync(paths.eventsRingPrev), true);
  });
});

describe('config-store defaults, validation, persistence & prototype-pollution defense', () => {
  it('exposes canonical DEFAULT_PULSE_USER_CONFIG & DEFAULT_CONFIG defaults', () => {
    assert.equal(DEFAULT_CONFIG, DEFAULT_PULSE_USER_CONFIG);
    assert.equal(DEFAULT_PULSE_USER_CONFIG.version, 1);
    assert.equal(DEFAULT_PULSE_USER_CONFIG.inlineStampMode, 'smart');
    assert.equal(DEFAULT_PULSE_USER_CONFIG.hudSortMode, 'active-first');
    assert.equal(DEFAULT_PULSE_USER_CONFIG.timelineScope, 'tree');
    assert.deepEqual(DEFAULT_PULSE_USER_CONFIG.smartThresholds, {
      contextWarnPct: 70,
      contextCriticalPct: 85,
      stampContextTriggerPct: 75,
      quotaLowTriggerPct: 20,
      heavyConcurrentAlertCount: 3,
      heavyQuotaThresholdPct: 40,
    });
    assert.deepEqual(DEFAULT_PULSE_USER_CONFIG.pollIntervalsMs, {
      active: 1000,
      idle: 3000,
      quota: 30_000,
      modelConfig: 30_000,
    });
  });

  it('persists partial updates atomically and merges nested thresholds without clobbering siblings', () => {
    const base = makeTempDir();
    const initial = loadConfig(base);
    assert.equal(initial.inlineStampMode, 'smart');

    const updated1 = updateConfigPartial(
      {
        inlineStampMode: 'every-turn',
        smartThresholds: { contextWarnPct: 68 },
      },
      base
    );
    assert.equal(updated1.inlineStampMode, 'every-turn');
    assert.equal(updated1.smartThresholds.contextWarnPct, 68);
    assert.equal(updated1.smartThresholds.contextCriticalPct, 85);

    const updated2 = updateConfigPartial({ hudSortMode: 'topology-tree' }, base);
    assert.equal(updated2.inlineStampMode, 'every-turn');
    assert.equal(updated2.hudSortMode, 'topology-tree');
    assert.equal(updated2.smartThresholds.contextWarnPct, 68);

    const reloaded = loadConfig(base);
    assert.equal(reloaded.inlineStampMode, 'every-turn');
    assert.equal(reloaded.hudSortMode, 'topology-tree');
    assert.equal(reloaded.smartThresholds.contextWarnPct, 68);

    const saved = saveConfig(mergeConfig(DEFAULT_PULSE_USER_CONFIG, { timelineScope: 'conversation' }), base);
    assert.equal(saved.timelineScope, 'conversation');
  });

  it('rejects non-objects, invalid enums, out-of-range numbers, unknown keys & blocks __proto__ pollution', () => {
    const base = makeTempDir();

    assert.throws(() => validateConfigPatch(null), ConfigValidationError);
    assert.throws(() => validateConfigPatch(['smart']), ConfigValidationError);
    assert.throws(() => validateConfigPatch({ inlineStampMode: 'always' }), ConfigValidationError);
    assert.throws(() => validateConfigPatch({ hudSortMode: 'random' }), ConfigValidationError);
    assert.throws(() => validateConfigPatch({ timelineScope: 'all' }), ConfigValidationError);
    assert.throws(() => validateConfigPatch({ unknownKey: true }), ConfigValidationError);
    assert.throws(
      () => validateConfigPatch({ smartThresholds: { contextWarnPct: 0 } }),
      ConfigValidationError
    );
    assert.throws(
      () => validateConfigPatch({ smartThresholds: { contextCriticalPct: 120 } }),
      ConfigValidationError
    );
    assert.throws(
      () => validateConfigPatch({ smartThresholds: { heavyConcurrentAlertCount: 1.5 } }),
      ConfigValidationError
    );
    assert.throws(
      () => validateConfigPatch({ pollIntervalsMs: { active: 10 } }),
      ConfigValidationError
    );

    const malicious = JSON.parse(
      '{"inlineStampMode":"off","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"hacked":true}},"smartThresholds":{"contextWarnPct":72,"__proto__":{"nestedPolluted":true}}}'
    ) as unknown;

    const updated = updateConfigPartial(malicious, base);
    assert.equal(updated.inlineStampMode, 'off');
    assert.equal(updated.smartThresholds.contextWarnPct, 72);

    const probe: Record<string, unknown> = {};
    assert.equal(probe.polluted, undefined);
    assert.equal(probe.hacked, undefined);
    assert.equal(probe.nestedPolluted, undefined);

    const rawConfigText = readFileSync(getStatePaths(base).configPath, 'utf8');
    assert.equal(rawConfigText.includes('polluted'), false);
    assert.equal(rawConfigText.includes('hacked'), false);
  });
});
