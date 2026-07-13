export type JsonObject = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;
export type ToolRisk = "readOnly" | "reversibleMutation" | "destructive";
export type ToolStatus = "validated" | "experimental" | "disabled" | "active" | "draft";
export type ToolBinding = "portable" | "project";

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
