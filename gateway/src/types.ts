export type JsonObject = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;
export type ToolRisk = "readOnly" | "reversibleMutation" | "destructive";
export type ToolStatus = "validated" | "experimental" | "disabled" | "active" | "draft";
export type ToolBinding = "portable" | "project";
export type BimDomain = "mep" | "constructability" | "documentation" | "quantity" | "rfi" | "clash";
export type LoopMode = "observe" | "bounded";
export type LoopPhase = "planned" | "executing" | "verifying" | "correcting" | "passed" | "failed" | "stopped";
export type LoopVerdict = "pending" | "passed" | "failed" | "stopped" | "unverified";
export type VerificationKind = "elementExists" | "elementCount" | "parameterEquals" | "mepConnectivity" | "clearance" | "viewPlacement" | "quantity" | "evidence";

export interface ToolDescriptor {
  toolId: string;
  capabilityKey?: string;
  name: string;
  version: string;
  description: string;
  inputSchema: JsonSchema;
  risk: ToolRisk;
  status: ToolStatus;
  binding: ToolBinding;
  projectFingerprint?: string;
  requiredContext?: string[];
  tags: string[];
  source?: string;
  performance?: ToolPerformanceSummary;
}

export interface BimTaskStep {
  action: string;
  object?: string;
  outcome: string;
}

export interface BimTaskUnderstanding {
  goal: string;
  displayTitle?: string;
  actions: string[];
  objects: string[];
  constraints?: string[];
  steps: BimTaskStep[];
  mode: "assess" | "execute" | "plan";
  domain: BimDomain;
  acceptanceCriteria: string[];
  evidenceRequirements: string[];
  loopMode: LoopMode;
  complexity: "standard" | "complex";
}

export interface VerificationCheck extends JsonObject {
  id: string;
  kind: VerificationKind;
  stepId?: string;
}

export interface LoopBudget {
  maxAttempts: number;
  maxSearches: number;
  maxMcpCalls: number;
  maxDynamicSources: number;
  maxContextDeltas: number;
  maxAutoCorrectionElements: number;
  maxDurationMs: number;
}

export interface LoopUsage {
  attempts: number;
  searches: number;
  mcpCalls: number;
  dynamicSources: number;
  contextDeltas: number;
  responseBytes: number;
}

export interface LoopRunState {
  schemaVersion: 1;
  runId: string;
  domain: BimDomain;
  requestedMode: LoopMode;
  effectiveMode: LoopMode;
  complexity: "standard" | "complex";
  phase: LoopPhase;
  verdict: LoopVerdict;
  createdAtUtc: string;
  updatedAtUtc: string;
  expiresAtUtc: string;
  projectFingerprint?: string;
  steps: Array<{ stepId: string; action: string; object?: string; outcome: string }>;
  acceptanceCriteria: string[];
  evidenceRequirements: string[];
  budget: LoopBudget;
  usage: LoopUsage;
  lastErrorCode?: string;
  consecutiveSameError: number;
  stopReason?: string;
}

export interface ToolDirectoryMatch {
  id: string;
  name: string;
  score: number;
}

export type ToolSummary = Omit<ToolDescriptor, "inputSchema" | "source" | "projectFingerprint">;

export interface GeneratedToolManifestInput {
  toolId: string;
  capabilityKey?: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  risk: ToolRisk;
  binding: ToolBinding;
  requiredContext?: string[];
  tags?: string[];
}

export interface SavedToolManifest extends ToolDescriptor {
  schemaVersion: 1;
  sourceHash: string;
  revitVersions: ["2024"];
  createdAt: string;
  lastValidatedAt: string | null;
  provenance: "codex-generated";
}

export interface BridgeResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  requestId?: string;
}

export interface BridgeCommandContext {
  taskId?: string;
  gatewayRequestId?: string;
}

export interface BridgeProgressEvent {
  requestId: string;
  taskId?: string;
  gatewayRequestId?: string;
  sequence?: number;
  phase: string;
  eventType?: string;
  timestampUtc?: string;
  message?: string;
  data?: JsonObject;
}

