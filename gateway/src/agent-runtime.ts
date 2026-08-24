import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { dirname } from "node:path";
import { ActivityStore } from "./activity-store.js";
import { ContextSnapshotStore } from "./context-snapshots.js";
import { getDomainProfile } from "./domain-profiles.js";
import { AgentError, normalizeError } from "./errors.js";
import { LoopController } from "./loop-controller.js";
import { RunStore } from "./run-store.js";
import { TelemetryStore } from "./telemetry.js";
import { ToolCatalog } from "./tool-catalog.js";
import { directoryToolTerms, parseTaskUnderstanding, routeTask } from "./tool-directory.js";
import { ToolStore, validateGeneratedToolManifest } from "./tool-store.js";
import { TaskReporter } from "./task-reporter.js";
import { createDeveloperTrace, createTaskExecutionDetail } from "./task-detail.js";
import type { TaskExecutionDetailInput } from "./task-detail.js";
import type {
  AgentResponse,
  AgentActivityEvent,
  AgentActivityKind,
  BridgeClient,
  BridgeCommandContext,
  GeneratedToolManifestInput,
  JsonObject,
  LoopPhase,
  LoopRunState,
  LoopVerdict,
  ToolDescriptor,
  ToolRisk,
  ToolSummary,
  TaskInputParameter,
  VerificationCheck,
} from "./types.js";
import { normalizeArguments, requireObject } from "./validation.js";
import { parseVerificationChecks, sanitizeEvidence } from "./verification.js";

export class AgentRuntime {
  private readonly loop: LoopController;
  private readonly snapshots: ContextSnapshotStore;
  private observationTail: Promise<void> = Promise.resolve();
  private readonly bridgeContext = new AsyncLocalStorage<BridgeCommandContext>();

  constructor(
    private readonly bridge: BridgeClient,
    private readonly catalog: ToolCatalog,
    private readonly store: ToolStore,
    private readonly telemetry: TelemetryStore,
    private readonly activity?: ActivityStore,
    loop?: LoopController,
    snapshots?: ContextSnapshotStore,
    private readonly taskReporter?: TaskReporter,
  ) {
    this.loop = loop ?? new LoopController(new RunStore(dirname(store.root)));
    this.snapshots = snapshots ?? new ContextSnapshotStore();
  }

  async execute(name: string, input: JsonObject): Promise<AgentResponse> {
    const requestId = randomUUID();
    const taskId = resolveTaskId(name, input.taskId);
    const title = taskActivityTitle(name, input);
    if (taskId && this.taskReporter) {
      this.observe(async () => {
        await this.taskReporter?.ensure(taskId, title, requestId);
        await this.taskReporter?.publish({
          taskId,
          requestId,
          source: "gateway",
          phase: "received",
          eventType: "task.received",
          title,
          executionStatus: "pending",
          verificationStatus: hasVerification(input) ? "pending" : "not_requested",
        });
      });
    }
    return this.bridgeContext.run({ taskId, gatewayRequestId: requestId }, () =>
      this.executeInternal(name, input, requestId, taskId, title));
  }

