import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  CascadeNodeView,
  FleetSnapshotResponse,
  HookRingEvent,
  ModelConfigEntry,
  QuotaSummaryView,
} from '../types/telemetry';

export const UUID_REGEX = /^[0-9a-f-]{36}$/i;
export const RING_MAX_BYTES = 512 * 1024;
let atomicTmpSeq = 0;

export interface StateDirPaths {
  stateDir: string;
  eventsRing: string;      // <stateDir>/events.ring.jsonl
  eventsRingPrev: string;  // <stateDir>/events.ring.prev.jsonl
  liveSnapshot: string;    // <stateDir>/live-snapshot.json
  modelMap: string;        // <stateDir>/model-map.json
  quotaCache: string;      // <stateDir>/quota-cache.json
  configPath: string;      // <stateDir>/config.json
  stampDedup: string;      // <stateDir>/stamp-dedup.json
}

export interface LiveSnapshotFile {
  schemaVersion: 1;
  updatedAt: string;
  hostConnected: boolean;
  activeConversationId: string | null;
  nodesByCascadeId: Record<string, CascadeNodeView>;
  fleet: FleetSnapshotResponse;
  quota: QuotaSummaryView;
}

export interface ModelMapFile {
  schemaVersion: 1;
  updatedAt: string;
  defaultModelEnum: string | null;
  modelsByEnum: Record<string, ModelConfigEntry>;
}

export interface CascadeQuotaBaseline {
  firstSeenAt: string;
  baseline5hFraction: number | null;
  last5hFraction: number | null;
  delta5hPct: number;
}

export interface QuotaCacheFile {
  schemaVersion: 1;
  updatedAt: string;
  quota: QuotaSummaryView;
  cascadeBaselines: Record<string, CascadeQuotaBaseline>;
}

export interface StampDedupEntry {
  lastInvocationNum: number;
  lastServedModel: string;
  lastTurnStamped: boolean;
  lastContextAlertPct: number;
  lastQuotaAlerted: boolean;
  updatedAt: string;
}

export interface StampDedupFile {
  schemaVersion: 1;
  byConversation: Record<string, StampDedupEntry>;
}

function tryChmod(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(targetPath, mode);
  } catch {
    // Best-effort on non-supporting filesystems
  }
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function assertValidUuid(value: unknown, fieldName = 'conversationId'): string {
  if (!isValidUuid(value)) {
    throw new RangeError(`Invalid ${fieldName}: expected 36-character UUID`);
  }
  return value;
}

export function resolveStateDir(overrideDir?: string): string {
  const trimmedOverride = overrideDir?.trim();
  const envStateDir = process.env.ANTIGRAVITY_PULSE_STATE_DIR?.trim();
  const pluginData = process.env.PLUGIN_DATA?.trim();
  const appDataDir =
    process.env.ANTIGRAVITY_APP_DATA_DIR?.trim() ||
    process.env.ANTIGRAVITY_DATA_DIR?.trim() ||
    path.join(os.homedir(), '.gemini', 'antigravity');
  const chosen =
    trimmedOverride ||
    envStateDir ||
    pluginData ||
    path.join(appDataDir, 'plugin_data', 'antigravity-pulse');
  return path.resolve(chosen);
}

export function getStatePaths(overrideDir?: string): StateDirPaths {
  const stateDir = resolveStateDir(overrideDir);
  return {
    stateDir,
    eventsRing: path.join(stateDir, 'events.ring.jsonl'),
    eventsRingPrev: path.join(stateDir, 'events.ring.prev.jsonl'),
    liveSnapshot: path.join(stateDir, 'live-snapshot.json'),
    modelMap: path.join(stateDir, 'model-map.json'),
    quotaCache: path.join(stateDir, 'quota-cache.json'),
    configPath: path.join(stateDir, 'config.json'),
    stampDedup: path.join(stateDir, 'stamp-dedup.json'),
  };
}

export function ensureStateDir(overrideDir?: string): string {
  const stateDir = resolveStateDir(overrideDir);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  tryChmod(stateDir, 0o700);
  return stateDir;
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const parentDir = path.dirname(filePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    tryChmod(parentDir, 0o700);
  }
  atomicTmpSeq = (atomicTmpSeq + 1) >>> 0;
  const suffix = `${process.pid}.${process.hrtime.bigint().toString(36)}.${atomicTmpSeq.toString(36)}`;
  const tmpPath = `${filePath}.${suffix}.tmp`;
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  try {
    writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
    tryChmod(tmpPath, 0o600);
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

export function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }
    const raw = readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function appendRingLine(event: HookRingEvent, overrideDir?: string): string {
  ensureStateDir(overrideDir);
  const { eventsRing } = getStatePaths(overrideDir);
  const line = `${JSON.stringify(event)}\n`;
  appendFileSync(eventsRing, line, { encoding: 'utf8', mode: 0o600 });
  return eventsRing;
}

export function rotateRingIfNeeded(
  overrideDir?: string,
  maxBytes = RING_MAX_BYTES
): { rotated: boolean; prevPath?: string; sizeBytes: number } {
  const paths = getStatePaths(overrideDir);
  if (!existsSync(paths.eventsRing)) {
    return { rotated: false, sizeBytes: 0 };
  }
  const sizeBytes = statSync(paths.eventsRing).size;
  if (sizeBytes <= maxBytes) {
    return { rotated: false, sizeBytes };
  }
  renameSync(paths.eventsRing, paths.eventsRingPrev);
  return {
    rotated: true,
    prevPath: paths.eventsRingPrev,
    sizeBytes,
  };
}