export interface BridgeClient {
  isConnected(): boolean;
  sendCommand(commandName: string, parameters?: JsonObject, timeoutMs?: number, context?: BridgeCommandContext): Promise<BridgeResponse>;
  disconnect(): Promise<void>;
}

export interface AgentResponse {
  requestId: string;
  taskId?: string;
  success: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  toolId?: string;
  version?: string;
  durationMs: number;
  cacheHit?: boolean;
  transactionName?: string;
  executionStatus?: TaskExecutionStatus;
  verificationStatus?: TaskVerificationStatus;
  reportUrl?: string;
}

export interface ToolPerformanceRecord {
  timestampUtc: string;
  toolId: string;
  durationMs: number;
  success: boolean;
  responseBytes: number;
  errorCode?: string;
  cacheHit?: boolean;
}

export interface ToolPerformanceSummary {
  samples: number;
  successRate: number;
  p95DurationMs: number;
  averageResponseBytes: number;
  health: "baseline" | "healthy" | "degraded";
}

export type AgentActivityStatus = "succeeded" | "failed" | "cancelled";
export type AgentActivityKind = "connection" | "context" | "search" | "operation" | "plan" | "dynamic";

export interface AgentActivityScope {
  elementIds?: number[];
  deletedElementIds?: number[];
  createdElementIds?: number[];
  parameterName?: string;
  stepCount?: number;
  runId?: string;
  phase?: LoopPhase;
  verdict?: LoopVerdict;
  attempt?: number;
  remainingCalls?: number;
  responseBytes?: number;
}

export interface AgentActivityEvent {
  schemaVersion: 1;
  requestId: string;
  startedAtUtc: string;
  completedAtUtc: string;
  kind: AgentActivityKind;
  title: string;
  toolId: string;
  version?: string;
  risk?: ToolRisk;
  status: AgentActivityStatus;
  durationMs: number;
  transactionName?: string;
  summary?: string;
  scope?: AgentActivityScope;
  errorCode?: string;
}

export type TaskEventSource = "gateway" | "bridge" | "tool" | "verifier";
export type TaskPhase = "received" | "preparing" | "routing" | "queued" | "executing" | "verifying" | "completed" | "stopped" | "failed" | "rolled_back" | "unknown";
export type TaskExecutionStatus = "pending" | "running" | "succeeded" | "failed" | "stopped" | "unknown";
export type TaskVerificationStatus = "not_requested" | "pending" | "passed" | "failed" | "insufficient_evidence";
export type TaskEngineeringStatus = "verified" | "completed_partially_verified" | "verification_failed" | "not_verified" | "execution_failed" | "rolled_back";
export type TaskInputOrigin = "user_provided" | "default" | "agent_resolved" | "tool_derived" | "system_injected";
export type TaskVerificationScope = "none" | "partial" | "full";
export type TaskErrorLayer = "client_input" | "agent_resolution" | "mcp_schema" | "typescript_dispatch" | "websocket_transport" | "revit_command" | "revit_transaction" | "result_normalization" | "independent_verification" | "ui_rendering";

export interface TaskInputParameter {
  origin: TaskInputOrigin;
  defaultValue?: unknown;
  unit?: string;
  resolver?: string;
}

export interface TaskVerificationClaim extends JsonObject {
  claimId: string;
  target?: string;
  expected?: unknown;
  actual?: unknown;
  status: "passed" | "failed" | "not_checked";
  method?: "reference_existence" | "result_assertion" | "independent_revit_readback" | string;
  verificationId?: string;
  verifiedAtUtc?: string;
  source?: string;
  evidenceRefs: string[];
}

export interface TaskRequiredClaim extends JsonObject {
  claimId: string;
  description: string;
  required: boolean;
}

export interface TaskEventScope {
  elementIds?: number[];
  createdElementIds?: number[];
  deletedElementIds?: number[];
  stepId?: string;
  stepNumber?: number;
  stepCount?: number;
  transactionName?: string;
  rolledBack?: boolean;
}

