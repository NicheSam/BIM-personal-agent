import { randomUUID } from "node:crypto";
import { TaskStore } from "./task-store.js";
import type {
  AgentTaskEvent,
  AgentTaskSummary,
  JsonObject,
  TaskEventScope,
  TaskEventSource,
  TaskExecutionStatus,
  TaskPhase,
  TaskVerificationStatus,
  TaskExecutionDetail,
  ToolRisk,
  BridgeProgressEvent,
} from "./types.js";
import type { DeveloperTrace } from "./task-detail.js";

export interface TaskEventInput {
  taskId: string;
  requestId: string;
  bridgeRequestId?: string;
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

export class TaskReporter {
  constructor(
    readonly store: TaskStore,
    private readonly consoleBaseUrl = process.env.BIM_PERSONAL_AGENT_CONSOLE_URL || "http://127.0.0.1:4178",
  ) {}

  reportUrl(taskId: string): string {
    return `${this.consoleBaseUrl}/?task=${encodeURIComponent(taskId)}`;
  }

  async ensure(taskId: string, title: string, requestId: string): Promise<AgentTaskSummary | undefined> {
    const now = new Date().toISOString();
    try {
      return await this.store.ensure({
        schemaVersion: 2,
        taskId,
        title,
        createdAtUtc: now,
        updatedAtUtc: now,
        firstRequestId: requestId,
        lastRequestId: requestId,
        phase: "received",
        executionStatus: "pending",
        verificationStatus: "not_requested",
        eventCount: 0,
        toolIds: [],
        reportUrl: this.reportUrl(taskId),
      });
    } catch {
      return undefined;
    }
  }

  async publish(input: TaskEventInput): Promise<AgentTaskEvent | undefined> {
    try {
      return await this.store.append({
        schemaVersion: 2,
        eventId: randomUUID(),
        timestampUtc: new Date().toISOString(),
        ...input,
      });
    } catch {
      return undefined;
    }
  }

  async saveDetail(detail: TaskExecutionDetail, developerTrace?: DeveloperTrace): Promise<boolean> {
    try {
      await this.store.saveDetail(detail, developerTrace);
      return true;
    } catch {
      return false;
    }
  }

  async publishBridge(event: BridgeProgressEvent): Promise<AgentTaskEvent | undefined> {
    if (!event.taskId || !event.gatewayRequestId) return undefined;
    const summary = await this.store.get(event.taskId);
    const phase = normalizeBridgePhase(event.phase);
    const executionStatus: TaskExecutionStatus = phase === "completed"
      ? "succeeded"
      : phase === "failed" || phase === "rolled_back"
        ? "failed"
        : phase === "stopped"
          ? "stopped"
          : "running";
    return this.publish({
      taskId: event.taskId,
      requestId: event.gatewayRequestId,
      bridgeRequestId: event.requestId,
      source: "bridge",
      phase,
      eventType: event.eventType || `bridge.${phase}`,
      title: summary?.title || "BIM task",
      message: event.message,
      executionStatus,
      verificationStatus: phase === "verifying" ? "pending" : summary?.verificationStatus || "not_requested",
      scope: event.data ? {
        stepId: readString(event.data.stepId ?? event.data.StepId),
        stepNumber: readNumber(event.data.stepNumber ?? event.data.StepNumber),
        stepCount: readNumber(event.data.stepCount ?? event.data.StepCount),
        transactionName: readString(event.data.transactionName ?? event.data.TransactionName),
        rolledBack: readBoolean(event.data.rolledBack ?? event.data.RolledBack),
      } : undefined,
    });
  }
}

function normalizeBridgePhase(value: string): TaskPhase {
  const phase = value.toLowerCase();
  const allowed: TaskPhase[] = ["received", "preparing", "routing", "queued", "executing", "verifying", "completed", "stopped", "failed", "rolled_back", "unknown"];
  return allowed.includes(phase as TaskPhase) ? phase as TaskPhase : "unknown";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
