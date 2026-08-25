import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRuntime } from "./agent-runtime.js";
import { AgentError } from "./errors.js";
import { LoopController } from "./loop-controller.js";
import { RunStore } from "./run-store.js";
import { TelemetryStore } from "./telemetry.js";
import { TaskReporter } from "./task-reporter.js";
import { TaskStore } from "./task-store.js";
import { ToolCatalog } from "./tool-catalog.js";
import { ToolStore } from "./tool-store.js";
import type { BridgeClient, BridgeResponse, JsonObject, ToolDescriptor } from "./types.js";

class FakeBridge implements BridgeClient {
  readonly calls: Array<{ commandName: string; parameters: JsonObject }> = [];

  isConnected(): boolean { return true; }
  async disconnect(): Promise<void> {}
  async sendCommand(commandName: string, parameters: JsonObject = {}): Promise<BridgeResponse> {
    this.calls.push({ commandName, parameters });
    if (commandName === "get_task_context") {
      return { success: true, data: { ProjectFingerprint: "project-001" } };
    }
    if (commandName === "execute_dynamic_csharp") {
      return { success: true, data: { Executed: true, CompilationCacheHit: false } };
    }
    if (commandName === "execute_agent_plan") {
      return { success: true, data: { ExecutedSteps: 1, Atomic: true } };
    }
    return { success: true, data: { ok: true } };
  }
}

class DestructiveFakeBridge extends FakeBridge {
  override async sendCommand(commandName: string, parameters: JsonObject = {}): Promise<BridgeResponse> {
    this.calls.push({ commandName, parameters });
    if (commandName === "execute_dynamic_csharp") {
      return { success: true, data: { Executed: true, Destructive: true } };
    }
    return { success: true, data: { ok: true } };
  }
}

class CreatedElementBridge extends FakeBridge {
  override async sendCommand(commandName: string, parameters: JsonObject = {}): Promise<BridgeResponse> {
    this.calls.push({ commandName, parameters });
    if (commandName === "create_test_element") {
      return { success: true, data: { ActualCreatedElementIds: [1001], Summary: "created one element" } };
    }
    return { success: true, data: { ok: true } };
  }
}

class ModifiedElementBridge extends FakeBridge {
  override async sendCommand(commandName: string, parameters: JsonObject = {}): Promise<BridgeResponse> {
    this.calls.push({ commandName, parameters });
    if (commandName === "apply_test_override") {
      return { success: true, data: { AppliedCount: 2, VerifiedCount: 2, ElementIds: [2002, 2001] } };
    }
    return { success: true, data: { ok: true } };
  }
}

class VerifiedPlanBridge extends FakeBridge {
  override async sendCommand(commandName: string, parameters: JsonObject = {}): Promise<BridgeResponse> {
    this.calls.push({ commandName, parameters });
    if (commandName === "get_task_context") {
      return { success: true, data: { ProjectFingerprint: "project-001" } };
    }
    if (commandName === "execute_agent_plan") {
      return {
        success: true,
        data: {
          ExecutedSteps: 1,
          Atomic: true,
          Verdict: "passed",
          RolledBack: false,
          Verification: {
            Passed: true,
            Checks: [{ Id: "project-exists", Kind: "evidence", StepId: "step-1", Passed: true, ElementIds: [1] }],
          },
        },
      };
    }
    return { success: true, data: { ok: true } };
  }
}

class UncertainPlanBridge extends FakeBridge {
  override async sendCommand(commandName: string, parameters: JsonObject = {}): Promise<BridgeResponse> {
    this.calls.push({ commandName, parameters });
    if (commandName === "get_task_context") {
      return { success: true, data: { ProjectFingerprint: "project-001" } };
    }
    if (commandName === "execute_agent_plan") {
      throw new AgentError(
        "REVIT_COMMAND_TIMEOUT_UNCERTAIN",
        "The command timed out and the Revit model state is uncertain.",
      );
    }
    return { success: true, data: { ok: true } };
  }
}

const elementLensBuiltin: ToolDescriptor = {
  toolId: "builtin:inspect_element_context",
  name: "inspect_element_context",
  version: "test",
  description: "Inspect selected element context",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      detail: { type: "string" },
      maxParameters: { type: "number" },
      maxViewsScanned: { type: "number" },
      includeDocumentPath: { type: "boolean" },
    },
  },
  risk: "readOnly",
  status: "validated",
  binding: "portable",
  capabilityKey: "element.context.inspect",
  tags: ["element", "parameter", "selection", "context"],
};

