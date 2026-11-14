import type {
  ClientModelConfigRaw,
  ContextWindowMetadataRaw,
  GeneratorMetadataEntryRaw,
  GetCascadeModelConfigDataResponse,
} from '../types/rpc';
import type {
  CascadeNodeView,
  EffortTier,
  ModelConfigEntry,
  ModelFamily,
  ModelTier,
} from '../types/telemetry';
import { computeRetryCount, toIntToken } from './formatters';

export interface ModelCatalog {
  defaultModelEnum: string | null;
  modelsByEnum: Record<string, ModelConfigEntry>;
  modelsById: Record<string, ModelConfigEntry>;
}

const BUILTIN_ALIASES: Record<string, ModelConfigEntry> = {
  MODEL_PLACEHOLDER_M427: {
    modelEnum: 'MODEL_PLACEHOLDER_M427',
    modelId: 'gemini-4-carbon-high',
    label: 'Gemini 4 Carbon (High)',
    family: 'gemini',
    effortTier: 'high',
    tier: 'apex',
    isOrchestrator: false,
  },
  MODEL_PLACEHOLDER_M418: {
    modelEnum: 'MODEL_PLACEHOLDER_M418',
    modelId: 'gemini-4-argon-medium',
    label: 'Gemini 4 Argon (Medium)',
    family: 'gemini',
    effortTier: 'medium',
    tier: 'workhorse',
    isOrchestrator: false,
  },
  MODEL_PLACEHOLDER_M667: {
    modelEnum: 'MODEL_PLACEHOLDER_M667',
    modelId: 'gemini-pro-orchestrator',
    label: 'Orchestrator (Carbon)',
    family: 'auto',
    effortTier: 'auto',
    tier: 'orchestrator',
    isOrchestrator: true,
  },
  MODEL_PLACEHOLDER_M669: {
    modelEnum: 'MODEL_PLACEHOLDER_M669',
    modelId: 'gemini-plan-execute-orchestrator',
    label: 'Orchestrator (Plan-Execute)',
    family: 'auto',
    effortTier: 'auto',
    tier: 'orchestrator',
    isOrchestrator: true,
  },
  MODEL_PLACEHOLDER_M681: {
    modelEnum: 'MODEL_PLACEHOLDER_M681',
    modelId: 'gemini-argon-orchestrator',
    label: 'Orchestrator (Argon)',
    family: 'auto',
    effortTier: 'auto',
    tier: 'orchestrator',
    isOrchestrator: true,
  },
  MODEL_PLACEHOLDER_M322: {
    modelEnum: 'MODEL_PLACEHOLDER_M322',
    modelId: 'gemini-flash',
    label: 'Gemini Flash',
    family: 'gemini',
    effortTier: 'flash',
    tier: 'fast',
    isOrchestrator: false,
  },
  inherit: {
    modelEnum: 'inherit',
    modelId: 'inherit',
    label: 'Inherit Parent',
    family: 'auto',
    effortTier: 'auto',
    tier: 'orchestrator',
    isOrchestrator: true,
  },
  auto: {
    modelEnum: 'auto',
    modelId: 'auto',
    label: 'Auto',
    family: 'auto',
    effortTier: 'auto',
    tier: 'orchestrator',
    isOrchestrator: true,
  },
  pro: {
    modelEnum: 'pro',
    modelId: 'gemini-pro',
    label: 'Gemini Pro (Auto)',
    family: 'gemini',
    effortTier: 'auto',
    tier: 'workhorse',
    isOrchestrator: false,
  },
  flash: {
    modelEnum: 'flash',
    modelId: 'gemini-flash',
    label: 'Gemini Flash',
    family: 'gemini',
    effortTier: 'flash',
    tier: 'fast',
    isOrchestrator: false,
  },
  flash_lite: {
    modelEnum: 'flash_lite',
    modelId: 'gemini-flash-lite',
    label: 'Gemini Flash Lite',
    family: 'gemini',
    effortTier: 'flash',
    tier: 'fast',
    isOrchestrator: false,
  },
};

export function normalizeModelFamily(raw: string): ModelFamily {
  if (/orchestrator|\bauto\b/i.test(raw)) {
    return 'auto';
  }
  if (/gemini/i.test(raw)) {
    return 'gemini';
  }
  if (/claude|opus|sonnet|haiku/i.test(raw)) {
    return 'claude';
  }
  if (/gpt|\bo[134](?:-|\b)/i.test(raw)) {
    return 'openai';
  }
  return 'unknown';
}

