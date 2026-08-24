import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gatewayPath = resolve(process.env.BIM_AGENT_GATEWAY_PATH || resolve(sourceRoot, "build", "index.js"));
const root = dirname(gatewayPath);
const transport = new StdioClientTransport({
  command: process.env.BIM_AGENT_NODE || process.execPath,
  args: [gatewayPath],
  cwd: root,
  env: { ...process.env },
  stderr: "pipe",
});
const client = new Client({ name: "bpa-live-smoke", version: "1.0.0" }, { capabilities: {} });

function envelope(response) {
  const value = response.content?.find((item) => item.type === "text")?.text;
  return JSON.parse(value || "null");
}

async function call(name, args) {
  const result = envelope(await client.callTool({ name, arguments: args }));
  if (!result?.success) {
    throw new Error(`${name} failed: ${result?.errorCode || "UNKNOWN"} ${result?.errorMessage || ""}`.trim());
  }
  return result;
}

try {
  await client.connect(transport);
  const status = await call("get_agent_status", {});
  if (status.data?.bridge?.Connected !== true || status.data?.bridge?.HasActiveDocument !== true) {
    throw new Error("Revit Bridge is not connected to an active document.");
  }

  const context = await call("get_bim_context", { includeSchema: false, selectionLimit: 5 });
  const search = await call("search_bim_tools", {
    task: {
      goal: "Read project information without changing the Revit model",
      actions: ["read"],
      objects: ["project"],
      steps: [{ action: "read", object: "project", outcome: "project information is returned" }],
      mode: "assess",
    },
    limit: 5,
  });
  const tool = search.data?.recommendedTools?.find((item) => item.toolId === "builtin:get_project_info");
  if (!tool) {
    throw new Error("Validated get_project_info tool was not found.");
  }
  const run = await call("run_bim_tool", {
    taskId: search.taskId,
    toolId: tool.toolId,
    version: tool.version,
    arguments: {},
  });

  console.log(JSON.stringify({
    gatewayVersion: status.data.gatewayVersion,
    bridgeVersion: status.data.bridge.BridgeVersion,
    projectName: status.data.bridge.ProjectName,
    projectFingerprint: context.data?.ProjectFingerprint,
    activeView: context.data?.ActiveView,
    selection: context.data?.Selection,
    taskId: run.taskId,
    reportUrl: run.reportUrl,
    toolId: run.toolId,
    durationMs: run.durationMs,
  }));
} finally {
  await client.close();
}
