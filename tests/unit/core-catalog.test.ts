import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildModelCatalog,
  classifyModelTier,
  computeContextWindow,
  decodeModelDescriptor,
  normalizeEffortTier,
  normalizeModelFamily,
  reconcileRequestedVsServed,
} from '../../src/core/model-catalog';
import type { GetCascadeModelConfigDataResponse } from '../../src/types/rpc';

const SAMPLE_LS_MODEL_CONFIG: GetCascadeModelConfigDataResponse = {
  defaultOverrideModelConfig: {
    modelOrAlias: { model: 'MODEL_PLACEHOLDER_M667' },
    label: 'Orchestrator (Carbon)',
    modelId: 'gemini-pro-orchestrator',
  },
  clientModelConfigs: [
    {
      label: 'Gemini 4 Carbon (High)',
      modelOrAlias: { model: 'MODEL_PLACEHOLDER_M427' },
      modelId: 'gemini-4-carbon-high',
      tagTitle: 'High',
      quotaInfo: { remainingFraction: 0.84972906, resetTime: '2026-11-14T15:00:00Z' },
    },
    {
      label: 'Gemini 4 Argon (Medium)',
      modelOrAlias: { model: 'MODEL_PLACEHOLDER_M418' },
      modelId: 'gemini-4-argon',
      tagTitle: 'Medium',
    },
    {
      label: 'Orchestrator (Carbon)',
      modelOrAlias: { model: 'MODEL_PLACEHOLDER_M667' },
      modelId: 'gemini-pro-orchestrator',
    },
    {
      label: 'Gemini 3.8 Flash',
      modelOrAlias: { alias: 'flash' },
      modelId: 'gemini-3.8-flash',
    },
    {
      label: 'Claude Opus 5.5 (High)',
      modelOrAlias: { model: 'claude-opus-5.5-high' },
      modelId: 'claude-opus-5.5-high',
    },
    {
      label: 'Gemini 4 Hydrogen (XHigh)',
      modelOrAlias: { model: 'gemini-4-hydrogen-xhigh' },
      modelId: 'gemini-4-hydrogen-xhigh',
    },
  ],
};

