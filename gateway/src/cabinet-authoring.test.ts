import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateArguments } from "./validation.js";
import { ToolCatalog } from "./tool-catalog.js";
import { ToolStore } from "./tool-store.js";
import { AgentRuntime } from "./agent-runtime.js";
import { TelemetryStore } from "./telemetry.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeClient, JsonObject } from "./types.js";
const catalog = JSON.parse(readFileSync(new URL("./catalog/builtin-tools.json", import.meta.url), "utf8"));
const tool = catalog.find((x: { toolId: string }) => x.toolId === "builtin:create_parametric_cabinet_files");
const fixture = () => JSON.parse(readFileSync(new URL("../../tests/fixtures/cabinet-pilot.json", import.meta.url), "utf8"));

test("production catalog initializes with the new cabinet tool", () => {
  assert.doesNotThrow(() => new ToolCatalog({} as ToolStore));
});

test("batch partial failure stays failed, preserves evidence and uses the batch timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "cabinet-runtime-"));
  const failure = { status: "partial_failed", completed: [{ name: "A" }], failedName: "B", remaining: ["C"] };
  let timeout: number | undefined;
  const bridge: BridgeClient = {
    isConnected: () => true, disconnect: async () => {},
    sendCommand: async (command: string, _args?: JsonObject, milliseconds?: number) => {
      if (command === "create_parametric_cabinet_files") { timeout = milliseconds; return { success: true, data: failure }; }
      return { success: true, data: { ProjectFingerprint: "test" } };
    },
  };
  try {
    const store = new ToolStore(root);
    const runtime = new AgentRuntime(bridge, new ToolCatalog(store), store, new TelemetryStore(root));
    const result = await runtime.execute("run_bim_tool", { toolId: tool.toolId, arguments: fixture() });
    await runtime.flushObservations();
    assert.equal(result.success, false);
    assert.equal(result.executionStatus, "failed");
    assert.equal(result.errorCode, "FAMILY_BATCH_FAILED");
    assert.deepEqual(JSON.parse(result.errorMessage!), failure);
    assert.equal(timeout, 120_000);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cabinet schema accepts dimensioned pilot with complete flex evidence", () => {
  assert.equal(tool.risk, "reversibleMutation");
  assert.equal(tool.status, "experimental");
  assert.doesNotThrow(() => validateArguments(tool.inputSchema, fixture()));
});

test("cabinet schema rejects file paths, executable source, excessive jobs and incomplete checks", () => {
  const f = fixture();
  for (const extra of [{ outputPath: "C:/existing.rfa" }, { source: "code" }, { overwrite: true }])
    assert.throws(() => validateArguments(tool.inputSchema, { ...f, ...extra }));
  assert.throws(() => validateArguments(tool.inputSchema, { jobs: Array(4).fill(f.jobs[0]) }));
  const j = f.jobs[0];
  assert.throws(() => validateArguments(tool.inputSchema, { jobs: [{ ...j, checks: [] }] }));
  assert.throws(() => validateArguments(tool.inputSchema, { jobs: [{ ...j, sourcePath: "C:/existing.rfa" }] }));
});

test("cabinet remains excluded from both atomic execution entry points", () => {
  const source = readFileSync(new URL("../src/agent-runtime.ts", import.meta.url), "utf8");
  assert.equal(source.match(/\["builtin:create_parametric_cabinet_files", "builtin:create_family_file", "builtin:create_lighting_family_file"\]/g)?.length, 2);
  const bridge = readFileSync(new URL("../../src/BimPersonalAgent.RevitBridge/Legacy/Core/AgentGatewayExecutor.cs", import.meta.url), "utf8");
  assert.match(bridge, /NonAtomicOrDestructivePlanCommands[\s\S]*?"create_parametric_cabinet_files"/);
});
