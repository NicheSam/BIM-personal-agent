import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentRuntime } from "./agent-runtime.js";
import { TelemetryStore } from "./telemetry.js";
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

    const search = await runtime.execute("search_bim_tools", { task: {
      goal: "Set the reviewed mark parameter", actions: ["set parameter"], objects: ["reviewed mark"],
      steps: [{ action: "set", object: "reviewed mark", outcome: "mark is updated" }], mode: "execute",
    } });
    const recommended = (search.data as { recommendedTool: ToolDescriptor }).recommendedTool;
    assert.equal(recommended.toolId, "saved:set-reviewed-mark");

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
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("tool search routes a Chinese DWG task and returns only one full schema", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-runtime-"));
  try {
    const store = new ToolStore(root);
    const dwgTool: ToolDescriptor = { ...builtin, toolId: "builtin:preview_dwg_columns", name: "preview_dwg_columns", description: "Preview column geometry from DWG layers", tags: ["cad", "dwg", "column"] };
    const runtime = new AgentRuntime(new FakeBridge(), new ToolCatalog(store, [dwgTool, builtin]), store, new TelemetryStore(root));
    const result = await runtime.execute("search_bim_tools", { task: {
      goal: "讀取連結的 DWG 並預覽柱的位置", actions: ["讀取", "預覽"], objects: ["DWG 圖層", "柱"], constraints: ["先不修改模型"],
      steps: [{ action: "掃描", object: "DWG 圖層", outcome: "取得柱的位置" }], mode: "assess",
    } });
    assert.equal(result.success, true);
    const data = result.data as { directory: Array<{ id: string }>; recommendedTool: ToolDescriptor; alternatives: Array<Record<string, unknown>> };
    assert.equal(data.directory[0].id, "cad-dwg");
    assert.equal(data.recommendedTool.toolId, dwgTool.toolId);
    assert.ok("inputSchema" in data.recommendedTool);
    assert.equal(data.alternatives.some((tool) => "inputSchema" in tool), false);
  } finally { await rm(root, { recursive: true, force: true }); }
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
