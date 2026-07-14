import { randomUUID } from "node:crypto";
import { AgentError } from "./errors.js";
import { effectiveLoopMode } from "./domain-profiles.js";
import { RunStore } from "./run-store.js";
import type { BimTaskUnderstanding, JsonObject, LoopBudget, LoopPhase, LoopRunState, LoopVerdict } from "./types.js";

type UsageKind = "call" | "search" | "dynamicSource" | "contextDelta" | "attempt";

export class LoopController {
  private queue: Promise<void> = Promise.resolve();
  readonly gatewayMode: "observe" | "bounded";

  constructor(private readonly store: RunStore, gatewayMode?: "observe" | "bounded") {
    this.gatewayMode = gatewayMode ?? parseGatewayMode(process.env.BIM_AGENT_LOOP_MODE);
  }

  async start(task: BimTaskUnderstanding): Promise<LoopRunState> {
    return this.serialized(async () => {
      const now = new Date();
      const mode = effectiveLoopMode(task.domain, task.loopMode, this.gatewayMode);
      const budget = createBudget(task.complexity, mode);
      const state: LoopRunState = {
        schemaVersion: 1,
        runId: randomUUID(),
        domain: task.domain,
        requestedMode: task.loopMode,
        effectiveMode: mode,
        complexity: task.complexity,
        phase: "planned",
        verdict: "pending",
        createdAtUtc: now.toISOString(),
        updatedAtUtc: now.toISOString(),
        expiresAtUtc: new Date(now.getTime() + budget.maxDurationMs).toISOString(),
        steps: task.steps.map((step, index) => ({ stepId: `step-${index + 1}`, ...step })),
        acceptanceCriteria: task.acceptanceCriteria,
        evidenceRequirements: task.evidenceRequirements,
        budget,
        usage: { attempts: 0, searches: 1, mcpCalls: 1, dynamicSources: 0, contextDeltas: 0, responseBytes: 0 },
        consecutiveSameError: 0,
      };
      await this.store.create(state);
      return state;
    });
  }

  async consume(runId: string, kinds: UsageKind[], attempt?: number): Promise<LoopRunState> {
    return this.serialized(async () => {
      const state = await this.store.get(runId);
      assertRunnable(state);
      for (const kind of kinds) {
        if (kind === "call") state.usage.mcpCalls += 1;
        if (kind === "search") state.usage.searches += 1;
        if (kind === "dynamicSource") state.usage.dynamicSources += 1;
        if (kind === "contextDelta") state.usage.contextDeltas += 1;
      }
      if (kinds.includes("attempt")) {
        const expected = state.usage.attempts + 1;
        const requested = attempt ?? expected;
        if (requested !== expected) {
          throw new AgentError("LOOP_ATTEMPT_INVALID", `attempt must be ${expected} for run ${runId}.`);
        }
        state.usage.attempts = requested;
        state.phase = requested === 1 ? "executing" : "correcting";
      }
      enforceBudget(state);
      touch(state);
      await this.store.write(state);
      return state;
    });
  }

  async attachProject(runId: string, projectFingerprint: string): Promise<LoopRunState> {
    return this.serialized(async () => {
      const state = await this.store.get(runId);
      if (state.projectFingerprint && state.projectFingerprint !== projectFingerprint) {
        return this.stopState(state, "ACTIVE_DOCUMENT_CHANGED");
      }
      state.projectFingerprint = projectFingerprint;
      touch(state);
      await this.store.write(state);
      return state;
    });
  }

