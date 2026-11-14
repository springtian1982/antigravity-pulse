/* SPDX-License-Identifier: MIT | Copyright (c) 2026 springtian <springtian@gmail.com> */

// src/sidecar/server.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, realpathSync } from "node:fs";
import path2 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Response, SidecarApp } from "sidecar_sdk";

// src/state/state-dir.ts
import { randomBytes } from "node:crypto";
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
  const chosen = trimmedOverride || envStateDir || pluginData || path.join(os.homedir(), ".gemini", "antigravity", "pulse-state");
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
  const suffix = `${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}`;
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

// src/sidecar/server.ts
var STRICT_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors *";
var STAGE0_ETAG = "stage0";
function resolveSidecarRoot() {
  const here = path2.dirname(fileURLToPath(import.meta.url));
  const parentDir = path2.resolve(here, "..");
  if (existsSync2(path2.join(parentDir, "index.html"))) {
    return parentDir;
  }
  return path2.resolve(here, "..", "..", "sidecars", "pulse_cockpit");
}
function createEmptyQuotaSummary(nowIso) {
  return {
    fetchedAt: nowIso,
    buckets: [],
    gemini5h: null,
    geminiWeekly: null,
    thirdParty5h: null,
    thirdPartyWeekly: null,
    treeNetDelta5hPct: null,
    burnRate5hPctPerMin: null
  };
}
function make400Json(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    contentType: "application/json"
  });
}
function makeUnchanged(etag) {
  return { unchanged: true, etag };
}
function createPulseSidecarServer() {
  const startedAt = Date.now();
  const sidecarRoot = resolveSidecarRoot();
  const app = new SidecarApp();
  const readAsset = (relPath) => {
    const fullPath = path2.join(sidecarRoot, relPath);
    if (!existsSync2(fullPath)) {
      return null;
    }
    return readFileSync2(fullPath, "utf8");
  };
  const serveHtmlPage = () => {
    const html = readAsset("index.html") ?? '<!doctype html><html><head><meta charset="utf-8"><title>Model Pulse</title></head><body><div id="pulse-app" class="pulse-app" data-view="hud" data-theme-mode="auto"><main id="app" class="pulse-main" aria-live="polite">Model Pulse loading...</main></div></body></html>';
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
  app.page("/", serveHtmlPage);
  app.page("/hud", serveHtmlPage);
  app.page("/fleet", serveHtmlPage);
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
    const js = readAsset(path2.join("dist", "ui.js"));
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
    () => ({
      ok: true,
      version: "0.1.0",
      lsConnected: false,
      stateDir: resolveStateDir(),
      uptimeMs: Date.now() - startedAt
    }),
    "GET"
  );
  app.api("/api/config", () => loadConfig(), "GET");
  app.api(
    "/api/config",
    (data) => {
      try {
        return updateConfigPartial(data);
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
      if (typeof data.etag === "string" && data.etag.trim() === STAGE0_ETAG) {
        return makeUnchanged(STAGE0_ETAG);
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      return {
        etag: STAGE0_ETAG,
        generatedAt: nowIso,
        hostConnected: false,
        activeConversationId: rawCid || app.config.conversationId || null,
        rootCascadeId: null,
        breadcrumb: [],
        activeNode: null,
        treeNodes: [],
        smartGovernanceBanner: {
          active: false,
          heavyConcurrentCount: 0,
          gemini5hRemainingPct: null,
          estimatedBurnPctPerMin: null,
          message: null
        },
        quota: createEmptyQuotaSummary(nowIso),
        config: loadConfig(),
        warnings: ["Stage 0 scaffold active: awaiting Stage 1 telemetry engine."]
      };
    },
    "GET"
  );
  app.api(
    "/api/timeline",
    (data) => {
      const rawCid = typeof data.conversationId === "string" ? data.conversationId.trim() : "";
      if (rawCid && !isValidUuid(rawCid)) {
        return make400Json("Invalid conversationId UUID");
      }
      const rawScope = typeof data.scope === "string" ? data.scope.trim() : "tree";
      if (rawScope !== "conversation" && rawScope !== "tree") {
        return make400Json("Invalid timeline scope: expected conversation | tree");
      }
      if (typeof data.etag === "string" && data.etag.trim() === STAGE0_ETAG) {
        return makeUnchanged(STAGE0_ETAG);
      }
      return {
        etag: STAGE0_ETAG,
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        rootCascadeId: null,
        scope: rawScope,
        turns: []
      };
    },
    "GET"
  );
  app.api(
    "/api/fleet",
    (data) => {
      if (typeof data.etag === "string" && data.etag.trim() === STAGE0_ETAG) {
        return makeUnchanged(STAGE0_ETAG);
      }
      const nowIso = (/* @__PURE__ */ new Date()).toISOString();
      return {
        etag: STAGE0_ETAG,
        generatedAt: nowIso,
        hostConnected: false,
        activeHeadline: {
          runningRoots: 0,
          runningSubagents: 0,
          totalRunningNodes: 0,
          modelHistogram: []
        },
        projects: [],
        topQuotaBurners: [],
        quota: createEmptyQuotaSummary(nowIso)
      };
    },
    "GET"
  );
  return app;
}
var isEntryPoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isEntryPoint) {
  const server = createPulseSidecarServer();
  void server.run();
}
export {
  STRICT_CSP,
  createPulseSidecarServer
};
