/* SPDX-License-Identifier: MIT | Copyright (c) 2026 springtian <springtian@gmail.com> */

// src/sidecar/server.ts
import { existsSync as existsSync4, readFileSync as readFileSync3, realpathSync, statSync as statSync3 } from "node:fs";
import path4 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Response, SidecarApp } from "sidecar_sdk";

// src/state/state-dir.ts
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
var UUID_REGEX = /^[0-9a-f-]{36}$/i;
var RING_MAX_BYTES = 512 * 1024;
var atomicTmpSeq = 0;
function tryChmod(targetPath, mode) {
  if (process.platform === "win32") return;
  try {
    chmodSync(targetPath, mode);
  } catch {
  }
}
function isValidUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}
function resolveStateDir(overrideDir) {
  const trimmedOverride = overrideDir?.trim();
  const envStateDir = process.env.ANTIGRAVITY_PULSE_STATE_DIR?.trim();
  const pluginData = process.env.PLUGIN_DATA?.trim();
  const appDataDir = process.env.ANTIGRAVITY_APP_DATA_DIR?.trim() || process.env.ANTIGRAVITY_DATA_DIR?.trim() || path.join(os.homedir(), ".gemini", "antigravity");
  const chosen = trimmedOverride || envStateDir || pluginData || path.join(appDataDir, "plugin_data", "antigravity-pulse");
  return path.resolve(chosen);
}
function getStatePaths(overrideDir) {
  const stateDir = resolveStateDir(overrideDir);
  return {
    stateDir,
    eventsRing: path.join(stateDir, "events.ring.jsonl"),
    eventsRingPrev: path.join(stateDir, "events.ring.prev.jsonl"),
    liveSnapshot: path.join(stateDir, "live-snapshot.json"),
    modelMap: path.join(stateDir, "model-map.json"),
    quotaCache: path.join(stateDir, "quota-cache.json"),
    configPath: path.join(stateDir, "config.json"),
    stampDedup: path.join(stateDir, "stamp-dedup.json")
  };
}
function ensureStateDir(overrideDir) {
  const stateDir = resolveStateDir(overrideDir);
  mkdirSync(stateDir, { recursive: true, mode: 448 });
  tryChmod(stateDir, 448);
  return stateDir;
}
function writeJsonAtomic(filePath, data) {
  const parentDir = path.dirname(filePath);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true, mode: 448 });
    tryChmod(parentDir, 448);
  }
  atomicTmpSeq = atomicTmpSeq + 1 >>> 0;
  const suffix = `${process.pid}.${process.hrtime.bigint().toString(36)}.${atomicTmpSeq.toString(36)}`;
  const tmpPath = `${filePath}.${suffix}.tmp`;
  const serialized = `${JSON.stringify(data, null, 2)}
`;
  try {
    writeFileSync(tmpPath, serialized, { encoding: "utf8", mode: 384 });
    tryChmod(tmpPath, 384);
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {
    }
    throw err;
  }
}
function readJsonSafe(filePath, fallback) {
  try {
    if (!existsSync(filePath)) {
      return fallback;
    }
    const raw = readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function rotateRingIfNeeded(overrideDir, maxBytes = RING_MAX_BYTES) {
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
    sizeBytes
  };
}

// src/state/config-store.ts
var ConfigValidationError = class extends RangeError {
  constructor(message) {
    super(message);
    this.name = "ConfigValidationError";
  }
};
var VALID_STAMP_MODES = /* @__PURE__ */ new Set(["smart", "every-turn", "off"]);
var VALID_HUD_SORT_MODES = /* @__PURE__ */ new Set([
  "active-first",
  "topology-tree"
]);
var VALID_TIMELINE_SCOPES = /* @__PURE__ */ new Set([
  "conversation",
  "tree"
]);
var PROTO_POLLUTION_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var ALLOWED_ROOT_KEYS = /* @__PURE__ */ new Set([
  "version",
  "updatedAt",
  "inlineStampMode",
  "hudSortMode",
  "timelineScope",
  "smartThresholds",
  "pollIntervalsMs"
]);
var PCT_THRESHOLD_KEYS = /* @__PURE__ */ new Set([
  "contextWarnPct",
  "contextCriticalPct",
  "stampContextTriggerPct",
  "quotaLowTriggerPct",
  "heavyQuotaThresholdPct"
]);
var POLL_INTERVAL_KEYS = /* @__PURE__ */ new Set([
  "active",
  "idle",
  "quota",
  "modelConfig"
]);
var DEFAULT_PULSE_USER_CONFIG = {
  version: 1,
  inlineStampMode: "smart",
  hudSortMode: "active-first",
  timelineScope: "tree",
  smartThresholds: {
    contextWarnPct: 70,
    contextCriticalPct: 85,
    stampContextTriggerPct: 75,
    quotaLowTriggerPct: 20,
    heavyConcurrentAlertCount: 3,
    heavyQuotaThresholdPct: 40
  },
  pollIntervalsMs: {
    active: 1e3,
    idle: 3e3,
    quota: 3e4,
    modelConfig: 3e4
  },
  updatedAt: (/* @__PURE__ */ new Date(0)).toISOString()
};
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertBoundedNumber(value, label, min, max, requireInteger = false) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
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
function validateConfigPatch(patch) {
  if (!isPlainRecord(patch)) {
    throw new ConfigValidationError("Config patch must be a plain JSON object");
  }
  const out = {};
  for (const key of Object.getOwnPropertyNames(patch)) {
    if (PROTO_POLLUTION_KEYS.has(key)) {
      continue;
    }
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      throw new ConfigValidationError(`Unknown config field: ${key}`);
    }
  }
  if (Object.hasOwn(patch, "version") && patch.version !== void 0) {
    if (patch.version !== 1) {
      throw new ConfigValidationError("Invalid version: only version 1 is supported");
    }
    out.version = 1;
  }
  if (Object.hasOwn(patch, "inlineStampMode") && patch.inlineStampMode !== void 0) {
    const mode = patch.inlineStampMode;
    if (typeof mode !== "string" || !VALID_STAMP_MODES.has(mode)) {
      throw new ConfigValidationError(
        `Invalid inlineStampMode: expected smart | every-turn | off`
      );
    }
    out.inlineStampMode = mode;
  }
  if (Object.hasOwn(patch, "hudSortMode") && patch.hudSortMode !== void 0) {
    const mode = patch.hudSortMode;
    if (typeof mode !== "string" || !VALID_HUD_SORT_MODES.has(mode)) {
      throw new ConfigValidationError(
        `Invalid hudSortMode: expected active-first | topology-tree`
      );
    }
    out.hudSortMode = mode;
  }
  if (Object.hasOwn(patch, "timelineScope") && patch.timelineScope !== void 0) {
    const scope = patch.timelineScope;
    if (typeof scope !== "string" || !VALID_TIMELINE_SCOPES.has(scope)) {
      throw new ConfigValidationError(
        `Invalid timelineScope: expected conversation | tree`
      );
    }
    out.timelineScope = scope;
  }
  if (Object.hasOwn(patch, "smartThresholds") && patch.smartThresholds !== void 0) {
    if (!isPlainRecord(patch.smartThresholds)) {
      throw new ConfigValidationError("smartThresholds must be an object");
    }
    const rawThresholds = patch.smartThresholds;
    const validatedThresholds = {};
    for (const key of Object.getOwnPropertyNames(rawThresholds)) {
      if (PROTO_POLLUTION_KEYS.has(key)) {
        continue;
      }
      if (key === "heavyConcurrentAlertCount") {
        validatedThresholds.heavyConcurrentAlertCount = assertBoundedNumber(
          rawThresholds[key],
          "smartThresholds.heavyConcurrentAlertCount",
          1,
          100,
          true
        );
      } else if (PCT_THRESHOLD_KEYS.has(key)) {
        const typedKey = key;
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
  if (Object.hasOwn(patch, "pollIntervalsMs") && patch.pollIntervalsMs !== void 0) {
    if (!isPlainRecord(patch.pollIntervalsMs)) {
      throw new ConfigValidationError("pollIntervalsMs must be an object");
    }
    const rawPolls = patch.pollIntervalsMs;
    const validatedPolls = {};
    for (const key of Object.getOwnPropertyNames(rawPolls)) {
      if (PROTO_POLLUTION_KEYS.has(key)) {
        continue;
      }
      if (POLL_INTERVAL_KEYS.has(key)) {
        const typedKey = key;
        validatedPolls[typedKey] = assertBoundedNumber(
          rawPolls[key],
          `pollIntervalsMs.${key}`,
          50,
          36e5
        );
      } else {
        throw new ConfigValidationError(`Unknown pollIntervalsMs field: ${key}`);
      }
    }
    out.pollIntervalsMs = validatedPolls;
  }
  return out;
}
function mergeConfig(base, patch) {
  return {
    version: 1,
    inlineStampMode: patch.inlineStampMode ?? base.inlineStampMode,
    hudSortMode: patch.hudSortMode ?? base.hudSortMode,
    timelineScope: patch.timelineScope ?? base.timelineScope,
    smartThresholds: {
      ...base.smartThresholds,
      ...patch.smartThresholds ?? {}
    },
    pollIntervalsMs: {
      ...base.pollIntervalsMs,
      ...patch.pollIntervalsMs ?? {}
    },
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function loadConfig(overrideDir) {
  const { configPath } = getStatePaths(overrideDir);
  const raw = readJsonSafe(configPath, null);
  if (!isPlainRecord(raw)) {
    return {
      ...DEFAULT_PULSE_USER_CONFIG,
      smartThresholds: { ...DEFAULT_PULSE_USER_CONFIG.smartThresholds },
      pollIntervalsMs: { ...DEFAULT_PULSE_USER_CONFIG.pollIntervalsMs }
    };
  }
  try {
    const validated = validateConfigPatch(raw);
    const merged = mergeConfig(DEFAULT_PULSE_USER_CONFIG, validated);
    if (typeof raw.updatedAt === "string" && raw.updatedAt.trim()) {
      merged.updatedAt = raw.updatedAt;
    }
    return merged;
  } catch {
    return {
      ...DEFAULT_PULSE_USER_CONFIG,
      smartThresholds: { ...DEFAULT_PULSE_USER_CONFIG.smartThresholds },
      pollIntervalsMs: { ...DEFAULT_PULSE_USER_CONFIG.pollIntervalsMs }
    };
  }
}
function updateConfigPartial(patch, overrideDir) {
  const validated = validateConfigPatch(patch);
  const current = loadConfig(overrideDir);
  const next = mergeConfig(current, validated);
  ensureStateDir(overrideDir);
  const { configPath } = getStatePaths(overrideDir);
  writeJsonAtomic(configPath, next);
  return next;
}

// src/sidecar/telemetry-engine.ts
import {
  closeSync,
  existsSync as existsSync3,
  openSync,
  readSync,
  statSync as statSync2,
  watch
} from "node:fs";
import os2 from "node:os";
import path3 from "node:path";

// src/core/etag.ts
import { createHash } from "node:crypto";
function canonicalize(value, seen = /* @__PURE__ */ new WeakSet()) {
  if (value === null || value === void 0) {
    return null;
  }
  const t = typeof value;
  if (t === "boolean" || t === "string") {
    return value;
  }
  if (t === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (t === "bigint") {
    return String(value);
  }
  if (t !== "object") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => item === void 0 ? null : canonicalize(item, seen));
    }
    const sorted = {};
    for (const [key, prop] of Object.entries(value).sort(
      ([a], [b]) => a < b ? -1 : a > b ? 1 : 0
    )) {
      if (prop === void 0 || typeof prop === "function" || typeof prop === "symbol") {
        continue;
      }
      sorted[key] = canonicalize(prop, seen);
    }
    return sorted;
  } finally {
    seen.delete(value);
  }
}
function computeDeterministicEtag(payload) {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return createHash("sha256").update(canonicalJson).digest("base64url").slice(0, 6);
}
function makeUnchangedResponse(etag) {
  return { unchanged: true, etag };
}
function isEtagMatch(clientEtag, serverEtag) {
  if (typeof clientEtag !== "string") {
    return false;
  }
  const trimmed = clientEtag.trim();
  return trimmed.length > 0 && trimmed === serverEtag;
}
function stripNodeVolatileFields(node) {
  const { phaseElapsedMs: _ignored, ...rest } = node;
  return rest;
}
function stripVolatileHudFields(snapshot) {
  return {
    hostConnected: snapshot.hostConnected,
    activeConversationId: snapshot.activeConversationId,
    rootCascadeId: snapshot.rootCascadeId,
    breadcrumb: snapshot.breadcrumb,
    activeNode: snapshot.activeNode ? stripNodeVolatileFields(snapshot.activeNode) : null,
    treeNodes: snapshot.treeNodes.map(stripNodeVolatileFields),
    smartGovernanceBanner: snapshot.smartGovernanceBanner,
    quota: snapshot.quota,
    config: snapshot.config,
    warnings: snapshot.warnings
  };
}
function computeHudSemanticEtag(snapshot) {
  return computeDeterministicEtag(stripVolatileHudFields(snapshot));
}

// src/core/topology-builder.ts
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2 } from "node:fs";
import path2 from "node:path";

// src/core/formatters.ts
function toIntToken(v) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : 0;
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}
function computeCacheHitPct(inputTokens, cacheReadTokens) {
  const safeIn = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0;
  const safeCache = Number.isFinite(cacheReadTokens) && cacheReadTokens > 0 ? cacheReadTokens : 0;
  const totalIn = safeIn + safeCache;
  return totalIn > 0 ? safeCache / totalIn * 100 : 0;
}
function computeRetryCount(retryInfos) {
  const len = Array.isArray(retryInfos) ? retryInfos.length : 0;
  return Math.max(0, len - 1);
}
var DURATION_SEGMENT_RE = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/gi;
var FULL_DURATION_RE = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/i;
function parseDurationMs(raw) {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
  }
  if (typeof raw !== "string") {
    return 0;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("-")) {
    return 0;
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
  }
  if (!FULL_DURATION_RE.test(trimmed)) {
    return 0;
  }
  let totalMs = 0;
  DURATION_SEGMENT_RE.lastIndex = 0;
  let match = DURATION_SEGMENT_RE.exec(trimmed);
  while (match !== null) {
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }
    switch (unit) {
      case "h":
        totalMs += value * 36e5;
        break;
      case "m":
        totalMs += value * 6e4;
        break;
      case "s":
        totalMs += value * 1e3;
        break;
      case "ms":
        totalMs += value;
        break;
      case "us":
      case "\xB5s":
        totalMs += value / 1e3;
        break;
      case "ns":
        totalMs += value / 1e6;
        break;
      default:
        break;
    }
    match = DURATION_SEGMENT_RE.exec(trimmed);
  }
  return Number.isFinite(totalMs) && totalMs >= 0 ? Math.round(totalMs) : 0;
}