export function normalizeEffortTier(raw: string): EffortTier {
  if (/\bxhigh\b|\(xhigh\)|_xhigh\b/i.test(raw)) {
    return 'xhigh';
  }
  if (/\bhigh\b|\(high\)|_high\b/i.test(raw)) {
    return 'high';
  }
  if (/\bmed(?:ium)?\b|\(medium\)|\(med\)|_med(?:ium)?\b/i.test(raw)) {
    return 'medium';
  }
  if (/\blow\b|\(low\)|_low\b/i.test(raw)) {
    return 'low';
  }
  if (/flash/i.test(raw)) {
    return 'flash';
  }
  if (/orchestrator|\bauto\b/i.test(raw)) {
    return 'auto';
  }
  return 'unknown';
}

export function classifyModelTier(
  family: ModelFamily,
  effortTier: EffortTier,
  isOrchestrator: boolean,
  label = '',
  modelId = ''
): ModelTier {
  if (isOrchestrator || family === 'auto' || effortTier === 'auto') {
    return 'orchestrator';
  }
  const combined = `${label} ${modelId}`;
  if (
    effortTier === 'xhigh' ||
    (effortTier === 'high' && /hydrogen|carbon|opus/i.test(combined))
  ) {
    return 'apex';
  }
  if (
    effortTier === 'flash' ||
    /flash|haiku|flash_lite/i.test(combined) ||
    (family === 'gemini' && /argon/i.test(combined) && effortTier === 'low')
  ) {
    return 'fast';
  }
  return 'workhorse';
}

function parseClientModelConfig(raw: ClientModelConfigRaw): ModelConfigEntry | null {
  const modelEnum = (
    raw.modelOrAlias?.model ||
    raw.modelOrAlias?.alias ||
    raw.modelId ||
    raw.label ||
    ''
  ).trim();
  if (!modelEnum) {
    return null;
  }

  const label = (raw.label ?? raw.modelId ?? modelEnum).trim();
  const modelId = (raw.modelId ?? modelEnum).trim();
  const combined = `${label} ${modelId} ${modelEnum}`;

  const family = normalizeModelFamily(combined);
  const effortTier = normalizeEffortTier(combined);
  const isOrchestrator =
    family === 'auto' || /orchestrator/i.test(label) || /orchestrator/i.test(modelId);
  const tier = classifyModelTier(family, effortTier, isOrchestrator, label, modelId);

  const entry: ModelConfigEntry = {
    modelEnum,
    modelId,
    label,
    family,
    effortTier,
    tier,
    isOrchestrator,
  };
  if (raw.tagTitle) {
    entry.tagTitle = raw.tagTitle;
  }
  if (raw.quotaInfo && typeof raw.quotaInfo.remainingFraction === 'number') {
    entry.quotaInfo = {
      remainingFraction: Math.min(1, Math.max(0, raw.quotaInfo.remainingFraction)),
      resetTime: raw.quotaInfo.resetTime ?? null,
    };
  }
  return entry;
}

export function buildModelCatalog(
  data: GetCascadeModelConfigDataResponse | null | undefined
): ModelCatalog {
  const defaultModelEnum =
    data?.defaultOverrideModelConfig?.modelOrAlias?.model ??
    data?.defaultOverrideModelConfig?.modelOrAlias?.alias ??
    null;

  const modelsByEnum: Record<string, ModelConfigEntry> = {};
  const modelsById: Record<string, ModelConfigEntry> = {};

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
        const chosen =
          defParsed.label === defParsed.modelEnum && aliasFallback ? aliasFallback : defParsed;
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
    modelsById,
  };
}

export function decodeModelDescriptor(
  raw: string | null | undefined,
  catalog: ModelCatalog
): ModelConfigEntry | null {
  if (!raw || typeof raw !== 'string') {
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
    if (
      entry.modelEnum.toLowerCase() === lower ||
      entry.modelId.toLowerCase() === lower ||
      entry.label.toLowerCase() === lower
    ) {
      return entry;
    }
  }

  for (const [aliasKey, aliasEntry] of Object.entries(BUILTIN_ALIASES)) {
    if (
      aliasKey.toLowerCase() === lower ||
      aliasEntry.modelId.toLowerCase() === lower ||
      aliasEntry.label.toLowerCase() === lower
    ) {
      return aliasEntry;
    }
  }

  if (/^MODEL_PLACEHOLDER_/i.test(key)) {
    return null;
  }

  const family = normalizeModelFamily(key);
  const effortTier = normalizeEffortTier(key);
  const isOrchestrator = family === 'auto' || /orchestrator|\bauto\b/i.test(key);
  const tier = classifyModelTier(family, effortTier, isOrchestrator, key, key);

  return {
    modelEnum: key,
    modelId: key,
    label: key,
    family,
    effortTier,
    tier,
    isOrchestrator,
  };
}

