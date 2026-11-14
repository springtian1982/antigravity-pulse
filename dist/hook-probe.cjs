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

// src/state/state-dir.ts
var import_node_fs = require("node:fs");
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var UUID_REGEX = /^[0-9a-f-]{36}$/i;
var RING_MAX_BYTES = 512 * 1024;
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
  const chosen = trimmedOverride || envStateDir || pluginData || import_node_path.default.join(import_node_os.default.homedir(), ".gemini", "antigravity", "pulse-state");
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
function appendRingLine(event, overrideDir) {
  ensureStateDir(overrideDir);
  const { eventsRing } = getStatePaths(overrideDir);
  const line = `${JSON.stringify(event)}
`;
  (0, import_node_fs.appendFileSync)(eventsRing, line, { encoding: "utf8", mode: 384 });
  return eventsRing;
}

// src/hook/hook-probe.ts
var KNOWN_HOOK_EVENTS = /* @__PURE__ */ new Set([
  "PreInvocation",
  "PostInvocation",
  "PreToolUse",
  "PostToolUse",
  "Stop"
]);
function normalizeEventName(payload) {
  const raw = payload.hookEventName ?? payload.hook_event_name;
  if (typeof raw === "string" && KNOWN_HOOK_EVENTS.has(raw)) {
    return raw;
  }
  return null;
}
function processHookPayload(rawStdin, overrideStateDir) {
  const startNs = process.hrtime.bigint();
  let eventName = null;
  try {
    const trimmed = rawStdin.trim();
    if (!trimmed) {
      return {};
    }
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    eventName = normalizeEventName(parsed);
    if (!eventName) {
      return {};
    }
    const rawCid = parsed.conversationId ?? parsed.conversation_id;
    const conversationId = isValidUuid(rawCid) ? rawCid : "unknown";
    const rawInvocationNum = parsed.invocationNum ?? parsed.invocation_num;
    const rawModel = parsed.model ?? parsed.modelName ?? parsed.model_name;
    const rawToolName = parsed.toolName ?? parsed.tool_name;
    const rawToolCallId = parsed.toolCallId ?? parsed.tool_call_id;
    const rawStopReason = parsed.stopReason ?? parsed.stop_reason;
    const durationUs = Number((process.hrtime.bigint() - startNs) / 1000n);
    const ringEvent = {
      ts: Date.now(),
      iso: (/* @__PURE__ */ new Date()).toISOString(),
      event: eventName,
      conversationId,
      ...typeof rawInvocationNum === "number" && Number.isFinite(rawInvocationNum) ? { invocationNum: rawInvocationNum } : {},
      ...typeof rawModel === "string" && rawModel ? { modelRaw: rawModel } : {},
      ...typeof rawToolName === "string" && rawToolName ? { toolName: rawToolName } : {},
      ...typeof rawToolCallId === "string" && rawToolCallId ? { toolCallId: rawToolCallId } : {},
      ...typeof rawStopReason === "string" && rawStopReason ? { stopReason: rawStopReason } : {},
      hookDurationUs: durationUs
    };
    try {
      appendRingLine(ringEvent, overrideStateDir);
    } catch {
    }
    return eventName === "PreToolUse" ? { decision: "allow" } : {};
  } catch {
    return eventName === "PreToolUse" ? { decision: "allow" } : {};
  }
}
function runHookCli() {
  let response = {};
  try {
    const stdinText = (0, import_node_fs2.readFileSync)(0, "utf8");
    response = processHookPayload(stdinText);
  } catch {
    response = {};
  }
  process.stdout.write(`${JSON.stringify(response)}
`);
  process.exitCode = 0;
}
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  runHookCli();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  processHookPayload,
  runHookCli
});
