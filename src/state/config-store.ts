import type { InlineStampMode, PulseUserConfig } from '../types/telemetry';
import { ensureStateDir, getStatePaths, readJsonSafe, writeJsonAtomic } from './state-dir';

export class ConfigValidationError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export interface PulseUserConfigPatch {
  version?: 1;
  inlineStampMode?: InlineStampMode;
  hudSortMode?: PulseUserConfig['hudSortMode'];
  timelineScope?: PulseUserConfig['timelineScope'];
  smartThresholds?: Partial<PulseUserConfig['smartThresholds']>;
  pollIntervalsMs?: Partial<PulseUserConfig['pollIntervalsMs']>;
}

const VALID_STAMP_MODES = new Set<InlineStampMode>(['smart', 'every-turn', 'off']);
const VALID_HUD_SORT_MODES = new Set<PulseUserConfig['hudSortMode']>([
  'active-first',
  'topology-tree',
]);
const VALID_TIMELINE_SCOPES = new Set<PulseUserConfig['timelineScope']>([
  'conversation',
  'tree',
]);

const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ALLOWED_ROOT_KEYS = new Set([
  'version',
  'updatedAt',
  'inlineStampMode',
  'hudSortMode',
  'timelineScope',
  'smartThresholds',
  'pollIntervalsMs',
]);
const PCT_THRESHOLD_KEYS = new Set<keyof PulseUserConfig['smartThresholds']>([
  'contextWarnPct',
  'contextCriticalPct',
  'stampContextTriggerPct',
  'quotaLowTriggerPct',
  'heavyQuotaThresholdPct',
]);
const POLL_INTERVAL_KEYS = new Set<keyof PulseUserConfig['pollIntervalsMs']>([
  'active',
  'idle',
  'quota',
  'modelConfig',
]);

export const DEFAULT_PULSE_USER_CONFIG: PulseUserConfig = {
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
  updatedAt: new Date(0).toISOString(),
};

export const DEFAULT_CONFIG = DEFAULT_PULSE_USER_CONFIG;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertBoundedNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
  requireInteger = false
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigValidationError(`Invalid ${label}: expected finite number`);
  }
  if (requireInteger && !Number.isInteger(value)) {
    throw new ConfigValidationError(`Invalid ${label}: expected integer`);
  }
  if (value < min || value > max) {
    throw new ConfigValidationError(`Invalid ${label}: must be between ${min} and ${max}`);
  }
  return value;
}

export function validateConfigPatch(patch: unknown): PulseUserConfigPatch {
  if (!isPlainRecord(patch)) {
    throw new ConfigValidationError('Config patch must be a plain JSON object');
  }

  const out: PulseUserConfigPatch = {};
  for (const key of Object.getOwnPropertyNames(patch)) {
    if (PROTO_POLLUTION_KEYS.has(key)) {
      continue;
    }
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      throw new ConfigValidationError(`Unknown config field: ${key}`);
    }
  }

  if (Object.hasOwn(patch, 'version') && patch.version !== undefined) {
    if (patch.version !== 1) {
      throw new ConfigValidationError('Invalid version: only version 1 is supported');
    }
    out.version = 1;
  }

  if (Object.hasOwn(patch, 'inlineStampMode') && patch.inlineStampMode !== undefined) {
    const mode = patch.inlineStampMode;
    if (typeof mode !== 'string' || !VALID_STAMP_MODES.has(mode as InlineStampMode)) {
      throw new ConfigValidationError(
        `Invalid inlineStampMode: expected smart | every-turn | off`
      );
    }
    out.inlineStampMode = mode as InlineStampMode;
  }

  if (Object.hasOwn(patch, 'hudSortMode') && patch.hudSortMode !== undefined) {
    const mode = patch.hudSortMode;
    if (
      typeof mode !== 'string' ||
      !VALID_HUD_SORT_MODES.has(mode as PulseUserConfig['hudSortMode'])
    ) {
      throw new ConfigValidationError(
        `Invalid hudSortMode: expected active-first | topology-tree`
      );
    }
    out.hudSortMode = mode as PulseUserConfig['hudSortMode'];
  }

  if (Object.hasOwn(patch, 'timelineScope') && patch.timelineScope !== undefined) {
    const scope = patch.timelineScope;
    if (
      typeof scope !== 'string' ||
      !VALID_TIMELINE_SCOPES.has(scope as PulseUserConfig['timelineScope'])
    ) {
      throw new ConfigValidationError(
        `Invalid timelineScope: expected conversation | tree`
      );
    }
    out.timelineScope = scope as PulseUserConfig['timelineScope'];
  }

  if (Object.hasOwn(patch, 'smartThresholds') && patch.smartThresholds !== undefined) {
    if (!isPlainRecord(patch.smartThresholds)) {
      throw new ConfigValidationError('smartThresholds must be an object');
    }
    const rawThresholds = patch.smartThresholds;
    const validatedThresholds: Partial<PulseUserConfig['smartThresholds']> = {};
    for (const key of Object.getOwnPropertyNames(rawThresholds)) {
      if (PROTO_POLLUTION_KEYS.has(key)) {
        continue;
      }
      if (key === 'heavyConcurrentAlertCount') {
        validatedThresholds.heavyConcurrentAlertCount = assertBoundedNumber(
          rawThresholds[key],
          'smartThresholds.heavyConcurrentAlertCount',
          1,
          100,
          true
        );
      } else if (PCT_THRESHOLD_KEYS.has(key as keyof PulseUserConfig['smartThresholds'])) {
        const typedKey = key as Exclude<
          keyof PulseUserConfig['smartThresholds'],
          'heavyConcurrentAlertCount'
        >;
        validatedThresholds[typedKey] = assertBoundedNumber(
          rawThresholds[key],
          `smartThresholds.${key}`,
          1,
          100
        );
      } else {
        throw new ConfigValidationError(`Unknown smartThresholds field: ${key}`);
      }
    }
    out.smartThresholds = validatedThresholds;
  }

  if (Object.hasOwn(patch, 'pollIntervalsMs') && patch.pollIntervalsMs !== undefined) {
    if (!isPlainRecord(patch.pollIntervalsMs)) {
      throw new ConfigValidationError('pollIntervalsMs must be an object');
    }
    const rawPolls = patch.pollIntervalsMs;
    const validatedPolls: Partial<PulseUserConfig['pollIntervalsMs']> = {};
    for (const key of Object.getOwnPropertyNames(rawPolls)) {
      if (PROTO_POLLUTION_KEYS.has(key)) {
        continue;
      }
      if (POLL_INTERVAL_KEYS.has(key as keyof PulseUserConfig['pollIntervalsMs'])) {
        const typedKey = key as keyof PulseUserConfig['pollIntervalsMs'];
        validatedPolls[typedKey] = assertBoundedNumber(
          rawPolls[key],
          `pollIntervalsMs.${key}`,
          50,
          3_600_000
        );
      } else {
        throw new ConfigValidationError(`Unknown pollIntervalsMs field: ${key}`);
      }
    }
    out.pollIntervalsMs = validatedPolls;
  }

  return out;
}

