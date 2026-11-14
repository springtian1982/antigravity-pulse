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
  runCli: () => runCli
});
module.exports = __toCommonJS(main_exports);

// src/state/state-dir.ts
var import_node_fs = require("node:fs");
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var RING_MAX_BYTES = 512 * 1024;
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

// src/cli/main.ts
var VERSION = "0.1.0";
function printHelp() {
  process.stdout.write(
    [
      "agy-pulse \u2014 Model Pulse CLI for Google Antigravity 2.0",
      "",
      "Usage:",
      "  agy-pulse status [--format json]",
      "  agy-pulse --version",
      "  agy-pulse --help",
      ""
    ].join("\n")
  );
}
function runCli(argv) {
  const args = argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${VERSION}
`);
    return 0;
  }
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }
  const command = args[0];
  if (command === "status") {
    const paths = getStatePaths();
    const snapshot = readJsonSafe(paths.liveSnapshot, null);
    const payload = {
      ok: true,
      version: VERSION,
      connected: Boolean(snapshot?.hostConnected),
      stateDir: paths.stateDir,
      snapshot
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
    return 0;
  }
  process.stderr.write(`Unknown command: ${command}
`);
  printHelp();
  return 1;
}
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  process.exitCode = runCli(process.argv);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  runCli
});