  private async executeInternal(
    name: string,
    input: JsonObject,
    requestId: string,
    taskId: string | undefined,
    taskTitle: string,
  ): Promise<AgentResponse> {
    const startedAt = Date.now();
    const startedAtUtc = new Date(startedAt).toISOString();
    let toolId = `agent:${name}`;
    let title = publicActivityTitle(name, input);
    let risk: ToolRisk | undefined;
    let kind = publicActivityKind(name);
    let inputParameters: Record<string, TaskInputParameter> = {};
    try {
      inputParameters = await this.normalizeDetailParameters(name, input);
      let data: unknown;
      let version: string | undefined;
      if (name === "get_agent_status") {
        data = await this.getStatus();
      } else if (name === "get_bim_context") {
        data = await this.getContext(input);
      } else if (name === "search_bim_tools") {
        data = await this.searchTools(input);
      } else if (name === "run_bim_tool") {
        const result = await this.runTool(input);
        data = result.data;
        toolId = result.toolId;
        version = result.version;
        title = result.title;
        risk = result.risk;
      } else if (name === "run_bim_plan") {
        data = await this.runPlan(input);
        title = `執行 ${Array.isArray(input.steps) ? input.steps.length : 0} 步 BIM 計畫`;
        risk = requestedPlanRisk(input);
      } else if (name === "execute_dynamic_csharp") {
        const result = await this.executeDynamic(input);
        data = result.data;
        toolId = result.toolId;
        version = result.version;
        title = result.title;
        risk = result.risk;
      } else {
        throw new AgentError("TOOL_NOT_FOUND", `Unknown Agent tool: ${name}`);
      }
      const durationMs = Date.now() - startedAt;
      const response: AgentResponse = {
        requestId, taskId, success: true, data, toolId, version, durationMs,
        cacheHit: readBoolean(data, "CompilationCacheHit", "cacheHit"),
        transactionName: readString(data, "TransactionName", "transactionName"),
        executionStatus: "succeeded",
        verificationStatus: taskVerificationStatus(input, data),
        reportUrl: taskId ? this.taskReporter?.reportUrl(taskId) : undefined,
      };
      this.observe(async () => {
        await this.telemetry.record({
          toolId, durationMs, success: true,
          responseBytes: Buffer.byteLength(JSON.stringify(data ?? null), "utf8"),
          cacheHit: response.cacheHit,
        });
        await this.activity?.record(createActivityEvent({
          requestId, startedAtUtc, kind, title, toolId, version, risk, durationMs, data,
        }));
        if (!taskId || !this.taskReporter) return;
        const detailInput: TaskExecutionDetailInput = {
          taskId,
          requestId,
          publicTool: name,
          toolId,
          version,
          risk,
          startedAtUtc,
          durationMs,
          executionStatus: "succeeded",
          verificationStatus: response.verificationStatus || "not_requested",
          input,
          inputParameters,
          result: data,
        };
        const detail = createTaskExecutionDetail(detailInput);
        await this.taskReporter.saveDetail(detail, createDeveloperTrace(detailInput, detail));
        await this.taskReporter.publish({
          taskId,
          requestId,
          source: "gateway",
          phase: "completed",
          eventType: "task.completed",
          title: taskTitle,
          message: readString(unwrapExecution(data), "Summary", "summary"),
          executionStatus: "succeeded",
          verificationStatus: response.verificationStatus || "not_requested",
          toolId,
          version,
          risk,
          durationMs,
          scope: toTaskScope(data),
        });
      });
      return response;
    } catch (error) {
      const normalized = normalizeError(error);
      await this.recordHarnessFailure(input, normalized);
      const durationMs = Date.now() - startedAt;
      this.observe(async () => {
        await this.telemetry.record({ toolId, durationMs, success: false, responseBytes: 0, errorCode: normalized.code });
        await this.activity?.record(createActivityEvent({
          requestId, startedAtUtc, kind, title, toolId, risk, durationMs,
          errorCode: normalized.code,
          errorMessage: normalized.message,
        }));
        if (!taskId || !this.taskReporter) return;
        const detailInput: TaskExecutionDetailInput = {
          taskId,
          requestId,
          publicTool: name,
          toolId,
          risk,
          startedAtUtc,
          durationMs,
          executionStatus: normalized.code === "REVIT_COMMAND_TIMEOUT_UNCERTAIN" ? "unknown" : "failed",
          verificationStatus: hasVerification(input) ? "insufficient_evidence" : "not_requested",
          input,
          inputParameters,
          errorCode: normalized.code,
          errorMessage: normalized.message,
          errorStack: error instanceof Error ? error.stack : undefined,
        };
        const detail = createTaskExecutionDetail(detailInput);
        await this.taskReporter.saveDetail(detail, createDeveloperTrace(detailInput, detail));
        await this.taskReporter.publish({
          taskId,
          requestId,
          source: "gateway",
          phase: normalized.code === "REVIT_COMMAND_TIMEOUT_UNCERTAIN" ? "unknown" : "failed",
          eventType: "task.failed",
          title: taskTitle,
          message: normalized.message.slice(0, 500),
          executionStatus: normalized.code === "REVIT_COMMAND_TIMEOUT_UNCERTAIN" ? "unknown" : "failed",
          verificationStatus: hasVerification(input) ? "insufficient_evidence" : "not_requested",
          toolId,
          risk,
          durationMs,
          errorCode: normalized.code,
        });
      });
      return {
        requestId,
        taskId,
        success: false,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        toolId,
        durationMs,
        executionStatus: normalized.code === "REVIT_COMMAND_TIMEOUT_UNCERTAIN" ? "unknown" : "failed",
        verificationStatus: hasVerification(input) ? "insufficient_evidence" : "not_requested",
        reportUrl: taskId ? this.taskReporter?.reportUrl(taskId) : undefined,
      };
    }
  }

  async flushObservations(): Promise<void> {
    await this.observationTail;
  }

  private observe(operation: () => Promise<void>): void {
    const next = this.observationTail.then(operation, operation);
    this.observationTail = next.then(() => undefined, () => undefined);
  }

  private async getStatus(): Promise<unknown> {
    let bridge: unknown = { connected: this.bridge.isConnected() };
    try {
      bridge = (await this.sendCommand("get_agent_status", {}, 10_000)).data;
    } catch (error) {
      const normalized = normalizeError(error);
      bridge = { connected: false, errorCode: normalized.code, errorMessage: normalized.message };
    }
    return {
      gatewayVersion: "0.8.0",
      bridge,
      catalog: await this.catalog.counts(),
      harness: {
        mode: this.loop.gatewayMode,
        defaultBudget: { attempts: this.loop.gatewayMode === "bounded" ? 2 : 1, searches: 2, mcpCalls: 10, dynamicSources: 2, contextDeltas: 2, durationMinutes: 10 },
        publicTools: 6,
      },
    };
  }

  private async getContext(input: JsonObject): Promise<unknown> {
    const includeSchema = input.includeSchema !== false;
    const selectionLimit = clampInteger(input.selectionLimit, 1, 50, 20);
    const runId = optionalRunId(input.runId);
    const snapshotId = optionalRunId(input.snapshotId, "snapshotId");
    if (runId) await this.loop.consume(runId, snapshotId ? ["call", "contextDelta"] : ["call"]);
    const raw = (await this.sendCommand("get_task_context", { includeSchema, maxSelectedElements: selectionLimit })).data;
    if (!runId && !snapshotId) return raw;
    const data = this.snapshots.capture(raw, snapshotId);
    if (runId) {
      const fingerprint = readString(data, "ProjectFingerprint", "projectFingerprint");
      if (fingerprint) await this.loop.attachProject(runId, fingerprint);
      await this.loop.recordResponse(runId, data);
    }
    return data;
  }