export function computeContextWindow(
  meta: ContextWindowMetadataRaw | undefined,
  thresholds?: { warnPct?: number; criticalPct?: number }
): CascadeNodeView['contextWindow'] {
  const estimatedTokensUsed = toIntToken(meta?.estimatedTokensUsed);
  const maxContextTokens = toIntToken(meta?.maxContextTokens);
  const warnPct = thresholds?.warnPct ?? 70;
  const criticalPct = thresholds?.criticalPct ?? 85;

  const pct =
    maxContextTokens > 0
      ? Math.min(100, Math.max(0, (estimatedTokensUsed / maxContextTokens) * 100))
      : 0;

  let level: CascadeNodeView['contextWindow']['level'] = 'normal';
  if (pct > criticalPct) {
    level = 'critical_85';
  } else if (pct > warnPct) {
    level = 'warn_70';
  }

  return {
    estimatedTokensUsed,
    maxContextTokens,
    pct,
    level,
  };
}

export interface ReconcileRoutingParams {
  catalog: ModelCatalog;
  requestedModelRaw?: string | null;
  requestedSource?: CascadeNodeView['requestedModel']['source'];
  latestGenMeta?: GeneratorMetadataEntryRaw | null;
  provisionalServedModelRaw?: string | null;
}

export interface ReconcileRoutingResult {
  requestedModel: CascadeNodeView['requestedModel'];
  servedModel: CascadeNodeView['servedModel'];
  routingStatus: CascadeNodeView['routingStatus'];
  retryCount: number;
}

const TIER_WEIGHT: Record<ModelTier, number> = {
  alert: 0,
  fast: 1,
  workhorse: 2,
  orchestrator: 2,
  apex: 3,
};

const EFFORT_WEIGHT: Record<EffortTier, number> = {
  flash: 0,
  low: 1,
  medium: 2,
  auto: 2,
  unknown: 2,
  high: 3,
  xhigh: 4,
};

