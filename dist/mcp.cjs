#!/usr/bin/env node
/* SPDX-License-Identifier: MIT | Copyright (c) 2026 springtian <springtian@gmail.com> */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/mcp/server.ts
var server_exports = {};
__export(server_exports, {
  startMcpServer: () => startMcpServer
});
module.exports = __toCommonJS(server_exports);
var import_node_readline = require("node:readline");
function writeJsonRpc(payload) {
  process.stdout.write(`${JSON.stringify(payload)}
`);
}
function handleRequest(req) {
  const hasId = req.id !== void 0 && req.id !== null;
  const method = req.method;
  if (method === "notifications/initialized") {
    return;
  }
  if (!hasId) {
    return;
  }
  switch (method) {
    case "initialize": {
      writeJsonRpc({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "antigravity-pulse",
            version: "0.1.0"
          }
        }
      });
      return;
    }
    case "ping": {
      writeJsonRpc({
        jsonrpc: "2.0",
        id: req.id,
        result: {}
      });
      return;
    }
    case "tools/list": {
      writeJsonRpc({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          tools: []
        }
      });
      return;
    }
    default: {
      writeJsonRpc({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32601,
          message: `Method not found: ${String(method ?? "")}`
        }
      });
    }
  }
}
function startMcpServer() {
  const rl = (0, import_node_readline.createInterface)({
    input: process.stdin,
    crlfDelay: Infinity
  });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      handleRequest(parsed);
    } catch {
      writeJsonRpc({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error"
        }
      });
    }
  });
}
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  startMcpServer();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  startMcpServer
});