export interface AgentTaskEvent {
  schemaVersion: 2;
  eventId: string;
  taskId: string;
  requestId: string;
  bridgeRequestId?: string;
  sequence: number;
  timestampUtc: string;
  source: TaskEventSource;
  phase: TaskPhase;
  eventType: string;
  title: string;
  message?: string;
  executionStatus: TaskExecutionStatus;
  verificationStatus: TaskVerificationStatus;
  toolId?: string;
  version?: string;
  risk?: ToolRisk;
  durationMs?: number;
  scope?: TaskEventScope;
  evidence?: JsonObject;
  errorCode?: string;
}

export interface AgentTaskSummary {
  schemaVersion: 2;
  taskId: string;
  title: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  firstRequestId: string;
  lastRequestId: string;
  phase: TaskPhase;
  executionStatus: TaskExecutionStatus;
  verificationStatus: TaskVerificationStatus;
  eventCount: number;
  toolIds: string[];
  durationMs?: number;
  errorCode?: string;
  reportUrl: string;
  detailCount?: number;
  engineeringStatus?: TaskEngineeringStatus;
}

export interface TaskModelIdentity {
  projectName?: string;
  projectFingerprint?: string;
  revitVersion?: string;
  activeView?: string;
  activeViewId?: number;
  level?: string;
  levelId?: number;
  capturedAtUtc?: string;
  scopeElementIds?: number[];
  scopeHash?: string;
}

export interface TaskModelChanges {
  transactionStarted?: boolean;
  transactionName?: string;
  createdElementIds: number[];
  modifiedElementIds: number[];
  deletedElementIds: number[];
  modelChanged?: boolean;
  rolledBack?: boolean;
}

export interface TaskVerificationDetail {
  requested: boolean;
  status: TaskVerificationStatus;
  method?: string;
  verifiedAtUtc?: string;
  verificationRequestId?: string;
  checkedElementCount?: number;
  passedCount?: number;
  failedCount?: number;
  verificationScope: TaskVerificationScope;
  requiredClaims: TaskRequiredClaim[];
  claims: TaskVerificationClaim[];
  coveredClaims: string[];
  uncoveredClaims: string[];
  rawPayload?: unknown;
}

export interface TaskLineageRecord extends JsonObject {
  sourceId?: string;
  candidateId?: string;
  previewId?: string;
  operationId?: string;
  elementId?: number;
  verificationId?: string;
  status?: string;
}

export interface TaskLineageEdge {
  from: string;
  to: string;
  relation: string;
}

export interface TaskStageTrace {
  stage: TaskErrorLayer | "persistence";
  status: "pending" | "completed" | "failed" | "skipped" | "not_observed";
  startedAtUtc?: string;
  completedAtUtc?: string;
  durationMs?: number;
  errorCode?: string;
}

export interface TaskNormalizedResult {
  normalizerId: string;
  normalizerVersion: number;
  value: unknown;
  fieldMappings: Array<{ source: string; target: string }>;
}

export interface TaskExecutionDetail {
  schemaVersion: 3;
  taskId: string;
  requestId: string;
  runId?: string;
  tool: {
    toolId: string;
    publicTool: string;
    name?: string;
    kind: "builtin" | "saved" | "dynamic" | "plan" | "agent";
    version?: string;
    sourceHash?: string;
    risk?: ToolRisk;
  };
  domain: string;
  domainSchemaVersion: number;
  domainData: JsonObject;
  startedAtUtc: string;
  completedAtUtc: string;
  durationMs: number;
  executionStatus: TaskExecutionStatus;
  verificationStatus: TaskVerificationStatus;
  status: TaskEngineeringStatus;
  input: unknown;
  inputOrigins: Record<string, TaskInputParameter>;
  rawResult?: unknown;
  normalizedResult: TaskNormalizedResult;
  verification: TaskVerificationDetail;
  modelBefore: TaskModelIdentity;
  modelAfter: TaskModelIdentity;
  changes: TaskModelChanges;
  lineage: { records: TaskLineageRecord[]; edges: TaskLineageEdge[] };
  stageTrace: TaskStageTrace[];
  warnings: unknown[];
  error?: {
    code: string;
    errorLayer: TaskErrorLayer;
    technicalMessage: string;
    engineeringMessage: string;
    suggestedAction: string;
    stack?: string;
  };
  developerTraceRef?: string;
  generatedAtUtc: string;
}
