/**
 * Frozen cross-module telemetry domain, state machine, snapshot, config, and budget contracts.
 * Canonical source: docs/plans/00_MASTER_IMPLEMENTATION_BLUEPRINT.md §3.1.
 * Any modification requires an approved [CONTRACT_CHANGE_REQUEST] in DECISION_LOG.md.
 */

/** Semantic visual tier aligned with Flexoki Light/Dark tokens. */
export type ModelTier = 'apex' | 'workhorse' | 'fast' | 'orchestrator' | 'alert';

/** 7-state single-node real-time execution lifecycle phase. */
export type LifecyclePhase =
  | 'IDLE'
  | 'PRE_FLIGHT'
  | 'THINKING'
  | 'STREAMING'
  | 'TOOL_RUNNING'
  | 'BLOCKED_APPROVAL'
  | 'ERROR_OR_QUOTA';

/** Inline zero-token user_markdown stamp mode. */
export type InlineStampMode = 'smart' | 'every-turn' | 'off';

export type ModelFamily = 'gemini' | 'claude' | 'openai' | 'auto' | 'unknown';

export type EffortTier =
  | 'xhigh'
  | 'high'
  | 'medium'
  | 'low'
  | 'flash'
  | 'auto'
  | 'unknown';

/** Resolved model catalog entry from GetCascadeModelConfigData. */
export interface ModelConfigEntry {
  modelEnum: string;
  modelId: string;
  label: string;
  family: ModelFamily;
  effortTier: EffortTier;
  tier: ModelTier;
  tagTitle?: string;
  isOrchestrator: boolean;
  quotaInfo?: {
    remainingFraction: number;
    resetTime: string | null;
  };
}

/** Single quota bucket from RetrieveUserQuotaSummary. */
export interface QuotaBucketView {
  bucketId: string;
  groupId?: string;
  displayName: string;
  window: '5h' | 'weekly' | string;
  remainingFraction: number;
  remainingPct: number;
  resetTime: string | null;
  resetInSeconds: number | null;
  resetInLabel: string;
  isLowAlert: boolean;
}

/** Normalized quota summary + active tree net consumption. */
export interface QuotaSummaryView {
  fetchedAt: string;
  buckets: QuotaBucketView[];
  gemini5h: QuotaBucketView | null;
  geminiWeekly: QuotaBucketView | null;
  thirdParty5h: QuotaBucketView | null;
  thirdPartyWeekly: QuotaBucketView | null;
  treeNetDelta5hPct: number | null;
  burnRate5hPctPerMin: number | null;
}

/** Unified node in a multi-agent cascade tree (Root, Subagent, Workflow, Swarm). */
export interface CascadeNodeView {
  cascadeId: string;
  rootCascadeId: string;
  parentCascadeId: string | null;
  kind: 'root' | 'subagent' | 'workflow' | 'swarm_member';
  title: string;
  role: string | null;
  typeName: string | null;
  depth: number;
  status: string;
  phase: LifecyclePhase;
  phaseStartedAt: string | null;
  phaseElapsedMs: number;
  requestedModel: {
    raw: string;
    displayName: string;
    modelId: string;
    source: 'user' | 'orchestrator' | 'inherited' | 'explicit' | 'swarm' | 'unknown';
  };
  servedModel: {
    responseModel: string;
    displayName: string;
    modelEnum: string;
    family: ModelFamily;
    effortTier: EffortTier;
    tier: ModelTier;
  };
  routingStatus: 'matched' | 'routed' | 'mismatch_or_fallback' | 'retrying' | 'unknown';
  retryCount: number;
  lastTool: {
    id?: string;
    name: string;
    summary?: string;
    startedAt?: string;
  } | null;
  stepCount: number;
  turnCount: number;
  streamingTokPerSec: number | null;
  contextWindow: {
    estimatedTokensUsed: number;
    maxContextTokens: number;
    pct: number;
    level: 'normal' | 'warn_70' | 'critical_85';
  };
  cacheHitPct: number;
  tokens: {
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    thinkingOutputTokens: number;
    responseOutputTokens: number;
  };
  deltaQuota5hPct: number | null;
  lastTtftMs: number | null;
  lastStreamingMs: number | null;
  lastModifiedTime: string;
  spawnStepIndex: number | null;
  swarmState?: {
    memberName: string;
    desiredState?: string;
    phase?: string;
    wakeMode?: string;
    killed?: boolean;
  };
  childrenIds: string[];
}

export interface SmartGovernanceBanner {
  active: boolean;
  heavyConcurrentCount: number;
  gemini5hRemainingPct: number | null;
  estimatedBurnPctPerMin: number | null;
  message: string | null;
}

