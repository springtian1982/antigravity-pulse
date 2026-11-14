/* SPDX-License-Identifier: MIT | Copyright (c) 2026 springtian <springtian@gmail.com> */
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/hook/hook-probe.ts
var hook_probe_exports = {};
__export(hook_probe_exports, {
  processHookPayload: () => processHookPayload,
  runHookCli: () => runHookCli
});
module.exports = __toCommonJS(hook_probe_exports);
var import_node_fs2 = require("node:fs");

// src/core/formatters.ts
var CANONICAL_HUD_URI = "sidecar://antigravity-pulse/pulse_cockpit/hud";
function formatDurationCompact(ms) {
  const safeMs = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  const roundedMs = Math.round(safeMs);
  if (roundedMs < 1e3) {
    return `${roundedMs}ms`;
  }
  if (safeMs < 6e4) {
    return `${(safeMs / 1e3).toFixed(1)}s`;
  }
  if (safeMs < 36e5) {
    const mins2 = Math.floor(safeMs / 6e4);
    const secs = Math.floor(safeMs % 6e4 / 1e3);
    return `${mins2}m ${secs}s`;
  }
  const hours = Math.floor(safeMs / 36e5);
  const mins = Math.floor(safeMs % 36e5 / 6e4);
  return `${hours}h ${mins}m`;
}
function escapeMarkdown(raw) {
  const str = raw === null || raw === void 0 ? "" : String(raw);
  return str.replace(/\r?\n/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1").trim();
}
function sanitizeInlineCode(raw) {
  const str = raw === null || raw === void 0 ? "" : String(raw);
  return str.replace(/\r?\n/g, " ").replace(/`/g, "'").trim();
}
function formatInlineTurnStamp(input) {
  const retryCount = typeof input.retryCount === "number" && Number.isFinite(input.retryCount) && input.retryCount > 0 ? Math.trunc(input.retryCount) : 0;
  const ctxTrigger = input.stampContextTriggerPct ?? 75;
  const quotaTrigger = input.quotaLowTriggerPct ?? 20;
  const isWarning = retryCount > 0 || input.routingStatus === "mismatch_or_fallback" || input.contextPct !== null && input.contextPct !== void 0 && Number.isFinite(input.contextPct) && input.contextPct > ctxTrigger || input.gemini5hRemainingPct !== null && input.gemini5hRemainingPct !== void 0 && Number.isFinite(input.gemini5hRemainingPct) && input.gemini5hRemainingPct < quotaTrigger;
  const icon = isWarning ? "\u26A0" : input.modelSwitched ? "\u{1F500}" : "\u26A1";
  const safeDisplay = escapeMarkdown(input.modelDisplayName || "Unknown Model");
  const parts = [`${icon} **${safeDisplay}**`];
  const safeResponse = sanitizeInlineCode(input.responseModel);
  if (safeResponse) {
    parts.push(`\`${safeResponse}\``);
  }
  if ((input.routingStatus === "routed" || input.routingStatus === "mismatch_or_fallback") && input.requestedLabel) {
    const safeRequested = escapeMarkdown(input.requestedLabel);
    if (safeRequested) {
      parts.push(`Routed from ${safeRequested}`);
    }
  }
  if (retryCount > 0) {
    parts.push(`Retried \xD7${retryCount}`);
  }
  if (input.ttftMs !== null && input.ttftMs !== void 0 && Number.isFinite(input.ttftMs)) {
    parts.push(`TTFT ${formatDurationCompact(input.ttftMs)}`);
  }
  if (input.contextPct !== null && input.contextPct !== void 0 && Number.isFinite(input.contextPct)) {
    const clampedCtx = Math.max(0, Math.round(input.contextPct));
    parts.push(`CTX ${clampedCtx}%`);
  }
  if (input.gemini5hRemainingPct !== null && input.gemini5hRemainingPct !== void 0 && Number.isFinite(input.gemini5hRemainingPct)) {
    parts.push(`5h \u4F59\u91CF ${input.gemini5hRemainingPct.toFixed(1)}%`);
  }
  parts.push(`[Model Pulse](${CANONICAL_HUD_URI})`);
  return parts.join(" \xB7 ");
}

