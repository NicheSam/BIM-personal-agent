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

export interface BridgeClient {
  isConnected(): boolean;
  sendCommand(commandName: string, parameters?: JsonObject, timeoutMs?: number): Promise<BridgeResponse>;
  disconnect(): Promise<void>;
}

export interface AgentResponse {
  requestId: string;
  success: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  toolId?: string;
  version?: string;
  durationMs: number;
  cacheHit?: boolean;
  transactionName?: string;
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
