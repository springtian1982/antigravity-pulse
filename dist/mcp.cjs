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

// src/mcp/server.ts
var server_exports = {};
__export(server_exports, {
  DEFAULT_PROTOCOL_VERSION: () => DEFAULT_PROTOCOL_VERSION,
  MCP_SERVER_NAME: () => MCP_SERVER_NAME,
  MCP_SERVER_VERSION: () => MCP_SERVER_VERSION,
  MCP_TOOL_DEFINITIONS: () => MCP_TOOL_DEFINITIONS,
  McpFrameDecoder: () => McpFrameDecoder,
  SIDECAR_PILL_MARKDOWN: () => SIDECAR_PILL_MARKDOWN,
  dispatchToolCall: () => dispatchToolCall,
  evaluateComputeBudget: () => evaluateComputeBudget,
  handleJsonRpcMessage: () => handleJsonRpcMessage,
  loadMcpTelemetry: () => loadMcpTelemetry,
  serializeJsonRpcMessage: () => serializeJsonRpcMessage,
  startMcpServer: () => startMcpServer
});
module.exports = __toCommonJS(server_exports);
var import_node_os2 = __toESM(require("node:os"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);

// src/core/formatters.ts
var CANONICAL_HUD_URI = "sidecar://antigravity-pulse/pulse_cockpit/hud";
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
function escapeHtml(raw) {
  const str = raw === null || raw === void 0 ? "" : String(raw);
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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

// src/core/quota-calculator.ts
var FIVE_MIN_MS = 5 * 60 * 1e3;
var RESET_HYSTERESIS = 5e-3;
function round8(value) {
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
  return elapsedMinutes > 0 ? round8(positiveDropsPct / elapsedMinutes) : null;
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
    const tickDropPct = round8(Math.max(0, (prevGlobal - currGlobal) * 100));
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
          entry.delta5hPct = round8(Math.max(0, entry.delta5hPct + share));
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
      treeNetDelta5hPct = round8(totalDelta);
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

// src/core/topology-builder.ts
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"), 1);

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
  const pbtxtPath = import_node_path.default.join(antigravityDataDir, "annotations", `${cascadeId}.pbtxt`);
  if (!(0, import_node_fs.existsSync)(pbtxtPath)) {
    return null;
  }
  try {
    const content = (0, import_node_fs.readFileSync)(pbtxtPath, "utf8");
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
  if (!(0, import_node_fs.existsSync)(dbPath) || typeof process.getBuiltinModule !== "function") {
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
    const sysGenDir = import_node_path.default.join(input.antigravityDataDir, "brain", parentCid, ".system_generated");
    if (!(0, import_node_fs.existsSync)(sysGenDir)) {
      continue;
    }
    const subagentsDir = import_node_path.default.join(sysGenDir, "subagents");
    if ((0, import_node_fs.existsSync)(subagentsDir)) {
      try {
        const files = (0, import_node_fs.readdirSync)(subagentsDir).filter((name) => name.endsWith(".json")).sort();
        for (const fileName of files) {
          const fullPath = import_node_path.default.join(subagentsDir, fileName);
          try {
            const parsed = JSON.parse((0, import_node_fs.readFileSync)(fullPath, "utf8"));
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
    const swarmMembersPath = import_node_path.default.join(sysGenDir, "swarm", "members.json");
    if ((0, import_node_fs.existsSync)(swarmMembersPath)) {
      try {
        const parsed = JSON.parse((0, import_node_fs.readFileSync)(swarmMembersPath, "utf8"));
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
      const dbPath = import_node_path.default.join(input.antigravityDataDir, "conversations", `${cid}.db`);
      if ((0, import_node_fs.existsSync)(dbPath)) {
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
var import_node_fs2 = require("node:fs");
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var UUID_REGEX = /^[0-9a-f-]{36}$/i;
var RING_MAX_BYTES = 512 * 1024;
var atomicTmpSeq = 0;
function tryChmod(targetPath, mode) {
  if (process.platform === "win32") return;
  try {
    (0, import_node_fs2.chmodSync)(targetPath, mode);
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
  const appDataDir = process.env.ANTIGRAVITY_APP_DATA_DIR?.trim() || process.env.ANTIGRAVITY_DATA_DIR?.trim() || import_node_path2.default.join(import_node_os.default.homedir(), ".gemini", "antigravity");
  const chosen = trimmedOverride || envStateDir || pluginData || import_node_path2.default.join(appDataDir, "plugin_data", "antigravity-pulse");
  return import_node_path2.default.resolve(chosen);
}
function getStatePaths(overrideDir) {
  const stateDir = resolveStateDir(overrideDir);
  return {
    stateDir,
    eventsRing: import_node_path2.default.join(stateDir, "events.ring.jsonl"),
    eventsRingPrev: import_node_path2.default.join(stateDir, "events.ring.prev.jsonl"),
    liveSnapshot: import_node_path2.default.join(stateDir, "live-snapshot.json"),
    modelMap: import_node_path2.default.join(stateDir, "model-map.json"),
    quotaCache: import_node_path2.default.join(stateDir, "quota-cache.json"),
    configPath: import_node_path2.default.join(stateDir, "config.json"),
    stampDedup: import_node_path2.default.join(stateDir, "stamp-dedup.json")
  };
}
function ensureStateDir(overrideDir) {
  const stateDir = resolveStateDir(overrideDir);
  (0, import_node_fs2.mkdirSync)(stateDir, { recursive: true, mode: 448 });
  tryChmod(stateDir, 448);
  return stateDir;
}
function writeJsonAtomic(filePath, data) {
  const parentDir = import_node_path2.default.dirname(filePath);
  if (!(0, import_node_fs2.existsSync)(parentDir)) {
    (0, import_node_fs2.mkdirSync)(parentDir, { recursive: true, mode: 448 });
    tryChmod(parentDir, 448);
  }
  atomicTmpSeq = atomicTmpSeq + 1 >>> 0;
  const suffix = `${process.pid}.${process.hrtime.bigint().toString(36)}.${atomicTmpSeq.toString(36)}`;
  const tmpPath = `${filePath}.${suffix}.tmp`;
  const serialized = `${JSON.stringify(data, null, 2)}
`;
  try {
    (0, import_node_fs2.writeFileSync)(tmpPath, serialized, { encoding: "utf8", mode: 384 });
    tryChmod(tmpPath, 384);
    (0, import_node_fs2.renameSync)(tmpPath, filePath);
  } catch (err) {
    try {
      if ((0, import_node_fs2.existsSync)(tmpPath)) {
        (0, import_node_fs2.unlinkSync)(tmpPath);
      }
    } catch {
    }
    throw err;
  }
}
function readJsonSafe(filePath, fallback) {
  try {
    if (!(0, import_node_fs2.existsSync)(filePath)) {
      return fallback;
    }
    const raw = (0, import_node_fs2.readFileSync)(filePath, "utf8");
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

// src/mcp/embed-card.ts
var import_node_crypto = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_url = require("node:url");

// src/core/fleet-builder.ts
var ROLLING_5H_WINDOW_MS = 5 * 60 * 60 * 1e3;
var EFFORT_SHORT_MAP = {
  xhigh: "(XH)",
  high: "(H)",
  medium: "(M)",
  med: "(M)",
  low: "(L)"
};
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

// src/mcp/embed-card.ts
var VALID_TIERS = /* @__PURE__ */ new Set(["apex", "workhorse", "fast", "orchestrator", "alert"]);
function sanitizeTier(tier) {
  return tier && VALID_TIERS.has(tier) ? tier : "workhorse";
}
function clampPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}
function formatEffortBadge(effort) {
  switch (effort) {
    case "xhigh":
      return "XH";
    case "high":
      return "HIGH";
    case "medium":
      return "MED";
    case "low":
      return "LOW";
    case "flash":
      return "FLASH";
    case "auto":
      return "AUTO";
    default:
      return "";
  }
}
function formatPhaseBadge(node) {
  const dur = formatDurationCompact(node.phaseElapsedMs);
  switch (node.phase) {
    case "THINKING":
      return { label: `THINKING ${dur}`, isActive: true, isAlert: false };
    case "STREAMING": {
      const rate = node.streamingTokPerSec !== null && Number.isFinite(node.streamingTokPerSec) ? ` ${Math.round(node.streamingTokPerSec)}t/s` : "";
      return { label: `STREAMING${rate} ${dur}`, isActive: true, isAlert: false };
    }
    case "TOOL_RUNNING":
      return {
        label: `TOOL ${node.lastTool?.name ? node.lastTool.name : "run"} ${dur}`,
        isActive: true,
        isAlert: false
      };
    case "PRE_FLIGHT":
      return { label: `PRE-FLIGHT ${dur}`, isActive: true, isAlert: false };
    case "BLOCKED_APPROVAL":
      return { label: `BLOCKED ${dur}`, isActive: true, isAlert: true };
    case "ERROR_OR_QUOTA":
      return { label: "ERROR / QUOTA", isActive: false, isAlert: true };
    case "IDLE":
    default:
      return { label: "IDLE", isActive: false, isAlert: false };
  }
}
function formatShortPhase(phase, elapsedMs) {
  const dur = formatDurationCompact(elapsedMs);
  switch (phase) {
    case "THINKING":
      return `THINK ${dur}`;
    case "STREAMING":
      return `STREAM ${dur}`;
    case "TOOL_RUNNING":
      return `TOOL ${dur}`;
    case "PRE_FLIGHT":
      return `INIT ${dur}`;
    case "BLOCKED_APPROVAL":
      return `WAIT ${dur}`;
    case "ERROR_OR_QUOTA":
      return "ERR";
    case "IDLE":
    default:
      return "IDLE";
  }
}
function formatKindLabel(kind) {
  switch (kind) {
    case "root":
      return "Root";
    case "subagent":
      return "Subagent";
    case "workflow":
      return "Workflow";
    case "swarm_member":
      return "Swarm";
    default:
      return String(kind || "Node");
  }
}
function formatBucketCell(label, bucket, extraSub) {
  const pct = bucket ? formatPct(bucket.remainingPct, 1) : "\u2014";
  const reset = bucket?.resetInLabel ? escapeHtml(bucket.resetInLabel) : "\u2014";
  const level = bucket && bucket.remainingPct < 15 ? "alert" : bucket && bucket.remainingPct < 25 ? "warn" : "ok";
  const sub = extraSub ? escapeHtml(extraSub) : `reset ${reset}`;
  return [
    `<div class="fuel-cell" data-fuel-level="${level}">`,
    `  <span class="fuel-label">${escapeHtml(label)}</span>`,
    `  <span class="fuel-val tabular-nums">${escapeHtml(pct)}</span>`,
    `  <span class="fuel-sub tabular-nums">${sub}</span>`,
    `</div>`
  ].join("\n");
}
function buildRoutingPill(node) {
  const req = node.requestedModel.displayName || node.requestedModel.raw || "Unknown";
  const served = node.servedModel.displayName || node.servedModel.responseModel || "Pending";
  const servedId = node.servedModel.responseModel || node.servedModel.modelEnum;
  const eff = formatEffortBadge(node.servedModel.effortTier);
  const tier = node.retryCount > 0 || node.routingStatus === "mismatch_or_fallback" ? "alert" : sanitizeTier(node.servedModel.tier);
  const sameLabel = req.trim().toLowerCase() === served.trim().toLowerCase();
  const routeText = sameLabel ? served : `${req} -> ${served}`;
  const suffix = eff ? ` [${eff}]` : "";
  const idBadge = servedId ? `<span class="mono-id">${escapeHtml(servedId)}</span>` : "";
  const retryBadge = node.retryCount > 0 ? `<span class="pill" data-tier="alert">Retry \xD7${node.retryCount}</span>` : "";
  const mismatchBadge = node.routingStatus === "mismatch_or_fallback" ? `<span class="pill" data-tier="alert">Fallback</span>` : "";
  return [
    `<div class="routing-row">`,
    `  <span class="pill" data-tier="${tier}">${escapeHtml(routeText + suffix)}</span>`,
    idBadge ? `  ${idBadge}` : "",
    retryBadge ? `  ${retryBadge}` : "",
    mismatchBadge ? `  ${mismatchBadge}` : "",
    `</div>`
  ].filter(Boolean).join("\n");
}
function formatCompactNodeModel(node) {
  const base = compactModelLabel(node.servedModel);
  const effort = formatEffortBadge(node.servedModel.effortTier);
  if (!effort) {
    return base;
  }
  if (/\((?:XH|H|M|L)\)$/i.test(base) || base.toLowerCase().includes(effort.toLowerCase())) {
    return base;
  }
  return `${base} \xB7 ${effort}`;
}
function renderNodeRow(node, isFocused) {
  const effectiveTier = node.retryCount > 0 || node.phase === "ERROR_OR_QUOTA" ? "alert" : sanitizeTier(node.servedModel.tier);
  const kindLabel = formatKindLabel(node.kind);
  const nodeName = node.role || node.title || node.cascadeId.slice(0, 8);
  const swarmSuffix = node.swarmState?.memberName ? ` (${node.swarmState.memberName})` : "";
  const modelDisplay = node.servedModel.displayName || node.servedModel.responseModel || "Pending";
  const effort = formatEffortBadge(node.servedModel.effortTier);
  const fullModelText = effort ? `${modelDisplay} \xB7 ${effort}` : modelDisplay;
  const fullModelTitle = node.servedModel.responseModel ? `${fullModelText} [${node.servedModel.responseModel}]` : fullModelText;
  const compactModelText = formatCompactNodeModel(node);
  const phaseStr = formatShortPhase(node.phase, node.phaseElapsedMs);
  const ctxPct = formatPct(node.contextWindow.pct, 0);
  const deltaStr = formatDeltaQuotaPct(node.deltaQuota5hPct);
  const actionParts = [];
  if (node.lastTool?.name) {
    actionParts.push(node.lastTool.name);
  }
  if (node.lastTool?.summary) {
    actionParts.push(node.lastTool.summary);
  }
  const actionText = actionParts.length > 0 ? actionParts.join(": ") : node.phase === "IDLE" ? "Ready" : phaseStr;
  const indentPx = Math.min(24, Math.max(0, node.depth) * 8);
  const rowCls = isFocused ? "tree-row is-focused" : "tree-row";
  const phaseTier = node.phase === "ERROR_OR_QUOTA" || node.phase === "BLOCKED_APPROVAL" ? "alert" : node.phase === "IDLE" ? "muted" : effectiveTier;
  const fallbackBadge = node.routingStatus === "mismatch_or_fallback" ? `<span class="pill pill-xs" data-tier="alert">Fallback</span>` : "";
  const retryBadge = node.retryCount > 0 ? `<span class="pill pill-xs" data-tier="alert">Retry \xD7${node.retryCount}</span>` : "";
  return [
    `<div class="${rowCls}">`,
    `  <div class="tree-row-main">`,
    `    <div class="node-cell" style="padding-left:${indentPx}px">`,
    `      <span class="kind-tag">${escapeHtml(kindLabel)}</span>`,
    `      <span class="node-name" title="${escapeHtml(nodeName + swarmSuffix)}">${escapeHtml(nodeName + swarmSuffix)}</span>`,
    `    </div>`,
    `    <div class="node-badges">`,
    `      <span class="pill pill-xs pill-model" data-tier="${effectiveTier}" title="${escapeHtml(fullModelTitle)}">${escapeHtml(compactModelText)}</span>`,
    fallbackBadge ? `      ${fallbackBadge}` : "",
    retryBadge ? `      ${retryBadge}` : "",
    `      <span class="phase-txt tabular-nums" data-phase-tier="${phaseTier}">${escapeHtml(phaseStr)}</span>`,
    `      <span class="node-metrics tabular-nums">CTX ${escapeHtml(ctxPct)} \xB7 \u0394${escapeHtml(deltaStr)}</span>`,
    `    </div>`,
    `  </div>`,
    `  <div class="tree-row-sub" style="padding-left:${indentPx}px">`,
    `    <span class="sub-model" title="${escapeHtml(fullModelTitle)}">${escapeHtml(fullModelText)}</span>`,
    `    <span class="sub-action" title="${escapeHtml(actionText)}">${escapeHtml(actionText)}</span>`,
    `  </div>`,
    `</div>`
  ].filter(Boolean).join("\n");
}
var CARD_CSS = `
:root {
  color-scheme: light dark;
  --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  --paper: #fffcf0;
  --surface: #f2f0e5;
  --surface-alt: #e6e4d9;
  --border: #cecdc3;
  --ink: #100f0f;
  --muted: #6f6e69;
  --tier-apex: #5e409d;
  --tier-workhorse: #205ea6;
  --tier-fast: #24837b;
  --tier-orchestrator: #ad8301;
  --tier-alert: #af3029;
  --tier-apex-ink: #4b3182;
  --tier-workhorse-ink: #184b85;
  --tier-fast-ink: #19635d;
  --tier-orchestrator-ink: #5c4500;
  --tier-alert-ink: #8f241f;
  --tier-apex-bg: rgba(94, 64, 157, 0.1);
  --tier-workhorse-bg: rgba(32, 94, 166, 0.1);
  --tier-fast-bg: rgba(36, 131, 123, 0.1);
  --tier-orchestrator-bg: rgba(173, 131, 1, 0.12);
  --tier-alert-bg: rgba(175, 48, 41, 0.11);
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #100f0f;
    --surface: #1c1b1a;
    --surface-alt: #282726;
    --border: #403e3c;
    --ink: #cecdc3;
    --muted: #878580;
    --tier-apex: #8b7ec8;
    --tier-workhorse: #4385be;
    --tier-fast: #3aa99f;
    --tier-orchestrator: #d0a215;
    --tier-alert: #d14d41;
    --tier-apex-ink: #c2b9ea;
    --tier-workhorse-ink: #8cc0ec;
    --tier-fast-ink: #76d4cc;
    --tier-orchestrator-ink: #f3da8b;
    --tier-alert-ink: #f0958d;
    --tier-apex-bg: rgba(139, 126, 200, 0.16);
    --tier-workhorse-bg: rgba(67, 133, 190, 0.16);
    --tier-fast-bg: rgba(58, 169, 159, 0.16);
    --tier-orchestrator-bg: rgba(208, 162, 21, 0.16);
    --tier-alert-bg: rgba(209, 77, 65, 0.16);
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --paper: #fffcf0;
  --surface: #f2f0e5;
  --surface-alt: #e6e4d9;
  --border: #cecdc3;
  --ink: #100f0f;
  --muted: #6f6e69;
  --tier-apex: #5e409d;
  --tier-workhorse: #205ea6;
  --tier-fast: #24837b;
  --tier-orchestrator: #ad8301;
  --tier-alert: #af3029;
  --tier-apex-ink: #4b3182;
  --tier-workhorse-ink: #184b85;
  --tier-fast-ink: #19635d;
  --tier-orchestrator-ink: #5c4500;
  --tier-alert-ink: #8f241f;
  --tier-apex-bg: rgba(94, 64, 157, 0.1);
  --tier-workhorse-bg: rgba(32, 94, 166, 0.1);
  --tier-fast-bg: rgba(36, 131, 123, 0.1);
  --tier-orchestrator-bg: rgba(173, 131, 1, 0.12);
  --tier-alert-bg: rgba(175, 48, 41, 0.11);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --paper: #100f0f;
  --surface: #1c1b1a;
  --surface-alt: #282726;
  --border: #403e3c;
  --ink: #cecdc3;
  --muted: #878580;
  --tier-apex: #8b7ec8;
  --tier-workhorse: #4385be;
  --tier-fast: #3aa99f;
  --tier-orchestrator: #d0a215;
  --tier-alert: #d14d41;
  --tier-apex-ink: #c2b9ea;
  --tier-workhorse-ink: #8cc0ec;
  --tier-fast-ink: #76d4cc;
  --tier-orchestrator-ink: #f3da8b;
  --tier-alert-ink: #f0958d;
  --tier-apex-bg: rgba(139, 126, 200, 0.16);
  --tier-workhorse-bg: rgba(67, 133, 190, 0.16);
  --tier-fast-bg: rgba(58, 169, 159, 0.16);
  --tier-orchestrator-bg: rgba(208, 162, 21, 0.16);
  --tier-alert-bg: rgba(209, 77, 65, 0.16);
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 12px;
  line-height: 1.35;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
.tabular-nums { font-variant-numeric: tabular-nums; }
.card {
  width: 100%;
  max-width: 596px;
  margin: 0 auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 9px;
  min-width: 0;
}
.head-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--tier-fast);
  flex-shrink: 0;
}
.dot[data-state="alert"] { background: var(--tier-alert); }
.dot[data-state="idle"] { background: var(--muted); }
.title {
  margin: 4px 0 4px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  word-break: break-word;
}
.routing-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.pill {
  display: inline-block;
  vertical-align: middle;
  line-height: 1.35;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  border: 1px solid var(--border);
  background: var(--surface-alt);
  color: var(--ink);
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill-xs { padding: 1px 6px; font-size: 10px; line-height: 1.3; }
.pill-model { max-width: 165px; }
.pill[data-tier="apex"] { border-color: var(--tier-apex); background: var(--tier-apex-bg); color: var(--tier-apex-ink); }
.pill[data-tier="workhorse"] { border-color: var(--tier-workhorse); background: var(--tier-workhorse-bg); color: var(--tier-workhorse-ink); }
.pill[data-tier="fast"] { border-color: var(--tier-fast); background: var(--tier-fast-bg); color: var(--tier-fast-ink); }
.pill[data-tier="orchestrator"] { border-color: var(--tier-orchestrator); background: var(--tier-orchestrator-bg); color: var(--tier-orchestrator-ink); }
.pill[data-tier="alert"] { border-color: var(--tier-alert); background: var(--tier-alert-bg); color: var(--tier-alert-ink); }
.mono-id {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--muted);
  word-break: break-all;
}
.bars-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 420px) {
  .bars-grid { grid-template-columns: minmax(0, 1fr); }
}
.bar-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  margin-bottom: 4px;
}
.bar-label { font-weight: 600; color: var(--ink); }
.bar-val { color: var(--muted); font-size: 10.5px; }
.bar-track {
  height: 6px;
  width: 100%;
  border-radius: 999px;
  background: var(--surface-alt);
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--tier-fast);
}
.bar-fill[data-level="warn_70"] { background: var(--tier-orchestrator); }
.bar-fill[data-level="critical_85"] { background: var(--tier-alert); }
.bar-fill[data-kind="cache"] { background: var(--tier-workhorse); }
.fuel-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}
@media (max-width: 460px) {
  .fuel-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.fuel-cell {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 5px 7px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.fuel-cell[data-fuel-level="warn"] { border-color: var(--tier-orchestrator); }
.fuel-cell[data-fuel-level="alert"] { border-color: var(--tier-alert); }
.fuel-label { font-size: 10px; color: var(--muted); font-weight: 600; }
.fuel-val { font-size: 12px; font-weight: 700; color: var(--ink); }
.fuel-cell[data-fuel-level="alert"] .fuel-val { color: var(--tier-alert-ink); }
.fuel-sub { font-size: 10px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.banner {
  border-radius: 5px;
  padding: 6px 8px;
  font-size: 11px;
  border: 1px solid var(--tier-orchestrator);
  background: var(--tier-orchestrator-bg);
  color: var(--tier-orchestrator-ink);
  word-break: break-word;
}
.banner[data-level="alert"] {
  border-color: var(--tier-alert);
  background: var(--tier-alert-bg);
  color: var(--tier-alert-ink);
}
.tree-wrap { padding: 0; overflow: hidden; }
.tree-head {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
}
.tree-list {
  display: flex;
  flex-direction: column;
}
.tree-row {
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.tree-row:last-child { border-bottom: none; }
.tree-row.is-focused { background: var(--surface-alt); }
.tree-row-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.node-cell {
  flex: 1 1 130px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
}
.kind-tag {
  flex: 0 0 auto;
  font-size: 9.5px;
  font-weight: 600;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  color: var(--muted);
}
.node-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.node-badges {
  flex: 0 1 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin-left: auto;
  max-width: 100%;
}
.node-badges .pill { flex: 0 0 auto; }
.phase-txt {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 10.5px;
}
.node-metrics {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 10.5px;
  color: var(--muted);
}
.tree-row-sub {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--muted);
  margin-top: 2px;
  min-width: 0;
}
.sub-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-action {
  flex: 0 1 auto;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phase-txt[data-phase-tier="apex"] { color: var(--tier-apex-ink); font-weight: 600; }
.phase-txt[data-phase-tier="workhorse"] { color: var(--tier-workhorse-ink); font-weight: 600; }
.phase-txt[data-phase-tier="fast"] { color: var(--tier-fast-ink); font-weight: 600; }
.phase-txt[data-phase-tier="alert"] { color: var(--tier-alert-ink); font-weight: 600; }
.phase-txt[data-phase-tier="muted"] { color: var(--muted); }
.empty-msg { padding: 10px; font-size: 11px; color: var(--muted); text-align: center; }
.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  color: var(--muted);
  padding: 0 2px;
  flex-wrap: wrap;
}
`.trim();
function buildStatusCardHtml(input) {
  const theme = input.theme === "light" || input.theme === "dark" ? input.theme : "auto";
  const includeTree = input.includeTree !== false;
  const active = input.activeNode;
  const nodes = Array.isArray(input.treeNodes) ? input.treeNodes : [];
  const titleText = active?.title || (input.hostConnected ? "Active Cascade" : "Model Pulse Offline");
  const cidLabel = input.conversationId || active?.cascadeId || "global";
  const statusPill = active ? formatPhaseBadge(active) : input.hostConnected ? { label: "NO ACTIVE CASCADE", isActive: false, isAlert: false } : { label: input.stale ? "OFFLINE / STALE" : "OFFLINE", isActive: false, isAlert: true };
  const dotState = statusPill.isAlert ? "alert" : statusPill.isActive ? "active" : "idle";
  const statusTier = statusPill.isAlert ? "alert" : active ? sanitizeTier(active.servedModel.tier) : "workhorse";
  const ctxPct = clampPct(active?.contextWindow.pct ?? 0);
  const ctxLevel = active?.contextWindow.level ?? "normal";
  const ctxLabel = active ? `${formatTokensCompact(active.contextWindow.estimatedTokensUsed)} / ${formatTokensCompact(active.contextWindow.maxContextTokens)} (${formatPct(ctxPct, 1)})` : "\u2014";
  const cachePct = clampPct(active?.cacheHitPct ?? 0);
  const cacheLabel = active ? `${formatPct(cachePct, 1)} \xB7 In ${formatTokensCompact(active.tokens.inputTokens)} / Out ${formatTokensCompact(active.tokens.outputTokens)}` : "\u2014";
  const g5h = input.quota?.gemini5h ?? null;
  const gWk = input.quota?.geminiWeekly ?? null;
  const p3 = input.quota?.thirdParty5h ?? null;
  const treeDelta = formatDeltaQuotaPct(input.quota?.treeNetDelta5hPct ?? null);
  const resetSub = g5h?.resetInLabel ? `reset ${g5h.resetInLabel}` : "reset \u2014";
  const headerHtml = [
    `<section class="panel">`,
    `  <div class="head-top">`,
    `    <span class="brand"><span class="dot" data-state="${dotState}"></span>Model Pulse</span>`,
    `    <span class="pill" data-tier="${statusTier}">${escapeHtml(statusPill.label)}</span>`,
    `  </div>`,
    `  <h1 class="title">${escapeHtml(titleText)}</h1>`,
    active ? `  ${buildRoutingPill(active)}` : `  <div class="mono-id">cid: ${escapeHtml(cidLabel)}</div>`,
    active ? `  <div class="mono-id" style="margin-top:4px">cid: ${escapeHtml(cidLabel)}</div>` : "",
    `</section>`
  ].filter(Boolean).join("\n");
  const healthHtml = [
    `<section class="panel bars-grid">`,
    `  <div>`,
    `    <div class="bar-head"><span class="bar-label">CTX Window</span><span class="bar-val tabular-nums">${escapeHtml(ctxLabel)}</span></div>`,
    `    <div class="bar-track"><div class="bar-fill" data-level="${escapeHtml(ctxLevel)}" style="width:${ctxPct.toFixed(1)}%"></div></div>`,
    `  </div>`,
    `  <div>`,
    `    <div class="bar-head"><span class="bar-label">Cache Hit</span><span class="bar-val tabular-nums">${escapeHtml(cacheLabel)}</span></div>`,
    `    <div class="bar-track"><div class="bar-fill" data-kind="cache" style="width:${cachePct.toFixed(1)}%"></div></div>`,
    `  </div>`,
    `</section>`
  ].join("\n");
  const fuelHtml = [
    `<section class="panel fuel-strip">`,
    formatBucketCell("Gemini 5h", g5h),
    formatBucketCell("Gemini Wk", gWk),
    formatBucketCell("3P 5h", p3),
    [
      `<div class="fuel-cell" data-fuel-level="ok">`,
      `  <span class="fuel-label">Tree \u0394Quota</span>`,
      `  <span class="fuel-val tabular-nums">${escapeHtml(treeDelta)}</span>`,
      `  <span class="fuel-sub tabular-nums">${escapeHtml(resetSub)}</span>`,
      `</div>`
    ].join("\n"),
    `</section>`
  ].join("\n");
  const bannerList = [];
  if (input.smartGovernanceBanner?.active && input.smartGovernanceBanner.message) {
    bannerList.push(
      `<div class="banner" data-level="warn">${escapeHtml(input.smartGovernanceBanner.message)}</div>`
    );
  }
  for (const warn of input.warnings ?? []) {
    if (!warn) continue;
    const isCrit = /critical|< 15%|< 20%|offline|error/i.test(warn);
    bannerList.push(
      `<div class="banner" data-level="${isCrit ? "alert" : "warn"}">${escapeHtml(warn)}</div>`
    );
  }
  let treeHtml = "";
  if (includeTree) {
    const bodyHtml = nodes.length > 0 ? [
      `<div class="tree-list">`,
      nodes.map((n) => renderNodeRow(n, n.cascadeId === active?.cascadeId)).join("\n"),
      `</div>`
    ].join("\n") : `<div class="empty-msg">No active cascade nodes found in $PULSE_STATE_DIR. Start a session or open Model Pulse sidecar.</div>`;
    treeHtml = [
      `<section class="panel tree-wrap">`,
      `  <div class="tree-head"><span>Cascade Topology</span><span class="tabular-nums">${nodes.length} node${nodes.length === 1 ? "" : "s"}</span></div>`,
      bodyHtml,
      `</section>`
    ].join("\n");
  }
  const connText = input.hostConnected ? input.stale ? "Host: Stale" : "Host: Live" : "Host: Disconnected";
  const footerHtml = [
    `<footer class="foot tabular-nums">`,
    `  <span>${escapeHtml(connText)} \xB7 ${nodes.length} node${nodes.length === 1 ? "" : "s"}</span>`,
    `  <span>${escapeHtml(input.generatedAt)}</span>`,
    `</footer>`
  ].join("\n");
  const colorSchemeMeta = theme === "auto" ? "light dark" : theme;
  return [
    `<!doctype html>`,
    `<html lang="en" data-theme="${theme}">`,
    `<head>`,
    `  <meta charset="utf-8">`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1">`,
    `  <meta name="color-scheme" content="${colorSchemeMeta}">`,
    `  <title>Model Pulse \u2014 ${escapeHtml(titleText)}</title>`,
    `  <style>${CARD_CSS}</style>`,
    `</head>`,
    `<body>`,
    `  <main class="card">`,
    headerHtml,
    healthHtml,
    fuelHtml,
    bannerList.join("\n"),
    treeHtml,
    footerHtml,
    `  </main>`,
    `</body>`,
    `</html>`,
    ``
  ].filter(Boolean).join("\n");
}
function tryChmod2(targetPath, mode) {
  if (process.platform === "win32") return;
  try {
    (0, import_node_fs3.chmodSync)(targetPath, mode);
  } catch {
  }
}
function resolveSafeCardConversationSegment(conversationId) {
  if (conversationId === null || conversationId === void 0) {
    return "global";
  }
  const trimmed = conversationId.trim();
  if (!trimmed || trimmed === "global") {
    return "global";
  }
  if (!isValidUuid(trimmed)) {
    throw new RangeError("Invalid conversationId: expected 36-character UUID");
  }
  return trimmed;
}
function writeStatusCardFile(input, options = {}) {
  const safeCid = resolveSafeCardConversationSegment(input.conversationId);
  const paths = getStatePaths(options.stateDir);
  const cardsDir = import_node_path3.default.join(paths.stateDir, "cards");
  (0, import_node_fs3.mkdirSync)(paths.stateDir, { recursive: true, mode: 448 });
  tryChmod2(paths.stateDir, 448);
  (0, import_node_fs3.mkdirSync)(cardsDir, { recursive: true, mode: 448 });
  tryChmod2(cardsDir, 448);
  const ts = typeof options.timestampMs === "number" && Number.isFinite(options.timestampMs) ? Math.trunc(options.timestampMs) : Date.now();
  const fileName = `${safeCid}-${ts}.html`;
  const outputPath = import_node_path3.default.join(cardsDir, fileName);
  const resolvedCardsDir = import_node_path3.default.resolve(cardsDir);
  const resolvedOut = import_node_path3.default.resolve(outputPath);
  if (!resolvedOut.startsWith(`${resolvedCardsDir}${import_node_path3.default.sep}`)) {
    throw new RangeError("Refusing to write status card outside $PULSE_STATE_DIR/cards");
  }
  const html = buildStatusCardHtml(input);
  const tmpPath = `${outputPath}.${process.pid}.${ts}.${(0, import_node_crypto.randomBytes)(4).toString("hex")}.tmp`;
  try {
    (0, import_node_fs3.writeFileSync)(tmpPath, html, { encoding: "utf8", mode: 384 });
    tryChmod2(tmpPath, 384);
    (0, import_node_fs3.renameSync)(tmpPath, outputPath);
  } catch (err) {
    try {
      if ((0, import_node_fs3.existsSync)(tmpPath)) {
        (0, import_node_fs3.unlinkSync)(tmpPath);
      }
    } catch {
    }
    throw err;
  }
  return {
    safeConversationId: safeCid,
    outputPath,
    fileUri: (0, import_node_url.pathToFileURL)(outputPath).href,
    html
  };
}

// src/mcp/server.ts
var MCP_SERVER_NAME = "antigravity-pulse";
var MCP_SERVER_VERSION = "0.1.0";
var DEFAULT_PROTOCOL_VERSION = "2024-11-05";
var SIDECAR_PILL_MARKDOWN = `[Model Pulse](${CANONICAL_HUD_URI})`;
var MAX_CONTENT_LENGTH_BYTES = 16 * 1024 * 1024;
var LS_RPC_TIMEOUT_MS = 1500;
var STALE_THRESHOLD_MS = 3e4;
var MAX_LIVE_META_CASCADES = 12;
var MCP_TOOL_DEFINITIONS = [
  {
    name: "pulse_status_card",
    description: "Generate a self-contained Flexoki Light/Dark HTML status card in $PULSE_STATE_DIR/cards/ for the active conversation, multi-agent topology, and quota buckets, returning an <agent-embed> tag and sidecar:// pill.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: {
          type: "string",
          description: "Optional 36-character conversation UUID. Defaults to active conversation context."
        },
        theme: {
          type: "string",
          enum: ["auto", "light", "dark"],
          description: "Card color theme polarity (defaults to auto)."
        },
        includeTree: {
          type: "boolean",
          description: "Include multi-agent subagent/workflow/swarm topology table (defaults to true)."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "pulse_get_compute_budget",
    description: "Query live active model routing, context window saturation (%), and 5h/weekly quota headroom before spawning parallel subagents or swarms; recommends inherit, argon, or flash.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: {
          type: "string",
          description: "Optional 36-character conversation UUID."
        },
        plannedSubagentCount: {
          type: "integer",
          minimum: 0,
          description: "Optional count of parallel subagent/swarm workers planned to spawn."
        },
        taskKind: {
          type: "string",
          enum: ["exploration", "coding", "review", "general"],
          description: "Optional task category for subagent tier recommendation."
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "pulse_set_preference",
    description: "Validate and atomically persist Model Pulse user preferences in $PULSE_STATE_DIR/config.json (inlineStampMode, hudSortMode, timelineScope, smartThresholds).",
    inputSchema: {
      type: "object",
      properties: {
        inlineStampMode: {
          type: "string",
          enum: ["smart", "every-turn", "off"],
          description: "Inline chat turn stamp policy."
        },
        hudSortMode: {
          type: "string",
          enum: ["active-first", "topology-tree"],
          description: "Pulse HUD live agent list ordering mode."
        },
        timelineScope: {
          type: "string",
          enum: ["conversation", "tree"],
          description: "Timeline scope (single conversation vs whole cascade tree)."
        },
        smartThresholds: {
          type: "object",
          properties: {
            contextWarnPct: { type: "number", minimum: 1, maximum: 100 },
            contextCriticalPct: { type: "number", minimum: 1, maximum: 100 },
            stampContextTriggerPct: { type: "number", minimum: 1, maximum: 100 },
            quotaLowTriggerPct: { type: "number", minimum: 1, maximum: 100 },
            heavyConcurrentAlertCount: { type: "integer", minimum: 1, maximum: 100 },
            heavyQuotaThresholdPct: { type: "number", minimum: 1, maximum: 100 }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  }
];
function isPlainRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function serializeJsonRpcMessage(payload, framing) {
  const json = JSON.stringify(payload);
  if (framing === "content-length") {
    const bytes = Buffer.byteLength(json, "utf8");
    return `Content-Length: ${bytes}\r
\r
${json}`;
  }
  return `${json}
`;
}
function isAsciiWhitespace(byte) {
  return byte === 32 || byte === 9 || byte === 13 || byte === 10;
}
function findHeaderTerminator(buf) {
  const crlfIdx = buf.indexOf("\r\n\r\n");
  const lfIdx = buf.indexOf("\n\n");
  if (crlfIdx === -1 && lfIdx === -1) {
    return null;
  }
  if (crlfIdx !== -1 && (lfIdx === -1 || crlfIdx < lfIdx)) {
    return { index: crlfIdx, length: 4 };
  }
  return { index: lfIdx, length: 2 };
}
var McpFrameDecoder = class {
  buffer = Buffer.alloc(0);
  push(chunk, eof = false) {
    if (chunk.length > 0) {
      this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    }
    return this.drain(eof);
  }
  flushEnd() {
    return this.drain(true);
  }
  drain(eof) {
    const frames = [];
    while (this.buffer.length > 0) {
      let start = 0;
      while (start < this.buffer.length && isAsciiWhitespace(this.buffer[start])) {
        start += 1;
      }
      if (start > 0) {
        this.buffer = this.buffer.subarray(start);
      }
      if (this.buffer.length === 0) {
        break;
      }
      const firstByte = this.buffer[0];
      if (firstByte === 123 || firstByte === 91) {
        const nlIdx2 = this.buffer.indexOf(10);
        if (nlIdx2 === -1) {
          if (!eof) {
            break;
          }
          const trailing = this.buffer.toString("utf8").trim();
          this.buffer = Buffer.alloc(0);
          if (trailing) {
            frames.push({ framing: "ndjson", rawJson: trailing });
          }
          break;
        }
        const line = this.buffer.subarray(0, nlIdx2).toString("utf8").replace(/\r$/, "").trim();
        this.buffer = this.buffer.subarray(nlIdx2 + 1);
        if (line) {
          frames.push({ framing: "ndjson", rawJson: line });
        }
        continue;
      }
      const nlIdx = this.buffer.indexOf(10);
      if (nlIdx === -1) {
        if (!eof) {
          break;
        }
        const trailing = this.buffer.toString("utf8").trim();
        this.buffer = Buffer.alloc(0);
        if (trailing) {
          if (/^content-(?:length|type)\s*:/i.test(trailing)) {
            frames.push({ framing: "content-length", parseError: true });
          } else {
            frames.push({ framing: "ndjson", rawJson: trailing });
          }
        }
        break;
      }
      const firstLine = this.buffer.subarray(0, nlIdx).toString("latin1").replace(/\r$/, "");
      if (!/^content-(?:length|type)\s*:/i.test(firstLine)) {
        const line = this.buffer.subarray(0, nlIdx).toString("utf8").replace(/\r$/, "").trim();
        this.buffer = this.buffer.subarray(nlIdx + 1);
        if (line) {
          frames.push({ framing: "ndjson", rawJson: line });
        }
        continue;
      }
      const term = findHeaderTerminator(this.buffer);
      if (!term) {
        if (!eof) {
          break;
        }
        this.buffer = Buffer.alloc(0);
        frames.push({ framing: "content-length", parseError: true });
        break;
      }
      const headersRaw = this.buffer.subarray(0, term.index).toString("latin1");
      const lenMatch = /(?:^|\r?\n)\s*content-length\s*:\s*(\d+)\s*(?=\r?\n|$)/i.exec(headersRaw);
      const contentLength = lenMatch?.[1] ? Number.parseInt(lenMatch[1], 10) : Number.NaN;
      const bodyStart = term.index + term.length;
      if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_CONTENT_LENGTH_BYTES) {
        this.buffer = this.buffer.subarray(bodyStart);
        frames.push({ framing: "content-length", parseError: true });
        continue;
      }
      const bodyEnd = bodyStart + contentLength;
      if (this.buffer.length < bodyEnd) {
        if (!eof) {
          break;
        }
        this.buffer = Buffer.alloc(0);
        frames.push({ framing: "content-length", parseError: true });
        break;
      }
      const rawJson = this.buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.subarray(bodyEnd);
      frames.push({ framing: "content-length", rawJson });
    }
    return frames;
  }
};
function makeToolError(message) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, error: message }, null, 2)
      }
    ],
    isError: true
  };
}
function makeToolSuccess(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}
function parseExplicitUuidArg(args) {
  if (!Object.hasOwn(args, "conversationId") || args.conversationId === void 0 || args.conversationId === null) {
    return { provided: false, uuid: null };
  }
  if (typeof args.conversationId !== "string") {
    throw new RangeError("Invalid conversationId: expected 36-character UUID string");
  }
  const trimmed = args.conversationId.trim();
  if (!trimmed) {
    return { provided: false, uuid: null };
  }
  if (!isValidUuid(trimmed)) {
    throw new RangeError("Invalid conversationId: expected 36-character UUID");
  }
  return { provided: true, uuid: trimmed };
}
function resolveTreeNodes(nodesByCascadeId, targetCid) {
  const allNodes = Object.values(nodesByCascadeId);
  if (allNodes.length === 0) {
    return { activeNode: null, treeNodes: [] };
  }
  const activeNode = targetCid ? nodesByCascadeId[targetCid] ?? null : null;
  const rootId = activeNode?.rootCascadeId ?? targetCid;
  if (!rootId) {
    return { activeNode: null, treeNodes: [] };
  }
  const matching = allNodes.filter((n) => n.rootCascadeId === rootId || n.cascadeId === rootId);
  if (matching.length === 0) {
    return { activeNode, treeNodes: activeNode ? [activeNode] : [] };
  }
  const ordered = [];
  const seen = /* @__PURE__ */ new Set();
  const visit = (cid) => {
    if (seen.has(cid)) return;
    const node = nodesByCascadeId[cid];
    if (!node || node.rootCascadeId !== rootId && node.cascadeId !== rootId) {
      return;
    }
    seen.add(cid);
    ordered.push(node);
    for (const childId of node.childrenIds ?? []) {
      visit(childId);
    }
  };
  visit(rootId);
  const remaining = matching.filter((n) => !seen.has(n.cascadeId)).sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const aSpawn = a.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
    const bSpawn = b.spawnStepIndex ?? Number.MAX_SAFE_INTEGER;
    if (aSpawn !== bSpawn) return aSpawn - bSpawn;
    return a.cascadeId < b.cascadeId ? -1 : a.cascadeId > b.cascadeId ? 1 : 0;
  });
  return {
    activeNode: activeNode ?? ordered[0] ?? remaining[0] ?? null,
    treeNodes: [...ordered, ...remaining]
  };
}
function pickFallbackConversationId(snapshot, nodesByCascadeId) {
  if (snapshot?.activeConversationId && isValidUuid(snapshot.activeConversationId)) {
    if (Object.keys(nodesByCascadeId).length === 0 || nodesByCascadeId[snapshot.activeConversationId]) {
      return snapshot.activeConversationId;
    }
  }
  const allNodes = Object.values(nodesByCascadeId);
  if (allNodes.length === 0) {
    return snapshot?.activeConversationId ?? null;
  }
  const byModDesc = (a, b) => {
    const aMs = Date.parse(a.lastModifiedTime) || 0;
    const bMs = Date.parse(b.lastModifiedTime) || 0;
    if (bMs !== aMs) return bMs - aMs;
    return a.cascadeId < b.cascadeId ? -1 : a.cascadeId > b.cascadeId ? 1 : 0;
  };
  const runningNode = allNodes.filter(
    (n) => n.status === "CASCADE_RUN_STATUS_RUNNING" || n.phase !== "IDLE" && n.phase !== "ERROR_OR_QUOTA"
  ).sort(byModDesc)[0];
  if (runningNode) {
    return runningNode.cascadeId;
  }
  const latestRoot = allNodes.filter((n) => n.parentCascadeId === null || n.kind === "root").sort(byModDesc)[0];
  if (latestRoot) {
    return latestRoot.cascadeId;
  }
  return allNodes.sort(byModDesc)[0]?.cascadeId ?? null;
}
function buildCatalogFromMapFile(mapFile) {
  if (!mapFile || !mapFile.modelsByEnum) {
    return buildModelCatalog(null);
  }
  const modelsById = {};
  for (const entry of Object.values(mapFile.modelsByEnum)) {
    if (entry?.modelId) {
      modelsById[entry.modelId] = entry;
    }
  }
  return {
    defaultModelEnum: mapFile.defaultModelEnum ?? null,
    modelsByEnum: mapFile.modelsByEnum,
    modelsById
  };
}
function isRunningSummary(summary) {
  return summary?.status === "CASCADE_RUN_STATUS_RUNNING";
}
async function loadMcpTelemetry(options = {}) {
  const env = options.context?.env ?? process.env;
  const nowMs = options.context?.nowMs ? options.context.nowMs() : Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const paths = getStatePaths(options.context?.stateDir);
  const config = loadConfig(paths.stateDir);
  const antigravityDataDir = options.context?.antigravityDataDir?.trim() || env.ANTIGRAVITY_DATA_DIR?.trim() || import_node_path4.default.join(import_node_os2.default.homedir(), ".gemini", "antigravity");
  const snapshot = readJsonSafe(paths.liveSnapshot, null);
  const quotaCache = readJsonSafe(paths.quotaCache, null);
  const modelMap = readJsonSafe(paths.modelMap, null);
  let nodesByCascadeId = snapshot && isPlainRecord2(snapshot.nodesByCascadeId) ? snapshot.nodesByCascadeId : {};
  let quota = snapshot?.quota ?? quotaCache?.quota ?? null;
  let hostConnected = Boolean(snapshot?.hostConnected);
  let liveRefreshSucceeded = false;
  const warnings = [];
  const metaCidRaw = typeof options.metaConversationId === "string" ? options.metaConversationId.trim() : "";
  const envCidRaw = typeof env.ANTIGRAVITY_CONVERSATION_ID === "string" ? env.ANTIGRAVITY_CONVERSATION_ID.trim() : "";
  const preferredCid = (options.explicitConversationId && isValidUuid(options.explicitConversationId) ? options.explicitConversationId : null) ?? (metaCidRaw && isValidUuid(metaCidRaw) ? metaCidRaw : null) ?? (envCidRaw && isValidUuid(envCidRaw) ? envCidRaw : null);
  const lsAddress = env.ANTIGRAVITY_LS_ADDRESS?.trim() || "";
  const lsCsrf = env.ANTIGRAVITY_CSRF_TOKEN?.trim() || "";
  if (lsAddress && lsCsrf) {
    const lsClient = new ReadOnlyLsClient({
      address: lsAddress,
      csrfToken: lsCsrf,
      timeoutMs: LS_RPC_TIMEOUT_MS
    });
    if (lsClient.isConfigured()) {
      const [modelRes, quotaRes, trajRes] = await Promise.allSettled([
        lsClient.getCascadeModelConfigData(),
        lsClient.retrieveUserQuotaSummary(),
        lsClient.getAllCascadeTrajectories()
      ]);
      const catalog = modelRes.status === "fulfilled" ? buildModelCatalog(modelRes.value) : buildCatalogFromMapFile(modelMap);
      let trajectories = {};
      if (trajRes.status === "fulfilled") {
        trajectories = trajRes.value.trajectorySummaries ?? {};
        liveRefreshSucceeded = true;
        hostConnected = true;
      }
      if (quotaRes.status === "fulfilled") {
        const normalized = normalizeQuotaSummary(
          quotaRes.value,
          quotaCache,
          Object.keys(trajectories),
          generatedAt
        );
        quota = normalized.quota;
        liveRefreshSucceeded = true;
        hostConnected = true;
      }
      const trajIds = Object.keys(trajectories);
      if (trajIds.length > 0) {
        const prioritizedIds = [...trajIds].sort((a, b) => {
          if (preferredCid) {
            if (a === preferredCid) return -1;
            if (b === preferredCid) return 1;
          }
          const aRun = isRunningSummary(trajectories[a]) ? 1 : 0;
          const bRun = isRunningSummary(trajectories[b]) ? 1 : 0;
          if (bRun !== aRun) return bRun - aRun;
          const aMod = Date.parse(trajectories[a]?.lastModifiedTime ?? "") || 0;
          const bMod = Date.parse(trajectories[b]?.lastModifiedTime ?? "") || 0;
          return bMod - aMod;
        }).slice(0, MAX_LIVE_META_CASCADES);
        const generatorMetadataByCascade = {};
        const stepsByCascade = {};
        await Promise.all(
          prioritizedIds.map(async (cid) => {
            const summary = trajectories[cid];
            const metaPromise = lsClient.getCascadeTrajectoryGeneratorMetadata(cid).then((res) => {
              generatorMetadataByCascade[cid] = res.generatorMetadata ?? [];
            }).catch(() => {
            });
            const stepsPromise = isRunningSummary(summary) ? lsClient.getCascadeTrajectorySteps(cid, summary?.stepCount ?? 0).then((res) => {
              stepsByCascade[cid] = res.steps ?? [];
            }).catch(() => {
            }) : Promise.resolve();
            await Promise.all([metaPromise, stepsPromise]);
          })
        );
        const topo = buildTopologyGraph({
          antigravityDataDir,
          trajectories,
          generatorMetadataByCascade,
          stepsByCascade,
          modelCatalog: catalog,
          quotaBaselines: quotaCache?.cascadeBaselines,
          prevNodesByCascadeId: nodesByCascadeId,
          smartThresholds: config.smartThresholds,
          lsConnected: true,
          nowMs,
          enableSqliteFallback: false
        });
        if (Object.keys(topo.nodesByCascadeId).length > 0) {
          nodesByCascadeId = topo.nodesByCascadeId;
        }
      }
    }
  }
  let staleAgeMs = null;
  let stale = false;
  if (!liveRefreshSucceeded) {
    const parsedUpdatedAt = snapshot?.updatedAt ? Date.parse(snapshot.updatedAt) : Number.NaN;
    staleAgeMs = Number.isFinite(parsedUpdatedAt) ? Math.max(0, nowMs - parsedUpdatedAt) : null;
    stale = snapshot === null || !snapshot.hostConnected || staleAgeMs === null || !Number.isFinite(staleAgeMs) || staleAgeMs > STALE_THRESHOLD_MS;
  } else {
    staleAgeMs = 0;
    stale = false;
  }
  const conversationId = preferredCid ?? pickFallbackConversationId(snapshot, nodesByCascadeId);
  const { activeNode, treeNodes } = resolveTreeNodes(nodesByCascadeId, conversationId);
  const allNodes = Object.values(nodesByCascadeId);
  if (quota && quotaCache?.cascadeBaselines && treeNodes.length > 0) {
    let hasBaseline = false;
    let sum = 0;
    for (const node of treeNodes) {
      const b = quotaCache.cascadeBaselines[node.cascadeId];
      if (b) {
        hasBaseline = true;
        sum += Math.max(0, b.delta5hPct);
      }
    }
    if (hasBaseline) {
      quota = {
        ...quota,
        treeNetDelta5hPct: Math.round(sum * 1e8) / 1e8
      };
    }
  }
  const runningApexCount = (treeNodes.length > 0 ? treeNodes : allNodes).filter(
    (n) => n.phase !== "IDLE" && n.phase !== "ERROR_OR_QUOTA" && n.servedModel.tier === "apex"
  ).length;
  const g5hPct = quota?.gemini5h?.remainingPct ?? null;
  const smartBannerActive = runningApexCount >= config.smartThresholds.heavyConcurrentAlertCount && (g5hPct ?? 100) < config.smartThresholds.heavyQuotaThresholdPct;
  const smartGovernanceBanner = smartBannerActive ? {
    active: true,
    heavyConcurrentCount: runningApexCount,
    gemini5hRemainingPct: g5hPct,
    estimatedBurnPctPerMin: quota?.burnRate5hPctPerMin ?? null,
    message: `Smart Governance: ${runningApexCount} concurrent apex nodes active at ${g5hPct !== null ? g5hPct.toFixed(1) : "\u2014"}% 5h quota.`
  } : null;
  return {
    nowMs,
    generatedAt,
    hostConnected,
    stale,
    staleAgeMs,
    conversationId,
    activeNode,
    treeNodes,
    allNodes,
    quota,
    smartGovernanceBanner,
    config,
    warnings
  };
}
function evaluateComputeBudget(params) {
  const { telemetry, plannedSubagentCount, taskKind } = params;
  const g5h = telemetry.quota?.gemini5h?.remainingPct ?? null;
  const gWk = telemetry.quota?.geminiWeekly?.remainingPct ?? null;
  const p3 = telemetry.quota?.thirdParty5h?.remainingPct ?? null;
  const resetInLabel = telemetry.quota?.gemini5h?.resetInLabel ?? null;
  const scopeNodes = telemetry.treeNodes.length > 0 ? telemetry.treeNodes : telemetry.allNodes;
  const runningApexNodes = scopeNodes.filter(
    (n) => n.phase !== "IDLE" && n.phase !== "ERROR_OR_QUOTA" && n.servedModel.tier === "apex"
  ).length;
  const planned = plannedSubagentCount ?? 0;
  const projectedHeavyCount = runningApexNodes + planned;
  let recommendedSubagentModel = "inherit";
  let reason = "";
  if (g5h !== null && g5h < 25) {
    recommendedSubagentModel = "flash";
    reason = `Gemini 5h quota is ${g5h.toFixed(1)}% (< 25%); downgrade non-critical subagents to flash.`;
  } else if (runningApexNodes >= 3 && (g5h ?? 100) < 40) {
    recommendedSubagentModel = "flash";
    reason = `Smart Governance: ${runningApexNodes} concurrent apex nodes running with Gemini 5h quota at ${(g5h ?? 0).toFixed(1)}% (< 40%); use flash for subagents.`;
  } else if (taskKind === "exploration" && g5h !== null && g5h < 45) {
    recommendedSubagentModel = "flash";
    reason = `Exploration task under moderate Gemini 5h quota (${g5h.toFixed(1)}% < 45%); use flash for fast low-cost retrieval.`;
  } else if (planned >= 4 && (g5h ?? 100) < 55 || projectedHeavyCount >= 5 && (g5h ?? 100) < 50) {
    recommendedSubagentModel = "flash";
    reason = `Heavy subagent fan-out (${planned} planned, ${runningApexNodes} active apex) with Gemini 5h quota at ${g5h !== null ? g5h.toFixed(1) : "unknown"}%; use flash.`;
  } else if (g5h !== null && g5h < 45) {
    recommendedSubagentModel = "argon";
    reason = `Gemini 5h quota is ${g5h.toFixed(1)}% (25%..45%); use argon for balanced cost and capability.`;
  } else if (g5h === null) {
    recommendedSubagentModel = "inherit";
    reason = "Live quota telemetry unavailable; defaulting to inherit.";
  } else {
    recommendedSubagentModel = "inherit";
    reason = `Gemini 5h quota is healthy (${g5h.toFixed(1)}% >= 45%); safe to inherit active model.`;
  }
  const contextWindowPct = telemetry.activeNode ? Math.round(telemetry.activeNode.contextWindow.pct * 10) / 10 : null;
  const warnings = [];
  if (g5h === null) {
    warnings.push("Live quota telemetry unavailable; defaulting to inherit");
  } else if (g5h < 20) {
    warnings.push(`CRITICAL: Gemini 5h quota critically low (${g5h.toFixed(1)}% < 20%).`);
  } else if (g5h < 25) {
    warnings.push(`Low Gemini 5h quota (${g5h.toFixed(1)}% < 25%); preserve budget with flash.`);
  }
  if (contextWindowPct !== null) {
    if (contextWindowPct > 85) {
      warnings.push(
        `Context window critical (${contextWindowPct.toFixed(1)}% > 85%); recommend /compact before spawning subagents.`
      );
    } else if (contextWindowPct > 70) {
      warnings.push(`Context window elevated (${contextWindowPct.toFixed(1)}% > 70%).`);
    }
  }
  if (!telemetry.hostConnected) {
    warnings.push("Host telemetry disconnected; using cached/offline state.");
  } else if (telemetry.stale) {
    warnings.push("Telemetry snapshot is stale (> 30s).");
  }
  return {
    generatedAt: telemetry.generatedAt,
    conversationId: telemetry.conversationId,
    activeModel: telemetry.activeNode ? {
      displayName: telemetry.activeNode.servedModel.displayName,
      responseModel: telemetry.activeNode.servedModel.responseModel || telemetry.activeNode.servedModel.modelEnum,
      tier: telemetry.activeNode.servedModel.tier
    } : null,
    contextWindowPct,
    quota: {
      gemini5hRemainingPct: g5h,
      geminiWeeklyRemainingPct: gWk,
      thirdParty5hRemainingPct: p3,
      resetInLabel
    },
    recommendedSubagentModel,
    reason,
    warnings
  };
}
function buildStatusCardSummary(telemetry) {
  const active = telemetry.activeNode;
  const g5h = telemetry.quota?.gemini5h;
  const quotaStr = g5h ? `Gemini 5h ${formatPct(g5h.remainingPct, 1)} (${g5h.resetInLabel})` : "Gemini 5h \u2014";
  if (!active) {
    const statusLabel = telemetry.hostConnected ? "No active cascade" : "Offline";
    return `Model Pulse \xB7 ${statusLabel} \xB7 ${quotaStr}`;
  }
  const activeSubagents = telemetry.treeNodes.filter(
    (n) => n.cascadeId !== active.cascadeId && n.phase !== "IDLE" && n.phase !== "ERROR_OR_QUOTA"
  ).length;
  const phaseStr = active.phase === "IDLE" ? "IDLE" : `${active.phase} ${formatDurationCompact(active.phaseElapsedMs)}`;
  const modelPart = active.servedModel.responseModel ? `${active.servedModel.displayName} [${active.servedModel.responseModel}]` : active.servedModel.displayName;
  return [
    modelPart,
    phaseStr,
    `${activeSubagents} active subagent${activeSubagents === 1 ? "" : "s"}`,
    `CTX ${formatPct(active.contextWindow.pct, 1)}`,
    `Cache ${formatPct(active.cacheHitPct, 1)}`,
    quotaStr
  ].join(" \xB7 ");
}
var ALLOWED_PREF_KEYS = /* @__PURE__ */ new Set([
  "inlineStampMode",
  "hudSortMode",
  "timelineScope",
  "smartThresholds"
]);
async function handlePulseStatusCard(args, meta, context) {
  const { uuid: explicitCid } = parseExplicitUuidArg(args);
  let theme = "auto";
  if (Object.hasOwn(args, "theme") && args.theme !== void 0) {
    if (args.theme !== "auto" && args.theme !== "light" && args.theme !== "dark") {
      return makeToolError("Invalid theme: expected auto | light | dark");
    }
    theme = args.theme;
  }
  let includeTree = true;
  if (Object.hasOwn(args, "includeTree") && args.includeTree !== void 0) {
    if (typeof args.includeTree !== "boolean") {
      return makeToolError("Invalid includeTree: expected boolean");
    }
    includeTree = args.includeTree;
  }
  const telemetry = await loadMcpTelemetry({
    explicitConversationId: explicitCid,
    metaConversationId: meta?.["antigravity.google/conversation_id"],
    context
  });
  const cardWarnings = [...telemetry.warnings];
  if (!telemetry.hostConnected) {
    cardWarnings.push("Host telemetry disconnected; showing cached/offline state.");
  } else if (telemetry.stale) {
    cardWarnings.push("Telemetry snapshot is stale (> 30s).");
  }
  const persisted = writeStatusCardFile(
    {
      conversationId: telemetry.conversationId,
      generatedAt: telemetry.generatedAt,
      hostConnected: telemetry.hostConnected,
      stale: telemetry.stale,
      staleAgeMs: telemetry.staleAgeMs,
      activeNode: telemetry.activeNode,
      treeNodes: telemetry.treeNodes,
      quota: telemetry.quota,
      smartGovernanceBanner: telemetry.smartGovernanceBanner,
      warnings: cardWarnings,
      theme,
      includeTree
    },
    {
      stateDir: context.stateDir,
      timestampMs: telemetry.nowMs
    }
  );
  return makeToolSuccess({
    ok: true,
    conversationId: telemetry.conversationId,
    outputPath: persisted.outputPath,
    fileUri: persisted.fileUri,
    embedTag: `<agent-embed src="${persisted.fileUri}"></agent-embed>`,
    sidecarPill: SIDECAR_PILL_MARKDOWN,
    summary: buildStatusCardSummary(telemetry),
    hostConnected: telemetry.hostConnected,
    stale: telemetry.stale,
    nodeCount: telemetry.treeNodes.length
  });
}
async function handlePulseGetComputeBudget(args, meta, context) {
  const { uuid: explicitCid } = parseExplicitUuidArg(args);
  let plannedSubagentCount;
  if (Object.hasOwn(args, "plannedSubagentCount") && args.plannedSubagentCount !== void 0) {
    if (typeof args.plannedSubagentCount !== "number" || !Number.isInteger(args.plannedSubagentCount) || args.plannedSubagentCount < 0) {
      return makeToolError("Invalid plannedSubagentCount: expected non-negative integer");
    }
    plannedSubagentCount = args.plannedSubagentCount;
  }
  let taskKind;
  if (Object.hasOwn(args, "taskKind") && args.taskKind !== void 0) {
    if (args.taskKind !== "exploration" && args.taskKind !== "coding" && args.taskKind !== "review" && args.taskKind !== "general") {
      return makeToolError("Invalid taskKind: expected exploration | coding | review | general");
    }
    taskKind = args.taskKind;
  }
  const telemetry = await loadMcpTelemetry({
    explicitConversationId: explicitCid,
    metaConversationId: meta?.["antigravity.google/conversation_id"],
    context
  });
  const advice = evaluateComputeBudget({
    telemetry,
    plannedSubagentCount,
    taskKind
  });
  return makeToolSuccess(advice);
}
function handlePulseSetPreference(args, context) {
  const keys = Object.getOwnPropertyNames(args);
  if (keys.length === 0) {
    return makeToolError("At least one preference setting must be provided");
  }
  for (const key of keys) {
    if (!ALLOWED_PREF_KEYS.has(key)) {
      return makeToolError(`Unknown preference field: ${key}`);
    }
  }
  const validated = validateConfigPatch(args);
  const hasEffectiveSetting = validated.inlineStampMode !== void 0 || validated.hudSortMode !== void 0 || validated.timelineScope !== void 0 || validated.smartThresholds !== void 0 && Object.keys(validated.smartThresholds).length > 0;
  if (!hasEffectiveSetting) {
    return makeToolError("At least one recognized preference field must be provided");
  }
  const config = updateConfigPartial(validated, context.stateDir);
  return makeToolSuccess({
    ok: true,
    config,
    sidecarPill: SIDECAR_PILL_MARKDOWN
  });
}
async function dispatchToolCall(name, rawArgs, meta, context = {}) {
  try {
    if (rawArgs !== void 0 && rawArgs !== null && !isPlainRecord2(rawArgs)) {
      return makeToolError("Tool arguments must be a JSON object");
    }
    const args = isPlainRecord2(rawArgs) ? rawArgs : {};
    switch (name) {
      case "pulse_status_card":
        return await handlePulseStatusCard(args, meta, context);
      case "pulse_get_compute_budget":
        return await handlePulseGetComputeBudget(args, meta, context);
      case "pulse_set_preference":
        return handlePulseSetPreference(args, context);
      default:
        return makeToolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err instanceof ConfigValidationError || err instanceof RangeError) {
      return makeToolError(err.message);
    }
    return makeToolError(err instanceof Error ? err.message : String(err));
  }
}
async function handleJsonRpcMessage(parsed, context = {}) {
  if (!isPlainRecord2(parsed)) {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: "Invalid Request" }
    };
  }
  const rawId = Object.hasOwn(parsed, "id") ? parsed.id : void 0;
  const responseId = typeof rawId === "string" || typeof rawId === "number" || rawId === null ? rawId : null;
  const hasId = rawId !== void 0 && rawId !== null;
  if (parsed.jsonrpc !== void 0 && parsed.jsonrpc !== "2.0") {
    return {
      jsonrpc: "2.0",
      id: responseId,
      error: { code: -32600, message: "Invalid Request" }
    };
  }
  if (typeof parsed.method !== "string" || parsed.method.trim() === "") {
    return {
      jsonrpc: "2.0",
      id: responseId,
      error: { code: -32600, message: "Invalid Request" }
    };
  }
  const method = parsed.method;
  const params = isPlainRecord2(parsed.params) ? parsed.params : {};
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return null;
  }
  if (!hasId) {
    return null;
  }
  switch (method) {
    case "initialize": {
      const reqVersion = typeof params.protocolVersion === "string" && params.protocolVersion.trim() ? params.protocolVersion.trim() : DEFAULT_PROTOCOL_VERSION;
      return {
        jsonrpc: "2.0",
        id: rawId,
        result: {
          protocolVersion: reqVersion,
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            version: MCP_SERVER_VERSION
          }
        }
      };
    }
    case "ping": {
      return {
        jsonrpc: "2.0",
        id: rawId,
        result: {}
      };
    }
    case "tools/list": {
      return {
        jsonrpc: "2.0",
        id: rawId,
        result: {
          tools: MCP_TOOL_DEFINITIONS
        }
      };
    }
    case "tools/call": {
      const toolName = typeof params.name === "string" ? params.name : "";
      if (!toolName) {
        return {
          jsonrpc: "2.0",
          id: rawId,
          result: makeToolError("Missing required parameter: params.name")
        };
      }
      const meta = isPlainRecord2(params._meta) ? params._meta : void 0;
      const result = await dispatchToolCall(toolName, params.arguments, meta, context);
      return {
        jsonrpc: "2.0",
        id: rawId,
        result
      };
    }
    default: {
      return {
        jsonrpc: "2.0",
        id: rawId,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      };
    }
  }
}
function startMcpServer(context = {}) {
  const decoder = new McpFrameDecoder();
  let queue = Promise.resolve();
  const processFrames = (frames) => {
    for (const frame of frames) {
      queue = queue.then(async () => {
        if (frame.parseError) {
          const errPayload = {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" }
          };
          process.stdout.write(serializeJsonRpcMessage(errPayload, frame.framing));
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(frame.rawJson ?? "");
        } catch {
          const errPayload = {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" }
          };
          process.stdout.write(serializeJsonRpcMessage(errPayload, frame.framing));
          return;
        }
        const response = await handleJsonRpcMessage(parsed, context);
        if (response !== null) {
          process.stdout.write(serializeJsonRpcMessage(response, frame.framing));
        }
      });
    }
  };
  process.stdin.on("data", (chunk) => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    const frames = decoder.push(buf, false);
    processFrames(frames);
  });
  process.stdin.on("end", () => {
    const remaining = decoder.flushEnd();
    processFrames(remaining);
  });
}
var isMcpEntrypoint = typeof require !== "undefined" && typeof module !== "undefined" && require.main === module && typeof require.main?.filename === "string" && /(?:^|[\\/])(?:server|mcp)\.(?:c?js|mjs|ts)$/i.test(require.main.filename);
if (isMcpEntrypoint) {
  startMcpServer();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_TOOL_DEFINITIONS,
  McpFrameDecoder,
  SIDECAR_PILL_MARKDOWN,
  dispatchToolCall,
  evaluateComputeBudget,
  handleJsonRpcMessage,
  loadMcpTelemetry,
  serializeJsonRpcMessage,
  startMcpServer
});