  private async searchTools(input: JsonObject): Promise<unknown> {
    const task = parseTaskUnderstanding(input);
    const requestedRunId = optionalRunId(input.runId);
    let run = requestedRunId
      ? await this.loop.consume(requestedRunId, ["call", "search"])
      : input.startLoop === true ? await this.loop.start(task) : undefined;
    const query = typeof input.query === "string" ? input.query.trim().slice(0, 500) : "";
    const limit = clampInteger(input.limit, 1, 10, 5);
    const performance = await this.telemetry.summaries();
    const recommendedById = new Map<string, ToolDescriptor>();
    const workflow = [];
    const candidateIds = new Set<string>();
    for (const [index, step] of task.steps.entries()) {
      const stepTask = {
        ...task,
        goal: `${step.action} ${step.object ?? ""} ${step.outcome}`,
        actions: [step.action],
        objects: step.object ? [step.object] : task.objects,
        steps: [step],
      };
      const directory = routeTask(stepTask, query);
      const searchText = [step.action, step.object ?? "", step.outcome, ...(task.constraints ?? []), query].join(" ");
      const tools = await this.catalog.search(
        searchText,
        limit,
        input.includeExperimental === true,
        performance,
        directoryToolTerms(directory),
      );
      const recommended = tools[0];
      const route = !recommended
        ? "dynamicCSharp"
        : recommended.performance?.health === "degraded"
          ? "evaluateDynamicCSharp"
          : "existingTool";
      if (recommended) recommendedById.set(recommended.toolId, recommended);
      for (const tool of tools) candidateIds.add(tool.toolId);
      workflow.push({
        stepNumber: index + 1,
        action: step.action,
        object: step.object,
        outcome: step.outcome,
        directory,
        route,
        recommendedToolId: recommended?.toolId,
        alternatives: tools.slice(1).map(toToolSummary),
        dynamicCSharp: route === "existingTool" ? undefined : {
          reason: route === "dynamicCSharp"
            ? "No relevant existing or saved tool covers this workflow step."
            : "The relevant tool is degraded in local telemetry; compare it with a direct parameterized C# implementation.",
          nextAction: "Generate and execute parameterized C# for this step, then save it as a reusable tool on success.",
        },
      });
    }
    const dynamicSteps = workflow.filter((step) => step.route !== "existingTool").map((step) => step.stepNumber);
    const profile = run ? getDomainProfile(task.domain) : undefined;
    const data = {
      runId: run?.runId,
      understoodTask: {
        mode: task.mode,
        domain: task.domain,
        actions: task.actions,
        objects: task.objects,
        stepCount: task.steps.length,
        acceptanceCriteria: task.acceptanceCriteria,
        evidenceRequirements: task.evidenceRequirements,
      },
      domainProfile: profile,
      workflow,
      recommendedTools: [...recommendedById.values()],
      resultCount: candidateIds.size,
      dynamicSteps,
      loop: run ? { enabled: true, requestedMode: run.requestedMode, effectiveMode: run.effectiveMode, remainingBudget: this.loop.remaining(run) } : { enabled: false },
      guidance: dynamicSteps.length === 0
        ? "Validate the proposed workflow, then run its tools individually or as one atomic plan when the steps modify the same document."
        : "Keep suitable existing tools in the workflow. Refine unresolved steps once, then use dynamic C# only for remaining gaps or degraded routes.",
    };
    if (!run) return data;
    run = await this.loop.recordResponse(run.runId, data);
    return { ...data, loop: { enabled: true, requestedMode: run.requestedMode, effectiveMode: run.effectiveMode, remainingBudget: this.loop.remaining(run) } };
  }

  private async runTool(input: JsonObject): Promise<{
    data: unknown; toolId: string; version: string; title: string; risk: ToolRisk;
  }> {
    const toolId = requireString(input.toolId, "toolId", 140);
    const requestedVersion = optionalVersion(input.version);
    const resolved = await this.catalog.resolve(toolId, requestedVersion);
    if (toolId.startsWith("builtin:") && resolved.descriptor.risk === "destructive") {
      throw new AgentError(
        "DESTRUCTIVE_BUILTIN_DISABLED",
        "This legacy destructive tool cannot prove its actual scope before execution. Use dynamic C# with Describe() confirmation instead.",
      );
    }
    const args = normalizeArguments(resolved.descriptor.inputSchema, input.arguments ?? {}, readOriginHints(input.argumentOrigins)).arguments;
    await this.assertProjectBinding(resolved.descriptor);
    const runId = optionalRunId(input.runId);
    const checks = parseVerificationChecks(input.verificationChecks, false);
    if (runId) {
      const data = await this.runPlan({
        runId,
        attempt: input.attempt,
        steps: [{ kind: "tool", stepId: "step-1", toolId, version: requestedVersion, arguments: args }],
        verificationChecks: checks,
      });
      return { data, toolId, version: resolved.descriptor.version, title: humanizeToolName(resolved.descriptor.name), risk: resolved.descriptor.risk };
    }
    const command = toolId.startsWith("builtin:") ? resolved.descriptor.name : "execute_dynamic_csharp";
    const parameters = toolId.startsWith("builtin:") ? args : { mode: "execute", source: resolved.source, inputs: args };
    const data = (await this.sendCommand(command, parameters, command === "execute_dynamic_csharp" ? 120_000 : 30_000)).data;
    return {
      data,
      toolId,
      version: resolved.descriptor.version,
      title: humanizeToolName(resolved.descriptor.name),
      risk: resolved.descriptor.risk,
    };
  }

