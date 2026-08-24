#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AgentRuntime } from "./agent-runtime.js";
import { ActivityStore } from "./activity-store.js";
import { RevitBridgeClient } from "./bridge-client.js";
import { publicTools } from "./public-tools.js";
import { TelemetryStore } from "./telemetry.js";
import { ToolCatalog } from "./tool-catalog.js";
import { ToolStore } from "./tool-store.js";
import { TaskReporter } from "./task-reporter.js";
import { TaskStore } from "./task-store.js";
import type { JsonObject } from "./types.js";
import { getBuildMetadata } from "./build-metadata.js";

const build = getBuildMetadata();

const store = new ToolStore();
const telemetry = new TelemetryStore();
const activity = new ActivityStore();
const taskReporter = new TaskReporter(new TaskStore());
const bridgePort = Number.parseInt(process.env.BIM_PERSONAL_AGENT_PORT || process.env.REVIT_MCP_PORT || "9686", 10);
const bridge = new RevitBridgeClient("localhost", bridgePort, (event) => {
  void taskReporter.publishBridge(event);
});
const runtime = new AgentRuntime(bridge, new ToolCatalog(store), store, telemetry, activity, undefined, undefined, taskReporter);
const server = new Server(
  { name: "bim-personal-agent", version: build.semanticVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: publicTools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const result = await runtime.execute(request.params.name, (request.params.arguments ?? {}) as JsonObject);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    isError: !result.success,
  };
});

async function shutdown(): Promise<void> {
  await bridge.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await server.connect(new StdioServerTransport());
console.error(`BIM Personal Agent Gateway ${build.buildId} started with 6 MCP tools.`);