// src/state/state-dir.ts
var import_node_fs = require("node:fs");
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var UUID_REGEX = /^[0-9a-f-]{36}$/i;
var RING_MAX_BYTES = 512 * 1024;
var atomicTmpSeq = 0;
function tryChmod(targetPath, mode) {
  if (process.platform === "win32") return;
  try {
    (0, import_node_fs.chmodSync)(targetPath, mode);
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
  const appDataDir = process.env.ANTIGRAVITY_APP_DATA_DIR?.trim() || process.env.ANTIGRAVITY_DATA_DIR?.trim() || import_node_path.default.join(import_node_os.default.homedir(), ".gemini", "antigravity");
  const chosen = trimmedOverride || envStateDir || pluginData || import_node_path.default.join(appDataDir, "plugin_data", "antigravity-pulse");
  return import_node_path.default.resolve(chosen);
}
function getStatePaths(overrideDir) {
  const stateDir = resolveStateDir(overrideDir);
  return {
    stateDir,
    eventsRing: import_node_path.default.join(stateDir, "events.ring.jsonl"),
    eventsRingPrev: import_node_path.default.join(stateDir, "events.ring.prev.jsonl"),
    liveSnapshot: import_node_path.default.join(stateDir, "live-snapshot.json"),
    modelMap: import_node_path.default.join(stateDir, "model-map.json"),
    quotaCache: import_node_path.default.join(stateDir, "quota-cache.json"),
    configPath: import_node_path.default.join(stateDir, "config.json"),
    stampDedup: import_node_path.default.join(stateDir, "stamp-dedup.json")
  };
}
function ensureStateDir(overrideDir) {
  const stateDir = resolveStateDir(overrideDir);
  (0, import_node_fs.mkdirSync)(stateDir, { recursive: true, mode: 448 });
  tryChmod(stateDir, 448);
  return stateDir;
}
function writeJsonAtomic(filePath, data) {
  const parentDir = import_node_path.default.dirname(filePath);
  if (!(0, import_node_fs.existsSync)(parentDir)) {
    (0, import_node_fs.mkdirSync)(parentDir, { recursive: true, mode: 448 });
    tryChmod(parentDir, 448);
  }
  atomicTmpSeq = atomicTmpSeq + 1 >>> 0;
  const suffix = `${process.pid}.${process.hrtime.bigint().toString(36)}.${atomicTmpSeq.toString(36)}`;
  const tmpPath = `${filePath}.${suffix}.tmp`;
  const serialized = `${JSON.stringify(data, null, 2)}
`;
  try {
    (0, import_node_fs.writeFileSync)(tmpPath, serialized, { encoding: "utf8", mode: 384 });
    tryChmod(tmpPath, 384);
    (0, import_node_fs.renameSync)(tmpPath, filePath);
  } catch (err) {
    try {
      if ((0, import_node_fs.existsSync)(tmpPath)) {
        (0, import_node_fs.unlinkSync)(tmpPath);
      }
    } catch {
    }
    throw err;
  }
}
function readJsonSafe(filePath, fallback) {
  try {
    if (!(0, import_node_fs.existsSync)(filePath)) {
      return fallback;
    }
    const raw = (0, import_node_fs.readFileSync)(filePath, "utf8");
    if (!raw.trim()) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function appendRingLine(event, overrideDir) {
  ensureStateDir(overrideDir);
  const { eventsRing } = getStatePaths(overrideDir);
  const line = `${JSON.stringify(event)}
`;
  (0, import_node_fs.appendFileSync)(eventsRing, line, { encoding: "utf8", mode: 384 });
  return eventsRing;
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

// src/hook/hook-probe.ts
var KNOWN_HOOK_EVENTS = /* @__PURE__ */ new Set([
  "PreInvocation",
  "PostInvocation",
  "PreToolUse",
  "PostToolUse",
  "Stop"
]);
var PROTO_POLLUTION_KEYS2 = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var STAMP_DEDUP_MAX_ENTRIES = 200;
var TOOL_SUMMARY_MAX_LEN = 80;
function isPlainRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function firstNonEmptyString(...values) {
  for (const val of values) {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return void 0;
}
function parseInvocationNum(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : void 0;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : void 0;
  }
  return void 0;
}
function normalizeEventName(payload) {
  const raw = payload.hookEventName ?? payload.hook_event_name;
  if (typeof raw === "string" && KNOWN_HOOK_EVENTS.has(raw)) {
    return raw;
  }
  return null;
}
function parseToolInput(raw) {
  if (isPlainRecord2(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const parsed = JSON.parse(raw);
      return isPlainRecord2(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
function truncateSummary(raw, maxLen = TOOL_SUMMARY_MAX_LEN) {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen - 3)}...`;
}
function extractToolSummary(toolInput) {
  if (!toolInput) {
    return void 0;
  }
  const raw = firstNonEmptyString(
    toolInput.ToolSummary,
    toolInput.toolSummary,
    toolInput.tool_summary,
    toolInput.CommandLine,
    toolInput.commandLine,
    toolInput.command_line,
    toolInput.command,
    toolInput.TargetFile,
    toolInput.targetFile,
    toolInput.target_file,
    toolInput.AbsolutePath,
    toolInput.absolutePath,
    toolInput.filePath,
    toolInput.file_path,
    toolInput.Path,
    toolInput.path,
    toolInput.query,
    toolInput.Query,
    toolInput.Url,
    toolInput.url,
    toolInput.Task,
    toolInput.task,
    toolInput.Description,
    toolInput.description,
    toolInput.Role,
    toolInput.role
  );
  return raw ? truncateSummary(raw) : void 0;
}
function extractSubagentRequest(toolName, toolInput) {
  if (toolName !== "invoke_subagent" || !toolInput) {
    return void 0;
  }
  const role = firstNonEmptyString(toolInput.Role, toolInput.role);
  const typeName = firstNonEmptyString(
    toolInput.TypeName,
    toolInput.typeName,
    toolInput.type_name,
    toolInput.subagent_type,
    toolInput.subagentType
  );
  const model = firstNonEmptyString(
    toolInput.Model,
    toolInput.model,
    toolInput.modelName,
    toolInput.model_name
  );
  if (!role && !typeName && !model) {
    return void 0;
  }
  return {
    ...role ? { role } : {},
    ...typeName ? { typeName } : {},
    ...model ? { model } : {}
  };
}
function resolveModelFromMap(modelRaw, modelMap) {
  if (!modelRaw || !modelMap || !isPlainRecord2(modelMap.modelsByEnum)) {
    return null;
  }
  if (!PROTO_POLLUTION_KEYS2.has(modelRaw) && Object.hasOwn(modelMap.modelsByEnum, modelRaw)) {
    const direct = modelMap.modelsByEnum[modelRaw];
    if (direct && typeof direct === "object") {
      return direct;
    }
  }
  const needle = modelRaw.toLowerCase();
  for (const key of Object.keys(modelMap.modelsByEnum)) {
    const entry = modelMap.modelsByEnum[key];
    if (!entry || typeof entry !== "object") continue;
    if (entry.modelEnum?.toLowerCase() === needle || entry.modelId?.toLowerCase() === needle || entry.label?.toLowerCase() === needle) {
      return entry;
    }
  }
  return null;
}
function pickNewestQuotaPct(liveSnapshot, quotaCache) {
  const livePct = liveSnapshot?.quota?.gemini5h?.remainingPct;
  const cachePct = quotaCache?.quota?.gemini5h?.remainingPct;
  const hasLivePct = typeof livePct === "number" && Number.isFinite(livePct);
  const hasCachePct = typeof cachePct === "number" && Number.isFinite(cachePct);
  if (hasLivePct && hasCachePct) {
    const liveTs = Date.parse(liveSnapshot?.updatedAt ?? "");
    const cacheTs = Date.parse(quotaCache?.updatedAt ?? "");
    if (Number.isFinite(liveTs) && Number.isFinite(cacheTs)) {
      return cacheTs >= liveTs ? cachePct : livePct;
    }
    return cachePct;
  }
  if (hasCachePct) return cachePct;
  if (hasLivePct) return livePct;
  return null;
}
function readStampDedup(filePath) {
  const raw = readJsonSafe(filePath, null);
  const byConversation = {};
  if (isPlainRecord2(raw) && isPlainRecord2(raw.byConversation)) {
    for (const key of Object.keys(raw.byConversation)) {
      if (PROTO_POLLUTION_KEYS2.has(key)) continue;
      if (key !== "unknown" && !isValidUuid(key)) continue;
      const entry = raw.byConversation[key];
      if (!isPlainRecord2(entry)) continue;
      const turnEpoch = typeof entry.turnEpoch === "number" && Number.isFinite(entry.turnEpoch) ? Math.trunc(entry.turnEpoch) : void 0;
      byConversation[key] = {
        lastInvocationNum: typeof entry.lastInvocationNum === "number" && Number.isFinite(entry.lastInvocationNum) ? Math.trunc(entry.lastInvocationNum) : 0,
        lastServedModel: typeof entry.lastServedModel === "string" ? entry.lastServedModel : "",
        lastTurnStamped: entry.lastTurnStamped === true,
        lastContextAlertPct: typeof entry.lastContextAlertPct === "number" && Number.isFinite(entry.lastContextAlertPct) ? entry.lastContextAlertPct : 0,
        lastQuotaAlerted: entry.lastQuotaAlerted === true,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : (/* @__PURE__ */ new Date(0)).toISOString(),
        ...turnEpoch !== void 0 ? { turnEpoch } : {}
      };
    }
  }
  return {
    schemaVersion: 1,
    byConversation
  };
}
function pruneStampDedup(byConversation, keepKey) {
  const entries = Object.entries(byConversation);
  if (entries.length <= STAMP_DEDUP_MAX_ENTRIES) {
    return byConversation;
  }
  entries.sort((a, b) => {
    if (keepKey) {
      if (a[0] === keepKey && b[0] !== keepKey) return -1;
      if (b[0] === keepKey && a[0] !== keepKey) return 1;
    }
    const ta = Date.parse(a[1].updatedAt);
    const tb = Date.parse(b[1].updatedAt);
    const va = Number.isFinite(ta) ? ta : 0;
    const vb = Number.isFinite(tb) ? tb : 0;
    return vb - va;
  });
  const pruned = {};
  for (let i = 0; i < STAMP_DEDUP_MAX_ENTRIES; i += 1) {
    const [key, value] = entries[i];
    pruned[key] = value;
  }
  return pruned;
}
function advanceTurnEpochOnStop(overrideStateDir, conversationId, nowIso) {
  const paths = getStatePaths(overrideStateDir);
  const dedup = readStampDedup(paths.stampDedup);
  const existing = Object.hasOwn(dedup.byConversation, conversationId) ? dedup.byConversation[conversationId] : void 0;
  if (existing) {
    const currentEpoch = Math.max(
      1,
      typeof existing.turnEpoch === "number" && Number.isFinite(existing.turnEpoch) ? existing.turnEpoch : 0,
      existing.lastInvocationNum
    );
    dedup.byConversation[conversationId] = {
      ...existing,
      turnEpoch: currentEpoch + 1,
      updatedAt: nowIso
    };
  } else {
    dedup.byConversation[conversationId] = {
      lastInvocationNum: 0,
      lastServedModel: "",
      lastTurnStamped: false,
      lastContextAlertPct: 0,
      lastQuotaAlerted: false,
      turnEpoch: 1,
      updatedAt: nowIso
    };
  }
  dedup.byConversation = pruneStampDedup(dedup.byConversation, conversationId);
  writeJsonAtomic(paths.stampDedup, dedup);
}
function evaluatePostInvocationStamp(params) {
  const config = loadConfig(params.overrideStateDir);
  if (config.inlineStampMode === "off") {
    return { stdout: {}, stamped: false, stampReason: null };
  }
  const paths = getStatePaths(params.overrideStateDir);
  const dedup = readStampDedup(paths.stampDedup);
  const existing = Object.hasOwn(dedup.byConversation, params.conversationId) ? dedup.byConversation[params.conversationId] : void 0;
  const turnKey = params.invocationNum !== void 0 ? params.invocationNum : existing && typeof existing.turnEpoch === "number" && existing.turnEpoch > 0 ? Math.max(existing.turnEpoch, existing.lastInvocationNum) : existing && existing.lastInvocationNum > 0 ? existing.lastInvocationNum : 1;
  if (existing?.lastTurnStamped && existing.lastInvocationNum === turnKey) {
    return { stdout: {}, stamped: false, stampReason: null };
  }
  const liveSnapshot = readJsonSafe(paths.liveSnapshot, null);
  const quotaCache = readJsonSafe(paths.quotaCache, null);
  const modelMap = params.initialModelMap ?? readJsonSafe(paths.modelMap, null);
  const node = liveSnapshot && isPlainRecord2(liveSnapshot.nodesByCascadeId) && !PROTO_POLLUTION_KEYS2.has(params.conversationId) && Object.hasOwn(liveSnapshot.nodesByCascadeId, params.conversationId) ? liveSnapshot.nodesByCascadeId[params.conversationId] : void 0;
  const mapEntry = resolveModelFromMap(params.modelRaw, modelMap) ?? (modelMap?.defaultModelEnum ? resolveModelFromMap(modelMap.defaultModelEnum, modelMap) : null);
  const servedDisplayName = firstNonEmptyString(
    node?.servedModel?.displayName,
    mapEntry?.label,
    params.modelRaw,
    node?.servedModel?.responseModel,
    node?.servedModel?.modelEnum
  ) ?? "Unknown Model";
  const responseModel = firstNonEmptyString(
    node?.servedModel?.responseModel,
    mapEntry?.modelId,
    node?.servedModel?.modelEnum,
    mapEntry?.modelEnum,
    params.modelRaw
  ) ?? null;
  const servedModelId = firstNonEmptyString(
    node?.servedModel?.responseModel,
    mapEntry?.modelId,
    node?.servedModel?.modelEnum,
    params.modelRaw
  ) ?? "";
  const requestedLabel = firstNonEmptyString(
    node?.requestedModel?.displayName,
    node?.requestedModel?.raw,
    mapEntry?.label,
    params.modelRaw
  ) ?? null;
  const routingStatus = node?.routingStatus ?? "unknown";
  const retryCount = typeof node?.retryCount === "number" && Number.isFinite(node.retryCount) && node.retryCount > 0 ? Math.trunc(node.retryCount) : 0;
  const ttftMs = typeof node?.lastTtftMs === "number" && Number.isFinite(node.lastTtftMs) && node.lastTtftMs >= 0 ? node.lastTtftMs : null;
  const nodeContextPct = typeof node?.contextWindow?.pct === "number" && Number.isFinite(node.contextWindow.pct) && node.contextWindow.pct >= 0 ? node.contextWindow.pct : null;
  const contextPct = nodeContextPct ?? 0;
  const gemini5hRemainingPct = pickNewestQuotaPct(liveSnapshot, quotaCache);
  const ctxTriggerPct = config.smartThresholds.stampContextTriggerPct;
  const quotaTriggerPct = config.smartThresholds.quotaLowTriggerPct;
  const isTurn1 = !existing || !existing.lastTurnStamped;
  const prevMapEntry = existing?.lastServedModel ? resolveModelFromMap(existing.lastServedModel, modelMap) : null;
  const sameModelViaMap = prevMapEntry !== null && node?.servedModel?.modelEnum !== void 0 && node.servedModel.modelEnum !== "" && prevMapEntry.modelEnum === node.servedModel.modelEnum && prevMapEntry.label === node.servedModel.displayName;
  const modelChanged = servedModelId !== "" && existing !== void 0 && existing.lastServedModel !== "" && servedModelId !== existing.lastServedModel && !sameModelViaMap;
  const hasRetryOrFallback = retryCount > 0 || routingStatus === "retrying" || routingStatus === "mismatch_or_fallback";
  const contextCrossed = contextPct > ctxTriggerPct && (!existing || existing.lastContextAlertPct <= ctxTriggerPct);
  const quotaCrossed = gemini5hRemainingPct !== null && gemini5hRemainingPct < quotaTriggerPct && (!existing || !existing.lastQuotaAlerted);
  let stampReason = null;
  if (config.inlineStampMode === "every-turn") {
    stampReason = "every-turn";
  } else if (isTurn1) {
    stampReason = "turn_1";
  } else if (modelChanged) {
    stampReason = "model_changed";
  } else if (hasRetryOrFallback) {
    stampReason = "retry_or_fallback";
  } else if (contextCrossed) {
    stampReason = "context_high";
  } else if (quotaCrossed) {
    stampReason = "quota_low";
  }
  const nextQuotaAlerted = gemini5hRemainingPct !== null ? gemini5hRemainingPct < quotaTriggerPct : existing?.lastQuotaAlerted ?? false;
  if (!stampReason) {
    const nextTurnEpoch2 = existing ? Math.max(
      1,
      typeof existing.turnEpoch === "number" && Number.isFinite(existing.turnEpoch) ? existing.turnEpoch : 0,
      existing.lastInvocationNum,
      params.invocationNum ?? 0
    ) : 1;
    if (existing && (existing.lastContextAlertPct !== contextPct || existing.lastQuotaAlerted !== nextQuotaAlerted || existing.turnEpoch !== nextTurnEpoch2)) {
      dedup.byConversation[params.conversationId] = {
        ...existing,
        lastContextAlertPct: contextPct,
        lastQuotaAlerted: nextQuotaAlerted,
        turnEpoch: nextTurnEpoch2,
        updatedAt: params.nowIso
      };
      dedup.byConversation = pruneStampDedup(dedup.byConversation, params.conversationId);
      writeJsonAtomic(paths.stampDedup, dedup);
    }
    return { stdout: {}, stamped: false, stampReason: null };
  }
  const userMarkdown = formatInlineTurnStamp({
    modelDisplayName: servedDisplayName,
    responseModel,
    requestedLabel,
    routingStatus,
    modelSwitched: modelChanged,
    retryCount,
    ttftMs,
    contextPct: nodeContextPct,
    gemini5hRemainingPct,
    stampContextTriggerPct: ctxTriggerPct,
    quotaLowTriggerPct: quotaTriggerPct
  });
  const nextTurnEpoch = Math.max(
    1,
    typeof existing?.turnEpoch === "number" && Number.isFinite(existing.turnEpoch) ? existing.turnEpoch : 0,
    existing?.lastInvocationNum ?? 0,
    turnKey
  );
  dedup.byConversation[params.conversationId] = {
    lastInvocationNum: turnKey,
    lastServedModel: servedModelId || existing?.lastServedModel || "",
    lastTurnStamped: true,
    lastContextAlertPct: contextPct,
    lastQuotaAlerted: nextQuotaAlerted,
    turnEpoch: nextTurnEpoch,
    updatedAt: params.nowIso
  };
  dedup.byConversation = pruneStampDedup(dedup.byConversation, params.conversationId);
  writeJsonAtomic(paths.stampDedup, dedup);
  return {
    stdout: {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: "",
            metadata: {
              user_markdown: userMarkdown
            }
          }
        }
      ]
    },
    stamped: true,
    stampReason
  };
}
function processHookPayload(rawStdin, options) {
  const startNs = process.hrtime.bigint();
  const opts = typeof options === "string" ? { overrideStateDir: options } : options ?? {};
  let eventName = null;
  const elapsedUs = () => Math.max(0, Number((process.hrtime.bigint() - startNs) / 1000n));
  const fallbackResult = () => ({
    stdout: eventName === "PreToolUse" ? { decision: "allow" } : {},
    event: null,
    stamped: false,
    stampReason: null,
    hookDurationUs: elapsedUs()
  });
  try {
    const trimmed = rawStdin.trim();
    if (!trimmed) {
      return fallbackResult();
    }
    const parsed = JSON.parse(trimmed);
    if (!isPlainRecord2(parsed)) {
      return fallbackResult();
    }
    eventName = normalizeEventName(parsed);
    if (!eventName) {
      return fallbackResult();
    }
    const typed = parsed;
    const rawCid = typed.conversationId ?? typed.conversation_id;
    const conversationId = isValidUuid(rawCid) ? rawCid : "unknown";
    const invocationNum = parseInvocationNum(typed.invocationNum ?? typed.invocation_num);
    const modelRaw = firstNonEmptyString(typed.model, typed.modelName, typed.model_name);
    const toolName = firstNonEmptyString(typed.toolName, typed.tool_name);
    const toolCallId = firstNonEmptyString(typed.toolCallId, typed.tool_call_id);
    const stopReason = firstNonEmptyString(typed.stopReason, typed.stop_reason);
    const toolInput = parseToolInput(typed.toolInput ?? typed.tool_input);
    const toolSummary = extractToolSummary(toolInput);
    const subagentRequest = extractSubagentRequest(toolName, toolInput);
    let initialModelMap = null;
    let modelDisplay;
    if (modelRaw) {
      const paths = getStatePaths(opts.overrideStateDir);
      initialModelMap = readJsonSafe(paths.modelMap, null);
      modelDisplay = resolveModelFromMap(modelRaw, initialModelMap)?.label;
    }
    const ts = typeof opts.nowMs === "number" && Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
    const iso = new Date(ts).toISOString();
    const ringEvent = {
      ts,
      iso,
      event: eventName,
      conversationId,
      ...invocationNum !== void 0 ? { invocationNum } : {},
      ...modelRaw ? { modelRaw } : {},
      ...modelDisplay ? { modelDisplay } : {},
      ...toolName ? { toolName } : {},
      ...toolCallId ? { toolCallId } : {},
      ...toolSummary ? { toolSummary } : {},
      ...subagentRequest ? { subagentRequest } : {},
      ...stopReason ? { stopReason } : {},
      hookDurationUs: elapsedUs()
    };
    try {
      appendRingLine(ringEvent, opts.overrideStateDir);
    } catch {
    }
    if (eventName === "PreToolUse") {
      return {
        stdout: { decision: "allow" },
        event: ringEvent,
        stamped: false,
        stampReason: null,
        hookDurationUs: elapsedUs()
      };
    }
    if (eventName === "Stop") {
      if (invocationNum === void 0) {
        try {
          advanceTurnEpochOnStop(opts.overrideStateDir, conversationId, iso);
        } catch {
        }
      }
      return {
        stdout: {},
        event: ringEvent,
        stamped: false,
        stampReason: null,
        hookDurationUs: elapsedUs()
      };
    }
    if (eventName === "PostInvocation") {
      try {
        const stampOutcome = evaluatePostInvocationStamp({
          overrideStateDir: opts.overrideStateDir,
          conversationId,
          invocationNum,
          modelRaw,
          initialModelMap,
          nowIso: iso
        });
        return {
          stdout: stampOutcome.stdout,
          event: ringEvent,
          stamped: stampOutcome.stamped,
          stampReason: stampOutcome.stampReason,
          hookDurationUs: elapsedUs()
        };
      } catch {
        return {
          stdout: {},
          event: ringEvent,
          stamped: false,
          stampReason: null,
          hookDurationUs: elapsedUs()
        };
      }
    }
    return {
      stdout: {},
      event: ringEvent,
      stamped: false,
      stampReason: null,
      hookDurationUs: elapsedUs()
    };
  } catch {
    return fallbackResult();
  }
}
function runHookCli() {
  let stdout = {};
  try {
    const stdinText = (0, import_node_fs2.readFileSync)(0, "utf8");
    stdout = processHookPayload(stdinText).stdout;
  } catch {
    stdout = {};
  }
  process.stdout.write(`${JSON.stringify(stdout)}
`);
  process.exitCode = 0;
}
var isHookEntrypoint = typeof require !== "undefined" && typeof module !== "undefined" && require.main === module && typeof require.main?.filename === "string" && /(?:^|[\\/])hook-probe\.(?:c?js|mjs|ts)$/i.test(require.main.filename);
if (isHookEntrypoint) {
  runHookCli();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  processHookPayload,
  runHookCli
});