  private async normalizeDetailParameters(name: string, input: JsonObject): Promise<Record<string, TaskInputParameter>> {
    const result: Record<string, TaskInputParameter> = {};
    const append = (prefix: string, values: Record<string, TaskInputParameter>) => {
      for (const [path, detail] of Object.entries(values)) result[`${prefix}${path}`] = detail;
    };
    if (name === "execute_dynamic_csharp") {
      const manifest = input.manifest && typeof input.manifest === "object" ? input.manifest as unknown as GeneratedToolManifestInput : undefined;
      if (manifest?.inputSchema) append("arguments.", normalizeArguments(manifest.inputSchema, input.arguments ?? {}, readOriginHints(input.argumentOrigins)).parameters);
      return result;
    }
    if (name === "run_bim_tool" && typeof input.toolId === "string") {
      const resolved = await this.catalog.resolve(input.toolId, optionalVersion(input.version));
      append("arguments.", normalizeArguments(resolved.descriptor.inputSchema, input.arguments ?? {}, readOriginHints(input.argumentOrigins)).parameters);
      return result;
    }
    if (name !== "run_bim_plan" || !Array.isArray(input.steps)) return result;
    for (let index = 0; index < input.steps.length; index += 1) {
      const rawStep = input.steps[index];
      if (!rawStep || typeof rawStep !== "object") continue;
      const step = rawStep as JsonObject;
      if (step.kind === "dynamic") {
        const manifest = step.manifest && typeof step.manifest === "object" ? step.manifest as unknown as GeneratedToolManifestInput : undefined;
        if (manifest?.inputSchema) append(`steps[${index}].arguments.`, normalizeArguments(manifest.inputSchema, step.arguments ?? {}, readOriginHints(step.argumentOrigins)).parameters);
      } else if (typeof step.toolId === "string") {
        const resolved = await this.catalog.resolve(step.toolId, optionalVersion(step.version));
        append(`steps[${index}].arguments.`, normalizeArguments(resolved.descriptor.inputSchema, step.arguments ?? {}, readOriginHints(step.argumentOrigins)).parameters);
      }
    }
    return result;
  }

