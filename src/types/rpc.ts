/**
 * Strict wire payload contracts for Antigravity 2.0 read-only LanguageServerService Connect-RPC,
 * filesystem topology (.system_generated/subagents/*.json & swarm/members.json), and hooks.json stdio.
 */

export interface ClientModelConfigRaw {
  label?: string;
  modelOrAlias?: {
    model?: string;
    alias?: string;
  };
  modelId?: string;
  quotaInfo?: {
    remainingFraction?: number;
    resetTime?: string | null;
  };
  tagTitle?: string;
}

export interface GetCascadeModelConfigDataResponse {
  clientModelConfigs?: ClientModelConfigRaw[];
  defaultOverrideModelConfig?: ClientModelConfigRaw;
}

export interface QuotaBucketRaw {
  bucketId?: string;
  displayName?: string;
  window?: string;
  remainingFraction?: number;
  resetTime?: string | null;
}

export interface QuotaGroupRaw {
  groupId?: string;
  displayName?: string;
  buckets?: QuotaBucketRaw[];
}

export interface RetrieveUserQuotaSummaryResponse {
  response?: {
    groups?: QuotaGroupRaw[];
  };
  groups?: QuotaGroupRaw[];
}

export interface TrajectoryWorkspaceRaw {
  workspaceFolderAbsoluteUri?: string;
  gitRootAbsoluteUri?: string;
  repository?: {
    computedName?: string;
  };
}

export interface TrajectorySummaryRaw {
  trajectoryId?: string;
  status?: string;
  stepCount?: number;
  createdTime?: string;
  lastModifiedTime?: string;
  summary?: string | null;
  killed?: boolean;
  latestExecutorTerminationReason?: string;
  workspaces?: TrajectoryWorkspaceRaw[];
}

export interface GetAllCascadeTrajectoriesResponse {
  trajectorySummaries?: Record<string, TrajectorySummaryRaw>;
}

/**
 * L-001: Protobuf int64 fields in usage arrive as JSON strings (e.g., "19353").
 */
export interface UsageRaw {
  inputTokens?: string | number;
  outputTokens?: string | number;
  thinkingOutputTokens?: string | number;
  responseOutputTokens?: string | number;
  cacheReadTokens?: string | number;
  apiProvider?: string;
}

export interface ContextWindowMetadataRaw {
  estimatedTokensUsed?: string | number;
  maxContextTokens?: string | number;
}

export interface CustomMetadataRaw {
  cascade_id?: string;
  parent_cascade_id?: string;
  root_cascade_id?: string;
  model_enum?: string;
  last_step_index?: string | number;
}

export interface ChatStartMetadataRaw {
  createdAt?: string;
  contextWindowMetadata?: ContextWindowMetadataRaw;
}

export interface ChatModelMetadataRaw {
  timestamp?: string;
  createdAt?: string;
  model?: string;
  modelDisplayName?: string;
  responseModel?: string;
  timeToFirstToken?: string;
  streamingDuration?: string;
  /** L-003: Normal unretried invocations have retryInfos.length === 1. */
  retryInfos?: unknown[];
  chatStartMetadata?: ChatStartMetadataRaw;
  customMetadata?: CustomMetadataRaw;
  usage?: UsageRaw;
}

export interface GeneratorMetadataEntryRaw {
  stepIndices?: number[];
  chatModel?: ChatModelMetadataRaw;
}

export interface GetCascadeTrajectoryGeneratorMetadataRequest {
  cascadeId: string;
}

export interface GetCascadeTrajectoryGeneratorMetadataResponse {
  generatorMetadata?: GeneratorMetadataEntryRaw[];
}

export interface ToolCallRaw {
  id?: string;
  name?: string;
  argumentsJson?: string;
}

export interface TrajectoryStepMetadataRaw {
  viewableAt?: string;
  finishedGeneratingAt?: string;
  createdAt?: string;
  generatorModel?: string;
  toolCall?: ToolCallRaw;
}

export interface TrajectoryStepRaw {
  type?: string;
  status?: string;
  metadata?: TrajectoryStepMetadataRaw;
}

/**
 * L-004: GetCascadeTrajectorySteps ignores startIndex/endIndex; must use stepOffset + disableRehydration: true.
 */
export interface GetCascadeTrajectoryStepsRequest {
  cascadeId: string;
  stepOffset: number;
  disableRehydration: true;
  startIndex?: never;
  endIndex?: never;
}

export interface GetCascadeTrajectoryStepsResponse {
  steps?: TrajectoryStepRaw[];
}

export interface SubagentDescriptorFileRaw {
  conversationId?: string;
  subagentDescriptor?: {
    typeName?: string;
    role?: string;
  };
  state?: string;
  spawnStepIndex?: number;
  workspaceUris?: string[];
}

export interface SwarmMemberRaw {
  conversation_id?: string;
  role?: string;
  desired_state?: string;
  desired_model?: string;
  applied_model?: string;
  workspace_mode?: string;
  phase?: string;
  wake_mode?: string;
  killed?: boolean;
  model?: string;
}

/**
 * L-005: swarm/members.json stores members as an object map keyed by member name, NOT an array.
 */
export interface SwarmMembersFileRaw {
  title?: string;
  members?: Record<string, SwarmMemberRaw>;
}

export type HookEventName =
  | 'PreInvocation'
  | 'PostInvocation'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop';

export interface HookStdinPayload {
  hookEventName?: HookEventName | string;
  hook_event_name?: HookEventName | string;
  conversationId?: string;
  conversation_id?: string;
  invocationNum?: number;
  invocation_num?: number;
  model?: string;
  modelName?: string;
  model_name?: string;
  toolName?: string;
  tool_name?: string;
  toolCallId?: string;
  tool_call_id?: string;
  toolInput?: Record<string, unknown>;
  tool_input?: Record<string, unknown>;
  stopReason?: string;
  stop_reason?: string;
}

export interface HookInjectSystemMessage {
  systemMessage: string;
  metadata: {
    user_markdown: string;
  };
}

export interface HookInjectStep {
  systemMessage: HookInjectSystemMessage;
}

export type HookStdoutResponse =
  | { decision: 'allow' }
  | { injectSteps: HookInjectStep[] }
  | Record<string, never>;