function canonicalBaseModel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\((xhigh|high|medium|med|low)\)/gi, '')
    .replace(/[\s._]+/g, '-')
    .replace(/-(xhigh|high|medium|med|low)$/i, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function reconcileRequestedVsServed(
  params: ReconcileRoutingParams
): ReconcileRoutingResult {
  const chatModel = params.latestGenMeta?.chatModel;
  const customModelEnum = chatModel?.customMetadata?.model_enum?.trim() || null;

  const explicitRequested = params.requestedModelRaw?.trim() || null;
  const effectiveRequestedRaw =
    explicitRequested ?? customModelEnum ?? params.catalog.defaultModelEnum ?? '';
  const decodedReq = decodeModelDescriptor(effectiveRequestedRaw, params.catalog);

  const inferredSource: CascadeNodeView['requestedModel']['source'] =
    params.requestedSource ??
    (explicitRequested
      ? 'explicit'
      : customModelEnum
        ? 'user'
        : params.catalog.defaultModelEnum
          ? decodedReq?.isOrchestrator
            ? 'orchestrator'
            : 'user'
          : 'unknown');

  const requestedModel: CascadeNodeView['requestedModel'] = {
    raw: effectiveRequestedRaw || 'unknown',
    displayName: decodedReq?.label ?? (effectiveRequestedRaw || 'Unknown'),
    modelId: decodedReq?.modelId ?? (effectiveRequestedRaw || 'unknown'),
    source: inferredSource,
  };

  const retryCount = computeRetryCount(chatModel?.retryInfos);
  const servedRawResponse = chatModel?.responseModel?.trim() || '';
  const servedRawDisplay = chatModel?.modelDisplayName?.trim() || '';
  const servedRawModel = chatModel?.model?.trim() || '';
  const hasServedResponse = Boolean(servedRawResponse || servedRawDisplay || servedRawModel);

  let servedModel: CascadeNodeView['servedModel'];

  if (hasServedResponse) {
    const decodedByEnum = decodeModelDescriptor(servedRawModel, params.catalog);
    const decodedByDisplay = decodeModelDescriptor(servedRawDisplay, params.catalog);
    const decodedByResp = decodeModelDescriptor(servedRawResponse, params.catalog);
    const bestDecoded = decodedByEnum ?? decodedByDisplay ?? decodedByResp;

    const displayName =
      servedRawDisplay || bestDecoded?.label || servedRawResponse || servedRawModel || 'Unknown';
    const responseModel =
      servedRawResponse || bestDecoded?.modelId || servedRawModel || 'unknown';
    const modelEnum =
      servedRawModel || bestDecoded?.modelEnum || responseModel || 'unknown';

    const combined = `${displayName} ${responseModel} ${modelEnum}`;
    const family = normalizeModelFamily(combined) !== 'unknown'
      ? normalizeModelFamily(combined)
      : bestDecoded?.family ?? 'unknown';
    const effortTier = normalizeEffortTier(combined) !== 'unknown'
      ? normalizeEffortTier(combined)
      : bestDecoded?.effortTier ?? 'unknown';
    const isOrchestrator =
      family === 'auto' ||
      /orchestrator/i.test(displayName) ||
      (bestDecoded?.isOrchestrator ?? false);
    const tier = classifyModelTier(family, effortTier, isOrchestrator, displayName, responseModel);

    servedModel = {
      responseModel,
      displayName,
      modelEnum,
      family,
      effortTier,
      tier,
    };
  } else if (params.provisionalServedModelRaw?.trim()) {
    const provRaw = params.provisionalServedModelRaw.trim();
    const provDecoded = decodeModelDescriptor(provRaw, params.catalog);
    servedModel = {
      responseModel: provDecoded?.modelId ?? provRaw,
      displayName: provDecoded?.label ?? provRaw,
      modelEnum: provDecoded?.modelEnum ?? provRaw,
      family: provDecoded?.family ?? 'unknown',
      effortTier: provDecoded?.effortTier ?? 'unknown',
      tier: provDecoded?.tier ?? 'workhorse',
    };
  } else {
    servedModel = {
      responseModel: '',
      displayName: decodedReq?.label ? `${decodedReq.label} (pending)` : 'Pending',
      modelEnum: requestedModel.raw,
      family: decodedReq?.family ?? 'unknown',
      effortTier: decodedReq?.effortTier ?? 'unknown',
      tier: decodedReq?.tier ?? 'workhorse',
    };
  }

  let routingStatus: CascadeNodeView['routingStatus'];
  if (retryCount > 0) {
    routingStatus = 'retrying';
  } else if (!hasServedResponse) {
    routingStatus = 'unknown';
  } else {
    const reqLower = requestedModel.raw.toLowerCase();
    const isDynamicAlias =
      requestedModel.raw === 'unknown' ||
      decodedReq?.isOrchestrator === true ||
      reqLower === 'auto' ||
      reqLower === 'inherit' ||
      reqLower === 'pro' ||
      /orchestrator/i.test(requestedModel.displayName);

    if (isDynamicAlias) {
      routingStatus = 'routed';
    } else if (!decodedReq && /^MODEL_PLACEHOLDER_/i.test(requestedModel.raw)) {
      routingStatus =
        servedModel.modelEnum.toLowerCase() === reqLower ||
        chatModel?.model?.trim()?.toLowerCase() === reqLower
          ? 'matched'
          : 'routed';
    } else if (
      reqLower === 'flash' ||
      reqLower === 'flash_lite' ||
      (reqLower === 'model_placeholder_m322' && decodedReq?.tier === 'fast')
    ) {
      routingStatus = servedModel.tier === 'fast' ? 'matched' : 'mismatch_or_fallback';
    } else {
      const reqCanonical = canonicalBaseModel(decodedReq?.modelId || requestedModel.displayName);
      const servedCanonical = canonicalBaseModel(
        servedModel.responseModel || servedModel.displayName
      );
      const baseMismatch =
        Boolean(reqCanonical) && Boolean(servedCanonical) && reqCanonical !== servedCanonical;

      const reqTier = decodedReq?.tier ?? 'workhorse';
      const tierDowngraded =
        (servedModel.effortTier !== 'unknown' || servedModel.tier === 'fast') &&
        TIER_WEIGHT[servedModel.tier] < TIER_WEIGHT[reqTier];
      const reqEffort = decodedReq?.effortTier ?? 'unknown';
      const effortDowngraded =
        reqEffort !== 'unknown' &&
        servedModel.effortTier !== 'unknown' &&
        EFFORT_WEIGHT[servedModel.effortTier] < EFFORT_WEIGHT[reqEffort];

      routingStatus =
        baseMismatch || tierDowngraded || effortDowngraded ? 'mismatch_or_fallback' : 'matched';
    }
  }

  return {
    requestedModel,
    servedModel,
    routingStatus,
    retryCount,
  };
}