  private async runPlan(input: JsonObject): Promise<unknown> {
    if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 20) {
      throw new AgentError("VALIDATION_ERROR", "steps must contain between 1 and 20 operations.");
    }
    const runId = optionalRunId(input.runId);
    const attempt = clampInteger(input.attempt, 1, 3, 1);
    const checks = parseVerificationChecks(input.verificationChecks, false);
    if (runId && checks.length === 0) {
      throw new AgentError("VALIDATION_ERROR", "verificationChecks are required when runId enables the Harness.");
    }
    let run: LoopRunState | undefined;
    const dynamicCount = input.steps.filter((item) => item && typeof item === "object" && (item as JsonObject).kind === "dynamic").length;
    if (runId) {
      run = await this.loop.limitBudget(runId, input.loopBudget === undefined ? undefined : requireObject(input.loopBudget, "loopBudget"));
      const usageKinds: Array<"call" | "attempt" | "dynamicSource"> = ["call", "attempt"];
      for (let index = 0; index < dynamicCount; index += 1) usageKinds.push("dynamicSource");
      run = await this.loop.consume(runId, usageKinds, attempt);
    }
    let projectFingerprint: string | undefined;
    if (runId) {
      projectFingerprint = await this.getProjectFingerprint();
      run = await this.loop.attachProject(runId, projectFingerprint);
      if (run.phase === "stopped") {
        throw new AgentError("ACTIVE_DOCUMENT_CHANGED", "The active Revit document changed during the Harness run.");
      }
    }
    if (runId && run && attempt > 1 && verificationScopeSize(checks) > run.budget.maxAutoCorrectionElements) {
      await this.loop.stop(runId, "AUTO_CORRECTION_SCOPE_EXCEEDED");
      throw new AgentError("AUTO_CORRECTION_SCOPE_EXCEEDED", `Automatic correction is limited to ${run.budget.maxAutoCorrectionElements} scoped elements.`);
    }
    const steps: JsonObject[] = [];
    const pendingDynamic: Array<{ source: string; manifest: GeneratedToolManifestInput; projectFingerprint?: string; saveOnSuccess: boolean }> = [];
    const savedSteps: Array<{ stepId: string; toolId: string; version: string }> = [];
    for (const rawStep of input.steps) {
      const step = requireObject(rawStep, "step");
      const kind = step.kind === "dynamic" ? "dynamic" : "tool";
      const stepId = requireString(step.stepId ?? `step-${steps.length + 1}`, "step.stepId", 80);
      if (kind === "dynamic") {
        const source = requireString(step.source, "step.source", 60_000);
        const manifest = requireObject(step.manifest, "step.manifest") as unknown as GeneratedToolManifestInput;
        validateGeneratedToolManifest(manifest);
        if (manifest.risk === "destructive") {
          if (runId) await this.loop.stop(runId, "DESTRUCTIVE_OPERATION");
          throw new AgentError("DESTRUCTIVE_PLAN_NOT_SUPPORTED", "Destructive Dynamic C# cannot run inside a correction loop.");
        }
        const args = normalizeArguments(manifest.inputSchema, step.arguments ?? {}, readOriginHints(step.argumentOrigins)).arguments;
        if (manifest.binding === "project" && !projectFingerprint) projectFingerprint = await this.getProjectFingerprint();
        const bindingFingerprint = manifest.binding === "project" ? projectFingerprint : undefined;
        pendingDynamic.push({ source, manifest, projectFingerprint: bindingFingerprint, saveOnSuccess: step.saveOnSuccess !== false });
        steps.push({ commandName: "execute_dynamic_csharp", parameters: { mode: "execute", source, inputs: args }, toolId: `dynamic:${hashPrefix(source)}`, stepId });
        continue;
      }
      const toolId = requireString(step.toolId, "step.toolId", 140);
      const resolved = await this.catalog.resolve(toolId, optionalVersion(step.version));
      if (resolved.descriptor.risk === "destructive") {
        throw new AgentError("DESTRUCTIVE_PLAN_NOT_SUPPORTED", "Destructive built-in tools are not supported in atomic V1 plans.");
      }
      const args = normalizeArguments(resolved.descriptor.inputSchema, step.arguments ?? {}, readOriginHints(step.argumentOrigins)).arguments;
      await this.assertProjectBinding(resolved.descriptor);
      if (toolId.startsWith("saved:")) savedSteps.push({ stepId, toolId, version: resolved.descriptor.version });
      steps.push(toolId.startsWith("builtin:")
        ? { commandName: resolved.descriptor.name, parameters: args, toolId, stepId }
        : { commandName: "execute_dynamic_csharp", parameters: { mode: "execute", source: resolved.source, inputs: args }, toolId, stepId });
    }
    const bridgeData = (await this.sendCommand("execute_agent_plan", {
      steps, verificationChecks: checks, runId, attempt,
    }, 120_000)).data;
    const verdict = readString(bridgeData, "Verdict", "verdict") ?? "unverified";
    const passed = verdict === "passed";
    const rolledBack = readBoolean(bridgeData, "RolledBack", "rolledBack") === true;
    const savedTools = [];
    for (const pending of pendingDynamic) {
      if (!pending.saveOnSuccess) continue;
      savedTools.push(await this.store.save(
        pending.source,
        pending.manifest,
        (passed || (!runId && verdict === "unverified")) && !rolledBack ? "active" : "draft",
        pending.projectFingerprint,
      ));
    }
    if (checks.length > 0) await this.recordSavedToolVerification(savedSteps, bridgeData, passed);
    const evidence = sanitizeEvidence(bridgeData);
    if (!runId || !run) {
      return { execution: bridgeData, verdict, rolledBack, evidence, savedTools };
    }
    run = await this.loop.recordOutcome(
      runId,
      passed ? "passed" : verdict === "stopped" ? "stopped" : "failed",
      passed ? "passed" : verdict === "stopped" ? "stopped" : verdict === "failed" ? "failed" : "unverified",
      evidence,
      passed ? undefined : readString(bridgeData, "ErrorCode", "errorCode") ?? "VERIFICATION_FAILED",
    );
    const data = {
      runId,
      attempt,
      phase: run.phase,
      verdict: run.verdict,
      evidence,
      remainingBudget: this.loop.remaining(run),
      rolledBack,
      nextAction: passed
        ? "complete"
        : run.phase === "stopped"
          ? "inspect-and-start-a-new-task"
          : "review-evidence-and-apply-the-smallest-justified-correction",
      execution: bridgeData,
      savedTools,
    };
    await this.loop.recordResponse(runId, data);
    return data;
  }

  private async executeDynamic(input: JsonObject): Promise<{
    data: unknown; toolId: string; version?: string; title: string; risk: ToolRisk;
  }> {
    const source = requireString(input.source, "source", 60_000);
    const manifest = requireObject(input.manifest, "manifest") as unknown as GeneratedToolManifestInput;
    validateGeneratedToolManifest(manifest);
    const args = normalizeArguments(manifest.inputSchema, input.arguments ?? {}, readOriginHints(input.argumentOrigins)).arguments;
    const saveOnSuccess = input.saveOnSuccess !== false;
    const runId = optionalRunId(input.runId);
    const checks = parseVerificationChecks(input.verificationChecks, false);
    if (runId) {
      if (manifest.risk === "destructive") {
        await this.loop.stop(runId, "DESTRUCTIVE_OPERATION");
        throw new AgentError("DESTRUCTIVE_PLAN_NOT_SUPPORTED", "Destructive Dynamic C# cannot run inside a correction loop.");
      }
      const data = await this.runPlan({
        runId,
        attempt: input.attempt,
        steps: [{ kind: "dynamic", stepId: "step-1", source, manifest, arguments: args, saveOnSuccess }],
        verificationChecks: checks,
      });
      const saved = Array.isArray((data as JsonObject).savedTools) ? ((data as JsonObject).savedTools as JsonObject[])[0] : undefined;
      return {
        toolId: saved ? `saved:${String(saved.toolId)}` : `dynamic:${hashPrefix(source)}`,
        version: typeof saved?.version === "string" ? saved.version : undefined,
        title: manifest.name,
        risk: manifest.risk,
        data,
      };
    }
    let projectFingerprint: string | undefined;
    if (manifest.binding === "project") {
      projectFingerprint = await this.getProjectFingerprint();
    }
    try {
      const data = (await this.sendCommand(
        "execute_dynamic_csharp",
        { mode: "execute", source, inputs: args },
        120_000,
      )).data;
      const executed = readBoolean(data, "Executed", "executed") === true;
      const cancelled = readBoolean(data, "Cancelled", "cancelled") === true;
      const effectiveManifest = readBoolean(data, "Destructive", "destructive") === true
        ? { ...manifest, risk: "destructive" as const }
        : manifest;
      const saved = saveOnSuccess
        ? await this.store.save(source, effectiveManifest, executed && !cancelled ? "active" : "draft", projectFingerprint)
        : undefined;
      return {
        toolId: saved ? `saved:${saved.toolId}` : `dynamic:${hashPrefix(source)}`,
        version: saved?.version,
        title: manifest.name,
        risk: effectiveManifest.risk,
        data: { phase: executed && !cancelled ? "passed" : "failed", verdict: executed && !cancelled ? "unverified" : "failed", execution: data, savedTool: saved },
      };
    } catch (error) {
      const normalized = normalizeError(error);
      if (saveOnSuccess && !isCompilationFailure(normalized.message)) {
        let saved;
        try {
          saved = await this.store.save(source, manifest, "draft", projectFingerprint);
        } catch (saveError) {
          const saveFailure = normalizeError(saveError);
          throw new AgentError(normalized.code, `${normalized.message} Draft was not saved: ${saveFailure.message}`);
        }
        throw new AgentError(normalized.code, `${normalized.message} Draft saved as saved:${saved.toolId}@${saved.version}.`);
      }
      throw normalized;
    }
  }

  private async assertProjectBinding(tool: ToolDescriptor): Promise<void> {
    if (tool.binding === "project" && tool.projectFingerprint !== await this.getProjectFingerprint()) {
      throw new AgentError("PROJECT_BINDING_MISMATCH", `Saved tool belongs to a different Revit project: ${tool.toolId}`);
    }
  }

  private sendCommand(commandName: string, parameters: JsonObject = {}, timeoutMs = 30_000) {
    return this.bridge.sendCommand(commandName, parameters, timeoutMs, this.bridgeContext.getStore());
  }

  private async getProjectFingerprint(): Promise<string> {
    const context = await this.getContext({ includeSchema: false, selectionLimit: 1 });
    const fingerprint = readString(context, "ProjectFingerprint", "projectFingerprint");
    if (!fingerprint) {
      throw new AgentError("PROJECT_FINGERPRINT_UNAVAILABLE", "Connected Revit Bridge did not return a project fingerprint.");
    }
    return fingerprint;
  }

  private async recordSavedToolVerification(
    steps: Array<{ stepId: string; toolId: string; version: string }>,
    bridgeData: unknown,
    passed: boolean,
  ): Promise<void> {
    const failedStepIds = readFailedStepIds(bridgeData);
    for (const step of steps) {
      const stepPassed = passed || (failedStepIds.size > 0 && !failedStepIds.has(step.stepId));
      await this.store.recordVerification(step.toolId.slice("saved:".length), step.version, stepPassed);
    }
  }

  private async recordHarnessFailure(input: JsonObject, error: AgentError): Promise<void> {
    const runId = typeof input.runId === "string" && /^[0-9a-f-]{36}$/i.test(input.runId) ? input.runId : undefined;
    if (!runId) return;
    try {
      const current = await this.loop.get(runId);
      if (current.phase === "passed" || current.phase === "stopped") return;
      if (mustStopHarness(error.code)) {
        await this.loop.stop(runId, error.code);
        return;
      }
      await this.loop.recordOutcome(runId, "failed", "failed", { errorCode: error.code }, error.code);
    } catch {
      // Harness bookkeeping must never replace the original execution error.
    }
  }
}