/** Persistent user preferences stored in $PULSE_STATE_DIR/config.json. */
export interface PulseUserConfig {
  version: 1;
  inlineStampMode: InlineStampMode;
  hudSortMode: 'active-first' | 'topology-tree';
  timelineScope: 'conversation' | 'tree';
  smartThresholds: {
    contextWarnPct: number;
    contextCriticalPct: number;
    stampContextTriggerPct: number;
    quotaLowTriggerPct: number;
    heavyConcurrentAlertCount: number;
    heavyQuotaThresholdPct: number;
  };
  pollIntervalsMs: {
    active: number;
    idle: number;
    quota: number;
    modelConfig: number;
  };
  updatedAt: string;
}

/** 34-byte ETag cache hit response for /api/hud, /api/timeline, /api/fleet. */
export interface UnchangedEtagResponse {
  readonly unchanged: true;
  readonly etag: string;
}

/** GET /api/hud full payload. */
export interface HudSnapshotResponse {
  unchanged?: false;
  etag: string;
  generatedAt: string;
  hostConnected: boolean;
  activeConversationId: string | null;
  rootCascadeId: string | null;
  breadcrumb: Array<{
    cascadeId: string;
    title: string;
    role: string | null;
  }>;
  activeNode: CascadeNodeView | null;
  treeNodes: CascadeNodeView[];
  smartGovernanceBanner: SmartGovernanceBanner;
  quota: QuotaSummaryView;
  config: PulseUserConfig;
  warnings: string[];
}

/** Single LLM invocation turn extracted from generatorMetadata[]. */
export interface TimelineTurnItem {
  turnIndex: number;
  cascadeId: string;
  cascadeTitle: string;
  role: string | null;
  stepIndices: number[];
  timestamp: string | null;
  requestedLabel: string;
  servedModelDisplayName: string;
  responseModel: string;
  tier: ModelTier;
  routingChangedFromPrevTurn: boolean;
  ttftMs: number;
  streamingMs: number;
  totalMs: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheHitPct: number;
  outputTokens: number;
  thinkingOutputTokens: number;
  responseOutputTokens: number;
  thinkingRatioPct: number;
  retryCount: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
  contextPct: number;
  deltaQuota5hPct: number | null;
  apiProvider: string | null;
}

/** GET /api/timeline full payload (reverse-chronological turns). */
export interface TimelineSnapshotResponse {
  unchanged?: false;
  etag: string;
  generatedAt: string;
  rootCascadeId: string | null;
  scope: 'conversation' | 'tree';
  turns: TimelineTurnItem[];
}

export interface FleetTreeSummary {
  rootCascadeId: string;
  rootTitle: string;
  rootPhase: LifecyclePhase;
  activeNodeCount: number;
  totalNodeCount: number;
  elapsedMs: number;
  modelMix: Record<string, number>;
  nodes: CascadeNodeView[];
  treeDeltaQuota5hPct: number | null;
}

export interface FleetProjectGroup {
  projectKey: string;
  projectName: string;
  workspaceUris: string[];
  runningCount: number;
  trees: FleetTreeSummary[];
}

export interface QuotaBurnerEntry {
  rank: number;
  rootCascadeId: string;
  title: string;
  projectName: string;
  dominantModel: string;
  dominantTier: ModelTier;
  consumed5hPct: number;
  delta5hPct: number;
  totalTokens: number;
  lastActiveAt: string;
  isRunning: boolean;
}

/** GET /api/fleet full payload. */
export interface FleetSnapshotResponse {
  unchanged?: false;
  etag: string;
  generatedAt: string;
  hostConnected: boolean;
  activeHeadline: {
    runningRoots: number;
    runningSubagents: number;
    totalRunningNodes: number;
    modelHistogram: Array<{
      label: string;
      tier: ModelTier;
      count: number;
    }>;
  };
  projects: FleetProjectGroup[];
  topQuotaBurners: QuotaBurnerEntry[];
  quota: QuotaSummaryView;
}

/** Single line appended to $PULSE_STATE_DIR/events.ring.jsonl by hook-probe.cjs. */
export interface HookRingEvent {
  ts: number;
  iso: string;
  event: 'PreInvocation' | 'PostInvocation' | 'PreToolUse' | 'PostToolUse' | 'Stop';
  conversationId: string;
  invocationNum?: number;
  modelRaw?: string;
  modelDisplay?: string;
  toolName?: string;
  toolCallId?: string;
  toolSummary?: string;
  subagentRequest?: {
    role?: string;
    typeName?: string;
    model?: string;
  };
  stopReason?: string;
  hookDurationUs?: number;
}

/** Output contract for MCP tool `pulse_get_compute_budget`. */
export interface ComputeBudgetAdvice {
  generatedAt: string;
  conversationId: string | null;
  activeModel: {
    displayName: string;
    responseModel: string;
    tier: ModelTier;
  } | null;
  contextWindowPct: number | null;
  quota: {
    gemini5hRemainingPct: number | null;
    geminiWeeklyRemainingPct: number | null;
    thirdParty5hRemainingPct: number | null;
    resetInLabel: string | null;
  };
  recommendedSubagentModel: 'inherit' | 'argon' | 'flash';
  reason: string;
  warnings: string[];
}