  async limitBudget(runId: string, overrides: JsonObject | undefined): Promise<LoopRunState> {
    if (!overrides) return this.store.get(runId);
    return this.serialized(async () => {
      const state = await this.store.get(runId);
      const fields: Array<keyof Pick<LoopBudget, "maxAttempts" | "maxMcpCalls" | "maxDynamicSources" | "maxContextDeltas" | "maxAutoCorrectionElements">> = [
        "maxAttempts", "maxMcpCalls", "maxDynamicSources", "maxContextDeltas", "maxAutoCorrectionElements",
      ];
      for (const field of fields) {
        const value = overrides[field];
        if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
          state.budget[field] = Math.min(state.budget[field], value);
        }
      }
      enforceBudget(state);
      touch(state);
      await this.store.write(state);
      return state;
    });
  }

  async recordResponse(runId: string, data: unknown): Promise<LoopRunState> {
    return this.serialized(async () => {
      const state = await this.store.get(runId);
      state.usage.responseBytes += Buffer.byteLength(JSON.stringify(data ?? null), "utf8");
      touch(state);
      await this.store.write(state);
      return state;
    });
  }

  async recordOutcome(
    runId: string,
    phase: LoopPhase,
    verdict: LoopVerdict,
    evidence?: JsonObject,
    errorCode?: string,
  ): Promise<LoopRunState> {
    return this.serialized(async () => {
      const state = await this.store.get(runId);
      state.phase = phase;
      state.verdict = verdict;
      if (errorCode) {
        state.consecutiveSameError = state.lastErrorCode === errorCode ? state.consecutiveSameError + 1 : 1;
        state.lastErrorCode = errorCode;
        if (state.consecutiveSameError >= 2) {
          state.phase = "stopped";
          state.verdict = "stopped";
          state.stopReason = "SAME_ERROR_REPEATED";
        }
      } else if (verdict === "passed") {
        state.consecutiveSameError = 0;
        state.lastErrorCode = undefined;
      }
      touch(state);
      await this.store.write(state);
      if (evidence) await this.store.appendEvidence(runId, evidence);
      return state;
    });
  }

  async stop(runId: string, reason: string): Promise<LoopRunState> {
    return this.serialized(async () => this.stopState(await this.store.get(runId), reason));
  }

  async get(runId: string): Promise<LoopRunState> {
    return this.store.get(runId);
  }

  remaining(state: LoopRunState): JsonObject {
    return {
      attempts: Math.max(0, state.budget.maxAttempts - state.usage.attempts),
      searches: Math.max(0, state.budget.maxSearches - state.usage.searches),
      mcpCalls: Math.max(0, state.budget.maxMcpCalls - state.usage.mcpCalls),
      dynamicSources: Math.max(0, state.budget.maxDynamicSources - state.usage.dynamicSources),
      contextDeltas: Math.max(0, state.budget.maxContextDeltas - state.usage.contextDeltas),
      expiresAtUtc: state.expiresAtUtc,
    };
  }

  private async stopState(state: LoopRunState, reason: string): Promise<LoopRunState> {
    state.phase = "stopped";
    state.verdict = "stopped";
    state.stopReason = reason;
    touch(state);
    await this.store.write(state);
    return state;
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function createBudget(complexity: "standard" | "complex", mode: "observe" | "bounded"): LoopBudget {
  return {
    maxAttempts: mode === "observe" ? 1 : complexity === "complex" ? 3 : 2,
    maxSearches: 2,
    maxMcpCalls: 10,
    maxDynamicSources: 2,
    maxContextDeltas: 2,
    maxAutoCorrectionElements: 200,
    maxDurationMs: 10 * 60 * 1000,
  };
}

function enforceBudget(state: LoopRunState): void {
  const over = state.usage.attempts > state.budget.maxAttempts ? "attempts"
    : state.usage.searches > state.budget.maxSearches ? "searches"
      : state.usage.mcpCalls > state.budget.maxMcpCalls ? "MCP calls"
        : state.usage.dynamicSources > state.budget.maxDynamicSources ? "dynamic sources"
          : state.usage.contextDeltas > state.budget.maxContextDeltas ? "context deltas"
            : undefined;
  if (over) throw new AgentError("LOOP_BUDGET_EXCEEDED", `Loop budget exceeded: ${over}.`);
}

function assertRunnable(state: LoopRunState): void {
  if (state.phase === "passed" || state.phase === "stopped") {
    throw new AgentError("LOOP_CLOSED", `Loop is ${state.phase}: ${state.stopReason ?? state.verdict}.`);
  }
  if (Date.now() > Date.parse(state.expiresAtUtc)) {
    throw new AgentError("LOOP_EXPIRED", "Loop exceeded its 10-minute duration budget.");
  }
}

function touch(state: LoopRunState): void {
  state.updatedAtUtc = new Date().toISOString();
}

function parseGatewayMode(value: string | undefined): "observe" | "bounded" {
  return value?.toLowerCase() === "bounded" ? "bounded" : "observe";
}