function mustStopHarness(errorCode: string): boolean {
  return errorCode === "ACTIVE_DOCUMENT_CHANGED"
    || errorCode === "REVIT_COMMAND_TIMEOUT_UNCERTAIN"
    || errorCode === "INVALID_BRIDGE_RESPONSE"
    || errorCode === "REVIT_NOT_CONNECTED"
    || errorCode.startsWith("REVIT_CONNECTION_")
    || errorCode === "DESTRUCTIVE_PLAN_NOT_SUPPORTED"
    || errorCode === "AUTO_CORRECTION_SCOPE_EXCEEDED";
}

function requireString(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new AgentError("VALIDATION_ERROR", `${name} is required and must be at most ${maxLength} characters.`);
  }
  return value;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function optionalVersion(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 80) {
    throw new AgentError("VALIDATION_ERROR", "version must be a non-empty string of at most 80 characters.");
  }
  return value;
}

function optionalRunId(value: unknown, name = "runId"): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new AgentError("VALIDATION_ERROR", `${name} must be a UUID.`);
  }
  return value;
}

function readOriginHints(value: unknown): Record<string, TaskInputParameter["origin"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set<TaskInputParameter["origin"]>([
    "user_provided", "default", "agent_resolved", "tool_derived", "system_injected",
  ]);
  return Object.fromEntries(Object.entries(value as JsonObject).filter((entry): entry is [string, TaskInputParameter["origin"]] =>
    typeof entry[1] === "string" && allowed.has(entry[1] as TaskInputParameter["origin"]))) as Record<string, TaskInputParameter["origin"]>;
}

