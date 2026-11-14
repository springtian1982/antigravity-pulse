#!/usr/bin/env node
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

// src/cli/main.ts
var main_exports = {};
__export(main_exports, {
  CLI_VERSION: () => CLI_VERSION,
  getConfigHelpText: () => getConfigHelpText,
  getDoctorHelpText: () => getDoctorHelpText,
  getMainHelpText: () => getMainHelpText,
  runCli: () => runCli,
  runConfigCommand: () => runConfigCommand,
  runDoctorCheck: () => runDoctorCheck,
  runDoctorCommand: () => runDoctorCommand
});
module.exports = __toCommonJS(main_exports);
var import_node_fs5 = require("node:fs");
var import_node_os3 = require("node:os");
var import_node_path4 = require("node:path");

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
function assertValidUuid(value, fieldName = "conversationId") {
  if (!isValidUuid(value)) {
    throw new RangeError(`Invalid ${fieldName}: expected 36-character UUID`);
  }
  return value;
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
function saveConfig(config, overrideDir) {
  ensureStateDir(overrideDir);
  const { configPath } = getStatePaths(overrideDir);
  const validated = validateConfigPatch(config);
  const normalized = mergeConfig(DEFAULT_PULSE_USER_CONFIG, validated);
  writeJsonAtomic(configPath, normalized);
  return normalized;
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

// src/cli/status-formatter.ts
var import_node_fs4 = require("node:fs");

// src/core/topology-builder.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = __toESM(require("node:path"), 1);

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
function formatTokensCompact(tokens) {
  const safe = Number.isFinite(tokens) && tokens >= 0 ? tokens : 0;
  if (safe < 1e3) {
    return `${Math.round(safe)}`;
  }
  if (safe < 1e5) {
    const formatted = (safe / 1e3).toFixed(1).replace(/\.0$/, "");
    return `${formatted}k`;
  }
  if (safe < 1e6) {
    return `${Math.round(safe / 1e3)}k`;
  }
  return `${(safe / 1e6).toFixed(2)}M`;
}
function formatPct(pct, decimals = 1) {
  if (pct === null || pct === void 0 || !Number.isFinite(pct)) {
    return "\u2014";
  }
  return `${pct.toFixed(decimals)}%`;
}
function formatDeltaQuotaPct(consumedPct) {
  if (consumedPct === null || consumedPct === void 0 || !Number.isFinite(consumedPct)) {
    return "\u2014";
  }
  if (consumedPct <= 0) {
    return "0.00%";
  }
  const formatted = consumedPct.toFixed(2);
  return formatted === "0.00" ? "0.00%" : `-${formatted}%`;
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
  const pbtxtPath = import_node_path2.default.join(antigravityDataDir, "annotations", `${cascadeId}.pbtxt`);
  if (!(0, import_node_fs2.existsSync)(pbtxtPath)) {
    return null;
  }
  try {
    const content = (0, import_node_fs2.readFileSync)(pbtxtPath, "utf8");
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
  if (!(0, import_node_fs2.existsSync)(dbPath) || typeof process.getBuiltinModule !== "function") {
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
    const sysGenDir = import_node_path2.default.join(input.antigravityDataDir, "brain", parentCid, ".system_generated");
    if (!(0, import_node_fs2.existsSync)(sysGenDir)) {
      continue;
    }
    const subagentsDir = import_node_path2.default.join(sysGenDir, "subagents");
    if ((0, import_node_fs2.existsSync)(subagentsDir)) {
      try {
        const files = (0, import_node_fs2.readdirSync)(subagentsDir).filter((name) => name.endsWith(".json")).sort();
        for (const fileName of files) {
          const fullPath = import_node_path2.default.join(subagentsDir, fileName);
          try {
            const parsed = JSON.parse((0, import_node_fs2.readFileSync)(fullPath, "utf8"));
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
    const swarmMembersPath = import_node_path2.default.join(sysGenDir, "swarm", "members.json");
    if ((0, import_node_fs2.existsSync)(swarmMembersPath)) {
      try {
        const parsed = JSON.parse((0, import_node_fs2.readFileSync)(swarmMembersPath, "utf8"));
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
      const dbPath = import_node_path2.default.join(input.antigravityDataDir, "conversations", `${cid}.db`);
      if ((0, import_node_fs2.existsSync)(dbPath)) {
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

// src/cli/snapshot-reader.ts
var import_node_fs3 = require("node:fs");
var import_node_os2 = __toESM(require("node:os"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);

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

// src/cli/snapshot-reader.ts
var LIVE_LS_STALE_TRIGGER_MS = 1e4;
var SNAPSHOT_STALE_THRESHOLD_MS = 3e4;
var LIVE_LS_TIMEOUT_MS = 1500;
var MAX_META_FETCH_CASCADES = 12;
var META_FETCH_CONCURRENCY = 6;
var PHASE_PRIORITY = {
  BLOCKED_APPROVAL: 0,
  ERROR_OR_QUOTA: 1,
  TOOL_RUNNING: 2,
  STREAMING: 3,
  THINKING: 4,
  PRE_FLIGHT: 5,
  IDLE: 6
};
function isPlainRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isLiveSnapshotFile(raw) {
  return isPlainRecord2(raw) && raw.schemaVersion === 1 && isPlainRecord2(raw.nodesByCascadeId);
}
function isQuotaCacheFile(raw) {
  return isPlainRecord2(raw) && raw.schemaVersion === 1 && isPlainRecord2(raw.quota);
}
function isModelMapFile(raw) {
  return isPlainRecord2(raw) && raw.schemaVersion === 1 && isPlainRecord2(raw.modelsByEnum);
}
function parseIsoMs(iso) {
  if (!iso || typeof iso !== "string") {
    return null;
  }
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}
function isNodeRunning2(node) {
  return node.status === "CASCADE_RUN_STATUS_RUNNING" || node.phase !== "IDLE" && node.phase !== "ERROR_OR_QUOTA";
}
async function runWithConcurrency(items, concurrency, worker) {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (cursor < items.length) {
        const idx = cursor;
        cursor += 1;
        await worker(items[idx]);
      }
    })
  );
}
function sortTreeNodes(nodes, sortMode, activeCid) {
  if (nodes.length <= 1) {
    return [...nodes];
  }
  if (sortMode === "topology-tree") {
    const byId = /* @__PURE__ */ new Map();
    for (const node of nodes) {
      byId.set(node.cascadeId, node);
    }
    const childrenByParent = /* @__PURE__ */ new Map();
    const roots = [];
    for (const node of nodes) {
      if (node.parentCascadeId && byId.has(node.parentCascadeId)) {
        const list = childrenByParent.get(node.parentCascadeId) ?? [];
        list.push(node);
        childrenByParent.set(node.parentCascadeId, list);
      } else {
        roots.push(node);
      }
    }
    const sortSiblings = (list) => list.sort((a, b) => {
      if (a.spawnStepIndex !== null && b.spawnStepIndex !== null && a.spawnStepIndex !== b.spawnStepIndex) {
        return a.spawnStepIndex - b.spawnStepIndex;
      }
      return (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0);
    });
    sortSiblings(roots);
    const ordered = [];
    const visited = /* @__PURE__ */ new Set();
    const visit = (node) => {
      if (visited.has(node.cascadeId)) return;
      visited.add(node.cascadeId);
      ordered.push(node);
      const children = sortSiblings([...childrenByParent.get(node.cascadeId) ?? []]);
      for (const child of children) {
        visit(child);
      }
    };
    for (const root of roots) {
      visit(root);
    }
    for (const node of nodes) {
      visit(node);
    }
    return ordered;
  }
  return [...nodes].sort((a, b) => {
    const pa = PHASE_PRIORITY[a.phase] ?? 9;
    const pb = PHASE_PRIORITY[b.phase] ?? 9;
    if (pa !== pb) return pa - pb;
    if (activeCid) {
      if (a.cascadeId === activeCid && b.cascadeId !== activeCid) return -1;
      if (b.cascadeId === activeCid && a.cascadeId !== activeCid) return 1;
    }
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0);
  });
}
function modelCatalogFromFile(file) {
  if (!file) {
    return buildModelCatalog(null);
  }
  const modelsById = {};
  for (const entry of Object.values(file.modelsByEnum)) {
    if (entry?.modelId) {
      modelsById[entry.modelId] = entry;
    }
  }
  return {
    defaultModelEnum: file.defaultModelEnum ?? null,
    modelsByEnum: file.modelsByEnum,
    modelsById
  };
}
function resolveTargetCid(nodesById, explicitCid, envCid, snapshotActiveCid) {
  if (explicitCid) {
    return explicitCid;
  }
  if (envCid && (nodesById[envCid] || !snapshotActiveCid)) {
    return envCid;
  }
  if (snapshotActiveCid && nodesById[snapshotActiveCid]) {
    return snapshotActiveCid;
  }
  const allNodes = Object.values(nodesById);
  if (allNodes.length === 0) {
    return snapshotActiveCid ?? envCid ?? null;
  }
  const running = allNodes.filter(isNodeRunning2).sort((a, b) => (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0));
  if (running.length > 0) {
    return running[0].cascadeId;
  }
  const roots = allNodes.filter((n) => n.parentCascadeId === null).sort((a, b) => (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0));
  if (roots.length > 0) {
    return roots[0].cascadeId;
  }
  return allNodes.slice().sort((a, b) => (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0))[0].cascadeId;
}
async function fetchLiveFromLs(params) {
  const client = new ReadOnlyLsClient({
    address: params.address,
    csrfToken: params.csrfToken,
    timeoutMs: LIVE_LS_TIMEOUT_MS,
    fetchFn: params.fetchFn
  });
  if (!client.isConfigured()) {
    return null;
  }
  const warnings = [];
  const [modelRes, quotaRes, trajRes] = await Promise.allSettled([
    client.getCascadeModelConfigData(),
    client.retrieveUserQuotaSummary(),
    client.getAllCascadeTrajectories()
  ]);
  if (trajRes.status === "rejected") {
    return null;
  }
  const trajectories = trajRes.value.trajectorySummaries ?? {};
  const modelCatalog = modelRes.status === "fulfilled" ? buildModelCatalog(modelRes.value) : modelCatalogFromFile(params.modelMap);
  const entries = Object.entries(trajectories).sort(([, a], [, b]) => {
    const aRun = a.status === "CASCADE_RUN_STATUS_RUNNING" ? 1 : 0;
    const bRun = b.status === "CASCADE_RUN_STATUS_RUNNING" ? 1 : 0;
    if (bRun !== aRun) return bRun - aRun;
    return (parseIsoMs(b.lastModifiedTime) ?? 0) - (parseIsoMs(a.lastModifiedTime) ?? 0);
  });
  const metaTargets = /* @__PURE__ */ new Set();
  for (const preferred of params.preferredCids) {
    if (preferred && trajectories[preferred]) {
      metaTargets.add(preferred);
    }
  }
  const runningTargets = [];
  for (const [cid, summary] of entries) {
    if (summary.status === "CASCADE_RUN_STATUS_RUNNING") {
      metaTargets.add(cid);
      runningTargets.push({
        cid,
        stepCount: typeof summary.stepCount === "number" && Number.isFinite(summary.stepCount) ? summary.stepCount : 0
      });
    } else if (metaTargets.size < MAX_META_FETCH_CASCADES) {
      metaTargets.add(cid);
    }
  }
  const generatorMetadataByCascade = {};
  const stepsByCascade = {};
  await Promise.all([
    runWithConcurrency(Array.from(metaTargets), META_FETCH_CONCURRENCY, async (cid) => {
      try {
        const res = await client.getCascadeTrajectoryGeneratorMetadata(cid);
        generatorMetadataByCascade[cid] = res.generatorMetadata ?? [];
      } catch {
      }
    }),
    runWithConcurrency(runningTargets, META_FETCH_CONCURRENCY, async ({ cid, stepCount }) => {
      try {
        const res = await client.getCascadeTrajectorySteps(cid, stepCount);
        stepsByCascade[cid] = res.steps ?? [];
      } catch {
      }
    })
  ]);
  const nowIso = new Date(params.nowMs).toISOString();
  const normalizedQuota = quotaRes.status === "fulfilled" ? normalizeQuotaSummary(
    quotaRes.value,
    params.quotaCache,
    Object.keys(trajectories),
    nowIso
  ) : {
    quota: params.quotaCache?.quota ?? {
      fetchedAt: nowIso,
      buckets: [],
      gemini5h: null,
      geminiWeekly: null,
      thirdParty5h: null,
      thirdPartyWeekly: null,
      treeNetDelta5hPct: null,
      burnRate5hPctPerMin: null
    },
    cascadeBaselines: params.quotaCache?.cascadeBaselines ?? {}
  };
  const topology = buildTopologyGraph({
    antigravityDataDir: params.antigravityDataDir,
    trajectories,
    generatorMetadataByCascade,
    stepsByCascade,
    modelCatalog,
    quotaBaselines: normalizedQuota.cascadeBaselines,
    prevNodesByCascadeId: params.prevNodes,
    smartThresholds: params.config.smartThresholds,
    lsConnected: true,
    nowMs: params.nowMs,
    enableSqliteFallback: false
  });
  for (const w of topology.warnings) {
    warnings.push(w);
  }
  const fleetCore = buildFleetSnapshot({
    nowMs: params.nowMs,
    hostConnected: true,
    trajectories,
    nodesByCascadeId: topology.nodesByCascadeId,
    quota: normalizedQuota.quota,
    cascadeBaselines: normalizedQuota.cascadeBaselines
  });
  return {
    nodesById: topology.nodesByCascadeId,
    quota: normalizedQuota.quota,
    fleet: {
      etag: "live-cli",
      ...fleetCore
    },
    warnings
  };
}
async function loadCliTelemetry(options = {}) {
  if (options.conversationId !== void 0) {
    assertValidUuid(options.conversationId, "conversationId");
  }
  const nowMs = options.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const paths = getStatePaths(options.stateDir);
  const config = loadConfig(options.stateDir);
  const rawSnapshot = readJsonSafe(paths.liveSnapshot, null);
  const snapshot = isLiveSnapshotFile(rawSnapshot) ? rawSnapshot : null;
  const rawQuotaCache = readJsonSafe(paths.quotaCache, null);
  const quotaCache = isQuotaCacheFile(rawQuotaCache) ? rawQuotaCache : null;
  const rawModelMap = readJsonSafe(paths.modelMap, null);
  const modelMap = isModelMapFile(rawModelMap) ? rawModelMap : null;
  const snapshotUpdatedMs = parseIsoMs(snapshot?.updatedAt);
  const snapshotAgeMs = snapshotUpdatedMs !== null ? Math.max(0, nowMs - snapshotUpdatedMs) : null;
  const snapshotNeedsRefresh = snapshot === null || !snapshot.hostConnected || snapshotAgeMs === null || snapshotAgeMs > LIVE_LS_STALE_TRIGGER_MS;
  const lsAddress = (options.lsEnv?.address ?? process.env.ANTIGRAVITY_LS_ADDRESS ?? "").trim();
  const lsCsrf = (options.lsEnv?.csrfToken ?? process.env.ANTIGRAVITY_CSRF_TOKEN ?? "").trim();
  const envCidRaw = (options.lsEnv?.conversationId ?? process.env.ANTIGRAVITY_CONVERSATION_ID ?? "").trim();
  const validEnvCid = isValidUuid(envCidRaw) ? envCidRaw : null;
  const antigravityDataDir = options.lsEnv?.antigravityDataDir?.trim() || process.env.ANTIGRAVITY_DATA_DIR?.trim() || import_node_path3.default.join(import_node_os2.default.homedir(), ".gemini", "antigravity");
  const warnings = [];
  let liveResult = null;
  const shouldTryLiveLs = lsAddress.length > 0 && lsCsrf.length > 0 && (options.live === true || snapshotNeedsRefresh);
  if (shouldTryLiveLs) {
    try {
      const preferred = [
        options.conversationId ?? "",
        validEnvCid ?? "",
        snapshot?.activeConversationId ?? ""
      ].filter(Boolean);
      liveResult = await fetchLiveFromLs({
        address: lsAddress,
        csrfToken: lsCsrf,
        fetchFn: options.fetchFn,
        antigravityDataDir,
        config,
        modelMap,
        quotaCache,
        prevNodes: snapshot?.nodesByCascadeId ?? {},
        preferredCids: preferred,
        nowMs
      });
      if (!liveResult) {
        warnings.push("Live Language Server RPC unavailable; using cached state.");
      }
    } catch {
      liveResult = null;
      warnings.push("Live Language Server RPC failed; falling back to cached state.");
    }
  }
  let nodesById;
  let hostConnected;
  let stale;
  let staleAgeMs;
  let snapshotUpdatedAt;
  let source;
  let quota;
  let fleet;
  let fleetHeadline;
  if (liveResult) {
    nodesById = liveResult.nodesById;
    hostConnected = true;
    stale = false;
    staleAgeMs = 0;
    snapshotUpdatedAt = generatedAt;
    source = "live-ls";
    quota = liveResult.quota;
    fleet = liveResult.fleet;
    fleetHeadline = liveResult.fleet.activeHeadline;
    warnings.push(...liveResult.warnings);
  } else {
    nodesById = snapshot?.nodesByCascadeId ?? {};
    hostConnected = Boolean(snapshot?.hostConnected);
    staleAgeMs = snapshotAgeMs;
    stale = snapshot === null || !hostConnected || snapshotAgeMs === null || !Number.isFinite(snapshotAgeMs) || snapshotAgeMs > SNAPSHOT_STALE_THRESHOLD_MS;
    snapshotUpdatedAt = snapshot?.updatedAt ?? null;
    source = snapshot ? "snapshot" : quotaCache ? "cache-only" : "none";
    quota = snapshot?.quota ?? quotaCache?.quota ?? null;
    fleet = snapshot?.fleet ?? null;
    fleetHeadline = snapshot?.fleet?.activeHeadline ?? null;
  }
  const targetCid = resolveTargetCid(
    nodesById,
    options.conversationId,
    validEnvCid,
    snapshot?.activeConversationId
  );
  const activeNode = targetCid ? nodesById[targetCid] ?? null : null;
  if (options.conversationId && !activeNode && Object.keys(nodesById).length > 0) {
    warnings.push(`Conversation ${options.conversationId} was not found in telemetry.`);
  }
  const rootCascadeId = activeNode ? activeNode.rootCascadeId || activeNode.cascadeId : targetCid;
  const rawTreeNodes = activeNode && rootCascadeId ? Object.values(nodesById).filter(
    (n) => (n.rootCascadeId || n.cascadeId) === rootCascadeId
  ) : [];
  const treeNodes = sortTreeNodes(
    rawTreeNodes,
    config.hudSortMode,
    activeNode?.cascadeId ?? null
  );
  const breadcrumb = buildBreadcrumb(
    rootCascadeId,
    activeNode?.cascadeId ?? null,
    nodesById
  );
  const activeSubagentCount = treeNodes.filter(
    (n) => n.kind !== "root" && n.phase !== "IDLE" && n.phase !== "ERROR_OR_QUOTA"
  ).length;
  const gemini5hPct = quota?.gemini5h?.remainingPct ?? null;
  const smartGovernanceBanner = evaluateSmartGovernanceBanner(
    treeNodes,
    gemini5hPct,
    quota?.burnRate5hPctPerMin ?? null,
    config
  );
  if (snapshot === null && !liveResult) {
    if (!(0, import_node_fs3.existsSync)(paths.stateDir)) {
      warnings.push(`State directory does not exist yet: ${paths.stateDir}`);
    } else {
      warnings.push(`No live-snapshot.json found in ${paths.stateDir}`);
    }
  } else if (stale && !liveResult) {
    warnings.push(
      staleAgeMs !== null ? `Cached telemetry is stale (${Math.round(staleAgeMs / 1e3)}s old)` : "Host is disconnected; displaying cached telemetry"
    );
  }
  let statusClass;
  if (!hostConnected || stale) {
    statusClass = "disconnected";
  } else if (gemini5hPct !== null && gemini5hPct < 15 || activeNode?.phase === "ERROR_OR_QUOTA" || activeNode?.routingStatus === "retrying" || activeNode?.routingStatus === "mismatch_or_fallback" || activeNode?.contextWindow.level === "critical_85") {
    statusClass = "alert";
  } else if (gemini5hPct !== null && gemini5hPct < 25 || activeNode?.contextWindow.level === "warn_70" || activeNode?.phase === "BLOCKED_APPROVAL" || smartGovernanceBanner.active) {
    statusClass = "warning";
  } else if (activeNode !== null && activeNode.phase !== "IDLE" || activeSubagentCount > 0) {
    statusClass = "active";
  } else {
    statusClass = "idle";
  }
  return {
    generatedAt,
    stateDir: paths.stateDir,
    source,
    snapshotUpdatedAt,
    hostConnected,
    stale,
    staleAgeMs,
    statusClass,
    activeConversationId: activeNode?.cascadeId ?? targetCid,
    rootCascadeId,
    breadcrumb,
    activeNode,
    treeNodes,
    activeSubagentCount,
    fleetHeadline,
    fleet,
    quota,
    smartGovernanceBanner,
    config,
    warnings
  };
}

// src/cli/status-formatter.ts
var VALID_FORMATS = /* @__PURE__ */ new Set(["waybar", "tmux", "json", "text"]);
var WATCHED_FILES = /* @__PURE__ */ new Set([
  "live-snapshot.json",
  "quota-cache.json",
  "config.json",
  "model-map.json"
]);
var WATCH_DEBOUNCE_MS = 50;
var MIN_WATCH_INTERVAL_MS = 200;
var TMUX_TIER_COLOR = {
  apex: "#8b7ec8",
  workhorse: "#4385be",
  fast: "#3aa99f",
  orchestrator: "#d0a215",
  alert: "#d14d41"
};
function sanitizeSingleLine(raw) {
  return raw.replace(/[\r\n]+/g, " ").trim();
}
function sanitizeTmuxText(raw) {
  return sanitizeSingleLine(raw).replace(/[#[\]]/g, "");
}
function formatWaybarText(view) {
  const pct5h = view.quota?.gemini5h ? Math.round(view.quota.gemini5h.remainingPct) : null;
  if (view.statusClass === "disconnected") {
    return pct5h !== null ? `\u26A0 Pulse: Offline \xB7 ${pct5h}%` : "\u26A0 Pulse: Offline";
  }
  const node = view.activeNode;
  if (!node) {
    return pct5h !== null ? `\u26AA Pulse: Ready \xB7 ${pct5h}%` : "\u26AA Pulse: Ready";
  }
  const shortModel = sanitizeSingleLine(compactModelLabel(node.servedModel));
  const sub = view.activeSubagentCount > 0 ? ` +${view.activeSubagentCount} sub` : "";
  const pctSuffix = pct5h !== null ? ` \xB7 ${pct5h}%` : "";
  if (node.retryCount > 0 || node.routingStatus === "retrying") {
    return `\u26A0 Retry \xD7${Math.max(1, node.retryCount)} \xB7 ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === "ERROR_OR_QUOTA") {
    return `\u26A0 Error \xB7 ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.routingStatus === "mismatch_or_fallback") {
    return `\u26A0 Fallback \xB7 ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === "BLOCKED_APPROVAL") {
    return `\u23F8\uFE0F Blocked \xB7 ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === "TOOL_RUNNING") {
    const toolName = sanitizeSingleLine(node.lastTool?.name || "tool");
    return `\u{1F527} Tool: ${toolName} \xB7 ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === "STREAMING") {
    return `\u26A1 ${shortModel}${sub}${pctSuffix}`;
  }
  if (node.phase === "THINKING" || node.phase === "PRE_FLIGHT") {
    return `\u{1F9E0} ${shortModel}${sub}${pctSuffix}`;
  }
  return `\u26AA ${shortModel}${sub}${pctSuffix}`;
}
function formatStatusWaybar(view) {
  const rawPct = view.quota?.gemini5h?.remainingPct;
  const percentage = typeof rawPct === "number" && Number.isFinite(rawPct) ? Math.max(0, Math.min(100, Math.round(rawPct))) : 0;
  const lines = [];
  const node = view.activeNode;
  if (node) {
    lines.push(
      `${sanitizeSingleLine(node.title)} | ${sanitizeSingleLine(node.requestedModel.displayName)} \u2794 ${sanitizeSingleLine(node.servedModel.displayName)} (${node.servedModel.effortTier})`
    );
    const phaseParts = [`Phase: ${node.phase}`];
    if (node.phaseElapsedMs > 0 && node.phase !== "IDLE") {
      phaseParts.push(formatDurationCompact(node.phaseElapsedMs));
    }
    if (node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec)) {
      phaseParts.push(`${node.streamingTokPerSec.toFixed(1)} tok/s`);
    }
    if (node.lastTool) {
      const summary = node.lastTool.summary ? ` (${sanitizeSingleLine(node.lastTool.summary)})` : "";
      phaseParts.push(`Tool: ${sanitizeSingleLine(node.lastTool.name)}${summary}`);
    }
    lines.push(phaseParts.join(" \xB7 "));
    const ctxUsed = formatTokensCompact(node.contextWindow.estimatedTokensUsed);
    const ctxMax = node.contextWindow.maxContextTokens > 0 ? formatTokensCompact(node.contextWindow.maxContextTokens) : "\u2014";
    const ctxPct = node.contextWindow.maxContextTokens > 0 ? formatPct(node.contextWindow.pct, 1) : "\u2014";
    lines.push(
      `CTX: ${ctxUsed}/${ctxMax} (${ctxPct}) | Cache Hit: ${formatPct(node.cacheHitPct, 1)}`
    );
    const subnodes = view.treeNodes.filter((n) => n.cascadeId !== node.cascadeId && n.kind !== "root");
    if (subnodes.length > 0) {
      lines.push("Subagents:");
      for (const sub of subnodes.slice(0, 6)) {
        const label = sanitizeSingleLine(sub.role || sub.title);
        lines.push(`  - ${label} | ${sanitizeSingleLine(sub.servedModel.displayName)} | ${sub.phase}`);
      }
    }
  } else {
    lines.push(`Model Pulse: No active conversation (${view.stateDir})`);
  }
  const g5h = view.quota?.gemini5h;
  const gWk = view.quota?.geminiWeekly;
  const tp5h = view.quota?.thirdParty5h;
  lines.push(
    `Gemini 5h: ${formatPct(g5h?.remainingPct, 1)} (reset ${g5h?.resetInLabel ?? "\u2014"}) | Weekly: ${formatPct(gWk?.remainingPct, 1)} | 3P 5h: ${formatPct(tp5h?.remainingPct, 1)}`
  );
  if (view.stale || !view.hostConnected) {
    const ageLabel = view.staleAgeMs !== null ? `${formatDurationCompact(view.staleAgeMs)} ago` : "no live snapshot";
    lines.push(`Stale: ${ageLabel}${view.snapshotUpdatedAt ? ` (${view.snapshotUpdatedAt})` : ""}`);
  }
  return {
    text: formatWaybarText(view),
    tooltip: lines.join("\n"),
    class: view.statusClass,
    percentage
  };
}
function formatStatusTmux(view) {
  if (view.statusClass === "disconnected") {
    return "#[fg=#878580]Pulse: offline#[default]";
  }
  const node = view.activeNode;
  const g5h = view.quota?.gemini5h;
  const quotaStr = g5h ? `5h:${Math.round(g5h.remainingPct)}%` : "5h:\u2014";
  if (!node) {
    return `#[fg=#878580]\u26AA Pulse: idle#[default] #[fg=#cecdc3]${quotaStr}#[default]`;
  }
  let icon = "\u26AA";
  switch (node.phase) {
    case "PRE_FLIGHT":
    case "THINKING":
      icon = "\u{1F9E0}";
      break;
    case "STREAMING":
      icon = "\u26A1";
      break;
    case "TOOL_RUNNING":
      icon = "\u{1F527}";
      break;
    case "BLOCKED_APPROVAL":
      icon = "\u23F8\uFE0F";
      break;
    case "ERROR_OR_QUOTA":
      icon = "\u26A0";
      break;
    case "IDLE":
    default:
      icon = "\u26AA";
      break;
  }
  const tierColor = TMUX_TIER_COLOR[node.servedModel.tier] ?? "#4385be";
  const shortModel = sanitizeTmuxText(compactModelLabel(node.servedModel));
  const parts = [`#[fg=${tierColor},bold]${icon} ${shortModel}#[default]`];
  if (view.activeSubagentCount > 0) {
    parts.push(`#[fg=#3aa99f]+${view.activeSubagentCount}sub#[default]`);
  }
  if (view.statusClass === "alert") {
    const alertLabel = node.retryCount > 0 ? `\u26A0Retry\xD7${node.retryCount}` : node.routingStatus === "mismatch_or_fallback" ? "\u26A0Fallback" : node.phase === "ERROR_OR_QUOTA" ? "\u26A0Error" : node.contextWindow.level === "critical_85" ? `\u26A0CTX:${Math.round(node.contextWindow.pct)}%` : `\u26A0${quotaStr}`;
    parts.push(`#[fg=#d14d41,bold]${alertLabel}#[default]`);
    if (!alertLabel.includes("5h:")) {
      parts.push(`#[fg=#cecdc3]${quotaStr}#[default]`);
    }
  } else if (view.statusClass === "warning") {
    const warnLabel = node.phase === "BLOCKED_APPROVAL" ? "\u23F8Blocked" : node.contextWindow.level === "warn_70" ? `CTX:${Math.round(node.contextWindow.pct)}%` : quotaStr;
    parts.push(`#[fg=#d0a215,bold]${warnLabel}#[default]`);
    if (!warnLabel.includes("5h:")) {
      parts.push(`#[fg=#cecdc3]${quotaStr}#[default]`);
    }
  } else if (view.statusClass === "idle") {
    parts.push(`#[fg=#878580]${quotaStr}#[default]`);
  } else {
    parts.push(`#[fg=#cecdc3]${quotaStr}#[default]`);
  }
  return parts.join(" ");
}
function buildStatusJsonPayload(view) {
  return {
    schemaVersion: 1,
    generatedAt: view.generatedAt,
    hostConnected: view.hostConnected,
    stale: view.stale,
    staleAgeMs: view.staleAgeMs,
    statusClass: view.statusClass,
    activeConversationId: view.activeConversationId,
    activeNode: view.activeNode,
    activeSubagentCount: view.activeSubagentCount,
    treeNodes: view.treeNodes,
    fleetHeadline: view.fleetHeadline,
    quota: view.quota,
    warnings: view.warnings
  };
}
function formatStatusJson(view, pretty = true) {
  const payload = buildStatusJsonPayload(view);
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}
function formatStatusText(view) {
  const g5h = view.quota?.gemini5h;
  if (view.statusClass === "disconnected") {
    const age = view.staleAgeMs !== null ? ` (stale ${formatDurationCompact(view.staleAgeMs)})` : "";
    const cached = g5h ? ` | Cached Gemini 5h: ${formatPct(g5h.remainingPct, 1)} (${g5h.resetInLabel})` : "";
    return `[Model Pulse] OFFLINE${age}${cached}`;
  }
  const node = view.activeNode;
  if (!node) {
    const quotaText2 = g5h ? `Gemini 5h: ${formatPct(g5h.remainingPct, 1)} (${g5h.resetInLabel})` : "Gemini 5h: \u2014";
    return `[Model Pulse] IDLE | No active conversation | ${quotaText2}`;
  }
  let phaseLabel = node.phase;
  if (node.phase === "STREAMING" && node.streamingTokPerSec !== null) {
    phaseLabel = `${node.phase} ${node.streamingTokPerSec.toFixed(1)}t/s`;
  } else if (node.phase !== "IDLE" && node.phase !== "ERROR_OR_QUOTA" && node.phaseElapsedMs > 0) {
    phaseLabel = `${node.phase} ${formatDurationCompact(node.phaseElapsedMs)}`;
  }
  const modelIdTag = node.servedModel.responseModel || node.servedModel.modelEnum;
  const ctxText = node.contextWindow.maxContextTokens > 0 ? formatPct(node.contextWindow.pct, 1) : "\u2014";
  const quotaText = g5h ? `${formatPct(g5h.remainingPct, 1)} (${g5h.resetInLabel})` : "\u2014";
  return `[Model Pulse] ${phaseLabel} | ${sanitizeSingleLine(node.servedModel.displayName)} [${sanitizeSingleLine(modelIdTag)}] | Subagents: ${view.activeSubagentCount} active | CTX ${ctxText} | Cache ${formatPct(node.cacheHitPct, 1)} | Gemini 5h: ${quotaText}`;
}
function formatStatusOutput(view, format, options = {}) {
  switch (format) {
    case "waybar":
      return JSON.stringify(formatStatusWaybar(view));
    case "tmux":
      return formatStatusTmux(view);
    case "json":
      return formatStatusJson(view, !options.watch);
    case "text":
    default:
      return formatStatusText(view);
  }
}
function buildWatchDedupSignature(view, formatted, format) {
  if (format !== "json") {
    return formatted;
  }
  const payload = buildStatusJsonPayload(view);
  return JSON.stringify({
    ...payload,
    generatedAt: "",
    staleAgeMs: payload.stale ? "stale" : "fresh"
  });
}
function parseStatusArgs(args) {
  const opts = {
    format: "text",
    watch: false,
    intervalMs: 1e3,
    live: false
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--watch" || arg === "-w") {
      opts.watch = true;
      continue;
    }
    if (arg === "--live") {
      opts.live = true;
      continue;
    }
    if (arg === "--format" || arg.startsWith("--format=")) {
      const val = arg === "--format" ? args[++i] : arg.slice("--format=".length);
      if (!val || !VALID_FORMATS.has(val)) {
        throw new Error(`Invalid --format "${val ?? ""}". Expected waybar | tmux | json | text.`);
      }
      opts.format = val;
      continue;
    }
    if (arg === "--interval" || arg.startsWith("--interval=")) {
      const raw = arg === "--interval" ? args[++i] : arg.slice("--interval=".length);
      const parsed = Number(raw);
      if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --interval "${raw ?? ""}". Expected positive milliseconds.`);
      }
      opts.intervalMs = Math.max(MIN_WATCH_INTERVAL_MS, Math.trunc(parsed));
      continue;
    }
    if (arg === "--conversation" || arg.startsWith("--conversation=")) {
      const cid = arg === "--conversation" ? args[++i] : arg.slice("--conversation=".length);
      if (!cid || !isValidUuid(cid)) {
        throw new Error(`Invalid --conversation "${cid ?? ""}". Expected 36-character UUID.`);
      }
      opts.conversationId = cid;
      continue;
    }
    if (arg === "--state-dir" || arg.startsWith("--state-dir=")) {
      const dir = arg === "--state-dir" ? args[++i] : arg.slice("--state-dir=".length);
      if (!dir) {
        throw new Error("Missing path after --state-dir.");
      }
      opts.stateDir = dir;
      continue;
    }
    throw new Error(`Unknown status option: ${arg}`);
  }
  return opts;
}
function getStatusHelpText() {
  return [
    "Usage: agy-pulse status [options]",
    "",
    "Options:",
    "  --format <waybar|tmux|json|text>  Output format (default: text)",
    "  --watch                           Stream deduplicated updates on state changes",
    "  --interval <ms>                   Poll fallback interval in ms (default: 1000, min: 200)",
    "  --conversation <uuid>             Target conversation UUID",
    "  --live                            Force live read-only LS RPC refresh if env vars exist",
    "  -h, --help                        Show this help message",
    ""
  ].join("\n");
}
async function runStatusCommand(args, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  let opts;
  try {
    opts = parseStatusArgs(args);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}
`);
    stderr.write(getStatusHelpText());
    return 2;
  }
  if (opts.help) {
    stdout.write(getStatusHelpText());
    return 0;
  }
  const effectiveStateDir = opts.stateDir ?? io.stateDir;
  const loadOnce = () => loadCliTelemetry({
    conversationId: opts.conversationId,
    live: opts.live,
    stateDir: effectiveStateDir,
    lsEnv: io.lsEnv,
    fetchFn: io.fetchFn
  });
  if (!opts.watch) {
    const view = await loadOnce();
    const out = formatStatusOutput(view, opts.format, { watch: false });
    stdout.write(`${out}
`);
    return 0;
  }
  const paths = getStatePaths(effectiveStateDir);
  let lastEmittedSig = null;
  let closed = false;
  let watcher = null;
  let pollTimer = null;
  let debounceTimer = null;
  let inFlight = false;
  let pendingRefresh = false;
  const emitIfChanged = async () => {
    if (closed) return;
    if (inFlight) {
      pendingRefresh = true;
      return;
    }
    inFlight = true;
    try {
      const view = await loadOnce();
      if (closed) return;
      const line = formatStatusOutput(view, opts.format, { watch: true });
      const sig = buildWatchDedupSignature(view, line, opts.format);
      if (sig !== lastEmittedSig) {
        lastEmittedSig = sig;
        stdout.write(`${line}
`);
      }
      if (!watcher && (0, import_node_fs4.existsSync)(paths.stateDir)) {
        attachWatcher();
      }
    } catch {
    } finally {
      inFlight = false;
      if (pendingRefresh && !closed) {
        pendingRefresh = false;
        void emitIfChanged();
      }
    }
  };
  let onFinish = null;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
      }
      watcher = null;
    }
    if (io.registerProcessSignals !== false) {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    }
    io.signal?.removeEventListener("abort", handleSignal);
    stdout.off("error", handleStdoutError);
    onFinish?.();
  };
  const handleSignal = () => {
    cleanup();
  };
  const handleStdoutError = (err) => {
    if (err.code === "EPIPE") {
      cleanup();
    }
  };
  const scheduleDebouncedEmit = () => {
    if (closed) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void emitIfChanged();
    }, WATCH_DEBOUNCE_MS);
  };
  const attachWatcher = () => {
    if (closed || watcher || !(0, import_node_fs4.existsSync)(paths.stateDir)) {
      return;
    }
    try {
      watcher = (0, import_node_fs4.watch)(paths.stateDir, { persistent: true }, (_eventType, filename) => {
        const name = filename ? String(filename) : "";
        if (name && !WATCHED_FILES.has(name)) {
          return;
        }
        scheduleDebouncedEmit();
      });
      watcher.on("error", () => {
        try {
          watcher?.close();
        } catch {
        }
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  };
  if (io.signal?.aborted) {
    return 0;
  }
  await emitIfChanged();
  attachWatcher();
  return await new Promise((resolve2) => {
    onFinish = () => resolve2(0);
    pollTimer = setInterval(() => {
      void emitIfChanged();
    }, opts.intervalMs);
    if (io.registerProcessSignals !== false) {
      process.on("SIGINT", handleSignal);
      process.on("SIGTERM", handleSignal);
    }
    io.signal?.addEventListener("abort", handleSignal, { once: true });
    stdout.on("error", handleStdoutError);
  });
}

// src/cli/top-tui.ts
var MIN_TOP_INTERVAL_MS = 250;
var ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;
var ANSI = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  purple: "\x1B[35m",
  cyan: "\x1B[36m",
  gray: "\x1B[90m"
};
var TIER_ANSI = {
  apex: ANSI.purple,
  workhorse: ANSI.blue,
  fast: ANSI.cyan,
  orchestrator: ANSI.yellow,
  alert: ANSI.red
};
function stripAnsi(input) {
  return input.replace(ANSI_ESCAPE_RE, "");
}
function codePointDisplayWidth(cp) {
  if (cp < 32 || cp >= 127 && cp <= 159 || cp >= 768 && cp <= 879 || cp >= 6832 && cp <= 6911 || cp >= 7616 && cp <= 7679 || cp >= 8400 && cp <= 8447 || cp >= 65024 && cp <= 65039 || cp >= 65056 && cp <= 65071 || cp >= 8203 && cp <= 8207 || cp === 65279) {
    return 0;
  }
  if (cp >= 4352 && cp <= 4447 || cp === 9001 || cp === 9002 || cp >= 11904 && cp <= 12350 || cp >= 12352 && cp <= 13311 || cp >= 13312 && cp <= 19903 || cp >= 19968 && cp <= 42191 || cp >= 43360 && cp <= 43388 || cp >= 44032 && cp <= 55203 || cp >= 63744 && cp <= 64255 || cp >= 65040 && cp <= 65049 || cp >= 65072 && cp <= 65135 || cp >= 65281 && cp <= 65376 || cp >= 65504 && cp <= 65510 || cp >= 127744 && cp <= 129791) {
    return 2;
  }
  return 1;
}
function displayWidth(str) {
  let width = 0;
  for (const ch of stripAnsi(str)) {
    const cp = ch.codePointAt(0);
    if (cp !== void 0) {
      width += codePointDisplayWidth(cp);
    }
  }
  return width;
}
function visibleLength(input) {
  return displayWidth(input);
}
function truncatePlain(input, maxCols) {
  if (maxCols <= 0) return "";
  const clean = input.replace(/[\r\n]+/g, " ");
  if (displayWidth(clean) <= maxCols) return clean;
  if (maxCols === 1) return "\u2026";
  const limit = maxCols - 1;
  let usedCols = 0;
  let out = "";
  for (const ch of clean) {
    const cp = ch.codePointAt(0);
    if (cp === void 0) continue;
    const chWidth = codePointDisplayWidth(cp);
    if (chWidth > 0 && usedCols + chWidth > limit) {
      break;
    }
    out += ch;
    usedCols += chWidth;
  }
  return `${out}\u2026`;
}
function truncateAnsi(input, maxCols) {
  if (maxCols <= 0) return "";
  const clean = input.replace(/[\r\n]+/g, " ");
  if (visibleLength(clean) <= maxCols) return clean;
  const hasAnsi = stripAnsi(clean) !== clean;
  if (maxCols === 1) {
    return hasAnsi ? `\u2026${ANSI.reset}` : "\u2026";
  }
  const limit = maxCols - 1;
  const sgrPattern = /\x1b\[[0-9;]*m/g;
  let usedCols = 0;
  let out = "";
  let lastIndex = 0;
  let truncated = false;
  const appendPlainSlice = (segment) => {
    for (const ch of segment) {
      const cp = ch.codePointAt(0);
      if (cp === void 0) continue;
      const chWidth = codePointDisplayWidth(cp);
      if (chWidth > 0 && usedCols + chWidth > limit) {
        return false;
      }
      out += ch;
      usedCols += chWidth;
    }
    return true;
  };
  for (const match of clean.matchAll(sgrPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      if (!appendPlainSlice(clean.slice(lastIndex, matchIndex))) {
        truncated = true;
        break;
      }
    }
    out += match[0];
    lastIndex = matchIndex + match[0].length;
  }
  if (!truncated && lastIndex < clean.length) {
    if (!appendPlainSlice(clean.slice(lastIndex))) {
      truncated = true;
    }
  }
  if (!truncated) {
    return clean;
  }
  return hasAnsi ? `${out}\u2026${ANSI.reset}` : `${out}\u2026`;
}
function parsePositiveEnvInt(raw) {
  if (!raw) return void 0;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return void 0;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : void 0;
}
function padRightVisible(input, width) {
  const truncated = truncateAnsi(input, width);
  const pad = Math.max(0, width - visibleLength(truncated));
  return `${truncated}${" ".repeat(pad)}`;
}
function padLeftVisible(input, width) {
  const truncated = truncateAnsi(input, width);
  const pad = Math.max(0, width - visibleLength(truncated));
  return `${" ".repeat(pad)}${truncated}`;
}
function paint(text, code, noColor) {
  if (noColor || !code) return text;
  return `${code}${text}${ANSI.reset}`;
}
function renderBar(pct, barWidth, noColor, tone = "normal") {
  const safePct = typeof pct === "number" && Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const filled = pct === null || pct === void 0 || !Number.isFinite(pct) ? 0 : Math.round(safePct / 100 * barWidth);
  const empty = Math.max(0, barWidth - filled);
  const rawBar = `${"\u2588".repeat(filled)}${"\u2591".repeat(empty)}`;
  const color = tone === "alert" ? ANSI.red : tone === "warn" ? ANSI.yellow : ANSI.cyan;
  return `[${paint(rawBar, color, noColor)}]`;
}
function formatCompactPhase(node) {
  const dur = node.phaseElapsedMs > 0 ? formatDurationCompact(node.phaseElapsedMs) : "";
  switch (node.phase) {
    case "THINKING":
      return { plain: dur ? `THINK ${dur}` : "THINK", color: ANSI.purple };
    case "STREAMING": {
      const rate = node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec) ? `${node.streamingTokPerSec.toFixed(0)}t/s` : dur;
      return { plain: rate ? `STRM ${rate}` : "STRM", color: ANSI.cyan };
    }
    case "TOOL_RUNNING":
      return { plain: dur ? `TOOL ${dur}` : "TOOL", color: ANSI.blue };
    case "BLOCKED_APPROVAL":
      return { plain: dur ? `WAIT ${dur}` : "WAIT", color: ANSI.yellow };
    case "PRE_FLIGHT":
      return { plain: dur ? `PREP ${dur}` : "PREP", color: ANSI.yellow };
    case "ERROR_OR_QUOTA":
      return { plain: "ERR", color: ANSI.red };
    case "IDLE":
    default:
      return { plain: "IDLE", color: ANSI.gray };
  }
}
function formatTierTag(tier) {
  switch (tier) {
    case "apex":
      return "APEX";
    case "workhorse":
      return "WORK";
    case "fast":
      return "FAST";
    case "orchestrator":
      return "AUTO";
    case "alert":
      return "ALRT";
    default:
      return "MODL";
  }
}
function buildEmptyStateLines(stateDir, columns, bodyRows, noColor) {
  const innerWidth = Math.min(columns - 4, 72);
  const msg1 = truncatePlain(
    `No active Antigravity telemetry snapshot found in ${stateDir}.`,
    innerWidth - 4
  );
  const msg2 = truncatePlain(
    "Open Model Pulse sidecar or start a conversation.",
    innerWidth - 4
  );
  const topBorder = `\u250C${"\u2500".repeat(innerWidth - 2)}\u2510`;
  const bottomBorder = `\u2514${"\u2500".repeat(innerWidth - 2)}\u2518`;
  const line1 = `\u2502 ${padRightVisible(msg1, innerWidth - 4)} \u2502`;
  const line2 = `\u2502 ${padRightVisible(msg2, innerWidth - 4)} \u2502`;
  const boxLines = [topBorder, line1, line2, bottomBorder].map((l) => {
    const leftPad = Math.max(0, Math.floor((columns - innerWidth) / 2));
    return `${" ".repeat(leftPad)}${paint(l, ANSI.gray, noColor)}`;
  });
  const out = [];
  const topSpace = Math.max(0, Math.floor((bodyRows - boxLines.length) / 2));
  for (let i = 0; i < topSpace; i += 1) {
    out.push("");
  }
  out.push(...boxLines);
  while (out.length < bodyRows) {
    out.push("");
  }
  return out.slice(0, bodyRows);
}
function renderTopFrame(view, opts = {}) {
  const columns = Math.max(
    60,
    Math.floor(
      opts.columns ?? process.stdout.columns ?? parsePositiveEnvInt(process.env.COLUMNS) ?? 100
    )
  );
  const rows = Math.max(
    16,
    Math.floor(
      opts.rows ?? process.stdout.rows ?? parsePositiveEnvInt(process.env.LINES) ?? 24
    )
  );
  const noColor = opts.noColor ?? Boolean(process.env.NO_COLOR);
  const sortMode = opts.sortMode ?? view.config.hudSortMode;
  const barWidth = columns >= 100 ? 14 : 10;
  const timeTag = view.generatedAt.includes("T") ? view.generatedAt.slice(11, 19) + "Z" : view.generatedAt;
  let statusBadge;
  if (!view.hostConnected) {
    statusBadge = paint("[OFFLINE]", `${ANSI.bold}${ANSI.red}`, noColor);
  } else if (view.stale) {
    const age = view.staleAgeMs !== null ? ` ${formatDurationCompact(view.staleAgeMs)}` : "";
    statusBadge = paint(`[STALE${age}]`, `${ANSI.bold}${ANSI.yellow}`, noColor);
  } else {
    statusBadge = paint("[LIVE]", `${ANSI.bold}${ANSI.green}`, noColor);
  }
  const titlePart = paint("Model Pulse \u2014 agy-pulse top", ANSI.bold, noColor);
  const headerLine = truncateAnsi(
    `${titlePart}  ${statusBadge}  ${paint(timeTag, ANSI.gray, noColor)}`,
    columns
  );
  let focusLine;
  if (view.activeNode) {
    const node = view.activeNode;
    const breadcrumbPlain = view.breadcrumb.length > 0 ? view.breadcrumb.map((b) => b.role || b.title).filter(Boolean).join(" \u203A ") : node.title;
    const reqName = node.requestedModel.displayName || node.requestedModel.raw;
    const srvName = node.servedModel.displayName || node.servedModel.responseModel;
    const routeText = reqName && reqName !== srvName ? `${reqName} \u2794 ${srvName}` : srvName;
    const tierColor = TIER_ANSI[node.servedModel.tier] ?? ANSI.blue;
    const modelBadge = paint(
      `${routeText} [${node.servedModel.effortTier.toUpperCase()}]`,
      `${ANSI.bold}${tierColor}`,
      noColor
    );
    const retryTag = node.retryCount > 0 ? ` ${paint(`[Retry \xD7${node.retryCount}]`, `${ANSI.bold}${ANSI.red}`, noColor)}` : node.routingStatus === "mismatch_or_fallback" ? ` ${paint("[Fallback]", `${ANSI.bold}${ANSI.red}`, noColor)}` : "";
    const maxCrumb = Math.max(16, Math.floor(columns * 0.35));
    focusLine = truncateAnsi(
      `Focus: ${truncatePlain(breadcrumbPlain, maxCrumb)} | ${modelBadge}${retryTag}`,
      columns
    );
  } else {
    focusLine = truncateAnsi(
      `Focus: ${paint(`No active conversation (${view.stateDir})`, ANSI.gray, noColor)}`,
      columns
    );
  }
  const g5h = view.quota?.gemini5h;
  const gWk = view.quota?.geminiWeekly;
  const tp5h = view.quota?.thirdParty5h;
  const g5hPct = g5h?.remainingPct ?? null;
  const g5hTone = g5hPct !== null && g5hPct < 15 ? "alert" : g5hPct !== null && g5hPct < 25 ? "warn" : "normal";
  const g5hLine = truncateAnsi(
    `Gemini 5h: ${renderBar(g5hPct, barWidth, noColor, g5hTone)} ${formatPct(g5hPct, 1)} (reset ${g5h?.resetInLabel ?? "\u2014"})  \u0394Tree ${formatDeltaQuotaPct(view.quota?.treeNetDelta5hPct)}`,
    columns
  );
  const gWkPct = gWk?.remainingPct ?? null;
  const tp5hPct = tp5h?.remainingPct ?? null;
  const wkLine = truncateAnsi(
    `Gemini Wk: ${renderBar(gWkPct, barWidth, noColor)} ${formatPct(gWkPct, 1)}  |  3P 5h: ${renderBar(tp5hPct, barWidth, noColor)} ${formatPct(tp5hPct, 1)}`,
    columns
  );
  const activeCtx = view.activeNode?.contextWindow;
  const ctxTone = activeCtx?.level === "critical_85" ? "alert" : activeCtx?.level === "warn_70" ? "warn" : "normal";
  const ctxPct = activeCtx && activeCtx.maxContextTokens > 0 ? activeCtx.pct : null;
  const ctxDetail = activeCtx ? activeCtx.maxContextTokens > 0 ? ` (${formatTokensCompact(activeCtx.estimatedTokensUsed)}/${formatTokensCompact(activeCtx.maxContextTokens)})` : ` (${formatTokensCompact(activeCtx.estimatedTokensUsed)}/\u2014)` : "";
  const cacheText = view.activeNode ? formatPct(view.activeNode.cacheHitPct, 1) : "\u2014";
  const ctxLine = truncateAnsi(
    `Context  : ${renderBar(ctxPct, barWidth, noColor, ctxTone)} ${formatPct(ctxPct, 1)}${ctxDetail}  |  Cache Hit: ${cacheText}`,
    columns
  );
  const chromeTop = [headerLine, focusLine, g5hLine, wkLine, ctxLine];
  if (view.smartGovernanceBanner.active) {
    const bannerMsg = `\u26A1 SMART GOVERNANCE: ${view.smartGovernanceBanner.heavyConcurrentCount} Apex active @ ${formatPct(view.smartGovernanceBanner.gemini5hRemainingPct, 1)} 5h \u2014 consider Argon/Flash for exploration subagents`;
    chromeTop.push(
      paint(truncatePlain(bannerMsg, columns), `${ANSI.bold}${ANSI.yellow}`, noColor)
    );
  }
  const sep = paint("\u2500".repeat(columns), ANSI.gray, noColor);
  chromeTop.push(sep);
  const phaseW = 10;
  const ctxW = 5;
  const cacheW = 6;
  const deltaW = 7;
  const remainingW = Math.max(36, columns - (phaseW + ctxW + cacheW + deltaW + 6));
  const nodeW = Math.max(14, Math.floor(remainingW * 0.3));
  const modelW = Math.max(18, Math.floor(remainingW * 0.42));
  const toolW = Math.max(10, remainingW - nodeW - modelW);
  const tableHeader = paint(
    [
      padRightVisible("PHASE", phaseW),
      padRightVisible("NODE / ROLE", nodeW),
      padRightVisible("SERVED MODEL [TIER]", modelW),
      padLeftVisible("CTX%", ctxW),
      padLeftVisible("CACHE%", cacheW),
      padLeftVisible("\u0394QUOTA", deltaW),
      padRightVisible("LAST TOOL / ACTION", toolW)
    ].join(" "),
    ANSI.bold,
    noColor
  );
  chromeTop.push(tableHeader);
  const sortedNodes = sortTreeNodes(
    view.treeNodes,
    sortMode,
    view.activeNode?.cascadeId ?? null
  );
  const footerChromeCount = 2;
  const bodyRows = Math.max(3, rows - chromeTop.length - footerChromeCount);
  const maxOffset = Math.max(0, sortedNodes.length - bodyRows);
  const clampedOffset = Math.min(Math.max(0, Math.floor(opts.scrollOffset ?? 0)), maxOffset);
  let bodyLines;
  if (sortedNodes.length === 0) {
    bodyLines = buildEmptyStateLines(view.stateDir, columns, bodyRows, noColor);
  } else {
    const visibleSlice = sortedNodes.slice(clampedOffset, clampedOffset + bodyRows);
    bodyLines = visibleSlice.map((node) => {
      const isFocused = view.activeNode?.cascadeId === node.cascadeId;
      const phaseInfo = formatCompactPhase(node);
      const phaseCell = padRightVisible(
        paint(truncatePlain(phaseInfo.plain, phaseW), phaseInfo.color, noColor),
        phaseW
      );
      const indent = sortMode === "topology-tree" && node.depth > 0 ? `${" ".repeat(Math.min(node.depth, 3) * 2)}\u2514 ` : "";
      const focusMarker = isFocused ? "\u25B8 " : "  ";
      const rawLabel = node.role || node.title || node.cascadeId.slice(0, 8);
      const nodePlain = `${focusMarker}${indent}${rawLabel}`;
      const nodeCell = padRightVisible(
        isFocused ? paint(truncatePlain(nodePlain, nodeW), ANSI.bold, noColor) : truncatePlain(nodePlain, nodeW),
        nodeW
      );
      const tierTag = formatTierTag(node.servedModel.tier);
      const modelDisplay = modelW >= 28 ? node.servedModel.displayName : compactModelLabel(node.servedModel);
      const modelPlain = `${modelDisplay} [${tierTag}]`;
      const modelColor = node.retryCount > 0 || node.routingStatus === "mismatch_or_fallback" ? ANSI.red : TIER_ANSI[node.servedModel.tier] ?? ANSI.blue;
      const modelCell = padRightVisible(
        paint(truncatePlain(modelPlain, modelW), modelColor, noColor),
        modelW
      );
      const ctxStr = node.contextWindow.maxContextTokens > 0 ? `${node.contextWindow.pct.toFixed(0)}%` : "\u2014";
      const ctxColored = node.contextWindow.level === "critical_85" ? paint(ctxStr, ANSI.red, noColor) : node.contextWindow.level === "warn_70" ? paint(ctxStr, ANSI.yellow, noColor) : ctxStr;
      const ctxCell = padLeftVisible(ctxColored, ctxW);
      const cacheCell = padLeftVisible(formatPct(node.cacheHitPct, 1), cacheW);
      const deltaCell = padLeftVisible(formatDeltaQuotaPct(node.deltaQuota5hPct), deltaW);
      const toolText = node.lastTool ? `${node.lastTool.name}${node.lastTool.summary ? `: ${node.lastTool.summary}` : ""}` : "\u2014";
      const toolCell = padRightVisible(truncatePlain(toolText, toolW), toolW);
      return [phaseCell, nodeCell, modelCell, ctxCell, cacheCell, deltaCell, toolCell].join(" ");
    });
    while (bodyLines.length < bodyRows) {
      bodyLines.push("");
    }
  }
  const footerText = truncatePlain(
    `[q] Quit  [r] Refresh  [s] Sort: ${sortMode}  [\u2191/\u2193] Scroll (${clampedOffset}/${maxOffset})`,
    columns
  );
  const footerLine = paint(footerText, ANSI.gray, noColor);
  return [...chromeTop, ...bodyLines, sep, footerLine].join("\n");
}
function parseTopArgs(args) {
  const opts = {
    intervalMs: 1e3,
    once: false,
    noColor: Boolean(process.env.NO_COLOR),
    live: false
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--once") {
      opts.once = true;
      continue;
    }
    if (arg === "--no-color") {
      opts.noColor = true;
      continue;
    }
    if (arg === "--live") {
      opts.live = true;
      continue;
    }
    if (arg === "--interval" || arg.startsWith("--interval=")) {
      const raw = arg === "--interval" ? args[++i] : arg.slice("--interval=".length);
      const parsed = Number(raw);
      if (!raw || !Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid --interval "${raw ?? ""}". Expected positive milliseconds.`);
      }
      opts.intervalMs = Math.max(MIN_TOP_INTERVAL_MS, Math.trunc(parsed));
      continue;
    }
    if (arg === "--conversation" || arg.startsWith("--conversation=")) {
      const cid = arg === "--conversation" ? args[++i] : arg.slice("--conversation=".length);
      if (!cid || !isValidUuid(cid)) {
        throw new Error(`Invalid --conversation "${cid ?? ""}". Expected 36-character UUID.`);
      }
      opts.conversationId = cid;
      continue;
    }
    if (arg === "--sort" || arg.startsWith("--sort=")) {
      const mode = arg === "--sort" ? args[++i] : arg.slice("--sort=".length);
      if (mode !== "active-first" && mode !== "topology-tree") {
        throw new Error(
          `Invalid --sort "${mode ?? ""}". Expected active-first | topology-tree.`
        );
      }
      opts.sortMode = mode;
      continue;
    }
    if (arg === "--state-dir" || arg.startsWith("--state-dir=")) {
      const dir = arg === "--state-dir" ? args[++i] : arg.slice("--state-dir=".length);
      if (!dir) {
        throw new Error("Missing path after --state-dir.");
      }
      opts.stateDir = dir;
      continue;
    }
    throw new Error(`Unknown top option: ${arg}`);
  }
  return opts;
}
function getTopHelpText() {
  return [
    "Usage: agy-pulse top [options]",
    "",
    "Options:",
    "  --interval <ms>                    Refresh interval in ms (default: 1000, min: 250)",
    "  --once                             Render a single frame and exit 0 (no alt-screen)",
    "  --conversation <uuid>              Target conversation UUID",
    "  --sort <active-first|topology-tree> Override sort order for this session",
    "  --no-color                         Disable ANSI colors (also respects NO_COLOR)",
    "  --live                             Force live read-only LS RPC refresh if env vars exist",
    "  -h, --help                         Show this help message",
    ""
  ].join("\n");
}
async function runTopCommand(args, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;
  let opts;
  try {
    opts = parseTopArgs(args);
  } catch (err) {
    stderr.write(`${err instanceof Error ? err.message : String(err)}
`);
    stderr.write(getTopHelpText());
    return 2;
  }
  if (opts.help) {
    stdout.write(getTopHelpText());
    return 0;
  }
  const effectiveStateDir = opts.stateDir ?? io.stateDir;
  const loadOnce = () => loadCliTelemetry({
    conversationId: opts.conversationId,
    live: opts.live,
    stateDir: effectiveStateDir,
    lsEnv: io.lsEnv,
    fetchFn: io.fetchFn
  });
  if (opts.once || !stdout.isTTY) {
    const view = await loadOnce();
    const frame = renderTopFrame(view, {
      columns: stdout.columns ?? parsePositiveEnvInt(process.env.COLUMNS) ?? 100,
      rows: stdout.rows ?? parsePositiveEnvInt(process.env.LINES) ?? 24,
      sortMode: opts.sortMode ?? view.config.hudSortMode,
      noColor: opts.noColor
    });
    stdout.write(`${frame}
`);
    return 0;
  }
  let currentView = await loadOnce();
  let currentSortMode = opts.sortMode ?? currentView.config.hudSortMode;
  let scrollOffset = 0;
  let cleaned = false;
  let refreshInFlight = false;
  let timer = null;
  let resolveExit = null;
  const draw = () => {
    if (cleaned) return;
    const maxOff = Math.max(0, currentView.treeNodes.length - 3);
    scrollOffset = Math.min(Math.max(0, scrollOffset), maxOff);
    const frame = renderTopFrame(currentView, {
      columns: stdout.columns ?? parsePositiveEnvInt(process.env.COLUMNS) ?? 100,
      rows: stdout.rows ?? parsePositiveEnvInt(process.env.LINES) ?? 24,
      sortMode: currentSortMode,
      scrollOffset,
      noColor: opts.noColor
    });
    stdout.write(`\x1B[H\x1B[2J${frame}`);
  };
  const refreshAndDraw = async () => {
    if (cleaned || refreshInFlight) return;
    refreshInFlight = true;
    try {
      currentView = await loadOnce();
      draw();
    } catch {
    } finally {
      refreshInFlight = false;
    }
  };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    stdin.off("data", onData);
    stdout.off("resize", onResize);
    stdout.off("error", onStdoutError);
    if (io.registerProcessSignals !== false) {
      process.off("SIGWINCH", onResize);
      process.off("SIGINT", onExitSignal);
      process.off("SIGTERM", onExitSignal);
    }
    if (stdin.isTTY && typeof stdin.setRawMode === "function") {
      try {
        stdin.setRawMode(false);
      } catch {
      }
    }
    try {
      stdin.pause();
    } catch {
    }
    try {
      stdout.write("\x1B[?25h\x1B[?1049l");
    } catch {
    }
    resolveExit?.();
  };
  const onResize = () => draw();
  const onExitSignal = () => cleanup();
  const onStdoutError = (err) => {
    if (err.code === "EPIPE") {
      cleanup();
    }
  };
  const onData = (chunk) => {
    const key = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (key === "q" || key === "Q" || key === "") {
      cleanup();
      return;
    }
    if (key === "r" || key === "R") {
      void refreshAndDraw();
      return;
    }
    if (key === "s" || key === "S") {
      currentSortMode = currentSortMode === "active-first" ? "topology-tree" : "active-first";
      draw();
      return;
    }
    if (key === "j" || key === "\x1B[B") {
      scrollOffset += 1;
      draw();
      return;
    }
    if (key === "k" || key === "\x1B[A") {
      scrollOffset = Math.max(0, scrollOffset - 1);
      draw();
    }
  };
  try {
    stdout.write("\x1B[?1049h\x1B[?25l");
    if (stdin.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.resume();
    draw();
    await new Promise((resolve2) => {
      resolveExit = resolve2;
      stdin.on("data", onData);
      stdout.on("resize", onResize);
      stdout.on("error", onStdoutError);
      if (io.registerProcessSignals !== false) {
        process.on("SIGWINCH", onResize);
        process.on("SIGINT", onExitSignal);
        process.on("SIGTERM", onExitSignal);
      }
      timer = setInterval(() => {
        void refreshAndDraw();
      }, opts.intervalMs);
    });
  } finally {
    cleanup();
  }
  return 0;
}

// src/cli/main.ts
var CLI_VERSION = "0.1.0";
var REQUIRED_PLUGIN_FILES = [
  "plugin.json",
  "hooks.json",
  "mcp_config.json",
  "skills/model-pulse/SKILL.md",
  "dist/hook-probe.cjs",
  "dist/mcp.cjs",
  "dist/cli.cjs",
  "sidecars/pulse_cockpit/dist/server.mjs",
  "sidecars/pulse_cockpit/dist/ui.js"
];
var FORBIDDEN_SEGMENTS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var READONLY_CONFIG_KEYS = /* @__PURE__ */ new Set(["version", "updatedAt"]);
function getMainHelpText() {
  return [
    "agy-pulse \u2014 Model Pulse CLI for Google Antigravity 2.0",
    "",
    "Usage:",
    "  agy-pulse status [--format <waybar|tmux|json|text>] [--watch] [--interval <ms>] [--conversation <uuid>] [--live]",
    "  agy-pulse top [--interval <ms>] [--once] [--conversation <uuid>] [--sort <active-first|topology-tree>] [--no-color]",
    "  agy-pulse config [get [key] | set <key> <value> | reset | path]",
    "  agy-pulse doctor [--json]",
    "  agy-pulse --version",
    "  agy-pulse --help",
    ""
  ].join("\n");
}
function getConfigHelpText() {
  return [
    "Usage: agy-pulse config [subcommand]",
    "",
    "Subcommands:",
    "  get [key]            Print full config JSON or a specific key (supports dotted paths)",
    "  set <key> <value>    Validate and atomically update a config setting",
    "  reset                Reset config to built-in defaults",
    "  path                 Print resolved config.json path",
    "",
    "Options:",
    "  --state-dir <path>   Override $PULSE_STATE_DIR",
    "  -h, --help           Show this help message",
    ""
  ].join("\n");
}
function getDoctorHelpText() {
  return [
    "Usage: agy-pulse doctor [options]",
    "",
    "Options:",
    "  --json               Emit structured JSON diagnostic report",
    "  --state-dir <path>   Override $PULSE_STATE_DIR",
    "  -h, --help           Show this help message",
    ""
  ].join("\n");
}
function isPlainRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function resolveConfigPath(source, dottedKey) {
  const segments = dottedKey.split(".");
  if (segments.some((seg) => !seg || FORBIDDEN_SEGMENTS.has(seg))) {
    return { found: false, value: void 0 };
  }
  let current = source;
  for (const seg of segments) {
    if (!isPlainRecord3(current) || !Object.hasOwn(current, seg)) {
      return { found: false, value: void 0 };
    }
    current = current[seg];
  }
  return { found: true, value: current };
}
function buildConfigPatch(dottedKey, rawValue) {
  if (!dottedKey || READONLY_CONFIG_KEYS.has(dottedKey)) {
    return {
      error: dottedKey ? `Config key "${dottedKey}" is read-only.` : "Missing config key.",
      exitCode: 1
    };
  }
  const segments = dottedKey.split(".");
  if (segments.length === 0 || segments.length > 2 || segments.some((s) => !s || FORBIDDEN_SEGMENTS.has(s))) {
    return { error: `Unknown config key: ${dottedKey}`, exitCode: 1 };
  }
  const defaultLookup = resolveConfigPath(DEFAULT_PULSE_USER_CONFIG, dottedKey);
  if (!defaultLookup.found || isPlainRecord3(defaultLookup.value)) {
    return {
      error: defaultLookup.found ? `Cannot set nested section "${dottedKey}" directly; specify a leaf key.` : `Unknown config key: ${dottedKey}`,
      exitCode: 1
    };
  }
  let coerced = rawValue;
  if (typeof defaultLookup.value === "number") {
    const trimmed = rawValue.trim();
    const num = Number(trimmed);
    if (!trimmed || !Number.isFinite(num)) {
      return {
        error: `Invalid numeric value "${rawValue}" for "${dottedKey}".`,
        exitCode: 1
      };
    }
    coerced = num;
  }
  if (segments.length === 1) {
    return {
      patch: { [segments[0]]: coerced },
      parsedValue: coerced
    };
  }
  return {
    patch: {
      [segments[0]]: {
        [segments[1]]: coerced
      }
    },
    parsedValue: coerced
  };
}
function extractStateDirFlag(args) {
  const positional = [];
  let stateDir;
  let help = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--state-dir" || arg.startsWith("--state-dir=")) {
      const dir = arg === "--state-dir" ? args[++i] : arg.slice("--state-dir=".length);
      if (!dir) {
        return { positional, stateDir, help, json, error: "Missing path after --state-dir." };
      }
      stateDir = dir;
      continue;
    }
    positional.push(arg);
  }
  return { positional, stateDir, help, json };
}
async function runConfigCommand(args, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const parsed = extractStateDirFlag(args);
  if (parsed.error) {
    stderr.write(`${parsed.error}
`);
    stderr.write(getConfigHelpText());
    return 2;
  }
  if (parsed.help) {
    stdout.write(getConfigHelpText());
    return 0;
  }
  const effectiveStateDir = parsed.stateDir ?? io.stateDir;
  const positional = parsed.positional;
  if (parsed.json) {
    stderr.write("Unknown config flag: --json\n");
    stderr.write(getConfigHelpText());
    return 2;
  }
  const action = positional[0] ?? "get";
  if (action === "path") {
    if (positional.length > 1) {
      stderr.write(`Unexpected argument for config path: ${positional[1]}
`);
      stderr.write(getConfigHelpText());
      return 2;
    }
    const paths = getStatePaths(effectiveStateDir);
    stdout.write(`${paths.configPath}
`);
    return 0;
  }
  if (action === "get") {
    if (positional.length > 2) {
      stderr.write(`Unexpected argument for config get: ${positional[2]}
`);
      stderr.write(getConfigHelpText());
      return 2;
    }
    const cfg = loadConfig(effectiveStateDir);
    const key = positional[1];
    if (!key) {
      stdout.write(`${JSON.stringify(cfg, null, 2)}
`);
      return 0;
    }
    const resolved = resolveConfigPath(cfg, key);
    if (!resolved.found) {
      stderr.write(`Unknown config key: ${key}
`);
      return 1;
    }
    if (isPlainRecord3(resolved.value)) {
      stdout.write(`${JSON.stringify(resolved.value, null, 2)}
`);
    } else {
      stdout.write(`${String(resolved.value)}
`);
    }
    return 0;
  }
  if (action === "set") {
    if (positional.length < 3 || positional.length > 3) {
      stderr.write("Usage: agy-pulse config set <key> <value>\n");
      return 2;
    }
    const [, key, rawValue] = positional;
    const built = buildConfigPatch(key, rawValue);
    if (built.error || !built.patch) {
      stderr.write(`${built.error ?? "Invalid config update."}
`);
      return built.exitCode ?? 1;
    }
    try {
      const updated = updateConfigPartial(built.patch, effectiveStateDir);
      const savedValue = resolveConfigPath(updated, key);
      stdout.write(`${key}=${String(savedValue.value)}
`);
      return 0;
    } catch (err) {
      if (err instanceof ConfigValidationError) {
        stderr.write(`${err.message}
`);
        return 1;
      }
      stderr.write(`${err instanceof Error ? err.message : String(err)}
`);
      return 1;
    }
  }
  if (action === "reset") {
    if (positional.length > 1) {
      stderr.write(`Unexpected argument for config reset: ${positional[1]}
`);
      stderr.write(getConfigHelpText());
      return 2;
    }
    const resetConfig = {
      ...DEFAULT_PULSE_USER_CONFIG,
      smartThresholds: { ...DEFAULT_PULSE_USER_CONFIG.smartThresholds },
      pollIntervalsMs: { ...DEFAULT_PULSE_USER_CONFIG.pollIntervalsMs },
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    saveConfig(resetConfig, effectiveStateDir);
    stdout.write(`${JSON.stringify(resetConfig, null, 2)}
`);
    return 0;
  }
  stderr.write(`Unknown config subcommand: ${action}
`);
  stderr.write(getConfigHelpText());
  return 2;
}
function isExecutableFile(filePath) {
  if (!(0, import_node_fs5.existsSync)(filePath)) return false;
  try {
    const st = (0, import_node_fs5.statSync)(filePath);
    if (!st.isFile()) return false;
    if (process.platform === "win32") return true;
    (0, import_node_fs5.accessSync)(filePath, import_node_fs5.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function checkRuntime() {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    return {
      id: "runtime",
      status: "warn",
      message: `Node.js v${nodeVersion} detected; v20+ is recommended`,
      details: { nodeVersion, execPath: process.execPath, platform: process.platform }
    };
  }
  return {
    id: "runtime",
    status: "pass",
    message: `Node.js v${nodeVersion} (${process.execPath})`,
    details: { nodeVersion, execPath: process.execPath, platform: process.platform }
  };
}
function checkStateDir(overrideDir) {
  const paths = getStatePaths(overrideDir);
  if (!(0, import_node_fs5.existsSync)(paths.stateDir)) {
    return {
      id: "state_dir",
      status: "warn",
      message: `State directory does not exist yet: ${paths.stateDir} (will be created on first hook/sidecar run)`,
      details: { stateDir: paths.stateDir, exists: false }
    };
  }
  try {
    const st = (0, import_node_fs5.statSync)(paths.stateDir);
    if (!st.isDirectory()) {
      return {
        id: "state_dir",
        status: "fail",
        message: `State path exists but is not a directory: ${paths.stateDir}`,
        details: { stateDir: paths.stateDir, exists: true, isDirectory: false }
      };
    }
  } catch (err) {
    return {
      id: "state_dir",
      status: "fail",
      message: `Cannot stat state directory ${paths.stateDir}: ${err instanceof Error ? err.message : String(err)}`,
      details: { stateDir: paths.stateDir }
    };
  }
  const probePath = (0, import_node_path4.join)(paths.stateDir, "doctor-probe.tmp");
  try {
    (0, import_node_fs5.writeFileSync)(probePath, `${process.pid}
`, { encoding: "utf8", mode: 384 });
    return {
      id: "state_dir",
      status: "pass",
      message: `Writable state directory: ${paths.stateDir}`,
      details: {
        stateDir: paths.stateDir,
        hasLiveSnapshot: (0, import_node_fs5.existsSync)(paths.liveSnapshot),
        hasConfig: (0, import_node_fs5.existsSync)(paths.configPath)
      }
    };
  } catch (err) {
    return {
      id: "state_dir",
      status: "fail",
      message: `State directory is not writable (${paths.stateDir}): ${err instanceof Error ? err.message : String(err)}`,
      details: { stateDir: paths.stateDir }
    };
  } finally {
    try {
      if ((0, import_node_fs5.existsSync)(probePath)) {
        (0, import_node_fs5.unlinkSync)(probePath);
      }
    } catch {
    }
  }
}
async function checkHostLs(lsEnv, fetchFn) {
  const address = (lsEnv?.address ?? process.env.ANTIGRAVITY_LS_ADDRESS ?? "").trim();
  const csrfToken = (lsEnv?.csrfToken ?? process.env.ANTIGRAVITY_CSRF_TOKEN ?? "").trim();
  if (!address || !csrfToken) {
    return {
      id: "host_ls",
      status: "warn",
      message: "Host Language Server env vars not exposed in shell (offline/cached mode)",
      details: { configured: false }
    };
  }
  const client = new ReadOnlyLsClient({
    address,
    csrfToken,
    timeoutMs: 1500,
    fetchFn
  });
  try {
    await client.getCascadeModelConfigData();
    return {
      id: "host_ls",
      status: "pass",
      message: `Connected read-only to Language Server at ${address}`,
      details: { configured: true, address }
    };
  } catch (err) {
    return {
      id: "host_ls",
      status: "warn",
      message: `Language Server unreachable at ${address}: ${err instanceof Error ? err.message : String(err)}`,
      details: { configured: true, address }
    };
  }
}
function checkPluginInstall(overridePluginDir) {
  const envPluginDir = process.env.ANTIGRAVITY_PLUGIN_DIR?.trim();
  const pluginDir = overridePluginDir?.trim() || envPluginDir || (0, import_node_path4.join)((0, import_node_os3.homedir)(), ".gemini", "config", "plugins", "antigravity-pulse");
  if (!(0, import_node_fs5.existsSync)(pluginDir)) {
    return {
      id: "plugin_install",
      status: "warn",
      message: `Installed plugin directory not found at ${pluginDir} (run npm run install:global)`,
      details: { pluginDir, exists: false }
    };
  }
  const forbiddenDirs = ["rules", ".agents"].filter((d) => (0, import_node_fs5.existsSync)((0, import_node_path4.join)(pluginDir, d)));
  const forbiddenFiles = ["AGENTS.md"].filter((f) => (0, import_node_fs5.existsSync)((0, import_node_path4.join)(pluginDir, f)));
  if (forbiddenDirs.length > 0 || forbiddenFiles.length > 0) {
    return {
      id: "plugin_install",
      status: "fail",
      message: `D-007 zero-token violation in ${pluginDir}: unexpected ${[...forbiddenDirs, ...forbiddenFiles].join(", ")}`,
      details: { pluginDir, forbiddenDirs, forbiddenFiles }
    };
  }
  const missingFiles = REQUIRED_PLUGIN_FILES.filter(
    (rel) => !(0, import_node_fs5.existsSync)((0, import_node_path4.join)(pluginDir, rel))
  );
  if (missingFiles.length > 0) {
    return {
      id: "plugin_install",
      status: "fail",
      message: `Incomplete plugin install at ${pluginDir}; missing: ${missingFiles.join(", ")}`,
      details: { pluginDir, missingFiles }
    };
  }
  return {
    id: "plugin_install",
    status: "pass",
    message: `Plugin directory valid (${REQUIRED_PLUGIN_FILES.length} core files present, zero rules/)`,
    details: { pluginDir, checkedFiles: REQUIRED_PLUGIN_FILES.length }
  };
}
function checkLauncherLink(pathEnv, overridePluginDir) {
  const names = process.platform === "win32" ? ["agy-pulse.cmd", "agy-pulse.ps1"] : ["agy-pulse"];
  const entries = (pathEnv ?? process.env.PATH ?? "").split(import_node_path4.delimiter).filter(Boolean);
  for (const dir of entries) {
    for (const name of names) {
      const candidate = (0, import_node_path4.join)(dir, name);
      if (isExecutableFile(candidate)) {
        return {
          id: "launcher_link",
          status: "pass",
          message: `Launcher available on PATH: ${candidate}`,
          details: { path: candidate, onPath: true }
        };
      }
    }
  }
  const fallbackCandidates = [
    ...overridePluginDir ? [(0, import_node_path4.join)(overridePluginDir, "bin", names[0])] : [],
    (0, import_node_path4.join)((0, import_node_os3.homedir)(), ".local", "bin", names[0]),
    (0, import_node_path4.resolve)((0, import_node_path4.dirname)(__filename), "..", "bin", names[0]),
    (0, import_node_path4.resolve)((0, import_node_path4.dirname)(__filename), "..", "..", "bin", names[0])
  ];
  for (const candidate of fallbackCandidates) {
    if (isExecutableFile(candidate)) {
      return {
        id: "launcher_link",
        status: "warn",
        message: `Launcher exists at ${candidate}, but agy-pulse is not on PATH`,
        details: { path: candidate, onPath: false }
      };
    }
  }
  return {
    id: "launcher_link",
    status: "warn",
    message: "agy-pulse launcher was not found on PATH or standard ~/.local/bin",
    details: { onPath: false }
  };
}
async function runDoctorCheck(options = {}) {
  const checks = [
    checkRuntime(),
    checkStateDir(options.stateDir),
    await checkHostLs(options.lsEnv, options.fetchFn),
    checkPluginInstall(options.pluginDir),
    checkLauncherLink(options.pathEnv, options.pluginDir)
  ];
  return {
    schemaVersion: 1,
    version: CLI_VERSION,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ok: checks.every((c) => c.status !== "fail"),
    checks
  };
}
async function runDoctorCommand(args, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const parsed = extractStateDirFlag(args);
  if (parsed.error) {
    stderr.write(`${parsed.error}
`);
    stderr.write(getDoctorHelpText());
    return 2;
  }
  if (parsed.help) {
    stdout.write(getDoctorHelpText());
    return 0;
  }
  if (parsed.positional.length > 0) {
    stderr.write(`Unknown doctor argument: ${parsed.positional[0]}
`);
    stderr.write(getDoctorHelpText());
    return 2;
  }
  const report = await runDoctorCheck({
    stateDir: parsed.stateDir ?? io.stateDir,
    pluginDir: io.pluginDir,
    lsEnv: io.lsEnv,
    pathEnv: io.pathEnv,
    fetchFn: io.fetchFn
  });
  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}
`);
  } else {
    const lines = [
      `Model Pulse Doctor (antigravity-pulse v${report.version})`,
      ...report.checks.map(
        (c) => `[${c.status.toUpperCase()}] ${c.id}: ${c.message}`
      ),
      `Overall: ${report.ok ? "OK" : "FAILED"}`
    ];
    stdout.write(`${lines.join("\n")}
`);
  }
  return report.ok ? 0 : 1;
}
async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    stdout.write(getMainHelpText());
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    stdout.write(`antigravity-pulse v${CLI_VERSION}
`);
    return 0;
  }
  const command = args[0];
  const subArgs = args.slice(1);
  if (command === "status") {
    return runStatusCommand(subArgs, {
      stdout,
      stderr,
      stateDir: io.stateDir,
      lsEnv: io.lsEnv,
      signal: io.signal,
      fetchFn: io.fetchFn,
      registerProcessSignals: io.registerProcessSignals
    });
  }
  if (command === "top") {
    return runTopCommand(subArgs, {
      stdin: io.stdin,
      stdout,
      stderr,
      stateDir: io.stateDir,
      lsEnv: io.lsEnv,
      fetchFn: io.fetchFn,
      registerProcessSignals: io.registerProcessSignals
    });
  }
  if (command === "config") {
    return runConfigCommand(subArgs, io);
  }
  if (command === "doctor") {
    return runDoctorCommand(subArgs, io);
  }
  if (command.startsWith("-")) {
    stderr.write(`Unknown option: ${command}
`);
  } else {
    stderr.write(`Unknown command: ${command}
`);
  }
  stderr.write(getMainHelpText());
  return 2;
}
function isCliEntrypoint() {
  return typeof require !== "undefined" && typeof module !== "undefined" && require.main === module && typeof require.main?.filename === "string" && /(?:^|[\\/])(?:main|cli)\.(?:c?js|mjs|ts)$/i.test(require.main.filename);
}
if (isCliEntrypoint()) {
  void runCli(process.argv).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(
        `agy-pulse error: ${err instanceof Error ? err.message : String(err)}
`
      );
      process.exitCode = 1;
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CLI_VERSION,
  getConfigHelpText,
  getDoctorHelpText,
  getMainHelpText,
  runCli,
  runConfigCommand,
  runDoctorCheck,
  runDoctorCommand
});