export function mergeConfig(
  base: PulseUserConfig,
  patch: PulseUserConfigPatch
): PulseUserConfig {
  return {
    version: 1,
    inlineStampMode: patch.inlineStampMode ?? base.inlineStampMode,
    hudSortMode: patch.hudSortMode ?? base.hudSortMode,
    timelineScope: patch.timelineScope ?? base.timelineScope,
    smartThresholds: {
      ...base.smartThresholds,
      ...(patch.smartThresholds ?? {}),
    },
    pollIntervalsMs: {
      ...base.pollIntervalsMs,
      ...(patch.pollIntervalsMs ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function loadConfig(overrideDir?: string): PulseUserConfig {
  const { configPath } = getStatePaths(overrideDir);
  const raw = readJsonSafe<unknown>(configPath, null);
  if (!isPlainRecord(raw)) {
    return {
      ...DEFAULT_PULSE_USER_CONFIG,
      smartThresholds: { ...DEFAULT_PULSE_USER_CONFIG.smartThresholds },
      pollIntervalsMs: { ...DEFAULT_PULSE_USER_CONFIG.pollIntervalsMs },
    };
  }
  try {
    const validated = validateConfigPatch(raw);
    const merged = mergeConfig(DEFAULT_PULSE_USER_CONFIG, validated);
    if (typeof raw.updatedAt === 'string' && raw.updatedAt.trim()) {
      merged.updatedAt = raw.updatedAt;
    }
    return merged;
  } catch {
    return {
      ...DEFAULT_PULSE_USER_CONFIG,
      smartThresholds: { ...DEFAULT_PULSE_USER_CONFIG.smartThresholds },
      pollIntervalsMs: { ...DEFAULT_PULSE_USER_CONFIG.pollIntervalsMs },
    };
  }
}

export function saveConfig(config: PulseUserConfig, overrideDir?: string): PulseUserConfig {
  ensureStateDir(overrideDir);
  const { configPath } = getStatePaths(overrideDir);
  const validated = validateConfigPatch(config);
  const normalized = mergeConfig(DEFAULT_PULSE_USER_CONFIG, validated);
  writeJsonAtomic(configPath, normalized);
  return normalized;
}

export function updateConfigPartial(
  patch: unknown,
  overrideDir?: string
): PulseUserConfig {
  const validated = validateConfigPatch(patch);
  const current = loadConfig(overrideDir);
  const next = mergeConfig(current, validated);
  ensureStateDir(overrideDir);
  const { configPath } = getStatePaths(overrideDir);
  writeJsonAtomic(configPath, next);
  return next;
}