describe('core/model-catalog — placeholders, 5-tier classification, context & routing trust', () => {
  it('RTM-04: decodes live GetCascadeModelConfigData placeholders & defaultOverrideModelConfig', () => {
    const catalog = buildModelCatalog(SAMPLE_LS_MODEL_CONFIG);
    assert.equal(catalog.defaultModelEnum, 'MODEL_PLACEHOLDER_M667');

    const m427 = decodeModelDescriptor('MODEL_PLACEHOLDER_M427', catalog);
    assert.ok(m427);
    assert.equal(m427.label, 'Gemini 4 Carbon (High)');
    assert.equal(m427.modelId, 'gemini-4-carbon-high');
    assert.equal(m427.tier, 'apex');
    assert.equal(m427.effortTier, 'high');
    assert.equal(m427.family, 'gemini');

    const m418 = decodeModelDescriptor('MODEL_PLACEHOLDER_M418', catalog);
    assert.ok(m418);
    assert.equal(m418.label, 'Gemini 4 Argon (Medium)');
    assert.equal(m418.tier, 'workhorse');

    const m667 = decodeModelDescriptor('MODEL_PLACEHOLDER_M667', catalog);
    assert.ok(m667);
    assert.equal(m667.isOrchestrator, true);
    assert.equal(m667.tier, 'orchestrator');
    assert.equal(m667.family, 'auto');
  });

  it('decodes built-in offline aliases & placeholders when LS catalog is empty', () => {
    const emptyCatalog = buildModelCatalog(null);
    assert.equal(emptyCatalog.defaultModelEnum, null);

    assert.equal(decodeModelDescriptor('MODEL_PLACEHOLDER_M427', emptyCatalog)?.tier, 'apex');
    assert.equal(decodeModelDescriptor('MODEL_PLACEHOLDER_M418', emptyCatalog)?.tier, 'workhorse');
    assert.equal(
      decodeModelDescriptor('MODEL_PLACEHOLDER_M667', emptyCatalog)?.tier,
      'orchestrator'
    );
    assert.equal(decodeModelDescriptor('inherit', emptyCatalog)?.isOrchestrator, true);
    assert.equal(decodeModelDescriptor('pro', emptyCatalog)?.family, 'gemini');
    assert.equal(decodeModelDescriptor('flash', emptyCatalog)?.tier, 'fast');
    assert.equal(decodeModelDescriptor('flash_lite', emptyCatalog)?.tier, 'fast');
    assert.equal(decodeModelDescriptor(null, emptyCatalog), null);
  });

  it('classifies all model families, effort tiers, and semantic tiers accurately', () => {
    assert.equal(
      classifyModelTier('gemini', 'xhigh', false, 'Gemini 4 Hydrogen (XHigh)', 'gemini-4-hydrogen-xhigh'),
      'apex'
    );
    assert.equal(
      classifyModelTier('gemini', 'high', false, 'Gemini 4 Carbon (High)', 'gemini-4-carbon-high'),
      'apex'
    );
    assert.equal(
      classifyModelTier('claude', 'high', false, 'Claude Opus 5.5 (High)', 'claude-opus-5.5-high'),
      'apex'
    );
    assert.equal(
      classifyModelTier('gemini', 'medium', false, 'Gemini 4 Carbon (Medium)', 'gemini-4-carbon-med'),
      'workhorse'
    );
    assert.equal(
      classifyModelTier('gemini', 'high', false, 'Gemini 4 Argon (High)', 'gemini-4-argon-high'),
      'workhorse'
    );
    assert.equal(
      classifyModelTier('claude', 'medium', false, 'Claude Sonnet 5.5', 'claude-sonnet-5.5'),
      'workhorse'
    );
    assert.equal(
      classifyModelTier('gemini', 'flash', false, 'Gemini 3.8 Flash', 'gemini-3.8-flash'),
      'fast'
    );
    assert.equal(
      classifyModelTier('gemini', 'low', false, 'Gemini 4 Argon (Low)', 'gemini-4-argon-low'),
      'fast'
    );
    assert.equal(
      classifyModelTier('claude', 'unknown', false, 'Claude Haiku 4.5', 'claude-haiku-4.5'),
      'fast'
    );
    assert.equal(
      classifyModelTier('auto', 'auto', true, 'Orchestrator', 'auto'),
      'orchestrator'
    );

    assert.equal(normalizeModelFamily('GPT-5.2'), 'openai');
    assert.equal(normalizeModelFamily('o3-mini'), 'openai');
    assert.equal(normalizeEffortTier('Gemini 4 Hydrogen (XHigh)'), 'xhigh');
  });

  it('RTM-12: computes context window boundaries (70%, 70.1%, 85%, 85.1%) and avoids fabricating 256k', () => {
    const empty = computeContextWindow(undefined);
    assert.equal(empty.maxContextTokens, 0);
    assert.equal(empty.pct, 0);
    assert.equal(empty.level, 'normal');

    const zeroMax = computeContextWindow({ estimatedTokensUsed: '5000', maxContextTokens: '0' });
    assert.equal(zeroMax.pct, 0);
    assert.equal(zeroMax.level, 'normal');

    assert.equal(
      computeContextWindow({ estimatedTokensUsed: 700, maxContextTokens: 1000 }).level,
      'normal'
    );
    assert.equal(
      computeContextWindow({ estimatedTokensUsed: 701, maxContextTokens: 1000 }).level,
      'warn_70'
    );
    assert.equal(
      computeContextWindow({ estimatedTokensUsed: 850, maxContextTokens: 1000 }).level,
      'warn_70'
    );
    assert.equal(
      computeContextWindow({ estimatedTokensUsed: 851, maxContextTokens: 1000 }).level,
      'critical_85'
    );
  });

  it('reconciles Requested vs Served across matched, routed, mismatch_or_fallback, retrying, and unknown', () => {
    const catalog = buildModelCatalog(SAMPLE_LS_MODEL_CONFIG);

    // 1. matched (exact requested M427 -> responseModel gemini-4-carbon with retryInfos length 1)
    const matched = reconcileRequestedVsServed({
      catalog,
      requestedModelRaw: 'MODEL_PLACEHOLDER_M427',
      latestGenMeta: {
        chatModel: {
          model: 'MODEL_PLACEHOLDER_M427',
          modelDisplayName: 'Gemini 4 Carbon (High)',
          responseModel: 'gemini-4-carbon',
          retryInfos: [{ attempt: 1 }],
        },
      },
    });
    assert.equal(matched.routingStatus, 'matched');
    assert.equal(matched.retryCount, 0);
    assert.equal(matched.servedModel.tier, 'apex');

    // 2. matched even when only responseModel is returned for same base model
    const matchedResponseOnly = reconcileRequestedVsServed({
      catalog,
      requestedModelRaw: 'MODEL_PLACEHOLDER_M427',
      latestGenMeta: {
        chatModel: {
          responseModel: 'gemini-4-carbon',
        },
      },
    });
    assert.equal(matchedResponseOnly.routingStatus, 'matched');

    // 3. routed (default Orchestrator / Auto / inherit / pro)
    const routed = reconcileRequestedVsServed({
      catalog,
      latestGenMeta: {
        chatModel: {
          model: 'MODEL_PLACEHOLDER_M418',
          modelDisplayName: 'Gemini 4 Argon (Medium)',
          responseModel: 'gemini-4-argon',
          retryInfos: [{ attempt: 1 }],
        },
      },
    });
    assert.equal(routed.routingStatus, 'routed');
    assert.equal(routed.requestedModel.raw, 'MODEL_PLACEHOLDER_M667');
    assert.equal(routed.servedModel.tier, 'workhorse');

    const routedInherit = reconcileRequestedVsServed({
      catalog,
      requestedModelRaw: 'inherit',
      latestGenMeta: {
        chatModel: {
          responseModel: 'gemini-3.8-flash',
          modelDisplayName: 'Gemini 3.8 Flash',
        },
      },
    });
    assert.equal(routedInherit.routingStatus, 'routed');

    // 4. mismatch_or_fallback (different model OR downgraded tier)
    const mismatchModel = reconcileRequestedVsServed({
      catalog,
      requestedModelRaw: 'MODEL_PLACEHOLDER_M427',
      latestGenMeta: {
        chatModel: {
          model: 'MODEL_PLACEHOLDER_M418',
          modelDisplayName: 'Gemini 4 Argon (Medium)',
          responseModel: 'gemini-4-argon',
        },
      },
    });
    assert.equal(mismatchModel.routingStatus, 'mismatch_or_fallback');

    const downgradedEffort = reconcileRequestedVsServed({
      catalog,
      requestedModelRaw: 'MODEL_PLACEHOLDER_M427',
      latestGenMeta: {
        chatModel: {
          modelDisplayName: 'Gemini 4 Carbon (Low)',
          responseModel: 'gemini-4-carbon',
        },
      },
    });
    assert.equal(downgradedEffort.routingStatus, 'mismatch_or_fallback');

    // 5. retrying (retryInfos.length > 1 supersedes matched/routed)
    const retrying = reconcileRequestedVsServed({
      catalog,
      requestedModelRaw: 'MODEL_PLACEHOLDER_M427',
      latestGenMeta: {
        chatModel: {
          model: 'MODEL_PLACEHOLDER_M427',
          modelDisplayName: 'Gemini 4 Carbon (High)',
          responseModel: 'gemini-4-carbon',
          retryInfos: [{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }],
        },
      },
    });
    assert.equal(retrying.routingStatus, 'retrying');
    assert.equal(retrying.retryCount, 2);

    // 6. unknown with provisional swarm/step model
    const pending = reconcileRequestedVsServed({
      catalog,
      requestedModelRaw: 'MODEL_PLACEHOLDER_M427',
      provisionalServedModelRaw: 'MODEL_PLACEHOLDER_M418',
      latestGenMeta: null,
    });
    assert.equal(pending.routingStatus, 'unknown');
    assert.equal(pending.servedModel.displayName, 'Gemini 4 Argon (Medium)');
  });
});