// src/core/model-catalog.ts
var BUILTIN_ALIASES = {
  MODEL_PLACEHOLDER_M427: {
    modelEnum: "MODEL_PLACEHOLDER_M427",
    modelId: "gemini-4-carbon-high",
    label: "Gemini 4 Carbon (High)",
    family: "gemini",
    effortTier: "high",
    tier: "apex",
    isOrchestrator: false
  },
  MODEL_PLACEHOLDER_M418: {
    modelEnum: "MODEL_PLACEHOLDER_M418",
    modelId: "gemini-4-argon-medium",
    label: "Gemini 4 Argon (Medium)",
    family: "gemini",
    effortTier: "medium",
    tier: "workhorse",
    isOrchestrator: false
  },
  MODEL_PLACEHOLDER_M667: {
    modelEnum: "MODEL_PLACEHOLDER_M667",
    modelId: "gemini-pro-orchestrator",
    label: "Orchestrator (Carbon)",
    family: "auto",
    effortTier: "auto",
    tier: "orchestrator",
    isOrchestrator: true
  },
  MODEL_PLACEHOLDER_M669: {
    modelEnum: "MODEL_PLACEHOLDER_M669",
    modelId: "gemini-plan-execute-orchestrator",
    label: "Orchestrator (Plan-Execute)",
    family: "auto",
    effortTier: "auto",
    tier: "orchestrator",
    isOrchestrator: true
  },
  MODEL_PLACEHOLDER_M681: {
    modelEnum: "MODEL_PLACEHOLDER_M681",
    modelId: "gemini-argon-orchestrator",
    label: "Orchestrator (Argon)",
    family: "auto",
    effortTier: "auto",
    tier: "orchestrator",
    isOrchestrator: true
  },
  MODEL_PLACEHOLDER_M322: {
    modelEnum: "MODEL_PLACEHOLDER_M322",
    modelId: "gemini-flash",
    label: "Gemini Flash",
    family: "gemini",
    effortTier: "flash",
    tier: "fast",
    isOrchestrator: false
  },
  inherit: {
    modelEnum: "inherit",
    modelId: "inherit",
    label: "Inherit Parent",
    family: "auto",
    effortTier: "auto",
    tier: "orchestrator",
    isOrchestrator: true
  },
  auto: {
    modelEnum: "auto",
    modelId: "auto",
    label: "Auto",
    family: "auto",
    effortTier: "auto",
    tier: "orchestrator",
    isOrchestrator: true
  },
  pro: {
    modelEnum: "pro",
    modelId: "gemini-pro",
    label: "Gemini Pro (Auto)",
    family: "gemini",
    effortTier: "auto",
    tier: "workhorse",
    isOrchestrator: false
  },
  flash: {
    modelEnum: "flash",
    modelId: "gemini-flash",
    label: "Gemini Flash",
    family: "gemini",
    effortTier: "flash",
    tier: "fast",
    isOrchestrator: false
  },
  flash_lite: {
    modelEnum: "flash_lite",
    modelId: "gemini-flash-lite",
    label: "Gemini Flash Lite",
    family: "gemini",
    effortTier: "flash",
    tier: "fast",
    isOrchestrator: false
  }
};
function normalizeModelFamily(raw) {
  if (/orchestrator|\bauto\b/i.test(raw)) {
    return "auto";
  }
  if (/gemini/i.test(raw)) {
    return "gemini";
  }
  if (/claude|opus|sonnet|haiku/i.test(raw)) {
    return "claude";
  }
  if (/gpt|\bo[134](?:-|\b)/i.test(raw)) {
    return "openai";
  }
  return "unknown";
}
function normalizeEffortTier(raw) {
  if (/\bxhigh\b|\(xhigh\)|_xhigh\b/i.test(raw)) {
    return "xhigh";
  }
  if (/\bhigh\b|\(high\)|_high\b/i.test(raw)) {
    return "high";
  }
  if (/\bmed(?:ium)?\b|\(medium\)|\(med\)|_med(?:ium)?\b/i.test(raw)) {
    return "medium";
  }
  if (/\blow\b|\(low\)|_low\b/i.test(raw)) {
    return "low";
  }
  if (/flash/i.test(raw)) {
    return "flash";
  }
  if (/orchestrator|\bauto\b/i.test(raw)) {
    return "auto";
  }
  return "unknown";
}
function classifyModelTier(family, effortTier, isOrchestrator, label = "", modelId = "") {
  if (isOrchestrator || family === "auto" || effortTier === "auto") {
    return "orchestrator";
  }
  const combined = `${label} ${modelId}`;
  if (effortTier === "xhigh" || effortTier === "high" && /hydrogen|carbon|opus/i.test(combined)) {
    return "apex";
  }
  if (effortTier === "flash" || /flash|haiku|flash_lite/i.test(combined) || family === "gemini" && /argon/i.test(combined) && effortTier === "low") {
    return "fast";
  }
  return "workhorse";
}
function parseClientModelConfig(raw) {
  const modelEnum = (raw.modelOrAlias?.model || raw.modelOrAlias?.alias || raw.modelId || raw.label || "").trim();
  if (!modelEnum) {
    return null;
  }
  const label = (raw.label ?? raw.modelId ?? modelEnum).trim();
  const modelId = (raw.modelId ?? modelEnum).trim();
  const combined = `${label} ${modelId} ${modelEnum}`;
  const family = normalizeModelFamily(combined);
  const effortTier = normalizeEffortTier(combined);
  const isOrchestrator = family === "auto" || /orchestrator/i.test(label) || /orchestrator/i.test(modelId);
  const tier = classifyModelTier(family, effortTier, isOrchestrator, label, modelId);
  const entry = {
    modelEnum,
    modelId,
    label,
    family,
    effortTier,
    tier,
    isOrchestrator
  };
  if (raw.tagTitle) {
    entry.tagTitle = raw.tagTitle;
  }
  if (raw.quotaInfo && typeof raw.quotaInfo.remainingFraction === "number") {
    entry.quotaInfo = {
      remainingFraction: Math.min(1, Math.max(0, raw.quotaInfo.remainingFraction)),
      resetTime: raw.quotaInfo.resetTime ?? null
    };
  }
  return entry;
}
function buildModelCatalog(data) {
  const defaultModelEnum = data?.defaultOverrideModelConfig?.modelOrAlias?.model ?? data?.defaultOverrideModelConfig?.modelOrAlias?.alias ?? null;
  const modelsByEnum = {};
  const modelsById = {};
  for (const cfg of data?.clientModelConfigs ?? []) {
    const parsed = parseClientModelConfig(cfg);
    if (!parsed) {
      continue;
    }
    modelsByEnum[parsed.modelEnum] = parsed;
    if (parsed.modelId) {
      modelsById[parsed.modelId] = parsed;
    }
  }
  if (data?.defaultOverrideModelConfig) {
    const defParsed = parseClientModelConfig(data.defaultOverrideModelConfig);
    if (defParsed) {
      if (!modelsByEnum[defParsed.modelEnum]) {
        const aliasFallback = BUILTIN_ALIASES[defParsed.modelEnum];
        const chosen = defParsed.label === defParsed.modelEnum && aliasFallback ? aliasFallback : defParsed;
        modelsByEnum[chosen.modelEnum] = chosen;
        if (chosen.modelId && !modelsById[chosen.modelId]) {
          modelsById[chosen.modelId] = chosen;
        }
      }
    }
  }
  return {
    defaultModelEnum,
    modelsByEnum,
    modelsById
  };
}
function decodeModelDescriptor(raw, catalog) {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const key = raw.trim();
  if (!key) {
    return null;
  }
  if (catalog.modelsByEnum[key]) {
    return catalog.modelsByEnum[key];
  }
  if (catalog.modelsById[key]) {
    return catalog.modelsById[key];
  }
  const lower = key.toLowerCase();
  for (const entry of Object.values(catalog.modelsByEnum)) {
    if (entry.modelEnum.toLowerCase() === lower || entry.modelId.toLowerCase() === lower || entry.label.toLowerCase() === lower) {
      return entry;
    }
  }
  for (const [aliasKey, aliasEntry] of Object.entries(BUILTIN_ALIASES)) {
    if (aliasKey.toLowerCase() === lower || aliasEntry.modelId.toLowerCase() === lower || aliasEntry.label.toLowerCase() === lower) {
      return aliasEntry;
    }
  }
  if (/^MODEL_PLACEHOLDER_/i.test(key)) {
    return null;
  }
  const family = normalizeModelFamily(key);
  const effortTier = normalizeEffortTier(key);
  const isOrchestrator = family === "auto" || /orchestrator|\bauto\b/i.test(key);
  const tier = classifyModelTier(family, effortTier, isOrchestrator, key, key);
  return {
    modelEnum: key,
    modelId: key,
    label: key,
    family,
    effortTier,
    tier,
    isOrchestrator
  };
}
function computeContextWindow(meta, thresholds) {
  const estimatedTokensUsed = toIntToken(meta?.estimatedTokensUsed);
  const maxContextTokens = toIntToken(meta?.maxContextTokens);
  const warnPct = thresholds?.warnPct ?? 70;
  const criticalPct = thresholds?.criticalPct ?? 85;
  const pct = maxContextTokens > 0 ? Math.min(100, Math.max(0, estimatedTokensUsed / maxContextTokens * 100)) : 0;
  let level = "normal";
  if (pct > criticalPct) {
    level = "critical_85";
  } else if (pct > warnPct) {
    level = "warn_70";
  }
  return {
    estimatedTokensUsed,
    maxContextTokens,
    pct,
    level
  };
}
var TIER_WEIGHT = {
  alert: 0,
  fast: 1,
  workhorse: 2,
  orchestrator: 2,
  apex: 3
};
var EFFORT_WEIGHT = {
  flash: 0,
  low: 1,
  medium: 2,
  auto: 2,
  unknown: 2,
  high: 3,
  xhigh: 4
};
function canonicalBaseModel(raw) {
  return raw.trim().toLowerCase().replace(/\((xhigh|high|medium|med|low)\)/gi, "").replace(/[\s._]+/g, "-").replace(/-(xhigh|high|medium|med|low)$/i, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function reconcileRequestedVsServed(params) {
  const chatModel = params.latestGenMeta?.chatModel;
  const customModelEnum = chatModel?.customMetadata?.model_enum?.trim() || null;
  const explicitRequested = params.requestedModelRaw?.trim() || null;
  const effectiveRequestedRaw = explicitRequested ?? customModelEnum ?? params.catalog.defaultModelEnum ?? "";
  const decodedReq = decodeModelDescriptor(effectiveRequestedRaw, params.catalog);
  const inferredSource = params.requestedSource ?? (explicitRequested ? "explicit" : customModelEnum ? "user" : params.catalog.defaultModelEnum ? decodedReq?.isOrchestrator ? "orchestrator" : "user" : "unknown");
  const requestedModel = {
    raw: effectiveRequestedRaw || "unknown",
    displayName: decodedReq?.label ?? (effectiveRequestedRaw || "Unknown"),
    modelId: decodedReq?.modelId ?? (effectiveRequestedRaw || "unknown"),
    source: inferredSource
  };
  const retryCount = computeRetryCount(chatModel?.retryInfos);
  const servedRawResponse = chatModel?.responseModel?.trim() || "";
  const servedRawDisplay = chatModel?.modelDisplayName?.trim() || "";
  const servedRawModel = chatModel?.model?.trim() || "";
  const hasServedResponse = Boolean(servedRawResponse || servedRawDisplay || servedRawModel);
  let servedModel;
  if (hasServedResponse) {
    const decodedByEnum = decodeModelDescriptor(servedRawModel, params.catalog);
    const decodedByDisplay = decodeModelDescriptor(servedRawDisplay, params.catalog);
    const decodedByResp = decodeModelDescriptor(servedRawResponse, params.catalog);
    const bestDecoded = decodedByEnum ?? decodedByDisplay ?? decodedByResp;
    const displayName = servedRawDisplay || bestDecoded?.label || servedRawResponse || servedRawModel || "Unknown";
    const responseModel = servedRawResponse || bestDecoded?.modelId || servedRawModel || "unknown";
    const modelEnum = servedRawModel || bestDecoded?.modelEnum || responseModel || "unknown";
    const combined = `${displayName} ${responseModel} ${modelEnum}`;
    const family = normalizeModelFamily(combined) !== "unknown" ? normalizeModelFamily(combined) : bestDecoded?.family ?? "unknown";
    const effortTier = normalizeEffortTier(combined) !== "unknown" ? normalizeEffortTier(combined) : bestDecoded?.effortTier ?? "unknown";
    const isOrchestrator = family === "auto" || /orchestrator/i.test(displayName) || (bestDecoded?.isOrchestrator ?? false);
    const tier = classifyModelTier(family, effortTier, isOrchestrator, displayName, responseModel);
    servedModel = {
      responseModel,
      displayName,
      modelEnum,
      family,
      effortTier,
      tier
    };
  } else if (params.provisionalServedModelRaw?.trim()) {
    const provRaw = params.provisionalServedModelRaw.trim();
    const provDecoded = decodeModelDescriptor(provRaw, params.catalog);
    servedModel = {
      responseModel: provDecoded?.modelId ?? provRaw,
      displayName: provDecoded?.label ?? provRaw,
      modelEnum: provDecoded?.modelEnum ?? provRaw,
      family: provDecoded?.family ?? "unknown",
      effortTier: provDecoded?.effortTier ?? "unknown",
      tier: provDecoded?.tier ?? "workhorse"
    };
  } else {
    servedModel = {
      responseModel: "",
      displayName: decodedReq?.label ? `${decodedReq.label} (pending)` : "Pending",
      modelEnum: requestedModel.raw,
      family: decodedReq?.family ?? "unknown",
      effortTier: decodedReq?.effortTier ?? "unknown",
      tier: decodedReq?.tier ?? "workhorse"
    };
  }
  let routingStatus;
  if (retryCount > 0) {
    routingStatus = "retrying";
  } else if (!hasServedResponse) {
    routingStatus = "unknown";
  } else {
    const reqLower = requestedModel.raw.toLowerCase();
    const isDynamicAlias = requestedModel.raw === "unknown" || decodedReq?.isOrchestrator === true || reqLower === "auto" || reqLower === "inherit" || reqLower === "pro" || /orchestrator/i.test(requestedModel.displayName);
    if (isDynamicAlias) {
      routingStatus = "routed";
    } else if (!decodedReq && /^MODEL_PLACEHOLDER_/i.test(requestedModel.raw)) {
      routingStatus = servedModel.modelEnum.toLowerCase() === reqLower || chatModel?.model?.trim()?.toLowerCase() === reqLower ? "matched" : "routed";
    } else if (reqLower === "flash" || reqLower === "flash_lite" || reqLower === "model_placeholder_m322" && decodedReq?.tier === "fast") {
      routingStatus = servedModel.tier === "fast" ? "matched" : "mismatch_or_fallback";
    } else {
      const reqCanonical = canonicalBaseModel(decodedReq?.modelId || requestedModel.displayName);
      const servedCanonical = canonicalBaseModel(
        servedModel.responseModel || servedModel.displayName
      );
      const baseMismatch = Boolean(reqCanonical) && Boolean(servedCanonical) && reqCanonical !== servedCanonical;
      const reqTier = decodedReq?.tier ?? "workhorse";
      const tierDowngraded = (servedModel.effortTier !== "unknown" || servedModel.tier === "fast") && TIER_WEIGHT[servedModel.tier] < TIER_WEIGHT[reqTier];
      const reqEffort = decodedReq?.effortTier ?? "unknown";
      const effortDowngraded = reqEffort !== "unknown" && servedModel.effortTier !== "unknown" && EFFORT_WEIGHT[servedModel.effortTier] < EFFORT_WEIGHT[reqEffort];
      routingStatus = baseMismatch || tierDowngraded || effortDowngraded ? "mismatch_or_fallback" : "matched";
    }
  }
  return {
    requestedModel,
    servedModel,
    routingStatus,
    retryCount
  };
}

// src/core/state-machine.ts
var ERROR_REASON_RE = /RESOURCE_EXHAUSTED|429|QUOTA|ERROR|FAILED/i;
var STEP_ERROR_RE = /ERROR|FAILED/i;
var STEP_WAITING_RE = /WAITING|APPROVAL|PENDING_CONFIRM/i;
var PRE_FLIGHT_GRACE_MS = 1500;
var APPROVAL_WAIT_MS = 3e3;
function parseValidMs(iso) {
  if (!iso || typeof iso !== "string") {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function extractToolSummary(toolCall) {
  const rawArgs = toolCall?.argumentsJson;
  if (!rawArgs || typeof rawArgs !== "string") {
    return void 0;
  }
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return void 0;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = Object.fromEntries(Object.entries(parsed));
      for (const key of [
        "ToolSummary",
        "Description",
        "CommandLine",
        "TargetFile",
        "AbsolutePath",
        "Path",
        "SearchPath",
        "Query",
        "query",
        "Role",
        "TaskName",
        "Url",
        "url"
      ]) {
        const val = record[key];
        if (typeof val === "string" && val.trim()) {
          return val.trim().slice(0, 80);
        }
      }
    }
  } catch {
    const match = /"(?:CommandLine|TargetFile|Description|query|Query|Role)"\s*:\s*"([^"]{1,80})"/i.exec(
      trimmed
    );
    if (match?.[1]) {
      return match[1].trim().slice(0, 80);
    }
  }
  return void 0;
}
function isApprovalSignaled(step, hook) {
  if (step?.status && STEP_WAITING_RE.test(step.status)) {
    return true;
  }
  const rawArgs = step?.metadata?.toolCall?.argumentsJson;
  if (typeof rawArgs === "string" && rawArgs.trim()) {
    try {
      const parsed = JSON.parse(rawArgs);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const rec = Object.fromEntries(Object.entries(parsed));
        if (rec.SafeToAutoRun === false || rec.safeToAutoRun === false || rec.ask === true || rec.force_ask === true || rec.approvalRequired === true || rec.waitForApproval === true) {
          return true;
        }
      }
    } catch {
      if (/"(?:SafeToAutoRun|safeToAutoRun)"\s*:\s*false|"(?:ask|force_ask|approvalRequired)"\s*:\s*true/i.test(rawArgs)) {
        return true;
      }
    }
  }
  const hookSignals = `${hook?.toolSummary ?? ""} ${hook?.stopReason ?? ""}`;
  return /\b(?:ask|force_ask|approval_required|awaiting_approval)\b/i.test(hookSignals);
}
function inferSwarmFallbackPhase(member) {
  if (!member) {
    return null;
  }
  if (member.killed || member.desired_state === "killed" || member.desired_state === "stopped") {
    return "IDLE";
  }
  const raw = `${member.phase ?? ""} ${member.desired_state ?? ""}`.toLowerCase();
  if (!raw.trim()) {
    return null;
  }
  if (/error|quota|fail/.test(raw)) return "ERROR_OR_QUOTA";
  if (/block|approv|wait/.test(raw)) return "BLOCKED_APPROVAL";
  if (/stream/.test(raw)) return "STREAMING";
  if (/think/.test(raw)) return "THINKING";
  if (/tool/.test(raw)) return "TOOL_RUNNING";
  if (/run|active|start|busy/.test(raw)) return "PRE_FLIGHT";
  if (/idle|done|complete|sleep/.test(raw)) return "IDLE";
  return null;
}
function computeProvisionalTokPerSec(latestGenMeta, stepCount) {
  const chatModel = latestGenMeta?.chatModel;
  if (!chatModel) {
    return null;
  }
  const indices = latestGenMeta.stepIndices ?? [];
  if (indices.length > 0 && stepCount > 0) {
    const maxIdx = Math.max(...indices);
    if (maxIdx < Math.max(0, stepCount - 4)) {
      return null;
    }
  }
  const streamMs = parseDurationMs(chatModel.streamingDuration);
  if (streamMs <= 0) {
    return null;
  }
  const responseOut = toIntToken(chatModel.usage?.responseOutputTokens);
  const totalOut = toIntToken(chatModel.usage?.outputTokens);
  const tokens = responseOut > 0 ? responseOut : totalOut;
  if (tokens <= 0) {
    return null;
  }
  return Math.round(tokens / (streamMs / 1e3) * 10) / 10;
}
function isActiveLifecyclePhase(phase) {
  return phase === "PRE_FLIGHT" || phase === "THINKING" || phase === "STREAMING" || phase === "TOOL_RUNNING" || phase === "BLOCKED_APPROVAL";
}
function deriveCascadePhase(input) {
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const steps = input.tailSteps ?? [];
  const latestStep = steps.length > 0 ? steps[steps.length - 1] : void 0;
  const cascadeHooks = (input.recentHookEvents ?? []).filter((ev) => ev.conversationId === input.cascadeId).sort((a, b) => a.ts - b.ts);
  const latestHook = cascadeHooks.length > 0 ? cascadeHooks[cascadeHooks.length - 1] : void 0;
  const latestPreToolHook = [...cascadeHooks].reverse().find((ev) => ev.event === "PreToolUse");
  const status = input.summary?.status ?? "";
  const isLsRunning = status === "CASCADE_RUN_STATUS_RUNNING";
  const hasErrorReason = ERROR_REASON_RE.test(
    input.summary?.latestExecutorTerminationReason ?? ""
  );
  const latestStepIsError = STEP_ERROR_RE.test(latestStep?.status ?? "");
  const stepTimestamps = [
    parseValidMs(latestStep?.metadata?.finishedGeneratingAt),
    parseValidMs(latestStep?.metadata?.viewableAt),
    parseValidMs(latestStep?.metadata?.createdAt)
  ].filter((t) => t !== null);
  const latestStepMs = stepTimestamps.length > 0 ? Math.max(...stepTimestamps) : 0;
  const summaryModifiedMs = parseValidMs(input.summary?.lastModifiedTime) ?? 0;
  let phase = "IDLE";
  let lastTool = input.prevNode?.lastTool ?? null;
  let streamingTokPerSec = null;
  let candidateStartIso = null;
  if (input.lsConnected && !isLsRunning) {
    if (hasErrorReason || latestStepIsError) {
      phase = "ERROR_OR_QUOTA";
      candidateStartIso = input.summary?.lastModifiedTime ?? null;
    } else {
      const withinPreFlightGrace = latestHook?.event === "PreInvocation" && nowMs - latestHook.ts <= PRE_FLIGHT_GRACE_MS && latestHook.ts >= summaryModifiedMs && (!input.prevNode || input.prevNode.phase === "IDLE" || input.prevNode.phase === "PRE_FLIGHT");
      if (withinPreFlightGrace && latestHook) {
        phase = "PRE_FLIGHT";
        candidateStartIso = latestHook.iso;
      } else {
        phase = "IDLE";
        candidateStartIso = input.summary?.lastModifiedTime ?? null;
      }
    }
  } else if (isLsRunning) {
    const isActionableHook = latestHook && latestHook.ts > latestStepMs && (latestHook.event === "Stop" || latestHook.event === "PreToolUse" || latestHook.event === "PostToolUse" || latestHook.event === "PreInvocation");
    if (latestStepIsError && !isActionableHook) {
      phase = "ERROR_OR_QUOTA";
      candidateStartIso = latestStep?.metadata?.createdAt ?? nowIso;
    } else if (isActionableHook && latestHook) {
      if (latestHook.event === "Stop") {
        phase = "IDLE";
        candidateStartIso = latestHook.iso;
      } else if (latestHook.event === "PreToolUse") {
        lastTool = {
          ...latestHook.toolCallId ? { id: latestHook.toolCallId } : {},
          name: latestHook.toolName || "tool",
          ...latestHook.toolSummary ? { summary: latestHook.toolSummary } : {},
          startedAt: latestHook.iso
        };
        const toolWaitMs = Math.max(0, nowMs - latestHook.ts);
        if (isApprovalSignaled(latestStep, latestHook) && (toolWaitMs > APPROVAL_WAIT_MS || STEP_WAITING_RE.test(latestStep?.status ?? "") || /force_ask|approval_required/i.test(latestHook.stopReason ?? ""))) {
          phase = "BLOCKED_APPROVAL";
        } else {
          phase = "TOOL_RUNNING";
        }
        candidateStartIso = latestHook.iso;
      } else if (latestHook.event === "PostToolUse") {
        phase = "THINKING";
        candidateStartIso = latestHook.iso;
      } else if (latestHook.event === "PreInvocation") {
        if (latestStep?.status === "CORTEX_STEP_STATUS_GENERATING") {
          if (latestStep.metadata?.viewableAt && !latestStep.metadata?.finishedGeneratingAt) {
            phase = "STREAMING";
            candidateStartIso = latestStep.metadata.viewableAt;
            streamingTokPerSec = computeProvisionalTokPerSec(
              input.latestGenMeta,
              input.summary?.stepCount ?? 0
            );
          } else {
            phase = "THINKING";
            candidateStartIso = latestStep.metadata?.createdAt ?? latestHook.iso;
          }
        } else {
          phase = "PRE_FLIGHT";
          candidateStartIso = latestHook.iso;
        }
      }
    } else if (latestStep) {
      if (latestStep.status === "CORTEX_STEP_STATUS_GENERATING") {
        if (latestStep.metadata?.viewableAt && !latestStep.metadata?.finishedGeneratingAt) {
          phase = "STREAMING";
          candidateStartIso = latestStep.metadata.viewableAt;
          streamingTokPerSec = computeProvisionalTokPerSec(
            input.latestGenMeta,
            input.summary?.stepCount ?? 0
          );
        } else {
          phase = "THINKING";
          candidateStartIso = latestStep.metadata?.createdAt ?? nowIso;
        }
      } else if (STEP_WAITING_RE.test(latestStep.status ?? "")) {
        if (latestStep.metadata?.toolCall) {
          const summary = extractToolSummary(latestStep.metadata.toolCall);
          lastTool = {
            ...latestStep.metadata.toolCall.id ? { id: latestStep.metadata.toolCall.id } : {},
            name: latestStep.metadata.toolCall.name || "tool",
            ...summary ? { summary } : {},
            ...latestStep.metadata.createdAt ? { startedAt: latestStep.metadata.createdAt } : {}
          };
        }
        phase = "BLOCKED_APPROVAL";
        candidateStartIso = latestStep.metadata?.createdAt ?? nowIso;
      } else if (latestStep.status === "CORTEX_STEP_STATUS_RUNNING" && latestStep.metadata?.toolCall) {
        const tc = latestStep.metadata.toolCall;
        const summary = extractToolSummary(tc);
        const startedAt = latestStep.metadata?.createdAt ?? latestPreToolHook?.iso ?? input.prevNode?.lastTool?.startedAt ?? nowIso;
        lastTool = {
          ...tc.id ? { id: tc.id } : {},
          name: tc.name || "tool",
          ...summary ? { summary } : {},
          startedAt
        };
        const startMs = parseValidMs(startedAt) ?? nowMs;
        const approvalSignal = isApprovalSignaled(latestStep, latestPreToolHook);
        if (approvalSignal && nowMs - startMs > APPROVAL_WAIT_MS) {
          phase = "BLOCKED_APPROVAL";
        } else {
          phase = "TOOL_RUNNING";
        }
        candidateStartIso = startedAt;
      } else {
        phase = "THINKING";
        candidateStartIso = latestStep.metadata?.createdAt ?? nowIso;
      }
    } else if (input.prevNode && isActiveLifecyclePhase(input.prevNode.phase)) {
      phase = input.prevNode.phase;
      candidateStartIso = input.prevNode.phaseStartedAt ?? nowIso;
    } else {
      phase = "PRE_FLIGHT";
      candidateStartIso = input.summary?.lastModifiedTime ?? nowIso;
    }
  } else {
    const swarmPhase = inferSwarmFallbackPhase(input.swarmMember);
    if (swarmPhase) {
      phase = swarmPhase;
      candidateStartIso = input.summary?.lastModifiedTime ?? nowIso;
    } else if (latestHook) {
      switch (latestHook.event) {
        case "PreInvocation":
          phase = "PRE_FLIGHT";
          candidateStartIso = latestHook.iso;
          break;
        case "PreToolUse":
          lastTool = {
            ...latestHook.toolCallId ? { id: latestHook.toolCallId } : {},
            name: latestHook.toolName || "tool",
            ...latestHook.toolSummary ? { summary: latestHook.toolSummary } : {},
            startedAt: latestHook.iso
          };
          phase = "TOOL_RUNNING";
          candidateStartIso = latestHook.iso;
          break;
        case "PostToolUse":
          phase = "THINKING";
          candidateStartIso = latestHook.iso;
          break;
        case "Stop":
          phase = "IDLE";
          candidateStartIso = latestHook.iso;
          break;
        default:
          phase = input.prevNode?.phase ?? "IDLE";
          candidateStartIso = input.prevNode?.phaseStartedAt ?? null;
          break;
      }
    } else if (hasErrorReason) {
      phase = "ERROR_OR_QUOTA";
      candidateStartIso = input.summary?.lastModifiedTime ?? null;
    } else {
      phase = "IDLE";
      candidateStartIso = input.summary?.lastModifiedTime ?? null;
    }
  }
  let phaseStartedAt = candidateStartIso;
  if (isActiveLifecyclePhase(phase)) {
    const samePhase = input.prevNode?.phase === phase;
    const sameTool = phase !== "TOOL_RUNNING" || (!lastTool?.id || lastTool.id === input.prevNode?.lastTool?.id) && lastTool?.name === input.prevNode?.lastTool?.name;
    if (samePhase && sameTool && input.prevNode?.phaseStartedAt) {
      phaseStartedAt = input.prevNode.phaseStartedAt;
    } else if (!phaseStartedAt) {
      phaseStartedAt = nowIso;
    }
  }
  const startedMs = parseValidMs(phaseStartedAt);
  const phaseElapsedMs = isActiveLifecyclePhase(phase) && startedMs !== null ? Math.max(0, nowMs - startedMs) : 0;
  return {
    phase,
    phaseStartedAt,
    phaseElapsedMs,
    lastTool,
    streamingTokPerSec
  };
}