function resolveTaskId(name: string, value: unknown): string | undefined {
  if (value !== undefined) return optionalRunId(value, "taskId");
  return isTaskOperation(name) ? randomUUID() : undefined;
}

function isTaskOperation(name: string): boolean {
  return name === "search_bim_tools"
    || name === "run_bim_tool"
    || name === "run_bim_plan"
    || name === "execute_dynamic_csharp";
}

function taskActivityTitle(name: string, input: JsonObject): string {
  if (name === "search_bim_tools" && input.task && typeof input.task === "object") {
    const task = input.task as JsonObject;
    const displayTitle = task.displayTitle;
    if (typeof displayTitle === "string" && displayTitle.trim()) return displayTitle.trim().slice(0, 120);
    const goal = task.goal;
    if (typeof goal === "string" && goal.trim()) return goal.trim().slice(0, 180);
  }
  if (name === "execute_dynamic_csharp" && input.manifest && typeof input.manifest === "object") {
    const manifestName = (input.manifest as JsonObject).name;
    if (typeof manifestName === "string" && manifestName.trim()) return manifestName.trim().slice(0, 180);
  }
  if (name === "run_bim_tool" && typeof input.toolId === "string") return humanizeToolName(input.toolId.replace(/^[^:]+:/, ""));
  if (name === "run_bim_plan") return `Run ${Array.isArray(input.steps) ? input.steps.length : 0} BIM steps`;
  return publicActivityTitle(name, input);
}

function hasVerification(input: JsonObject): boolean {
  return Array.isArray(input.verificationChecks) && input.verificationChecks.length > 0;
}

function requestedPlanRisk(input: JsonObject): ToolRisk {
  if (!Array.isArray(input.steps) || input.steps.length === 0) return "reversibleMutation";
  let risk: ToolRisk = "readOnly";
  for (const rawStep of input.steps) {
    if (!rawStep || typeof rawStep !== "object") return "reversibleMutation";
    const step = rawStep as JsonObject;
    if (step.kind !== "dynamic") return "reversibleMutation";
    const manifest = step.manifest && typeof step.manifest === "object" ? step.manifest as JsonObject : undefined;
    const stepRisk = manifest?.risk;
    if (stepRisk === "destructive") return "destructive";
    if (stepRisk === "reversibleMutation") risk = "reversibleMutation";
    if (stepRisk !== "readOnly" && stepRisk !== "reversibleMutation") return "reversibleMutation";
  }
  return risk;
}

function taskVerificationStatus(input: JsonObject, data: unknown): "not_requested" | "pending" | "passed" | "failed" | "insufficient_evidence" {
  if (!hasVerification(input)) return "not_requested";
  const verdict = readString(data, "verdict", "Verdict")
    ?? readString(unwrapExecution(data), "verdict", "Verdict");
  if (verdict === "passed") return "passed";
  if (verdict === "failed") return "failed";
  return "insufficient_evidence";
}

function toTaskScope(data: unknown) {
  const execution = summarizeScope(unwrapExecution(data));
  const harness = summarizeScope(data);
  const merged = mergeScopes(execution, harness);
  if (!merged) return undefined;
  return {
    elementIds: merged.elementIds,
    createdElementIds: merged.createdElementIds,
    deletedElementIds: merged.deletedElementIds,
    stepCount: merged.stepCount,
    transactionName: readString(unwrapExecution(data), "TransactionName", "transactionName"),
    rolledBack: readBoolean(data, "rolledBack", "RolledBack"),
  };
}

function readBoolean(value: unknown, ...keys: string[]): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "boolean") return candidate;
  }
  return undefined;
}

function publicActivityKind(name: string): AgentActivityKind {
  if (name === "get_agent_status") return "connection";
  if (name === "get_bim_context") return "context";
  if (name === "search_bim_tools") return "search";
  if (name === "run_bim_plan") return "plan";
  if (name === "execute_dynamic_csharp") return "dynamic";
  return "operation";
}

function publicActivityTitle(name: string, input: JsonObject): string {
  if (name === "get_agent_status") return "檢查 BIM Agent 連線";
  if (name === "get_bim_context") return "讀取目前 BIM 模型";
  if (name === "search_bim_tools") return "搜尋可用 BIM 工具";
  if (name === "run_bim_plan") return `執行 ${Array.isArray(input.steps) ? input.steps.length : 0} 步 BIM 計畫`;
  if (name === "execute_dynamic_csharp") return "執行新 BIM 操作";
  return "執行 BIM 工具";
}