const builtin: ToolDescriptor = {
  toolId: "builtin:get_project_info",
  name: "get_project_info",
  version: "test",
  description: "Get project information",
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  risk: "readOnly",
  status: "validated",
  binding: "portable",
  tags: ["project"],
};

test("search and execution can share one workbench task", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const toolStore = new ToolStore(root);
    const taskStore = new TaskStore(root);
    const reporter = new TaskReporter(taskStore);
    const runtime = new AgentRuntime(
      new FakeBridge(),
      new ToolCatalog(toolStore, [builtin]),
      toolStore,
      new TelemetryStore(root),
      undefined,
      undefined,
      undefined,
      reporter,
    );
    const taskId = "11111111-1111-4111-8111-111111111111";
    const search = await runtime.execute("search_bim_tools", {
      taskId,
      task: {
        goal: "Read project information",
        actions: ["read"],
        objects: ["project"],
        steps: [{ action: "read", object: "project", outcome: "project information is returned" }],
        mode: "execute",
      },
    });
    const run = await runtime.execute("run_bim_tool", { taskId, toolId: builtin.toolId, arguments: {} });
    await runtime.flushObservations();
    assert.equal(search.taskId, taskId);
    assert.equal(run.taskId, taskId);
    assert.match(run.reportUrl || "", new RegExp(taskId));
    assert.equal((await taskStore.get(taskId))?.eventCount, 4);
    assert.deepEqual((await taskStore.events(taskId)).map((event) => event.phase), ["received", "completed", "received", "completed"]);
    const details = await taskStore.details(taskId);
    assert.equal(details.length, 2);
    assert.equal(details.at(-1)?.tool.toolId, builtin.toolId);
    assert.deepEqual(details.at(-1)?.input, { toolId: builtin.toolId, arguments: {} });
    assert.equal((await taskStore.get(taskId))?.detailCount, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("simple execution returns before asynchronous observation storage completes", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  let releaseObservation!: () => void;
  const observationReleased = new Promise<void>((resolve) => { releaseObservation = resolve; });
  class BlockingTelemetry extends TelemetryStore {
    override async record(): Promise<void> {
      await observationReleased;
    }
  }
  try {
    const toolStore = new ToolStore(root);
    const bridge = new FakeBridge();
    const runtime = new AgentRuntime(
      bridge,
      new ToolCatalog(toolStore, [builtin]),
      toolStore,
      new BlockingTelemetry(root),
    );
    const response = await Promise.race([
      runtime.execute("run_bim_tool", { toolId: builtin.toolId, arguments: {} }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("execution waited for observation storage")), 100)),
    ]);
    assert.equal(response.success, true);
    assert.deepEqual(bridge.calls.map((call) => call.commandName), ["get_project_info"]);
    assert.equal(response.verificationStatus, "not_requested");
    releaseObservation();
    await runtime.flushObservations();
  } finally {
    releaseObservation();
    await rm(root, { recursive: true, force: true });
  }
});