// src/core/topology-builder.ts
function isSafeSegment(segment) {
  return Boolean(segment) && !segment.includes("/") && !segment.includes("\\") && !segment.includes("..") && !segment.includes("\0");
}
function unescapePbtxtString(raw) {
  return raw.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "	").replace(/\\r/g, "\r").replace(/\\\\/g, "\\");
}
function readFallbackTitleFromAnnotations(antigravityDataDir, cascadeId) {
  if (!antigravityDataDir || !isSafeSegment(cascadeId)) {
    return null;
  }
  const pbtxtPath = path2.join(antigravityDataDir, "annotations", `${cascadeId}.pbtxt`);
  if (!existsSync2(pbtxtPath)) {
    return null;
  }
  try {
    const content = readFileSync2(pbtxtPath, "utf8");
    const match = /^\s*title:\s*"((?:[^"\\]|\\.)*)"/m.exec(content);
    if (!match?.[1]) {
      return null;
    }
    const title = unescapePbtxtString(match[1]).trim();
    return title.length > 0 ? title : null;
  } catch {
    return null;
  }
}
function extractWorkspaceBasename(uri) {
  if (!uri || typeof uri !== "string") {
    return null;
  }
  let cleaned = uri.trim();
  if (!cleaned) {
    return null;
  }
  cleaned = cleaned.replace(/^file:\/\//i, "");
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
  }
  cleaned = cleaned.replace(/[\\/]+$/, "");
  if (!cleaned) {
    return null;
  }
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ? last.trim() : null;
}
function resolveCascadeTitle(summary, antigravityDataDir, cascadeId, role, extraWorkspaceUris) {
  const summaryTitle = typeof summary?.summary === "string" ? summary.summary.trim() : "";
  if (summaryTitle) {
    return summaryTitle;
  }
  const annotationTitle = readFallbackTitleFromAnnotations(antigravityDataDir, cascadeId);
  if (annotationTitle) {
    return annotationTitle;
  }
  const workspaceUri = summary?.workspaces?.[0]?.workspaceFolderAbsoluteUri ?? summary?.workspaces?.[0]?.gitRootAbsoluteUri ?? extraWorkspaceUris?.[0];
  const workspaceBase = extractWorkspaceBasename(workspaceUri);
  if (workspaceBase) {
    return workspaceBase;
  }
  const trimmedRole = typeof role === "string" ? role.trim() : "";
  if (trimmedRole) {
    return trimmedRole;
  }
  return `Cascade ${cascadeId.slice(0, 8)}`;
}
function readParentRefsFromSqliteReadOnly(dbPath) {
  if (!existsSync2(dbPath) || typeof process.getBuiltinModule !== "function") {
    return null;
  }
  const sqlite = process.getBuiltinModule("node:sqlite");
  if (!sqlite?.DatabaseSync) {
    return null;
  }
  let db = null;
  try {
    db = new sqlite.DatabaseSync(`file:${dbPath}?mode=ro`, { readOnly: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    for (const table of tables) {
      const tableName = table.name;
      if (!tableName || !/^[A-Za-z0-9_]+$/.test(tableName)) {
        continue;
      }
      const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
      const colNames = new Set(cols.map((c) => c.name).filter((n) => Boolean(n)));
      if (colNames.has("parent_cascade_id") || colNames.has("root_cascade_id")) {
        const selectCols = [
          colNames.has("parent_cascade_id") ? "parent_cascade_id" : "NULL AS parent_cascade_id",
          colNames.has("root_cascade_id") ? "root_cascade_id" : "NULL AS root_cascade_id"
        ].join(", ");
        const row = db.prepare(`SELECT ${selectCols} FROM ${tableName} LIMIT 1`).get();
        if (row) {
          const parentCascadeId = typeof row.parent_cascade_id === "string" && row.parent_cascade_id.trim() ? row.parent_cascade_id.trim() : void 0;
          const rootCascadeId = typeof row.root_cascade_id === "string" && row.root_cascade_id.trim() ? row.root_cascade_id.trim() : void 0;
          if (parentCascadeId || rootCascadeId) {
            return { parentCascadeId, rootCascadeId };
          }
        }
      }
    }
  } catch {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
      }
    }
  }
  return null;
}
function buildBreadcrumb(rootCascadeId, activeConversationId, nodesByCascadeId) {
  if (!activeConversationId) {
    return [];
  }
  const active = nodesByCascadeId[activeConversationId];
  if (!active) {
    return [];
  }
  const trail = [];
  const visited = /* @__PURE__ */ new Set();
  let curr = active;
  while (curr && !visited.has(curr.cascadeId)) {
    visited.add(curr.cascadeId);
    trail.push({
      cascadeId: curr.cascadeId,
      title: curr.title,
      role: curr.role
    });
    if (!curr.parentCascadeId || curr.cascadeId === rootCascadeId) {
      break;
    }
    curr = nodesByCascadeId[curr.parentCascadeId];
  }
  return trail.reverse();
}
function buildTopologyGraph(input) {
  const nowMs = input.nowMs ?? Date.now();
  const warnings = [];
  const discovery = /* @__PURE__ */ new Map();
  const getOrCreate = (cid) => {
    const existing = discovery.get(cid);
    if (existing) {
      return existing;
    }
    const created = {
      cascadeId: cid,
      parentCascadeId: null,
      explicitRootId: null,
      kind: "root",
      role: null,
      typeName: null,
      spawnStepIndex: null,
      workspaceUris: []
    };
    discovery.set(cid, created);
    return created;
  };
  for (const [cid, summary] of Object.entries(input.trajectories)) {
    if (!cid) continue;
    const rec = getOrCreate(cid);
    rec.summary = summary;
  }
  for (const cid of Object.keys(input.generatorMetadataByCascade)) {
    if (cid) {
      getOrCreate(cid);
    }
  }
  const brainQueue = Array.from(discovery.keys());
  const visitedBrain = /* @__PURE__ */ new Set();
  while (brainQueue.length > 0) {
    const parentCid = brainQueue.shift();
    if (!parentCid || visitedBrain.has(parentCid) || !isSafeSegment(parentCid)) {
      continue;
    }
    visitedBrain.add(parentCid);
    if (!input.antigravityDataDir) {
      continue;
    }
    const sysGenDir = path2.join(input.antigravityDataDir, "brain", parentCid, ".system_generated");
    if (!existsSync2(sysGenDir)) {
      continue;
    }
    const subagentsDir = path2.join(sysGenDir, "subagents");
    if (existsSync2(subagentsDir)) {
      try {
        const files = readdirSync(subagentsDir).filter((name) => name.endsWith(".json")).sort();
        for (const fileName of files) {
          const fullPath = path2.join(subagentsDir, fileName);
          try {
            const parsed = JSON.parse(readFileSync2(fullPath, "utf8"));
            const subCid = parsed.conversationId?.trim();
            if (!subCid || subCid === parentCid) {
              continue;
            }
            const childRec = getOrCreate(subCid);
            childRec.parentCascadeId = parentCid;
            childRec.kind = "subagent";
            childRec.role = parsed.subagentDescriptor?.role?.trim() || childRec.role;
            childRec.typeName = parsed.subagentDescriptor?.typeName?.trim() || childRec.typeName;
            if (typeof parsed.spawnStepIndex === "number" && Number.isFinite(parsed.spawnStepIndex)) {
              childRec.spawnStepIndex = parsed.spawnStepIndex;
            }
            if (Array.isArray(parsed.workspaceUris)) {
              childRec.workspaceUris = parsed.workspaceUris.filter(
                (u) => typeof u === "string" && u.trim().length > 0
              );
            }
            if (!visitedBrain.has(subCid)) {
              brainQueue.push(subCid);
            }
          } catch (err) {
            warnings.push(
              `Skipped malformed subagent descriptor ${fileName}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      } catch (err) {
        warnings.push(
          `Failed reading subagents dir for ${parentCid}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    const swarmMembersPath = path2.join(sysGenDir, "swarm", "members.json");
    if (existsSync2(swarmMembersPath)) {
      try {
        const parsed = JSON.parse(readFileSync2(swarmMembersPath, "utf8"));
        for (const [memberName, member] of Object.entries(parsed?.members ?? {})) {
          if (!member || typeof member !== "object") {
            continue;
          }
          const subCid = member.conversation_id?.trim() || `swarm:${parentCid}:${memberName}`;
          if (!subCid || subCid === parentCid) {
            continue;
          }
          const childRec = getOrCreate(subCid);
          childRec.parentCascadeId = parentCid;
          childRec.kind = "swarm_member";
          childRec.role = member.role?.trim() || memberName;
          childRec.typeName = "swarm";
          childRec.swarmMember = member;
          childRec.swarmState = {
            memberName,
            ...member.desired_state !== void 0 ? { desiredState: member.desired_state } : {},
            ...member.phase !== void 0 ? { phase: member.phase } : {},
            ...member.wake_mode !== void 0 ? { wakeMode: member.wake_mode } : {},
            ...member.killed !== void 0 ? { killed: member.killed } : {}
          };
          const reqRaw = member.desired_model?.trim() || member.model?.trim() || member.applied_model?.trim() || null;
          if (reqRaw) {
            childRec.requestedModelRaw = reqRaw;
            childRec.requestedSource = "swarm";
          }
          const appliedRaw = member.applied_model?.trim() || member.model?.trim() || null;
          if (appliedRaw) {
            childRec.provisionalServedModelRaw = appliedRaw;
          }
          if (member.conversation_id && !visitedBrain.has(subCid)) {
            brainQueue.push(subCid);
          }
        }
      } catch (err) {
        warnings.push(
          `Failed reading swarm/members.json for ${parentCid}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }
  for (const [cid, rec] of Array.from(discovery.entries())) {
    const genList = input.generatorMetadataByCascade[cid] ?? [];
    for (let i = genList.length - 1; i >= 0; i -= 1) {
      const custom = genList[i]?.chatModel?.customMetadata;
      if (!custom) continue;
      if (!rec.parentCascadeId && typeof custom.parent_cascade_id === "string") {
        const p = custom.parent_cascade_id.trim();
        if (p && p !== cid) {
          rec.parentCascadeId = p;
        }
      }
      if (!rec.explicitRootId && typeof custom.root_cascade_id === "string") {
        const r = custom.root_cascade_id.trim();
        if (r) {
          rec.explicitRootId = r;
        }
      }
      if (rec.parentCascadeId && rec.explicitRootId) {
        break;
      }
    }
    if (!rec.parentCascadeId && input.enableSqliteFallback !== false && input.antigravityDataDir && isSafeSegment(cid)) {
      const dbPath = path2.join(input.antigravityDataDir, "conversations", `${cid}.db`);
      if (existsSync2(dbPath)) {
        const sqliteRefs = readParentRefsFromSqliteReadOnly(dbPath);
        if (sqliteRefs?.parentCascadeId && sqliteRefs.parentCascadeId !== cid) {
          rec.parentCascadeId = sqliteRefs.parentCascadeId;
        }
        if (sqliteRefs?.rootCascadeId && !rec.explicitRootId) {
          rec.explicitRootId = sqliteRefs.rootCascadeId;
        }
      }
    }
    if (rec.parentCascadeId && rec.kind === "root") {
      const titleHint = rec.summary?.summary ?? "";
      rec.kind = /workflow/i.test(titleHint) ? "workflow" : "subagent";
    }
  }
  const hookEvents = input.recentHookEvents ?? [];
  for (const ev of hookEvents) {
    if (ev.event !== "PreToolUse" || ev.toolName !== "invoke_subagent" || !ev.subagentRequest || !ev.conversationId || ev.conversationId === "unknown") {
      continue;
    }
    if (nowMs - ev.ts > 15e3 || ev.ts > nowMs + 5e3) {
      continue;
    }
    const reqRole = ev.subagentRequest.role?.trim() || null;
    const reqType = ev.subagentRequest.typeName?.trim() || null;
    let alreadyMaterialized = false;
    for (const candidate of discovery.values()) {
      if (candidate.parentCascadeId !== ev.conversationId || candidate.isPreflightSynthetic) {
        continue;
      }
      const roleMatch = !reqRole || candidate.role === reqRole;
      const typeMatch = !reqType || candidate.typeName === reqType;
      if (roleMatch && typeMatch) {
        const createdMs = Date.parse(
          candidate.summary?.createdTime ?? candidate.summary?.lastModifiedTime ?? ""
        );
        const isActiveSummary = candidate.summary?.status === "CASCADE_RUN_STATUS_RUNNING";
        if (isActiveSummary || Number.isFinite(createdMs) && createdMs >= ev.ts - 2e3) {
          alreadyMaterialized = true;
          break;
        }
      }
    }
    if (alreadyMaterialized) {
      continue;
    }
    getOrCreate(ev.conversationId);
    const preflightId = `preflight:${ev.conversationId}:${ev.toolCallId || ev.ts}`;
    const preRec = getOrCreate(preflightId);
    preRec.parentCascadeId = ev.conversationId;
    preRec.kind = "subagent";
    preRec.role = reqRole;
    preRec.typeName = reqType;
    preRec.isPreflightSynthetic = true;
    preRec.preflightHook = ev;
    if (ev.subagentRequest.model?.trim()) {
      preRec.requestedModelRaw = ev.subagentRequest.model.trim();
      preRec.requestedSource = "explicit";
    } else {
      preRec.requestedModelRaw = "inherit";
      preRec.requestedSource = "inherited";
    }
  }
  const effectiveParentByCid = /* @__PURE__ */ new Map();
  const rootByCascadeId = {};
  const depthByCid = /* @__PURE__ */ new Map();
  const childrenByCid = /* @__PURE__ */ new Map();
  for (const cid of discovery.keys()) {
    childrenByCid.set(cid, []);
  }
  const cycleWarned = /* @__PURE__ */ new Set();
  for (const cid of Array.from(discovery.keys()).sort()) {
    const chain = [cid];
    const visited = /* @__PURE__ */ new Set([cid]);
    let curr = cid;
    while (true) {
      const parent = discovery.get(curr)?.parentCascadeId;
      if (!parent || !discovery.has(parent)) {
        break;
      }
      if (visited.has(parent)) {
        const cycleKey = [curr, parent].sort().join("<->");
        if (!cycleWarned.has(cycleKey)) {
          cycleWarned.add(cycleKey);
          warnings.push(`Cycle detected in cascade topology involving ${curr} and ${parent}; broken safely.`);
        }
        break;
      }
      visited.add(parent);
      chain.push(parent);
      curr = parent;
    }
    const effectiveParent = chain.length > 1 ? chain[1] : null;
    effectiveParentByCid.set(cid, effectiveParent);
    if (effectiveParent) {
      childrenByCid.get(effectiveParent)?.push(cid);
    }
    const rec = discovery.get(cid);
    const walkedRoot = chain[chain.length - 1];
    if (chain.length === 1 && rec?.explicitRootId && rec.explicitRootId !== cid && discovery.has(rec.explicitRootId)) {
      rootByCascadeId[cid] = rec.explicitRootId;
      depthByCid.set(cid, 1);
    } else {
      rootByCascadeId[cid] = walkedRoot;
      depthByCid.set(cid, chain.length - 1);
    }
  }
  const lsConnected = input.lsConnected ?? Object.keys(input.trajectories).length > 0;
  const nodesByCascadeId = {};
  for (const [cid, rec] of discovery.entries()) {
    const summary = rec.summary;
    const genMetas = input.generatorMetadataByCascade[cid] ?? [];
    let latestGenMeta = null;
    for (let i = genMetas.length - 1; i >= 0; i -= 1) {
      if (genMetas[i]?.chatModel) {
        latestGenMeta = genMetas[i];
        break;
      }
    }
    const latestChat = latestGenMeta?.chatModel;
    let inputTokens = 0;
    let cacheReadTokens = 0;
    let outputTokens = 0;
    let thinkingOutputTokens = 0;
    let responseOutputTokens = 0;
    let turnCount = 0;
    for (const entry of genMetas) {
      if (!entry.chatModel) continue;
      turnCount += 1;
      const usage = entry.chatModel.usage;
      if (!usage) continue;
      const turnIn = toIntToken(usage.inputTokens);
      const turnCache = toIntToken(usage.cacheReadTokens);
      const turnOut = toIntToken(usage.outputTokens);
      const turnThink = toIntToken(usage.thinkingOutputTokens);
      const turnResp = usage.responseOutputTokens !== void 0 ? toIntToken(usage.responseOutputTokens) : Math.max(0, turnOut - turnThink);
      inputTokens += turnIn;
      cacheReadTokens += turnCache;
      outputTokens += turnOut;
      thinkingOutputTokens += turnThink;
      responseOutputTokens += turnResp;
    }
    const cacheHitPct = computeCacheHitPct(inputTokens, cacheReadTokens);
    const contextWindow = computeContextWindow(
      latestChat?.chatStartMetadata?.contextWindowMetadata,
      input.smartThresholds ? {
        warnPct: input.smartThresholds.contextWarnPct,
        criticalPct: input.smartThresholds.contextCriticalPct
      } : void 0
    );
    const cascadeHooks = hookEvents.filter((ev) => ev.conversationId === cid).sort((a, b) => a.ts - b.ts);
    const latestInvocationHook = [...cascadeHooks].reverse().find((ev) => Boolean(ev.modelRaw));
    const tailSteps = input.stepsByCascade?.[cid] ?? [];
    const latestStep = tailSteps.length > 0 ? tailSteps[tailSteps.length - 1] : void 0;
    const requestedRaw = rec.requestedModelRaw ?? latestInvocationHook?.modelRaw ?? latestChat?.customMetadata?.model_enum ?? null;
    const requestedSource = rec.requestedSource ?? (latestInvocationHook?.modelRaw ? "user" : latestChat?.customMetadata?.model_enum ? "user" : rec.parentCascadeId ? "inherited" : void 0);
    const provisionalServed = rec.provisionalServedModelRaw ?? latestStep?.metadata?.generatorModel ?? null;
    const routing = reconcileRequestedVsServed({
      catalog: input.modelCatalog,
      requestedModelRaw: requestedRaw,
      requestedSource,
      latestGenMeta,
      provisionalServedModelRaw: provisionalServed
    });
    const prevNode = input.prevNodesByCascadeId?.[cid] ?? null;
    const state = rec.isPreflightSynthetic && rec.preflightHook ? {
      phase: "PRE_FLIGHT",
      phaseStartedAt: rec.preflightHook.iso,
      phaseElapsedMs: Math.max(0, nowMs - rec.preflightHook.ts),
      lastTool: null,
      streamingTokPerSec: null
    } : deriveCascadePhase({
      cascadeId: cid,
      lsConnected,
      summary,
      tailSteps,
      latestGenMeta,
      recentHookEvents: cascadeHooks,
      prevNode,
      swarmMember: rec.swarmMember,
      nowMs
    });
    const title = rec.isPreflightSynthetic ? rec.role || rec.typeName || "Spawning Subagent" : resolveCascadeTitle(
      summary,
      input.antigravityDataDir,
      cid,
      rec.role,
      rec.workspaceUris
    );
    const lastTtftMs = latestChat?.timeToFirstToken ? parseDurationMs(latestChat.timeToFirstToken) : null;
    const lastStreamingMs = latestChat?.streamingDuration ? parseDurationMs(latestChat.streamingDuration) : null;
    const lastModifiedTime = summary?.lastModifiedTime ?? rec.preflightHook?.iso ?? latestChat?.timestamp ?? latestChat?.createdAt ?? new Date(nowMs).toISOString();
    const sortedChildren = [...childrenByCid.get(cid) ?? []].sort((a, b) => {
      const aSpawn = discovery.get(a)?.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
      const bSpawn = discovery.get(b)?.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
      if (aSpawn !== bSpawn) return aSpawn - bSpawn;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const node = {
      cascadeId: cid,
      rootCascadeId: rootByCascadeId[cid] ?? cid,
      parentCascadeId: effectiveParentByCid.get(cid) ?? null,
      kind: rec.kind,
      title,
      role: rec.role,
      typeName: rec.typeName,
      depth: depthByCid.get(cid) ?? 0,
      status: summary?.status ?? (rec.isPreflightSynthetic ? "CASCADE_RUN_STATUS_RUNNING" : "CASCADE_RUN_STATUS_IDLE"),
      phase: state.phase,
      phaseStartedAt: state.phaseStartedAt,
      phaseElapsedMs: state.phaseElapsedMs,
      requestedModel: routing.requestedModel,
      servedModel: routing.servedModel,
      routingStatus: routing.routingStatus,
      retryCount: routing.retryCount,
      lastTool: state.lastTool,
      stepCount: summary?.stepCount ?? 0,
      turnCount,
      streamingTokPerSec: state.streamingTokPerSec,
      contextWindow,
      cacheHitPct,
      tokens: {
        inputTokens,
        cacheReadTokens,
        outputTokens,
        thinkingOutputTokens,
        responseOutputTokens
      },
      deltaQuota5hPct: input.quotaBaselines?.[cid]?.delta5hPct ?? null,
      lastTtftMs,
      lastStreamingMs,
      lastModifiedTime,
      spawnStepIndex: rec.spawnStepIndex,
      ...rec.swarmState ? { swarmState: rec.swarmState } : {},
      childrenIds: sortedChildren
    };
    nodesByCascadeId[cid] = node;
  }
  const treesByRootId = {};
  const roots = Object.values(nodesByCascadeId).filter((n) => n.parentCascadeId === null).sort((a, b) => a.cascadeId < b.cascadeId ? -1 : a.cascadeId > b.cascadeId ? 1 : 0);
  for (const root of roots) {
    const ordered = [];
    const seen = /* @__PURE__ */ new Set();
    const visit = (nid) => {
      if (seen.has(nid)) return;
      seen.add(nid);
      const node = nodesByCascadeId[nid];
      if (!node) return;
      ordered.push(node);
      for (const childId of node.childrenIds) {
        visit(childId);
      }
    };
    visit(root.cascadeId);
    treesByRootId[root.cascadeId] = ordered;
  }
  for (const node of Object.values(nodesByCascadeId)) {
    const rootId = node.rootCascadeId;
    if (!treesByRootId[rootId]) {
      treesByRootId[rootId] = [];
    }
    if (!treesByRootId[rootId].some((n) => n.cascadeId === node.cascadeId)) {
      treesByRootId[rootId].push(node);
    }
  }
  return {
    nodesByCascadeId,
    rootByCascadeId,
    treesByRootId,
    warnings
  };
}

// src/core/fleet-builder.ts
var ROLLING_5H_WINDOW_MS = 5 * 60 * 60 * 1e3;
var TIER_WEIGHT2 = {
  alert: 0,
  fast: 1,
  orchestrator: 2,
  workhorse: 3,
  apex: 4
};
var EFFORT_SHORT_MAP = {
  xhigh: "(XH)",
  high: "(H)",
  medium: "(M)",
  med: "(M)",
  low: "(L)"
};
function compareStringAsc(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function round8(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1e8) / 1e8;
}
function parseValidMs2(iso) {
  if (!iso || typeof iso !== "string") {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function isNodeRunning(node) {
  return node.status === "CASCADE_RUN_STATUS_RUNNING" || node.phase !== "IDLE" && node.phase !== "ERROR_OR_QUOTA";
}
function isRootNode(node) {
  return node.kind === "root" || node.parentCascadeId === null;
}
function compactModelLabel(servedModel) {
  let label = (servedModel.displayName || servedModel.responseModel || servedModel.modelEnum || "Unknown").trim();
  if (!label) {
    return "Unknown";
  }
  const pendingStripped = label.replace(/\s*\(pending\)\s*$/i, "").trim();
  if (pendingStripped) {
    label = pendingStripped;
  }
  let effortSuffix = "";
  const effortMatch = /\s*\((xhigh|high|medium|med|low)\)\s*$/i.exec(label);
  if (effortMatch?.[1]) {
    effortSuffix = EFFORT_SHORT_MAP[effortMatch[1].toLowerCase()] ?? "";
    label = label.slice(0, effortMatch.index).trim();
  }
  label = label.replace(/^(?:Gemini|Claude)\s+(?:\d+(?:\.\d+)*\s+)?/i, "").replace(/^OpenAI\s+/i, "").replace(/^(Opus|Sonnet|Haiku|Carbon|Argon|Hydrogen|Flash(?:\s+Lite)?)\s+\d+(?:\.\d+)*$/i, "$1").trim();
  if (!label) {
    label = "Unknown";
  }
  return `${label}${effortSuffix}`;
}
function normalizeUriKey(uri) {
  return uri.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
function collectWorkspacesFromNodes(rootCascadeId, treeNodes, trajectories) {
  const rootWorkspaces = trajectories[rootCascadeId]?.workspaces;
  if (Array.isArray(rootWorkspaces) && rootWorkspaces.length > 0) {
    return rootWorkspaces;
  }
  for (const node of treeNodes) {
    const childWorkspaces = trajectories[node.cascadeId]?.workspaces;
    if (Array.isArray(childWorkspaces) && childWorkspaces.length > 0) {
      return childWorkspaces;
    }
  }
  return [];
}
function resolveProjectIdentity(rootCascadeId, treeNodes, trajectories) {
  const workspaces = collectWorkspacesFromNodes(rootCascadeId, treeNodes, trajectories);
  const rawUris = [];
  const repoNames = [];
  for (const ws of workspaces) {
    const uri = ws.workspaceFolderAbsoluteUri?.trim() || ws.gitRootAbsoluteUri?.trim() || "";
    if (uri && !rawUris.includes(uri)) {
      rawUris.push(uri);
    }
    const repoName = ws.repository?.computedName?.trim() || "";
    if (repoName && !repoNames.includes(repoName)) {
      repoNames.push(repoName);
    }
  }
  if (rawUris.length > 0) {
    const normalizedKeys = Array.from(new Set(rawUris.map(normalizeUriKey))).sort(compareStringAsc);
    const projectKey = normalizedKeys.join("|");
    const firstBase = extractWorkspaceBasename(rawUris[0]);
    const projectName = firstBase || repoNames[0] || "Workspace Unavailable";
    return {
      projectKey,
      projectName,
      workspaceUris: rawUris
    };
  }
  if (repoNames.length > 0) {
    return {
      projectKey: `repo:${repoNames[0].toLowerCase()}`,
      projectName: repoNames[0],
      workspaceUris: []
    };
  }
  return {
    projectKey: "__global__",
    projectName: "Workspace Unavailable",
    workspaceUris: []
  };
}
function computeTreeDelta5hPct(treeNodes, cascadeBaselines) {
  let hasBaseline = false;
  let total = 0;
  for (const node of treeNodes) {
    const baseline = cascadeBaselines[node.cascadeId];
    if (baseline) {
      hasBaseline = true;
      total += Math.max(0, baseline.delta5hPct);
    } else if (node.deltaQuota5hPct !== null && node.deltaQuota5hPct !== void 0 && Number.isFinite(node.deltaQuota5hPct)) {
      hasBaseline = true;
      total += Math.max(0, node.deltaQuota5hPct);
    }
  }
  const rounded = round8(Math.max(0, total));
  return {
    treeDeltaQuota5hPct: hasBaseline ? rounded : null,
    positiveConsumedPct: rounded
  };
}
function nodeTotalTokens(node) {
  return Math.max(0, node.tokens.inputTokens) + Math.max(0, node.tokens.cacheReadTokens) + Math.max(0, node.tokens.outputTokens);
}
function selectDominantNode(treeNodes, rootCascadeId) {
  let best = treeNodes[0];
  for (let i = 1; i < treeNodes.length; i += 1) {
    const candidate = treeNodes[i];
    const bestTok = nodeTotalTokens(best);
    const candTok = nodeTotalTokens(candidate);
    if (candTok !== bestTok) {
      if (candTok > bestTok) {
        best = candidate;
      }
      continue;
    }
    const bestTierWeight = TIER_WEIGHT2[best.servedModel.tier] ?? 0;
    const candTierWeight = TIER_WEIGHT2[candidate.servedModel.tier] ?? 0;
    if (candTierWeight !== bestTierWeight) {
      if (candTierWeight > bestTierWeight) {
        best = candidate;
      }
      continue;
    }
    const bestIsRoot = best.cascadeId === rootCascadeId ? 1 : 0;
    const candIsRoot = candidate.cascadeId === rootCascadeId ? 1 : 0;
    if (candIsRoot !== bestIsRoot) {
      if (candIsRoot > bestIsRoot) {
        best = candidate;
      }
      continue;
    }
    if (compareStringAsc(candidate.cascadeId, best.cascadeId) < 0) {
      best = candidate;
    }
  }
  return best;
}
function buildFleetSnapshot(input) {
  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const recentIdleWindowMs = input.recentIdleWindowMs ?? ROLLING_5H_WINDOW_MS;
  const maxIdleTreesPerProject = input.maxIdleTreesPerProject ?? 5;
  const allNodes = Object.values(input.nodesByCascadeId);
  if (allNodes.length === 0) {
    return {
      generatedAt,
      hostConnected: input.hostConnected,
      activeHeadline: {
        runningRoots: 0,
        runningSubagents: 0,
        totalRunningNodes: 0,
        modelHistogram: []
      },
      projects: [],
      topQuotaBurners: [],
      quota: input.quota
    };
  }
  let runningRoots = 0;
  let runningSubagents = 0;
  const histogramMap = /* @__PURE__ */ new Map();
  for (const node of allNodes) {
    if (!isNodeRunning(node)) {
      continue;
    }
    if (isRootNode(node)) {
      runningRoots += 1;
    } else {
      runningSubagents += 1;
    }
    const label = compactModelLabel(node.servedModel);
    const key = `${label}\0${node.servedModel.tier}`;
    const prev = histogramMap.get(key);
    if (prev) {
      prev.count += 1;
    } else {
      histogramMap.set(key, { label, tier: node.servedModel.tier, count: 1 });
    }
  }
  const modelHistogram = Array.from(histogramMap.values()).sort((a, b) => {
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    const labelCmp = compareStringAsc(a.label, b.label);
    if (labelCmp !== 0) {
      return labelCmp;
    }
    return compareStringAsc(a.tier, b.tier);
  });
  const nodesByRoot = /* @__PURE__ */ new Map();
  for (const node of allNodes) {
    const rootId = node.rootCascadeId || node.cascadeId;
    const list = nodesByRoot.get(rootId);
    if (list) {
      list.push(node);
    } else {
      nodesByRoot.set(rootId, [node]);
    }
  }
  const treeRecords = [];
  for (const [rootCascadeId, rawTreeNodes] of nodesByRoot.entries()) {
    const rootNode = rawTreeNodes.find((n) => n.cascadeId === rootCascadeId) ?? rawTreeNodes.find((n) => n.parentCascadeId === null) ?? rawTreeNodes[0];
    const activeNodes = rawTreeNodes.filter(isNodeRunning);
    const activeNodeCount = activeNodes.length;
    const totalNodeCount = rawTreeNodes.length;
    let elapsedMs = 0;
    if (activeNodeCount > 0) {
      let earliestMs = null;
      for (const active of activeNodes) {
        const tsMs = parseValidMs2(active.phaseStartedAt) ?? parseValidMs2(active.lastModifiedTime);
        if (tsMs !== null && (earliestMs === null || tsMs < earliestMs)) {
          earliestMs = tsMs;
        }
      }
      elapsedMs = earliestMs !== null ? Math.max(0, nowMs - earliestMs) : Math.max(0, ...activeNodes.map((n) => n.phaseElapsedMs));
    }
    const mixSourceNodes = activeNodeCount > 0 ? activeNodes : rawTreeNodes;
    const mixCounts = /* @__PURE__ */ new Map();
    for (const n of mixSourceNodes) {
      const label = compactModelLabel(n.servedModel);
      mixCounts.set(label, (mixCounts.get(label) ?? 0) + 1);
    }
    const modelMix = {};
    for (const label of Array.from(mixCounts.keys()).sort(compareStringAsc)) {
      modelMix[label] = mixCounts.get(label) ?? 0;
    }
    const sortedNodes = [...rawTreeNodes].sort((a, b) => {
      const activeDiff = (isNodeRunning(b) ? 1 : 0) - (isNodeRunning(a) ? 1 : 0);
      if (activeDiff !== 0) {
        return activeDiff;
      }
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      const titleCmp = compareStringAsc(a.title.toLowerCase(), b.title.toLowerCase());
      if (titleCmp !== 0) {
        return titleCmp;
      }
      return compareStringAsc(a.cascadeId, b.cascadeId);
    });
    const { treeDeltaQuota5hPct, positiveConsumedPct } = computeTreeDelta5hPct(
      rawTreeNodes,
      input.cascadeBaselines
    );
    let maxLastModifiedMs = 0;
    let maxLastModifiedIso = rootNode.lastModifiedTime || generatedAt;
    let totalTokens = 0;
    for (const n of rawTreeNodes) {
      totalTokens += nodeTotalTokens(n);
      const ms = parseValidMs2(n.lastModifiedTime);
      if (ms !== null && ms > maxLastModifiedMs) {
        maxLastModifiedMs = ms;
        maxLastModifiedIso = n.lastModifiedTime;
      }
    }
    const trajModMs = parseValidMs2(input.trajectories[rootCascadeId]?.lastModifiedTime);
    if (trajModMs !== null && trajModMs > maxLastModifiedMs) {
      maxLastModifiedMs = trajModMs;
      maxLastModifiedIso = input.trajectories[rootCascadeId]?.lastModifiedTime ?? maxLastModifiedIso;
    }
    const dominantNode = selectDominantNode(rawTreeNodes, rootCascadeId);
    const projectIdentity = resolveProjectIdentity(
      rootCascadeId,
      rawTreeNodes,
      input.trajectories
    );
    treeRecords.push({
      summary: {
        rootCascadeId,
        rootTitle: rootNode.title,
        rootPhase: rootNode.phase,
        activeNodeCount,
        totalNodeCount,
        elapsedMs,
        modelMix,
        nodes: sortedNodes,
        treeDeltaQuota5hPct
      },
      projectIdentity,
      maxLastModifiedMs,
      maxLastModifiedIso,
      positiveConsumed5hPct: positiveConsumedPct,
      totalTokens,
      dominantModel: compactModelLabel(dominantNode.servedModel),
      dominantTier: dominantNode.servedModel.tier
    });
  }
  const idleCutoffMs = nowMs - recentIdleWindowMs;
  const projectMap = /* @__PURE__ */ new Map();
  for (const rec of treeRecords) {
    const isTreeActive = rec.summary.activeNodeCount > 0;
    if (!isTreeActive && rec.maxLastModifiedMs < idleCutoffMs) {
      continue;
    }
    const { projectKey, projectName, workspaceUris } = rec.projectIdentity;
    let bucket = projectMap.get(projectKey);
    if (!bucket) {
      bucket = {
        projectKey,
        projectName,
        workspaceUris: /* @__PURE__ */ new Set(),
        activeTrees: [],
        idleTrees: [],
        maxLastModifiedMs: 0
      };
      projectMap.set(projectKey, bucket);
    }
    for (const uri of workspaceUris) {
      bucket.workspaceUris.add(uri);
    }
    if (rec.maxLastModifiedMs > bucket.maxLastModifiedMs) {
      bucket.maxLastModifiedMs = rec.maxLastModifiedMs;
    }
    if (isTreeActive) {
      bucket.activeTrees.push(rec);
    } else {
      bucket.idleTrees.push(rec);
    }
  }
  const sortTreesDesc = (a, b) => {
    const activeDiff = (b.summary.activeNodeCount > 0 ? 1 : 0) - (a.summary.activeNodeCount > 0 ? 1 : 0);
    if (activeDiff !== 0) {
      return activeDiff;
    }
    if (b.summary.activeNodeCount !== a.summary.activeNodeCount) {
      return b.summary.activeNodeCount - a.summary.activeNodeCount;
    }
    if (b.maxLastModifiedMs !== a.maxLastModifiedMs) {
      return b.maxLastModifiedMs - a.maxLastModifiedMs;
    }
    const titleCmp = compareStringAsc(
      a.summary.rootTitle.toLowerCase(),
      b.summary.rootTitle.toLowerCase()
    );
    if (titleCmp !== 0) {
      return titleCmp;
    }
    return compareStringAsc(a.summary.rootCascadeId, b.summary.rootCascadeId);
  };
  const projectsWithMeta = [];
  for (const bucket of projectMap.values()) {
    bucket.activeTrees.sort(sortTreesDesc);
    bucket.idleTrees.sort(sortTreesDesc);
    const cappedIdle = maxIdleTreesPerProject > 0 ? bucket.idleTrees.slice(0, maxIdleTreesPerProject) : [];
    const combinedTrees = [...bucket.activeTrees, ...cappedIdle];
    if (combinedTrees.length === 0) {
      continue;
    }
    const runningCount = combinedTrees.reduce(
      (sum, t) => sum + t.summary.activeNodeCount,
      0
    );
    projectsWithMeta.push({
      group: {
        projectKey: bucket.projectKey,
        projectName: bucket.projectName,
        workspaceUris: Array.from(bucket.workspaceUris),
        runningCount,
        trees: combinedTrees.map((t) => t.summary)
      },
      maxLastModifiedMs: bucket.maxLastModifiedMs
    });
  }
  projectsWithMeta.sort((a, b) => {
    const activeDiff = (b.group.runningCount > 0 ? 1 : 0) - (a.group.runningCount > 0 ? 1 : 0);
    if (activeDiff !== 0) {
      return activeDiff;
    }
    if (b.group.runningCount !== a.group.runningCount) {
      return b.group.runningCount - a.group.runningCount;
    }
    if (b.maxLastModifiedMs !== a.maxLastModifiedMs) {
      return b.maxLastModifiedMs - a.maxLastModifiedMs;
    }
    const nameCmp = compareStringAsc(
      a.group.projectName.toLowerCase(),
      b.group.projectName.toLowerCase()
    );
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return compareStringAsc(a.group.projectKey, b.group.projectKey);
  });
  const rollingCutoffMs = nowMs - ROLLING_5H_WINDOW_MS;
  const burnerCandidates = treeRecords.filter((rec) => {
    const in5hWindow = rec.summary.activeNodeCount > 0 || rec.maxLastModifiedMs >= rollingCutoffMs;
    const hasConsumption = rec.positiveConsumed5hPct > 0 || rec.totalTokens > 0;
    return (in5hWindow || rec.positiveConsumed5hPct > 0) && hasConsumption;
  });
  burnerCandidates.sort((a, b) => {
    if (b.positiveConsumed5hPct !== a.positiveConsumed5hPct) {
      return b.positiveConsumed5hPct - a.positiveConsumed5hPct;
    }
    if (b.totalTokens !== a.totalTokens) {
      return b.totalTokens - a.totalTokens;
    }
    if (b.maxLastModifiedMs !== a.maxLastModifiedMs) {
      return b.maxLastModifiedMs - a.maxLastModifiedMs;
    }
    return compareStringAsc(a.summary.rootCascadeId, b.summary.rootCascadeId);
  });
  const topQuotaBurners = burnerCandidates.slice(0, 5).map((rec, idx) => ({
    rank: idx + 1,
    rootCascadeId: rec.summary.rootCascadeId,
    title: rec.summary.rootTitle,
    projectName: rec.projectIdentity.projectName,
    dominantModel: rec.dominantModel,
    dominantTier: rec.dominantTier,
    consumed5hPct: rec.positiveConsumed5hPct,
    delta5hPct: rec.positiveConsumed5hPct,
    totalTokens: rec.totalTokens,
    lastActiveAt: rec.maxLastModifiedIso,
    isRunning: rec.summary.activeNodeCount > 0
  }));
  return {
    generatedAt,
    hostConnected: input.hostConnected,
    activeHeadline: {
      runningRoots,
      runningSubagents,
      totalRunningNodes: runningRoots + runningSubagents,
      modelHistogram
    },
    projects: projectsWithMeta.map((p) => p.group),
    topQuotaBurners,
    quota: input.quota
  };
}

// src/core/quota-calculator.ts
var FIVE_MIN_MS = 5 * 60 * 1e3;
var RESET_HYSTERESIS = 5e-3;
function round82(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1e8) / 1e8;
}
function formatResetCountdown(resetTime, nowMs = Date.now()) {
  if (!resetTime || typeof resetTime !== "string") {
    return { resetInSeconds: null, resetInLabel: "\u2014" };
  }
  const targetMs = Date.parse(resetTime);
  if (!Number.isFinite(targetMs)) {
    return { resetInSeconds: null, resetInLabel: "\u2014" };
  }
  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1e3));
  if (diffSec <= 0) {
    return { resetInSeconds: 0, resetInLabel: "0m" };
  }
  if (diffSec < 3600) {
    return { resetInSeconds: diffSec, resetInLabel: `${Math.ceil(diffSec / 60)}m` };
  }
  if (diffSec < 86400) {
    const hours2 = Math.floor(diffSec / 3600);
    const mins = Math.floor(diffSec % 3600 / 60);
    return { resetInSeconds: diffSec, resetInLabel: `${hours2}h ${mins}m` };
  }
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor(diffSec % 86400 / 3600);
  return { resetInSeconds: diffSec, resetInLabel: `${days}d ${hours}h` };
}
function computeBurnRate5hPctPerMin(samples, nowMs) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return null;
  }
  const valid = samples.filter(
    (s) => Number.isFinite(s.tsMs) && Number.isFinite(s.remainingFraction) && s.remainingFraction >= 0 && s.remainingFraction <= 1
  ).sort((a, b) => a.tsMs - b.tsMs);
  if (valid.length < 2) {
    return null;
  }
  const refMs = nowMs !== void 0 && Number.isFinite(nowMs) ? nowMs : valid[valid.length - 1].tsMs;
  const windowSamples = valid.filter((s) => s.tsMs >= refMs - FIVE_MIN_MS && s.tsMs <= refMs);
  if (windowSamples.length < 2) {
    return null;
  }
  const elapsedMs = windowSamples[windowSamples.length - 1].tsMs - windowSamples[0].tsMs;
  if (elapsedMs < 1e4) {
    return null;
  }
  let positiveDropsPct = 0;
  for (let i = 1; i < windowSamples.length; i += 1) {
    const drop = windowSamples[i - 1].remainingFraction - windowSamples[i].remainingFraction;
    if (drop > 0) {
      positiveDropsPct += drop * 100;
    }
  }
  if (positiveDropsPct <= 0) {
    return null;
  }
  const elapsedMinutes = elapsedMs / 6e4;
  return elapsedMinutes > 0 ? round82(positiveDropsPct / elapsedMinutes) : null;
}
function updateCascadeQuotaBaselines(input) {
  const nextBaselines = {};
  for (const [cid, entry] of Object.entries(input.prevBaselines)) {
    nextBaselines[cid] = { ...entry };
  }
  const dedupedSignals = /* @__PURE__ */ new Map();
  for (const signal of input.activeCascades) {
    if (!signal.cascadeId) continue;
    const prev = dedupedSignals.get(signal.cascadeId);
    if (!prev) {
      dedupedSignals.set(signal.cascadeId, { ...signal });
    } else {
      dedupedSignals.set(signal.cascadeId, {
        cascadeId: signal.cascadeId,
        isRunning: prev.isRunning || signal.isRunning,
        stepCountIncremented: Boolean(prev.stepCountIncremented || signal.stepCountIncremented),
        tokenDelta: Math.max(0, prev.tokenDelta ?? 0) + Math.max(0, signal.tokenDelta ?? 0)
      });
    }
  }
  const ensureBaseline = (cid) => {
    const existing = nextBaselines[cid];
    if (existing) {
      return existing;
    }
    const created = {
      firstSeenAt: input.nowIso,
      baseline5hFraction: input.currGlobal5hFraction,
      last5hFraction: input.currGlobal5hFraction,
      delta5hPct: 0
    };
    nextBaselines[cid] = created;
    return created;
  };
  for (const cid of dedupedSignals.keys()) {
    ensureBaseline(cid);
  }
  for (const cid of input.allKnownCascadeIds ?? []) {
    if (cid) ensureBaseline(cid);
  }
  const prevGlobal = input.prevGlobal5hFraction;
  const currGlobal = input.currGlobal5hFraction;
  if (currGlobal === null || !Number.isFinite(currGlobal)) {
    return nextBaselines;
  }
  if (prevGlobal === null || !Number.isFinite(prevGlobal)) {
    for (const entry of Object.values(nextBaselines)) {
      if (entry.baseline5hFraction === null) {
        entry.baseline5hFraction = currGlobal;
      }
      entry.last5hFraction = currGlobal;
    }
    return nextBaselines;
  }
  if (currGlobal > prevGlobal + RESET_HYSTERESIS) {
    for (const entry of Object.values(nextBaselines)) {
      entry.baseline5hFraction = currGlobal;
      entry.last5hFraction = currGlobal;
      entry.delta5hPct = Math.max(0, entry.delta5hPct);
    }
    return nextBaselines;
  }
  if (currGlobal <= prevGlobal) {
    const tickDropPct = round82(Math.max(0, (prevGlobal - currGlobal) * 100));
    if (tickDropPct > 0) {
      const attributed = Array.from(dedupedSignals.values()).filter(
        (c) => c.isRunning || c.stepCountIncremented || (c.tokenDelta ?? 0) > 0
      );
      if (attributed.length > 0) {
        const totalTokenDelta = attributed.reduce(
          (sum, c) => sum + Math.max(0, c.tokenDelta ?? 0),
          0
        );
        for (const sig of attributed) {
          const entry = ensureBaseline(sig.cascadeId);
          const share = totalTokenDelta > 0 ? tickDropPct * (Math.max(0, sig.tokenDelta ?? 0) / totalTokenDelta) : tickDropPct / attributed.length;
          entry.delta5hPct = round82(Math.max(0, entry.delta5hPct + share));
        }
      }
    }
  }
  for (const entry of Object.values(nextBaselines)) {
    entry.last5hFraction = currGlobal;
  }
  return nextBaselines;
}
function toBucketView(rawBucket, groupId, nowMs) {
  const bucketId = (rawBucket.bucketId ?? "").trim();
  const displayName = (rawBucket.displayName ?? bucketId) || "Quota";
  const rawFraction = typeof rawBucket.remainingFraction === "number" && Number.isFinite(rawBucket.remainingFraction) ? rawBucket.remainingFraction : 0;
  const remainingFraction = Math.min(1, Math.max(0, rawFraction));
  const remainingPct = remainingFraction * 100;
  const resetTime = rawBucket.resetTime ?? null;
  const { resetInSeconds, resetInLabel } = formatResetCountdown(resetTime, nowMs);
  const inferredWindow = rawBucket.window?.trim() || (/week/i.test(`${bucketId} ${displayName}`) ? "weekly" : "5h");
  return {
    bucketId,
    ...groupId ? { groupId } : {},
    displayName,
    window: inferredWindow,
    remainingFraction,
    remainingPct,
    resetTime,
    resetInSeconds,
    resetInLabel,
    isLowAlert: remainingPct < 15
  };
}
function normalizeQuotaSummary(raw, prevCache, activeTreeNodeIds = [], fetchedAt = (/* @__PURE__ */ new Date()).toISOString(), burnSamples = [], activeCascades) {
  const parsedMs = Date.parse(fetchedAt);
  const nowMs = Number.isFinite(parsedMs) ? parsedMs : Date.now();
  const groups = raw?.response?.groups ?? raw?.groups ?? [];
  const buckets = [];
  for (const group of groups) {
    for (const rawBucket of group.buckets ?? []) {
      buckets.push(toBucketView(rawBucket, group.groupId, nowMs));
    }
  }
  const findSlot = (exactId, fallbackRe) => buckets.find((b) => b.bucketId === exactId) ?? buckets.find((b) => fallbackRe.test(`${b.bucketId} ${b.displayName}`)) ?? null;
  const gemini5h = findSlot("gemini-5h", /gemini.*5h/i);
  const geminiWeekly = findSlot("gemini-weekly", /gemini.*week/i);
  const thirdParty5h = findSlot("3p-5h", /(?:3p|third[-_ ]?party|claude).*5h/i);
  const thirdPartyWeekly = findSlot("3p-weekly", /(?:3p|third[-_ ]?party|claude).*week/i);
  const uniqueTreeIds = Array.from(new Set(activeTreeNodeIds.filter(Boolean)));
  const effectiveSignals = activeCascades !== void 0 ? activeCascades : uniqueTreeIds.map((cascadeId) => ({
    cascadeId,
    isRunning: true
  }));
  const prevGlobal5hFraction = prevCache?.quota?.gemini5h?.remainingFraction ?? null;
  const currGlobal5hFraction = gemini5h?.remainingFraction ?? null;
  const cascadeBaselines = updateCascadeQuotaBaselines({
    prevBaselines: prevCache?.cascadeBaselines ?? {},
    prevGlobal5hFraction,
    currGlobal5hFraction,
    activeCascades: effectiveSignals,
    allKnownCascadeIds: uniqueTreeIds,
    nowIso: fetchedAt
  });
  let treeNetDelta5hPct = null;
  if (uniqueTreeIds.length > 0) {
    let hasAnyBaseline = false;
    let totalDelta = 0;
    for (const cid of uniqueTreeIds) {
      const entry = cascadeBaselines[cid];
      if (entry) {
        hasAnyBaseline = true;
        totalDelta += Math.max(0, entry.delta5hPct);
      }
    }
    if (hasAnyBaseline) {
      treeNetDelta5hPct = round82(totalDelta);
    }
  }
  const burnRate5hPctPerMin = computeBurnRate5hPctPerMin(burnSamples, nowMs);
  return {
    quota: {
      fetchedAt,
      buckets,
      gemini5h,
      geminiWeekly,
      thirdParty5h,
      thirdPartyWeekly,
      treeNetDelta5hPct,
      burnRate5hPctPerMin
    },
    cascadeBaselines
  };
}
function evaluateSmartGovernanceBanner(treeNodes, gemini5hRemainingPct, burnRatePctPerMin, config) {
  const heavyConcurrentCount = treeNodes.filter(
    (node) => node.phase !== "IDLE" && node.phase !== "ERROR_OR_QUOTA" && node.servedModel.tier === "apex"
  ).length;
  const alertCount = config.smartThresholds.heavyConcurrentAlertCount;
  const quotaThreshold = config.smartThresholds.heavyQuotaThresholdPct;
  const effectiveRemaining = gemini5hRemainingPct ?? 100;
  const active = heavyConcurrentCount >= alertCount && effectiveRemaining < quotaThreshold;
  if (!active) {
    return {
      active: false,
      heavyConcurrentCount,
      gemini5hRemainingPct,
      estimatedBurnPctPerMin: burnRatePctPerMin,
      message: null
    };
  }
  const burnSuffix = burnRatePctPerMin !== null && Number.isFinite(burnRatePctPerMin) && burnRatePctPerMin > 0 ? `\u9884\u8BA1\u6BCF\u5206\u949F\u6D88\u8017 ~${burnRatePctPerMin.toFixed(1)}% 5h \u914D\u989D` : "\u5EFA\u8BAE\u5C06\u63A2\u7D22\u7C7B\u5B50\u4EE3\u7406\u5207\u6362\u4E3A Argon / Flash";
  return {
    active: true,
    heavyConcurrentCount,
    gemini5hRemainingPct,
    estimatedBurnPctPerMin: burnRatePctPerMin,
    message: `\u{1F4A1} \u5F53\u524D\u6709 ${heavyConcurrentCount} \u4E2A\u8282\u70B9\u5E76\u53D1\u8FD0\u884C\u4E8E Apex \u65D7\u8230\u6A21\u578B\uFF085h \u4F59\u91CF ${effectiveRemaining.toFixed(1)}%\uFF09\uFF0C${burnSuffix}`
  };
}

// src/core/timeline-builder.ts
function parseTimestamp(raw) {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) {
      return { ms: null, iso: null };
    }
    const ms = raw < 1e11 ? raw * 1e3 : raw;
    return { ms, iso: new Date(ms).toISOString() };
  }
  if (typeof raw !== "string") {
    return { ms: null, iso: null };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ms: null, iso: null };
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      const ms = num < 1e11 ? num * 1e3 : num;
      return { ms, iso: new Date(ms).toISOString() };
    }
    return { ms: null, iso: null };
  }
  const parsedMs = Date.parse(trimmed);
  if (!Number.isFinite(parsedMs)) {
    return { ms: null, iso: null };
  }
  return { ms: parsedMs, iso: trimmed };
}
function parseValidMs3(iso) {
  if (!iso || typeof iso !== "string") {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function compareStringAsc2(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareSortableTurnsAsc(a, b) {
  if (a.sortTimeMs !== b.sortTimeMs) {
    return a.sortTimeMs - b.sortTimeMs;
  }
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }
  if (a.spawnStepIndex !== b.spawnStepIndex) {
    return a.spawnStepIndex - b.spawnStepIndex;
  }
  const roleCmp = compareStringAsc2(a.roleKey, b.roleKey);
  if (roleCmp !== 0) {
    return roleCmp;
  }
  const cidCmp = compareStringAsc2(a.cascadeId, b.cascadeId);
  if (cidCmp !== 0) {
    return cidCmp;
  }
  if (a.firstStepIndex !== b.firstStepIndex) {
    return a.firstStepIndex - b.firstStepIndex;
  }
  if (a.minStepIndex !== b.minStepIndex) {
    return a.minStepIndex - b.minStepIndex;
  }
  return a.entryIndex - b.entryIndex;
}
function buildTimelineTurns(input) {
  const activeCid = input.activeConversationId?.trim() ?? "";
  if (!activeCid) {
    return {
      rootCascadeId: null,
      scope: input.scope,
      turns: []
    };
  }
  const activeNode = input.nodesByCascadeId[activeCid];
  const rootCascadeId = activeNode?.rootCascadeId ?? activeCid;
  let candidateIds;
  if (input.scope === "conversation") {
    candidateIds = [activeCid];
  } else {
    const treeIds = Object.values(input.nodesByCascadeId).filter((node) => node.rootCascadeId === rootCascadeId).map((node) => node.cascadeId);
    if (!treeIds.includes(activeCid)) {
      treeIds.push(activeCid);
    }
    candidateIds = Array.from(new Set(treeIds));
  }
  const records = [];
  for (const cascadeId of candidateIds) {
    const entries = input.generatorMetadataByCascade[cascadeId];
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }
    const node = input.nodesByCascadeId[cascadeId];
    const cascadeTitle = node?.title || `Cascade ${cascadeId.slice(0, 8)}`;
    const role = node?.role ?? null;
    const nodeModifiedMs = parseValidMs3(node?.lastModifiedTime) ?? 0;
    const depth = node?.depth ?? 0;
    const spawnStepIndex = node?.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
    const roleKey = (role || cascadeTitle || cascadeId).toLowerCase();
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const chatModel = entry?.chatModel;
      if (!chatModel) {
        continue;
      }
      const stepIndices = Array.isArray(entry.stepIndices) ? entry.stepIndices.filter((idx) => typeof idx === "number" && Number.isFinite(idx)).map((idx) => Math.trunc(idx)) : [];
      const firstStepIndex = stepIndices.length > 0 ? stepIndices[0] : Number.MAX_SAFE_INTEGER;
      const minStepIndex = stepIndices.length > 0 ? Math.min(...stepIndices) : Number.MAX_SAFE_INTEGER;
      const rawTs = chatModel.chatStartMetadata?.createdAt ?? chatModel.createdAt ?? chatModel.timestamp ?? null;
      const parsedTs = parseTimestamp(rawTs);
      const sortTimeMs = parsedTs.ms ?? nodeModifiedMs;
      const reqRaw = chatModel.customMetadata?.model_enum?.trim() || (node?.requestedModel?.raw && node.requestedModel.raw !== "unknown" ? node.requestedModel.raw : null);
      const routing = reconcileRequestedVsServed({
        catalog: input.modelCatalog,
        requestedModelRaw: reqRaw,
        requestedSource: node?.requestedModel?.source,
        latestGenMeta: entry
      });
      const requestedLabel = routing.requestedModel.raw !== "unknown" ? routing.requestedModel.displayName : node?.requestedModel?.displayName && node.requestedModel.displayName !== "Unknown" ? node.requestedModel.displayName : routing.requestedModel.displayName;
      const ttftMs = parseDurationMs(chatModel.timeToFirstToken);
      const streamingMs = parseDurationMs(chatModel.streamingDuration);
      const totalMs = ttftMs + streamingMs;
      const usage = chatModel.usage;
      const inputTokens = toIntToken(usage?.inputTokens);
      const cacheReadTokens = toIntToken(usage?.cacheReadTokens);
      const cacheHitPct = computeCacheHitPct(inputTokens, cacheReadTokens);
      const outputTokens = toIntToken(usage?.outputTokens);
      const thinkingOutputTokens = toIntToken(usage?.thinkingOutputTokens);
      const responseOutputTokens = toIntToken(usage?.responseOutputTokens) || Math.max(0, outputTokens - thinkingOutputTokens);
      const thinkingRatioPct = outputTokens > 0 ? Math.min(100, thinkingOutputTokens / outputTokens * 100) : 0;
      const ctxMeta = chatModel.chatStartMetadata?.contextWindowMetadata;
      const contextUsedTokens = toIntToken(ctxMeta?.estimatedTokensUsed);
      const contextMaxTokens = toIntToken(ctxMeta?.maxContextTokens);
      const contextPct = contextMaxTokens > 0 ? Math.min(100, Math.max(0, contextUsedTokens / contextMaxTokens * 100)) : 0;
      const deltaKey = stepIndices.length > 0 ? `${cascadeId}:${minStepIndex}` : `${cascadeId}:${entryIndex}`;
      const rawTurnDelta = input.turnDeltaQuotaByKey?.[deltaKey];
      const deltaQuota5hPct = typeof rawTurnDelta === "number" && Number.isFinite(rawTurnDelta) && rawTurnDelta >= 0 ? rawTurnDelta : null;
      const apiProvider = typeof usage?.apiProvider === "string" && usage.apiProvider.trim() ? usage.apiProvider.trim() : null;
      records.push({
        cascadeId,
        sortTimeMs,
        depth,
        spawnStepIndex,
        roleKey,
        firstStepIndex,
        minStepIndex,
        entryIndex,
        turn: {
          cascadeId,
          cascadeTitle,
          role,
          stepIndices,
          timestamp: parsedTs.iso,
          requestedLabel,
          servedModelDisplayName: routing.servedModel.displayName,
          responseModel: routing.servedModel.responseModel,
          tier: routing.servedModel.tier,
          ttftMs,
          streamingMs,
          totalMs,
          inputTokens,
          cacheReadTokens,
          cacheHitPct,
          outputTokens,
          thinkingOutputTokens,
          responseOutputTokens,
          thinkingRatioPct,
          retryCount: routing.retryCount,
          contextUsedTokens,
          contextMaxTokens,
          contextPct,
          deltaQuota5hPct,
          apiProvider
        }
      });
    }
  }
  if (records.length === 0) {
    return {
      rootCascadeId,
      scope: input.scope,
      turns: []
    };
  }
  records.sort(compareSortableTurnsAsc);
  const prevServedKeyByCascade = /* @__PURE__ */ new Map();
  const chronologicalTurns = records.map((rec, idx) => {
    const servedKey = (rec.turn.responseModel || rec.turn.servedModelDisplayName || "").trim().toLowerCase();
    const hadPrev = prevServedKeyByCascade.has(rec.cascadeId);
    const prevKey = prevServedKeyByCascade.get(rec.cascadeId);
    const routingChangedFromPrevTurn = hadPrev && prevKey !== servedKey;
    prevServedKeyByCascade.set(rec.cascadeId, servedKey);
    return {
      turnIndex: idx + 1,
      ...rec.turn,
      routingChangedFromPrevTurn
    };
  });
  return {
    rootCascadeId,
    scope: input.scope,
    turns: chronologicalTurns.reverse()
  };
}

// src/rpc/ls-client.ts
var READONLY_LS_METHODS = /* @__PURE__ */ new Set([
  "GetCascadeModelConfigData",
  "RetrieveUserQuotaSummary",
  "GetAllCascadeTrajectories",
  "GetCascadeTrajectoryGeneratorMetadata",
  "GetCascadeTrajectorySteps"
]);
var FORBIDDEN_LS_METHODS = /* @__PURE__ */ new Set([
  "DeleteCascadeTrajectory",
  "UpdateConversationAnnotations",
  "JetboxWriteState",
  "DeletePlugin",
  "InstallCustomization",
  "GetCascadeTrajectory"
]);
var ReadonlyRpcViolationError = class extends Error {
  method;
  constructor(method, reason) {
    super(
      reason ?? `Blocked non-readonly or unapproved LanguageServerService RPC method: "${method}"`
    );
    this.name = "ReadonlyRpcViolationError";
    this.method = method;
  }
};
var LsConnectionError = class extends Error {
  statusCode;
  code;
  constructor(message, details) {
    super(message);
    this.name = "LsConnectionError";
    this.statusCode = details?.statusCode;
    this.code = details?.code;
    if (details?.cause !== void 0) {
      this.cause = details.cause;
    }
  }
};
function normalizeLsBaseUrl(rawAddress) {
  const trimmed = (rawAddress ?? "").trim();
  if (!trimmed) {
    return "";
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}
var ReadOnlyLsClient = class {
  baseUrl;
  csrfToken;
  timeoutMs;
  fetchFn;
  constructor(options = {}) {
    const rawAddress = options.address ?? process.env.ANTIGRAVITY_LS_ADDRESS;
    const rawCsrf = options.csrfToken ?? process.env.ANTIGRAVITY_CSRF_TOKEN;
    this.baseUrl = normalizeLsBaseUrl(rawAddress);
    this.csrfToken = (rawCsrf ?? "").trim();
    this.timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.trunc(options.timeoutMs) : 2500;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
  }
  isConfigured() {
    return this.baseUrl.length > 0 && this.csrfToken.length > 0;
  }
  /**
   * Synchronously enforces the read-only method allowlist before constructing any URL or invoking fetch.
   */
  callReadonlyMethod(method, body = {}) {
    if (FORBIDDEN_LS_METHODS.has(method) || !READONLY_LS_METHODS.has(method)) {
      throw new ReadonlyRpcViolationError(method);
    }
    return this.dispatchReadonlyRpc(method, body);
  }
  async dispatchReadonlyRpc(method, body) {
    if (!this.isConfigured()) {
      throw new LsConnectionError("LS_NOT_CONFIGURED", { code: "LS_NOT_CONFIGURED" });
    }
    if (typeof this.fetchFn !== "function") {
      throw new LsConnectionError("FETCH_UNAVAILABLE", { code: "FETCH_UNAVAILABLE" });
    }
    const url = `${this.baseUrl}/exa.language_server_pb.LanguageServerService/${method}`;
    let response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-codeium-csrf-token": this.csrfToken
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (err) {
      throw new LsConnectionError(
        `LS RPC ${method} transport error: ${err instanceof Error ? err.message : String(err)}`,
        { code: "LS_TRANSPORT_ERROR", cause: err }
      );
    }
    if (!response.ok) {
      let snippet = "";
      try {
        snippet = (await response.text()).slice(0, 200);
      } catch {
      }
      throw new LsConnectionError(
        `LS RPC ${method} failed with HTTP ${response.status}${snippet ? `: ${snippet}` : ""}`,
        { statusCode: response.status, code: "LS_HTTP_ERROR" }
      );
    }
    try {
      return await response.json();
    } catch (err) {
      throw new LsConnectionError(`LS RPC ${method} returned invalid JSON`, {
        code: "LS_INVALID_JSON",
        cause: err
      });
    }
  }
  getCascadeModelConfigData() {
    return this.callReadonlyMethod(
      "GetCascadeModelConfigData",
      {}
    );
  }
  retrieveUserQuotaSummary() {
    return this.callReadonlyMethod(
      "RetrieveUserQuotaSummary",
      {}
    );
  }
  getAllCascadeTrajectories() {
    return this.callReadonlyMethod(
      "GetAllCascadeTrajectories",
      {}
    );
  }
  getCascadeTrajectoryGeneratorMetadata(cascadeId) {
    const req = { cascadeId };
    return this.callReadonlyMethod(
      "GetCascadeTrajectoryGeneratorMetadata",
      req
    );
  }
  /**
   * L-004: Always requests tail steps via stepOffset + disableRehydration: true (never startIndex/endIndex).
   */
  getCascadeTrajectorySteps(cascadeId, stepCount) {
    const safeStepCount = typeof stepCount === "number" && Number.isFinite(stepCount) && stepCount > 0 ? Math.trunc(stepCount) : 0;
    const req = {
      cascadeId,
      stepOffset: Math.max(0, safeStepCount - 4),
      disableRehydration: true
    };
    return this.callReadonlyMethod(
      "GetCascadeTrajectorySteps",
      req
    );
  }
};

// src/sidecar/telemetry-engine.ts
var RECENT_REQUEST_TTL_MS = 6e4;
var RECENT_HOOK_ACTIVITY_WINDOW_MS = 5e3;
var HOOK_EVENT_RETENTION_MS = 12e4;
var BURN_SAMPLE_RETENTION_MS = 10 * 60 * 1e3;
var MAX_HOOKS_PER_CASCADE = 32;
var FS_WATCH_DEBOUNCE_MS = 50;
var MAX_CONCURRENT_META_RPCS = 6;
async function runWithConcurrency(items, concurrency, worker) {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}
function stripVolatileFleetFields(fleet) {
  const { fetchedAt: _ignoredFetchedAt, ...stableQuota } = fleet.quota;
  return {
    hostConnected: fleet.hostConnected,
    activeHeadline: fleet.activeHeadline,
    projects: fleet.projects.map((project) => ({
      ...project,
      trees: project.trees.map((tree) => {
        const { elapsedMs: _ignoredElapsed, nodes, ...restTree } = tree;
        return {
          ...restTree,
          nodes: nodes.map((node) => {
            const { phaseElapsedMs: _ignoredNodeElapsed, ...restNode } = node;
            return restNode;
          })
        };
      })
    })),
    topQuotaBurners: fleet.topQuotaBurners,
    quota: stableQuota
  };
}
function createEmptyQuotaSummary(fetchedAt = (/* @__PURE__ */ new Date(0)).toISOString()) {
  return {
    fetchedAt,
    buckets: [],
    gemini5h: null,
    geminiWeekly: null,
    thirdParty5h: null,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: null,
    burnRate5hPctPerMin: null
  };
}
function sumGeneratorTokens(entries) {
  if (!entries || entries.length === 0) {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const usage = entry.chatModel?.usage;
    if (!usage) continue;
    total += toIntToken(usage.inputTokens) + toIntToken(usage.outputTokens);
  }
  return total;
}
var TelemetryEngine = class {
  lsClient;
  statePaths;
  antigravityDataDir;
  onWarning;
  enableSqliteFallback;
  initialConfigPatch;
  config;
  started = false;
  stopped = false;
  pollTimer = null;
  debounceTimer = null;
  watcher = null;
  inFlightRefresh = null;
  pendingRefresh = false;
  ringByteOffset = 0;
  hooksByCascade = /* @__PURE__ */ new Map();
  lastHookEventTsMs = 0;
  latestHookCid = null;
  hostConnected = false;
  warnings = [];
  modelCatalog = buildModelCatalog(null);
  lastModelConfigAtMs = 0;
  trajectories = {};
  prevStatuses = {};
  cachedGenMetaStepCount = {};
  generatorMetadataByCascade = {};
  stepsByCascade = {};
  prevTokensByCascade = {};
  quotaCache;
  lastQuotaAtMs = 0;
  lastQuotaRaw = null;
  burnSamples = [];
  topology = {
    nodesByCascadeId: {},
    rootByCascadeId: {},
    treesByRootId: {},
    warnings: []
  };
  lastRequestedCid = null;
  lastRequestedCidAtMs = 0;
  activeConversationId = null;
  lastPersistedModelKey = "";
  lastConfigSignature = "";
  turnDeltaQuotaByKey = {};
  constructor(options = {}) {
    this.lsClient = options.lsClient ?? new ReadOnlyLsClient();
    this.statePaths = options.statePaths ?? getStatePaths(options.stateDir);
    this.antigravityDataDir = options.antigravityDataDir?.trim() || process.env.ANTIGRAVITY_APP_DATA_DIR?.trim() || process.env.ANTIGRAVITY_DATA_DIR?.trim() || path3.join(os2.homedir(), ".gemini", "antigravity");
    this.onWarning = options.onWarning;
    this.enableSqliteFallback = Boolean(options.enableSqliteFallback);
    this.initialConfigPatch = options.initialConfig;
    this.config = loadConfig(this.statePaths.stateDir);
    this.recordCurrentConfigSignature();
    this.quotaCache = {
      schemaVersion: 1,
      updatedAt: (/* @__PURE__ */ new Date(0)).toISOString(),
      quota: createEmptyQuotaSummary(),
      cascadeBaselines: {}
    };
  }
  recordCurrentConfigSignature() {
    try {
      if (!existsSync3(this.statePaths.configPath)) {
        this.lastConfigSignature = "";
        return;
      }
      const st = statSync2(this.statePaths.configPath);
      this.lastConfigSignature = `${st.mtimeMs}:${st.size}`;
    } catch {
    }
  }
  syncConfigIfModified() {
    try {
      if (!existsSync3(this.statePaths.configPath)) {
        return;
      }
      const st = statSync2(this.statePaths.configPath);
      const sig = `${st.mtimeMs}:${st.size}`;
      if (sig !== this.lastConfigSignature) {
        this.lastConfigSignature = sig;
        this.config = loadConfig(this.statePaths.stateDir);
      }
    } catch {
    }
  }
  async start() {
    if (this.started) {
      return;
    }
    this.stopped = false;
    this.started = true;
    ensureStateDir(this.statePaths.stateDir);
    if (this.initialConfigPatch) {
      this.config = updateConfigPartial(this.initialConfigPatch, this.statePaths.stateDir);
    } else {
      this.config = loadConfig(this.statePaths.stateDir);
    }
    this.recordCurrentConfigSignature();
    this.hydratePersistedCaches();
    await this.refreshOnce();
    this.startWatcher();
    this.scheduleNextPoll();
  }
  stop() {
    this.stopped = true;
    this.started = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
      }
      this.watcher = null;
    }
  }
  hydratePersistedCaches() {
    const savedModels = readJsonSafe(this.statePaths.modelMap, null);
    if (savedModels && savedModels.schemaVersion === 1 && savedModels.modelsByEnum) {
      const modelsById = {};
      for (const entry of Object.values(savedModels.modelsByEnum)) {
        if (entry?.modelId) {
          modelsById[entry.modelId] = entry;
        }
      }
      this.modelCatalog = {
        defaultModelEnum: savedModels.defaultModelEnum ?? null,
        modelsByEnum: savedModels.modelsByEnum,
        modelsById
      };
      this.lastPersistedModelKey = JSON.stringify({
        defaultModelEnum: this.modelCatalog.defaultModelEnum,
        modelsByEnum: this.modelCatalog.modelsByEnum
      });
    }
    const savedQuota = readJsonSafe(this.statePaths.quotaCache, null);
    if (savedQuota && savedQuota.schemaVersion === 1 && savedQuota.quota) {
      this.quotaCache = {
        schemaVersion: 1,
        updatedAt: savedQuota.updatedAt ?? (/* @__PURE__ */ new Date(0)).toISOString(),
        quota: savedQuota.quota,
        cascadeBaselines: savedQuota.cascadeBaselines ?? {}
      };
    }
  }
  emitWarning(message) {
    if (!this.warnings.includes(message)) {
      this.warnings.push(message);
    }
    this.onWarning?.(message);
  }
  startWatcher() {
    if (this.stopped || this.watcher) {
      return;
    }
    try {
      this.watcher = watch(this.statePaths.stateDir, (_eventType, filename) => {
        const name = filename ? String(filename) : "";
        if (name && name !== "events.ring.jsonl" && name !== "config.json") {
          return;
        }
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          if (name === "config.json") {
            this.config = loadConfig(this.statePaths.stateDir);
            this.recordCurrentConfigSignature();
          }
          void this.refreshOnce().catch((err) => {
            this.emitWarning(`State watcher refresh error: ${err instanceof Error ? err.message : String(err)}`);
          });
        }, FS_WATCH_DEBOUNCE_MS);
      });
    } catch (err) {
      this.emitWarning(
        `fs.watch unavailable (${err instanceof Error ? err.message : String(err)}); falling back to polling`
      );
    }
  }
  scheduleNextPoll() {
    if (this.stopped || !this.started) {
      return;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
    const hasRunning = Object.values(this.trajectories).some(
      (s) => s.status === "CASCADE_RUN_STATUS_RUNNING"
    );
    const hasRecentHook = Date.now() - this.lastHookEventTsMs < RECENT_HOOK_ACTIVITY_WINDOW_MS;
    const intervalMs = hasRunning || hasRecentHook ? this.config.pollIntervalsMs.active : this.config.pollIntervalsMs.idle;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.refreshOnce().catch((err) => {
        this.emitWarning(`Poll refresh error: ${err instanceof Error ? err.message : String(err)}`);
      }).finally(() => {
        this.scheduleNextPoll();
      });
    }, intervalMs);
  }
  async refreshOnce(nowMs = Date.now()) {
    if (this.inFlightRefresh) {
      this.pendingRefresh = true;
      await this.inFlightRefresh;
      return;
    }
    const run = async () => {
      try {
        await this.executeRefreshCycle(nowMs);
      } finally {
        this.inFlightRefresh = null;
      }
      if (this.pendingRefresh && !this.stopped) {
        this.pendingRefresh = false;
        await this.refreshOnce(Date.now());
      }
    };
    this.inFlightRefresh = run();
    await this.inFlightRefresh;
  }
  tailEventsRing(nowMs) {
    const ringPath = this.statePaths.eventsRing;
    if (!existsSync3(ringPath)) {
      this.ringByteOffset = 0;
      return;
    }
    let size = 0;
    try {
      size = statSync2(ringPath).size;
    } catch {
      return;
    }
    if (size < this.ringByteOffset) {
      this.ringByteOffset = 0;
    }
    if (size > this.ringByteOffset) {
      const bytesToRead = size - this.ringByteOffset;
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const fd = openSync(ringPath, "r");
      let bytesRead = 0;
      try {
        bytesRead = readSync(fd, buffer, 0, bytesToRead, this.ringByteOffset);
      } finally {
        closeSync(fd);
      }
      if (bytesRead > 0) {
        const slice = buffer.subarray(0, bytesRead);
        const lastNewlineIdx = slice.lastIndexOf(10);
        if (lastNewlineIdx !== -1) {
          const completeChunk = slice.subarray(0, lastNewlineIdx + 1).toString("utf8");
          this.ringByteOffset += lastNewlineIdx + 1;
          for (const rawLine of completeChunk.split("\n")) {
            const trimmed = rawLine.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed);
              if (event && typeof event.event === "string" && typeof event.conversationId === "string") {
                this.recordHookEvent(event);
              }
            } catch {
            }
          }
        }
      }
    }
    const rotation = rotateRingIfNeeded(this.statePaths.stateDir, RING_MAX_BYTES);
    if (rotation.rotated) {
      this.ringByteOffset = 0;
    }
    const cutoff = nowMs - HOOK_EVENT_RETENTION_MS;
    for (const [cid, list] of this.hooksByCascade.entries()) {
      const kept = list.filter((ev) => ev.ts >= cutoff).slice(-MAX_HOOKS_PER_CASCADE);
      if (kept.length === 0) {
        this.hooksByCascade.delete(cid);
      } else {
        this.hooksByCascade.set(cid, kept);
      }
    }
  }
  recordHookEvent(event) {
    const cid = event.conversationId;
    if (event.ts > this.lastHookEventTsMs) {
      this.lastHookEventTsMs = event.ts;
      if (isValidUuid(cid)) {
        this.latestHookCid = cid;
      }
    }
    const existing = this.hooksByCascade.get(cid) ?? [];
    existing.push(event);
    if (existing.length > MAX_HOOKS_PER_CASCADE) {
      existing.splice(0, existing.length - MAX_HOOKS_PER_CASCADE);
    }
    this.hooksByCascade.set(cid, existing);
  }
  collectRecentHookEvents() {
    const all = [];
    for (const list of this.hooksByCascade.values()) {
      all.push(...list);
    }
    all.sort((a, b) => a.ts - b.ts);
    return all;
  }
  async refreshModelCatalog(nowMs) {
    const raw = await this.lsClient.getCascadeModelConfigData();
    this.modelCatalog = buildModelCatalog(raw);
    this.lastModelConfigAtMs = nowMs;
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date(nowMs).toISOString(),
      defaultModelEnum: this.modelCatalog.defaultModelEnum,
      modelsByEnum: this.modelCatalog.modelsByEnum
    };
    const serializedKey = JSON.stringify({
      defaultModelEnum: payload.defaultModelEnum,
      modelsByEnum: payload.modelsByEnum
    });
    if (serializedKey !== this.lastPersistedModelKey) {
      this.lastPersistedModelKey = serializedKey;
      writeJsonAtomic(this.statePaths.modelMap, payload);
    }
  }
  hasUnseenModelEnum(entries) {
    for (const entry of entries) {
      const chat = entry.chatModel;
      if (!chat) continue;
      for (const candidate of [chat.customMetadata?.model_enum, chat.model]) {
        const trimmed = candidate?.trim();
        if (trimmed && !this.modelCatalog.modelsByEnum[trimmed] && !this.modelCatalog.modelsById[trimmed]) {
          return true;
        }
      }
    }
    return false;
  }
  async executeRefreshCycle(nowMs) {
    this.warnings = [];
    this.tailEventsRing(nowMs);
    this.syncConfigIfModified();
    let anyStepIncremented = false;
    let anyRunningToIdle = false;
    const stepIncrementedCids = /* @__PURE__ */ new Set();
    const runningToIdleCids = /* @__PURE__ */ new Set();
    let modelConfigRefreshedThisCycle = false;
    let shouldRefreshQuotaNow = this.lastQuotaRaw === null || nowMs - this.lastQuotaAtMs >= this.config.pollIntervalsMs.quota;
    if (!this.lsClient.isConfigured()) {
      this.hostConnected = false;
      this.emitWarning("Language Server not configured (ANTIGRAVITY_LS_ADDRESS / ANTIGRAVITY_CSRF_TOKEN missing)");
    } else {
      try {
        if (this.lastModelConfigAtMs === 0 || nowMs - this.lastModelConfigAtMs >= this.config.pollIntervalsMs.modelConfig) {
          await this.refreshModelCatalog(nowMs);
          modelConfigRefreshedThisCycle = true;
        }
        const trajResp = await this.lsClient.getAllCascadeTrajectories();
        const summaries = trajResp.trajectorySummaries ?? {};
        this.trajectories = summaries;
        this.hostConnected = true;
        const cidsToFetchMeta = [];
        const cidsToFetchSteps = [];
        for (const [cid, summary] of Object.entries(summaries)) {
          const stepCount = typeof summary.stepCount === "number" && Number.isFinite(summary.stepCount) ? summary.stepCount : 0;
          const prevStepCount = this.cachedGenMetaStepCount[cid];
          const prevStatus = this.prevStatuses[cid];
          const isRunning = summary.status === "CASCADE_RUN_STATUS_RUNNING";
          if (prevStepCount !== void 0 && stepCount > prevStepCount) {
            anyStepIncremented = true;
            stepIncrementedCids.add(cid);
          }
          if (prevStatus === "CASCADE_RUN_STATUS_RUNNING" && !isRunning) {
            anyRunningToIdle = true;
            runningToIdleCids.add(cid);
          }
          this.prevStatuses[cid] = summary.status;
          if (!this.generatorMetadataByCascade[cid] || prevStepCount === void 0 || stepCount > prevStepCount) {
            cidsToFetchMeta.push(cid);
          }
          if (isRunning) {
            cidsToFetchSteps.push({ cid, stepCount });
          } else {
            delete this.stepsByCascade[cid];
          }
        }
        for (const cachedCid of Object.keys(this.stepsByCascade)) {
          if (!summaries[cachedCid]) {
            delete this.stepsByCascade[cachedCid];
          }
        }
        cidsToFetchMeta.sort((a, b) => {
          const aRun = summaries[a]?.status === "CASCADE_RUN_STATUS_RUNNING" ? 1 : 0;
          const bRun = summaries[b]?.status === "CASCADE_RUN_STATUS_RUNNING" ? 1 : 0;
          if (bRun !== aRun) return bRun - aRun;
          const aMod = Date.parse(summaries[a]?.lastModifiedTime ?? "") || 0;
          const bMod = Date.parse(summaries[b]?.lastModifiedTime ?? "") || 0;
          return bMod - aMod;
        });
        let spottedUnseenModel = false;
        await runWithConcurrency(cidsToFetchMeta, MAX_CONCURRENT_META_RPCS, async (cid) => {
          try {
            const metaResp = await this.lsClient.getCascadeTrajectoryGeneratorMetadata(cid);
            const entries = metaResp.generatorMetadata ?? [];
            this.generatorMetadataByCascade[cid] = entries;
            this.cachedGenMetaStepCount[cid] = summaries[cid]?.stepCount ?? 0;
            if (this.hasUnseenModelEnum(entries)) {
              spottedUnseenModel = true;
            }
          } catch (err) {
            this.emitWarning(
              `GeneratorMetadata RPC failed for ${cid}: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        });
        if (spottedUnseenModel && !modelConfigRefreshedThisCycle) {
          try {
            await this.refreshModelCatalog(nowMs);
          } catch (err) {
            this.emitWarning(
              `ModelConfig refresh failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        await Promise.all(
          cidsToFetchSteps.map(async ({ cid, stepCount }) => {
            try {
              const stepsResp = await this.lsClient.getCascadeTrajectorySteps(cid, stepCount);
              this.stepsByCascade[cid] = stepsResp.steps ?? [];
            } catch (err) {
              this.emitWarning(
                `TrajectorySteps RPC failed for ${cid}: ${err instanceof Error ? err.message : String(err)}`
              );
            }
          })
        );
        if (anyStepIncremented || anyRunningToIdle) {
          shouldRefreshQuotaNow = true;
        }
        if (shouldRefreshQuotaNow) {
          try {
            const quotaRaw = await this.lsClient.retrieveUserQuotaSummary();
            this.lastQuotaRaw = quotaRaw;
            this.lastQuotaAtMs = nowMs;
            const activeSignals = [];
            for (const [cid, summary] of Object.entries(summaries)) {
              const isRunning = summary.status === "CASCADE_RUN_STATUS_RUNNING";
              const stepInc = stepIncrementedCids.has(cid);
              const justFinished = runningToIdleCids.has(cid);
              const currentTokens = sumGeneratorTokens(this.generatorMetadataByCascade[cid]);
              const prevTokens = this.prevTokensByCascade[cid] ?? 0;
              const tokenDelta = Math.max(0, currentTokens - prevTokens);
              this.prevTokensByCascade[cid] = currentTokens;
              if (isRunning || stepInc || justFinished || tokenDelta > 0) {
                activeSignals.push({
                  cascadeId: cid,
                  isRunning: isRunning || justFinished,
                  stepCountIncremented: stepInc,
                  tokenDelta
                });
              }
            }
            const nowIso = new Date(nowMs).toISOString();
            const preliminaryNormalized = normalizeQuotaSummary(
              quotaRaw,
              this.quotaCache,
              Object.keys(summaries),
              nowIso,
              this.burnSamples,
              activeSignals
            );
            const g5Fraction = preliminaryNormalized.quota.gemini5h?.remainingFraction;
            if (typeof g5Fraction === "number" && Number.isFinite(g5Fraction)) {
              this.burnSamples.push({ tsMs: nowMs, remainingFraction: g5Fraction });
              const burnCutoff = nowMs - BURN_SAMPLE_RETENTION_MS;
              this.burnSamples = this.burnSamples.filter((s) => s.tsMs >= burnCutoff);
            }
            const finalNormalized = normalizeQuotaSummary(
              quotaRaw,
              this.quotaCache,
              Object.keys(summaries),
              nowIso,
              this.burnSamples,
              activeSignals
            );
            const prevBaselines = this.quotaCache.cascadeBaselines;
            for (const [cid, nextEntry] of Object.entries(finalNormalized.cascadeBaselines)) {
              const prevDelta = prevBaselines[cid]?.delta5hPct ?? 0;
              const deltaGain = Math.round(Math.max(0, nextEntry.delta5hPct - prevDelta) * 1e8) / 1e8;
              if (deltaGain <= 0) {
                continue;
              }
              const entries = this.generatorMetadataByCascade[cid];
              if (!entries || entries.length === 0) {
                continue;
              }
              let latestTurnKey = null;
              for (let i = entries.length - 1; i >= 0; i -= 1) {
                const entry = entries[i];
                if (!entry?.chatModel) continue;
                const indices = Array.isArray(entry.stepIndices) ? entry.stepIndices.filter(
                  (n) => typeof n === "number" && Number.isFinite(n)
                ) : [];
                latestTurnKey = indices.length > 0 ? `${cid}:${Math.min(...indices)}` : `${cid}:${i}`;
                break;
              }
              if (latestTurnKey) {
                const prevTurnDelta = this.turnDeltaQuotaByKey[latestTurnKey] ?? 0;
                this.turnDeltaQuotaByKey[latestTurnKey] = Math.round((prevTurnDelta + deltaGain) * 1e8) / 1e8;
              }
            }
            this.quotaCache = {
              schemaVersion: 1,
              updatedAt: nowIso,
              quota: finalNormalized.quota,
              cascadeBaselines: finalNormalized.cascadeBaselines
            };
            writeJsonAtomic(this.statePaths.quotaCache, this.quotaCache);
          } catch (err) {
            this.emitWarning(
              `RetrieveUserQuotaSummary RPC failed: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
      } catch (err) {
        this.hostConnected = false;
        this.emitWarning(
          `Language Server unreachable: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    this.topology = buildTopologyGraph({
      antigravityDataDir: this.antigravityDataDir,
      trajectories: this.trajectories,
      generatorMetadataByCascade: this.generatorMetadataByCascade,
      stepsByCascade: this.stepsByCascade,
      recentHookEvents: this.collectRecentHookEvents(),
      modelCatalog: this.modelCatalog,
      quotaBaselines: this.quotaCache.cascadeBaselines,
      prevNodesByCascadeId: this.topology.nodesByCascadeId,
      smartThresholds: this.config.smartThresholds,
      lsConnected: this.hostConnected,
      nowMs,
      enableSqliteFallback: this.enableSqliteFallback
    });
    for (const topoWarn of this.topology.warnings) {
      this.emitWarning(topoWarn);
    }
    this.activeConversationId = this.resolveActiveConversationId(null, nowMs);
    this.persistLiveSnapshot(nowMs);
  }
  resolveActiveConversationId(requestedCid, nowMs) {
    const nodes = this.topology.nodesByCascadeId;
    if (requestedCid && isValidUuid(requestedCid)) {
      if (nodes[requestedCid] || this.trajectories[requestedCid] || this.generatorMetadataByCascade[requestedCid]) {
        return requestedCid;
      }
    }
    if (this.lastRequestedCid && nowMs - this.lastRequestedCidAtMs <= RECENT_REQUEST_TTL_MS && (nodes[this.lastRequestedCid] || this.trajectories[this.lastRequestedCid] || this.generatorMetadataByCascade[this.lastRequestedCid])) {
      return this.lastRequestedCid;
    }
    if (this.latestHookCid && (nodes[this.latestHookCid] || this.trajectories[this.latestHookCid] || this.generatorMetadataByCascade[this.latestHookCid])) {
      return this.latestHookCid;
    }
    const allNodes = Object.values(nodes);
    const runningRoot = allNodes.filter((n) => n.parentCascadeId === null && n.status === "CASCADE_RUN_STATUS_RUNNING").sort((a, b) => Date.parse(b.lastModifiedTime) - Date.parse(a.lastModifiedTime))[0];
    if (runningRoot) {
      return runningRoot.cascadeId;
    }
    const latestRoot = allNodes.filter((n) => n.parentCascadeId === null).sort((a, b) => Date.parse(b.lastModifiedTime) - Date.parse(a.lastModifiedTime))[0];
    if (latestRoot) {
      return latestRoot.cascadeId;
    }
    return allNodes[0]?.cascadeId ?? null;
  }
  buildQuotaViewForTree(treeNodeIds) {
    const uniqueIds = Array.from(new Set(treeNodeIds.filter(Boolean)));
    let treeNetDelta5hPct = null;
    if (uniqueIds.length > 0) {
      let hasBaseline = false;
      let sum = 0;
      for (const cid of uniqueIds) {
        const b = this.quotaCache.cascadeBaselines[cid];
        if (b) {
          hasBaseline = true;
          sum += Math.max(0, b.delta5hPct);
        }
      }
      if (hasBaseline) {
        treeNetDelta5hPct = Math.round(sum * 1e8) / 1e8;
      }
    }
    return {
      ...this.quotaCache.quota,
      treeNetDelta5hPct
    };
  }
  buildCurrentFleetSnapshot(nowMs) {
    const fleetCore = buildFleetSnapshot({
      nowMs,
      hostConnected: this.hostConnected,
      trajectories: this.trajectories,
      nodesByCascadeId: this.topology.nodesByCascadeId,
      quota: this.quotaCache.quota,
      cascadeBaselines: this.quotaCache.cascadeBaselines
    });
    const etag = computeDeterministicEtag(stripVolatileFleetFields(fleetCore));
    return {
      etag,
      ...fleetCore
    };
  }
  persistLiveSnapshot(nowMs) {
    const nowIso = new Date(nowMs).toISOString();
    const activeCid = this.activeConversationId;
    const rootId = activeCid ? this.topology.rootByCascadeId[activeCid] ?? activeCid : null;
    const treeNodes = rootId ? this.topology.treesByRootId[rootId] ?? [] : [];
    const quotaView = this.buildQuotaViewForTree(treeNodes.map((n) => n.cascadeId));
    const filePayload = {
      schemaVersion: 1,
      updatedAt: nowIso,
      hostConnected: this.hostConnected,
      activeConversationId: activeCid,
      nodesByCascadeId: this.topology.nodesByCascadeId,
      fleet: this.buildCurrentFleetSnapshot(nowMs),
      quota: quotaView
    };
    writeJsonAtomic(this.statePaths.liveSnapshot, filePayload);
  }
  getConfig() {
    this.syncConfigIfModified();
    return this.config;
  }
  updateConfig(patch) {
    this.config = updateConfigPartial(patch, this.statePaths.stateDir);
    this.recordCurrentConfigSignature();
    const nowMs = Date.now();
    this.topology = buildTopologyGraph({
      antigravityDataDir: this.antigravityDataDir,
      trajectories: this.trajectories,
      generatorMetadataByCascade: this.generatorMetadataByCascade,
      stepsByCascade: this.stepsByCascade,
      recentHookEvents: this.collectRecentHookEvents(),
      modelCatalog: this.modelCatalog,
      quotaBaselines: this.quotaCache.cascadeBaselines,
      prevNodesByCascadeId: this.topology.nodesByCascadeId,
      smartThresholds: this.config.smartThresholds,
      lsConnected: this.hostConnected,
      nowMs,
      enableSqliteFallback: this.enableSqliteFallback
    });
    this.persistLiveSnapshot(nowMs);
    return this.config;
  }
  getHudSnapshot(conversationId, clientEtag) {
    const nowMs = Date.now();
    if (conversationId && isValidUuid(conversationId)) {
      this.lastRequestedCid = conversationId;
      this.lastRequestedCidAtMs = nowMs;
    }
    const effectiveCid = this.resolveActiveConversationId(conversationId, nowMs);
    const activeNode = effectiveCid ? this.topology.nodesByCascadeId[effectiveCid] ?? null : null;
    const rootCascadeId = effectiveCid ? this.topology.rootByCascadeId[effectiveCid] ?? effectiveCid : null;
    const treeNodes = rootCascadeId ? this.topology.treesByRootId[rootCascadeId] ?? (activeNode ? [activeNode] : []) : [];
    const breadcrumb = buildBreadcrumb(
      rootCascadeId,
      effectiveCid,
      this.topology.nodesByCascadeId
    );
    const quota = this.buildQuotaViewForTree(treeNodes.map((n) => n.cascadeId));
    const smartGovernanceBanner = evaluateSmartGovernanceBanner(
      treeNodes,
      quota.gemini5h?.remainingPct ?? null,
      quota.burnRate5hPctPerMin,
      this.config
    );
    const semanticInput = {
      hostConnected: this.hostConnected,
      activeConversationId: effectiveCid,
      rootCascadeId,
      breadcrumb,
      activeNode,
      treeNodes,
      smartGovernanceBanner,
      quota,
      config: this.config,
      warnings: [...this.warnings]
    };
    const etag = computeHudSemanticEtag(semanticInput);
    if (isEtagMatch(clientEtag, etag)) {
      return makeUnchangedResponse(etag);
    }
    return {
      etag,
      generatedAt: new Date(nowMs).toISOString(),
      ...semanticInput
    };
  }
  getTimelineSnapshot(conversationId, scope, clientEtag) {
    this.syncConfigIfModified();
    const nowMs = Date.now();
    const resolvedScope = scope ?? this.config.timelineScope;
    const effectiveCid = this.resolveActiveConversationId(conversationId ?? null, nowMs);
    const result = buildTimelineTurns({
      activeConversationId: effectiveCid ?? "",
      scope: resolvedScope,
      nodesByCascadeId: this.topology.nodesByCascadeId,
      generatorMetadataByCascade: this.generatorMetadataByCascade,
      modelCatalog: this.modelCatalog,
      turnDeltaQuotaByKey: this.turnDeltaQuotaByKey
    });
    const semanticPayload = {
      rootCascadeId: result.rootCascadeId,
      scope: result.scope,
      turns: result.turns
    };
    const etag = computeDeterministicEtag(semanticPayload);
    if (isEtagMatch(clientEtag, etag)) {
      return makeUnchangedResponse(etag);
    }
    return {
      etag,
      generatedAt: new Date(nowMs).toISOString(),
      ...semanticPayload
    };
  }
  getFleetSnapshot(clientEtag) {
    const snapshot = this.buildCurrentFleetSnapshot(Date.now());
    if (isEtagMatch(clientEtag, snapshot.etag)) {
      return makeUnchangedResponse(snapshot.etag);
    }
    return snapshot;
  }
  getHealthInfo() {
    return {
      lsConnected: this.hostConnected,
      stateDir: this.statePaths.stateDir,
      activeConversationId: this.activeConversationId
    };
  }
  // Stage 2 (S2-A) Extension Getters
  getAllGeneratorMetadataByCascade() {
    return this.generatorMetadataByCascade;
  }
  getCachedModelCatalog() {
    return this.modelCatalog;
  }
  getCachedTrajectories() {
    return this.trajectories;
  }
  getCachedQuotaState() {
    return this.quotaCache.quota;
  }
  getCascadeBaselines() {
    return this.quotaCache.cascadeBaselines;
  }
  getCascadeDelta5hPct(cid) {
    return this.quotaCache.cascadeBaselines[cid]?.delta5hPct ?? null;
  }
  getCachedNodesByCascadeId() {
    return this.topology.nodesByCascadeId;
  }
  getRootByCascadeId() {
    return this.topology.rootByCascadeId;
  }
  getAntigravityDataDir() {
    return this.antigravityDataDir;
  }
};

// src/sidecar/server.ts
var STRICT_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors *";
function resolveSidecarRoot() {
  const here = path4.dirname(fileURLToPath(import.meta.url));
  const parentDir = path4.resolve(here, "..");
  if (existsSync4(path4.join(parentDir, "index.html"))) {
    return parentDir;
  }
  return path4.resolve(here, "..", "..", "sidecars", "pulse_cockpit");
}
function make400Json(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    contentType: "application/json",
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    }
  });
}
function injectHtmlViewAttribute(html, view) {
  if (/data-view="(?:hud|fleet)"/.test(html)) {
    return html.replace(/data-view="(?:hud|fleet)"/, `data-view="${view}"`);
  }
  return html.replace(/<div\s+id="pulse-app"/, `<div id="pulse-app" data-view="${view}"`);
}
function validateAllowedConfigPostKeys(payload) {
  const keys = Object.getOwnPropertyNames(payload);
  if (keys.length === 0) {
    throw new ConfigValidationError("Empty config patch");
  }
  const allowedPostKeys = /* @__PURE__ */ new Set([
    "inlineStampMode",
    "hudSortMode",
    "timelineScope",
    "smartThresholds",
    "pollIntervalsMs"
  ]);
  for (const key of keys) {
    if (!allowedPostKeys.has(key)) {
      throw new ConfigValidationError(`Disallowed or unknown config patch field: ${key}`);
    }
  }
}
async function createPulseSidecarServer(options = {}) {
  const startedAt = Date.now();
  const sidecarRoot = resolveSidecarRoot();
  const app = new SidecarApp();
  const engine = new TelemetryEngine(options);
  const readAsset = (relPath) => {
    const fullPath = path4.join(sidecarRoot, relPath);
    if (!existsSync4(fullPath)) {
      return null;
    }
    return readFileSync3(fullPath, "utf8");
  };
  const serveHtmlPage = (view) => {
    const rawHtml = readAsset("index.html") ?? '<!doctype html><html><head><meta charset="utf-8"><title>Model Pulse</title></head><body><div id="pulse-app" class="pulse-app" data-view="hud" data-theme-mode="auto"><main id="app" class="pulse-main" aria-live="polite">Model Pulse loading...</main></div></body></html>';
    const html = injectHtmlViewAttribute(rawHtml, view);
    return new Response(html, {
      status: 200,
      contentType: "text/html; charset=utf-8",
      headers: {
        "Content-Security-Policy": STRICT_CSP,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store"
      }
    });
  };
  app.page("/", () => serveHtmlPage("hud"));
  app.page("/hud", () => serveHtmlPage("hud"));
  app.page("/fleet", () => serveHtmlPage("fleet"));
  app.page("/styles.css", () => {
    const css = readAsset("styles.css");
    if (css === null) {
      return new Response("/* styles.css not found */", {
        status: 404,
        contentType: "text/css; charset=utf-8",
        headers: { "X-Content-Type-Options": "nosniff" }
      });
    }
    return new Response(css, {
      status: 200,
      contentType: "text/css; charset=utf-8",
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store"
      }
    });
  });
  app.page("/dist/ui.js", () => {
    const js = readAsset(path4.join("dist", "ui.js"));
    if (js === null) {
      return new Response("// ui.js not found", {
        status: 404,
        contentType: "application/javascript; charset=utf-8",
        headers: { "X-Content-Type-Options": "nosniff" }
      });
    }
    return new Response(js, {
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store"
      }
    });
  });
  app.api(
    "/api/health",
    () => {
      const health = engine.getHealthInfo();
      return {
        ok: true,
        version: "0.1.0",
        lsConnected: health.lsConnected,
        stateDir: health.stateDir,
        activeConversationId: health.activeConversationId,
        uptimeMs: Date.now() - startedAt
      };
    },
    "GET"
  );
  app.api("/api/config", () => engine.getConfig(), "GET");
  app.api(
    "/api/config",
    (data) => {
      try {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          return make400Json("Config patch must be a JSON object");
        }
        validateAllowedConfigPostKeys(data);
        validateConfigPatch(data);
        return engine.updateConfig(data);
      } catch (err) {
        if (err instanceof ConfigValidationError) {
          return make400Json(err.message);
        }
        return make400Json(err instanceof Error ? err.message : "Invalid config payload");
      }
    },
    "POST"
  );
  app.api(
    "/api/hud",
    (data) => {
      const rawCid = typeof data.conversationId === "string" ? data.conversationId.trim() : "";
      if (rawCid && !isValidUuid(rawCid)) {
        return make400Json("Invalid conversationId UUID");
      }
      const hostCid = app.config.conversationId?.trim() ?? "";
      const requestedCid = rawCid || (isValidUuid(hostCid) ? hostCid : null);
      const clientEtag = typeof data.etag === "string" ? data.etag.trim() : void 0;
      return engine.getHudSnapshot(requestedCid, clientEtag);
    },
    "GET"
  );
  app.api(
    "/api/timeline",
    (data) => {
      if (data.conversationId !== void 0 && typeof data.conversationId !== "string") {
        return make400Json("Invalid conversationId UUID");
      }
      const rawCid = typeof data.conversationId === "string" ? data.conversationId.trim() : "";
      if (rawCid && !isValidUuid(rawCid)) {
        return make400Json("Invalid conversationId UUID");
      }
      let requestedScope;
      if (data.scope !== void 0) {
        const rawScope = typeof data.scope === "string" ? data.scope.trim() : "";
        if (rawScope !== "conversation" && rawScope !== "tree") {
          return make400Json("Invalid timeline scope: expected conversation | tree");
        }
        requestedScope = rawScope;
      }
      const hostCid = app.config.conversationId?.trim() ?? "";
      const requestedCid = rawCid || (isValidUuid(hostCid) ? hostCid : null);
      const clientEtag = typeof data.etag === "string" ? data.etag.trim() : void 0;
      return engine.getTimelineSnapshot(requestedCid, requestedScope, clientEtag);
    },
    "GET"
  );
  app.api(
    "/api/fleet",
    (data) => {
      const clientEtag = typeof data.etag === "string" ? data.etag.trim() : void 0;
      return engine.getFleetSnapshot(clientEtag);
    },
    "GET"
  );
  if (options.autoStartEngine !== false) {
    await engine.start();
  }
  return {
    app,
    engine,
    async start() {
      await engine.start();
      return app.run();
    },
    async stop() {
      engine.stop();
      await app.close();
    }
  };
}
function watchBundleForRestart(bundlePath, onBundleChanged, pollMs = 3e3) {
  let initialSig = "";
  try {
    const st = statSync3(bundlePath);
    initialSig = `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    return () => {
    };
  }
  const safePollMs = Number.isFinite(pollMs) ? Math.max(10, pollMs) : 3e3;
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) {
      return;
    }
    try {
      const st = statSync3(bundlePath);
      const sig = `${st.ino}:${st.mtimeMs}:${st.size}`;
      if (sig !== initialSig) {
        stopped = true;
        clearInterval(timer);
        onBundleChanged();
      }
    } catch {
    }
  }, safePollMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
function isServerEntryPoint() {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  try {
    const resolved = realpathSync(argv1);
    return import.meta.url === pathToFileURL(resolved).href && /(?:^|[\\/])server\.(?:m?js|cjs|ts)$/i.test(resolved);
  } catch {
    return false;
  }
}
if (isServerEntryPoint()) {
  const selfBundlePath = realpathSync(process.argv[1]);
  createPulseSidecarServer({ autoStartEngine: false }).then(async (handle) => {
    let shuttingDown = false;
    let stopBundleWatch = () => {
    };
    let restartTimer = null;
    const shutdown = () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      stopBundleWatch();
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      void handle.stop().finally(() => {
        process.exit(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    stopBundleWatch = watchBundleForRestart(
      selfBundlePath,
      () => {
        restartTimer = setTimeout(() => {
          console.log("[pulse_cockpit] Bundle updated on disk; exiting for supervisor restart.");
          shutdown();
        }, 400);
        restartTimer.unref?.();
      },
      3e3
    );
    await handle.start();
  }).catch((err) => {
    console.error("[pulse_cockpit] Fatal startup error:", err);
    process.exit(1);
  });
}
export {
  STRICT_CSP,
  createPulseSidecarServer,
  watchBundleForRestart
};