function createActivityEvent(input: {
  requestId: string;
  startedAtUtc: string;
  kind: AgentActivityKind;
  title: string;
  toolId: string;
  version?: string;
  risk?: ToolRisk;
  durationMs: number;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
}): AgentActivityEvent {
  const payload = unwrapExecution(input.data);
  const cancelled = readBoolean(payload, "Cancelled", "cancelled") === true;
  const transactionName = readString(payload, "TransactionName", "transactionName");
  const scope = mergeScopes(summarizeScope(payload), summarizeScope(input.data));
  return {
    schemaVersion: 1,
    requestId: input.requestId,
    startedAtUtc: input.startedAtUtc,
    completedAtUtc: new Date().toISOString(),
    kind: input.kind,
    title: input.title,
    toolId: input.toolId,
    version: input.version,
    risk: input.risk,
    status: input.errorCode ? "failed" : cancelled ? "cancelled" : "succeeded",
    durationMs: input.durationMs,
    transactionName,
    summary: input.errorMessage ? input.errorMessage.slice(0, 500) : readString(payload, "Summary", "summary"),
    scope,
    errorCode: input.errorCode,
  };
}

function unwrapExecution(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  return (data as Record<string, unknown>).execution ?? data;
}

function summarizeScope(data: unknown): AgentActivityEvent["scope"] {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const elementId = readFiniteNumber(record.ElementId ?? record.elementId);
  const deleted = readIdArray(record.ActualDeletedElementIds ?? record.actualDeletedElementIds);
  const created = readIdArray(record.ActualCreatedElementIds ?? record.actualCreatedElementIds);
  const parameterName = readString(record, "ParameterName", "parameterName");
  const stepCount = readFiniteNumber(record.ExecutedSteps ?? record.executedSteps);
  const runId = readString(record, "runId", "RunId");
  const phase = readString(record, "phase", "Phase") as LoopPhase | undefined;
  const verdict = readString(record, "verdict", "Verdict") as LoopVerdict | undefined;
  const attempt = readFiniteNumber(record.attempt ?? record.Attempt);
  const remaining = record.remainingBudget && typeof record.remainingBudget === "object"
    ? readFiniteNumber((record.remainingBudget as JsonObject).mcpCalls)
    : undefined;
  const scope = {
    elementIds: elementId === undefined ? undefined : [elementId],
    deletedElementIds: deleted,
    createdElementIds: created,
    parameterName,
    stepCount,
    runId,
    phase,
    verdict,
    attempt,
    remainingCalls: remaining,
    responseBytes: Buffer.byteLength(JSON.stringify(data), "utf8"),
  };
  return Object.values(scope).some((value) => value !== undefined) ? scope : undefined;
}

function mergeScopes(
  executionScope: AgentActivityEvent["scope"],
  harnessScope: AgentActivityEvent["scope"],
): AgentActivityEvent["scope"] {
  if (!executionScope) return harnessScope;
  if (!harnessScope) return executionScope;
  return { ...executionScope, ...harnessScope };
}

function readIdArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)).slice(0, 100);
  return ids.length > 0 ? ids : [];
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function humanizeToolName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toToolSummary(tool: ToolDescriptor): ToolSummary {
  const { inputSchema: _inputSchema, source: _source, projectFingerprint: _projectFingerprint, ...summary } = tool;
  return {
    ...summary,
    description: summary.description.slice(0, 300),
    tags: summary.tags.slice(0, 6),
  };
}

function readString(value: unknown, ...keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string") return candidate;
  }
  return undefined;
}

function hashPrefix(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isCompilationFailure(message: string): boolean {
  return /(compile|compilation|emit failed|source is required|blocked api|blocked namespace|syntax is not allowed)/i.test(message);
}

function verificationScopeSize(checks: VerificationCheck[]): number {
  const ids = new Set<number>();
  for (const check of checks) {
    for (const key of ["elementIds", "viewIds"] as const) {
      if (Array.isArray(check[key])) for (const value of check[key] as unknown[]) if (typeof value === "number") ids.add(value);
    }
    if (Array.isArray(check.pairs)) {
      for (const pair of check.pairs) {
        if (!pair || typeof pair !== "object") continue;
        for (const value of Object.values(pair as JsonObject)) if (typeof value === "number") ids.add(value);
      }
    }
  }
  return ids.size;
}

function readFailedStepIds(data: unknown): Set<string> {
  if (!data || typeof data !== "object") return new Set();
  const verification = (data as JsonObject).Verification ?? (data as JsonObject).verification;
  if (!verification || typeof verification !== "object") return new Set();
  const checks = (verification as JsonObject).Checks ?? (verification as JsonObject).checks;
  if (!Array.isArray(checks)) return new Set();
  return new Set(checks.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const check = item as JsonObject;
    const passed = check.Passed ?? check.passed;
    const stepId = check.StepId ?? check.stepId;
    return passed === false && typeof stepId === "string" ? [stepId] : [];
  }));
}