test("dynamic C# is saved and reusable without becoming a new MCP tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const bridge = new FakeBridge();
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(
      bridge,
      new ToolCatalog(store, [builtin]),
      store,
      new TelemetryStore(root),
    );
    const source = "public sealed class GeneratedCommand { }";
    const generated = await runtime.execute("execute_dynamic_csharp", {
      source,
      arguments: { value: "Reviewed" },
      manifest: {
        toolId: "set-reviewed-mark",
        name: "Set reviewed mark",
        description: "Sets a mark using context inputs.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        risk: "reversibleMutation",
        binding: "portable",
        tags: ["parameter"],
      },
    });
    assert.equal(generated.success, true);
    assert.equal(generated.toolId, "saved:set-reviewed-mark");

    const search = await runtime.execute("search_bim_tools", {
      task: {
        goal: "Set the reviewed mark parameter",
        actions: ["set parameter"],
        objects: ["reviewed mark"],
        steps: [{ action: "set", object: "reviewed mark", outcome: "mark is updated" }],
        mode: "execute",
      },
    });
    const recommended = (search.data as { recommendedTools: ToolDescriptor[] }).recommendedTools;
    assert.equal(recommended[0].toolId, "saved:set-reviewed-mark");

    const rerun = await runtime.execute("run_bim_tool", {
      toolId: "saved:set-reviewed-mark",
      arguments: { value: "Checked" },
    });
    assert.equal(rerun.success, true);
    assert.equal(bridge.calls.at(-1)?.commandName, "execute_dynamic_csharp");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool search requires task understanding and decomposition", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", { query: "project" });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "VALIDATION_ERROR");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool search adds Element Lens before selected element parameter work", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const parameterTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:set_element_parameter",
      name: "set_element_parameter",
      description: "Set a selected element parameter",
      risk: "reversibleMutation",
      tags: ["element", "parameter", "selection"],
    };
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [elementLensBuiltin, parameterTool, builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", {
      task: {
        goal: "Set the Mark parameter on the selected element",
        actions: ["set parameter"],
        objects: ["selected element", "Mark parameter"],
        steps: [{ action: "set", object: "selected element Mark parameter", outcome: "parameter value is updated" }],
        mode: "execute",
      },
    });
    assert.equal(result.success, true);
    const data = result.data as {
      workflow: Array<{ stepNumber: number; recommendedToolId?: string; suggestedArguments?: JsonObject; inspectionPolicy?: Record<string, unknown> }>;
      recommendedTools: ToolDescriptor[];
      inspectionPolicy: Record<string, unknown>;
    };
    assert.equal(data.workflow[0].stepNumber, 0);
    assert.equal(data.workflow[0].recommendedToolId, elementLensBuiltin.toolId);
    assert.deepEqual(data.workflow[0].suggestedArguments, {
      detail: "parameters",
      maxParameters: 80,
      maxViewsScanned: 0,
      includeDocumentPath: false,
    });
    assert.deepEqual(data.workflow[0].inspectionPolicy?.beforeStepNumbers, [1]);
    assert.equal(data.recommendedTools[0].toolId, elementLensBuiltin.toolId);
    assert.equal(data.inspectionPolicy.shouldInspect, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool search does not add Element Lens for non-selected parameter work", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const parameterTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:list_type_parameters",
      name: "list_type_parameters",
      description: "List family type parameters",
      tags: ["element", "parameter", "type"],
    };
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [elementLensBuiltin, parameterTool, builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", {
      task: {
        goal: "List wall type parameters",
        actions: ["list"],
        objects: ["wall type parameters"],
        steps: [{ action: "list", object: "wall type parameters", outcome: "parameters are returned" }],
        mode: "assess",
      },
    });
    assert.equal(result.success, true);
    const data = result.data as {
      workflow: Array<{ recommendedToolId?: string }>;
      recommendedTools: ToolDescriptor[];
      inspectionPolicy: Record<string, unknown>;
    };
    assert.notEqual(data.workflow[0].recommendedToolId, elementLensBuiltin.toolId);
    assert.equal(data.recommendedTools.some((tool) => tool.toolId === elementLensBuiltin.toolId), false);
    assert.equal(data.inspectionPolicy.shouldInspect, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool search does not add Element Lens for project-wide context work", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [elementLensBuiltin, builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", {
      task: {
        goal: "Read project information",
        actions: ["read"],
        objects: ["project"],
        steps: [{ action: "read", object: "project", outcome: "project information is returned" }],
        mode: "assess",
      },
    });
    assert.equal(result.success, true);
    const data = result.data as {
      workflow: Array<{ recommendedToolId?: string }>;
      recommendedTools: ToolDescriptor[];
      inspectionPolicy: Record<string, unknown>;
    };
    assert.notEqual(data.workflow[0].recommendedToolId, elementLensBuiltin.toolId);
    assert.equal(data.recommendedTools.some((tool) => tool.toolId === elementLensBuiltin.toolId), false);
    assert.equal(data.inspectionPolicy.shouldInspect, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool search routes a Chinese DWG task and keeps alternatives compact", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const dwgTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:preview_dwg_columns",
      name: "preview_dwg_columns",
      description: "Preview column geometry from DWG layers",
      tags: ["cad", "dwg", "column"],
    };
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [dwgTool, builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", {
      task: {
        goal: "讀取連結的 DWG 並預覽柱的位置",
        actions: ["讀取", "預覽"],
        objects: ["DWG 圖層", "柱"],
        constraints: ["先不修改模型"],
        steps: [{ action: "掃描", object: "DWG 圖層", outcome: "取得柱的位置" }],
        mode: "assess",
      },
    });
    assert.equal(result.success, true);
    const data = result.data as {
      workflow: Array<{ directory: Array<{ id: string }>; recommendedToolId?: string; alternatives: Array<Record<string, unknown>> }>;
      recommendedTools: ToolDescriptor[];
    };
    assert.equal(data.workflow[0].directory[0].id, "cad-dwg");
    assert.equal(data.workflow[0].recommendedToolId, dwgTool.toolId);
    assert.equal(data.recommendedTools[0].toolId, dwgTool.toolId);
    assert.ok("inputSchema" in data.recommendedTools[0]);
    assert.equal(data.workflow[0].alternatives.some((tool) => "inputSchema" in tool), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("complex tasks return a workflow with every required tool schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const scanTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:scan_dwg_layers",
      name: "scan_dwg_layers",
      description: "Scan DWG layers and imported CAD geometry",
      tags: ["cad", "dwg", "layer"],
    };
    const createTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:create_structural_columns",
      name: "create_structural_columns",
      description: "Create structural columns from validated positions",
      risk: "reversibleMutation",
      tags: ["structure", "column", "create"],
    };
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [scanTool, createTool]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", {
      task: {
        goal: "從 DWG 建立結構柱",
        actions: ["掃描", "建立"],
        objects: ["DWG 圖層", "結構柱"],
        steps: [
          { action: "掃描 DWG", object: "DWG 圖層", outcome: "取得柱位置" },
          { action: "建立", object: "結構柱", outcome: "依確認位置建立柱" },
        ],
        mode: "plan",
      },
    });
    assert.equal(result.success, true);
    const data = result.data as { workflow: Array<{ recommendedToolId?: string }>; recommendedTools: ToolDescriptor[] };
    assert.deepEqual(data.workflow.map((step) => step.recommendedToolId), [scanTool.toolId, createTool.toolId]);
    assert.deepEqual(data.recommendedTools.map((tool) => tool.toolId), [scanTool.toolId, createTool.toolId]);
    assert.equal(data.recommendedTools.every((tool) => "inputSchema" in tool), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uncovered workflow steps are routed to dynamic C# without replacing covered steps", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const scanTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:scan_dwg_layers",
      name: "scan_dwg_layers",
      description: "Scan DWG layers and imported CAD geometry",
      tags: ["cad", "dwg", "layer"],
    };
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [scanTool]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", {
      task: {
        goal: "掃描 DWG 後執行公司自訂編碼流程",
        actions: ["掃描", "自訂編碼"],
        objects: ["DWG 圖層", "公司編碼"],
        steps: [
          { action: "掃描 DWG", object: "DWG 圖層", outcome: "取得圖層資料" },
          { action: "套用 ZXQ 專案專屬編碼", object: "ZXQ 編碼規則", outcome: "完成專屬編碼" },
        ],
        mode: "plan",
      },
    });
    assert.equal(result.success, true);
    const data = result.data as {
      workflow: Array<{ route: string; recommendedToolId?: string; dynamicCSharp?: Record<string, unknown> }>;
      dynamicSteps: number[];
    };
    assert.equal(data.workflow[0].route, "existingTool");
    assert.equal(data.workflow[0].recommendedToolId, scanTool.toolId);
    assert.equal(data.workflow[1].route, "dynamicCSharp");
    assert.ok(data.workflow[1].dynamicCSharp);
    assert.deepEqual(data.dynamicSteps, [2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tool search exposes a targeting policy for autonomous creation work", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const createTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:create_test_element",
      name: "create_test_element",
      description: "Create a model element",
      risk: "reversibleMutation",
      tags: ["create", "element"],
    };
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [elementLensBuiltin, createTool, builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", {
      task: {
        goal: "Create a new duct segment and inspect its created ElementId after creation",
        actions: ["create"],
        objects: ["duct segment"],
        steps: [{ action: "create", object: "duct segment", outcome: "created ElementId is inspected after creation" }],
        mode: "execute",
      },
    });
    assert.equal(result.success, true);
    const data = result.data as {
      workflow: Array<{ recommendedToolId?: string }>;
      inspectionPolicy: { shouldInspect: boolean };
      targetingPolicy: { resolution: string; postOperation: Record<string, unknown>; targetSources: string[] };
    };
    assert.notEqual(data.workflow[0].recommendedToolId, elementLensBuiltin.toolId);
    assert.equal(data.inspectionPolicy.shouldInspect, false);
    assert.equal(data.targetingPolicy.resolution, "post_operation_target");
    assert.equal(data.targetingPolicy.postOperation.inspectCreated, true);
    assert.equal(data.targetingPolicy.targetSources.includes("created_element_ids"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run_bim_tool recommends Element Lens for created ElementIds", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const createTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:create_test_element",
      name: "create_test_element",
      description: "Create a model element",
      risk: "reversibleMutation",
      tags: ["create", "element"],
    };
    const runtime = new AgentRuntime(new CreatedElementBridge(), new ToolCatalog(store, [elementLensBuiltin, createTool, builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("run_bim_tool", { toolId: createTool.toolId, arguments: {} });
    assert.equal(result.success, true);
    const targeting = result.targeting as {
      hasTargets: boolean;
      createdElementIds: number[];
      recommendedInspections: Array<{ source: string; elementIds: number[]; arguments: JsonObject }>;
    };
    assert.equal(targeting.hasTargets, true);
    assert.deepEqual(targeting.createdElementIds, [1001]);
    assert.equal(targeting.recommendedInspections[0].source, "created");
    assert.deepEqual(targeting.recommendedInspections[0].elementIds, [1001]);
    assert.equal(targeting.recommendedInspections[0].arguments.elementId, 1001);
    assert.equal(targeting.recommendedInspections[0].arguments.detail, "full");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run_bim_tool projects verified applied ElementIds as modified targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const modifyTool: ToolDescriptor = {
      ...builtin,
      toolId: "builtin:apply_test_override",
      name: "apply_test_override",
      description: "Apply reversible overrides to elements",
      risk: "reversibleMutation",
      tags: ["modify", "element"],
    };
    const runtime = new AgentRuntime(new ModifiedElementBridge(), new ToolCatalog(store, [elementLensBuiltin, modifyTool, builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("run_bim_tool", { toolId: modifyTool.toolId, arguments: {} });
    assert.equal(result.success, true);
    const targeting = result.targeting as {
      modifiedElementIds: number[];
      recommendedInspections: Array<{ source: string; elementIds: number[]; arguments: JsonObject }>;
    };
    assert.deepEqual(targeting.modifiedElementIds, [2001, 2002]);
    assert.equal(targeting.recommendedInspections[0].source, "modified");
    assert.deepEqual(targeting.recommendedInspections[0].elementIds, [2001, 2002]);
    assert.equal(targeting.recommendedInspections[0].arguments.elementId, undefined);
    assert.equal(targeting.recommendedInspections[0].arguments.detail, "parameters");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic plans are delegated as one bridge command", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const bridge = new FakeBridge();
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(bridge, new ToolCatalog(store, [builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("run_bim_plan", {
      steps: [{ toolId: "builtin:get_project_info", arguments: {} }],
    });
    assert.equal(result.success, true);
    assert.equal(bridge.calls.length, 1);
    assert.equal(bridge.calls[0].commandName, "execute_agent_plan");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("normal context reads stay outside the Harness snapshot path", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("get_bim_context", {});
    assert.deepEqual(result.data, { ProjectFingerprint: "project-001" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Harness is opt-in and verifies a bounded plan when explicitly started", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const bridge = new VerifiedPlanBridge();
    const store = new ToolStore(root);
    const loop = new LoopController(new RunStore(join(root, "runs")), "bounded");
    const runtime = new AgentRuntime(
      bridge,
      new ToolCatalog(store, [builtin]),
      store,
      new TelemetryStore(root),
      undefined,
      loop,
    );
    const search = await runtime.execute("search_bim_tools", {
      startLoop: true,
      task: {
        goal: "確認目前專案資料可讀取",
        actions: ["讀取"],
        objects: ["專案資料"],
        steps: [{ action: "讀取", object: "專案資料", outcome: "取得可驗證資料" }],
        mode: "execute",
        domain: "mep",
        loopMode: "bounded",
      },
    });
    const searchData = search.data as { runId: string; loop: { enabled: boolean; effectiveMode: string } };
    assert.equal(searchData.loop.enabled, true);
    assert.equal(searchData.loop.effectiveMode, "bounded");

    const unverified = await runtime.execute("run_bim_tool", {
      runId: searchData.runId,
      toolId: builtin.toolId,
      arguments: {},
    });
    assert.equal(unverified.success, false);
    assert.equal(unverified.errorCode, "VALIDATION_ERROR");
    assert.equal(bridge.calls.some((call) => call.commandName === "execute_agent_plan"), false);

    const result = await runtime.execute("run_bim_plan", {
      runId: searchData.runId,
      attempt: 1,
      steps: [{ kind: "tool", stepId: "step-1", toolId: builtin.toolId, arguments: {} }],
      verificationChecks: [{ id: "project-exists", kind: "evidence", stepId: "step-1", elementIds: [1], minEvidence: 1 }],
    });
    const data = result.data as { phase: string; verdict: string; remainingBudget: { attempts: number; mcpCalls: number } };
    assert.equal(result.success, true);
    assert.equal(data.phase, "passed");
    assert.equal(data.verdict, "passed");
    assert.equal(data.remainingBudget.attempts, 1);
    assert.ok(data.remainingBudget.mcpCalls < 10);
    assert.equal(bridge.calls.at(-1)?.commandName, "execute_agent_plan");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uncertain Revit execution stops the Harness instead of inviting another attempt", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const bridge = new UncertainPlanBridge();
    const store = new ToolStore(root);
    const loop = new LoopController(new RunStore(join(root, "runs")), "bounded");
    const runtime = new AgentRuntime(
      bridge,
      new ToolCatalog(store, [builtin]),
      store,
      new TelemetryStore(root),
      undefined,
      loop,
    );
    const search = await runtime.execute("search_bim_tools", {
      startLoop: true,
      task: {
        goal: "Update a reversible parameter and verify it",
        actions: ["update"],
        objects: ["parameter"],
        steps: [{ action: "update", object: "parameter", outcome: "value matches" }],
        mode: "execute",
        loopMode: "bounded",
      },
    });
    const runId = (search.data as { runId: string }).runId;
    const result = await runtime.execute("run_bim_plan", {
      runId,
      attempt: 1,
      steps: [{ kind: "tool", stepId: "step-1", toolId: builtin.toolId, arguments: {} }],
      verificationChecks: [{ id: "project-exists", kind: "evidence", elementIds: [1], minEvidence: 1 }],
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "REVIT_COMMAND_TIMEOUT_UNCERTAIN");
    const state = await loop.get(runId);
    assert.equal(state.phase, "stopped");
    assert.equal(state.stopReason, "REVIT_COMMAND_TIMEOUT_UNCERTAIN");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid dynamic manifests are rejected before reaching Revit", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const bridge = new FakeBridge();
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(bridge, new ToolCatalog(store, [builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("execute_dynamic_csharp", {
      source: "public sealed class GeneratedCommand { }",
      arguments: {},
      manifest: {
        toolId: "bad-tool",
        name: "Bad tool",
        description: "Invalid risk must never reach the Bridge.",
        inputSchema: { type: "object", properties: {} },
        risk: "unknown",
        binding: "portable",
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "VALIDATION_ERROR");
    assert.equal(bridge.calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("destructive built-ins are blocked until they can prove scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const bridge = new FakeBridge();
    const store = new ToolStore(root);
    const destructive = { ...builtin, toolId: "builtin:delete_element", name: "delete_element", risk: "destructive" as const };
    const runtime = new AgentRuntime(bridge, new ToolCatalog(store, [destructive]), store, new TelemetryStore(root));
    const result = await runtime.execute("run_bim_tool", { toolId: destructive.toolId, arguments: {} });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "DESTRUCTIVE_BUILTIN_DISABLED");
    assert.equal(bridge.calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Bridge destructive detection upgrades the saved tool risk", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const bridge = new DestructiveFakeBridge();
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(bridge, new ToolCatalog(store, [builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("execute_dynamic_csharp", {
      source: "public sealed class GeneratedCommand { }",
      arguments: {},
      manifest: {
        toolId: "detected-delete",
        name: "Detected delete",
        description: "Bridge classification must be authoritative.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} },
        risk: "readOnly",
        binding: "portable",
      },
    });
    assert.equal(result.success, true);
    assert.equal((await store.getActive("detected-delete")).manifest.risk, "destructive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built-in execution rejects a mismatched requested version", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const bridge = new FakeBridge();
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(bridge, new ToolCatalog(store, [builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("run_bim_tool", {
      toolId: builtin.toolId,
      version: "wrong-version",
      arguments: {},
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "TOOL_VERSION_MISMATCH");
    assert.equal(bridge.calls.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
