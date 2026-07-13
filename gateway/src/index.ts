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
import type { JsonObject } from "./types.js";

const bridge = new RevitBridgeClient();
const store = new ToolStore();
const telemetry = new TelemetryStore();
const activity = new ActivityStore();
const runtime = new AgentRuntime(bridge, new ToolCatalog(store), store, telemetry, activity);
const server = new Server(
  { name: "bim-personal-agent", version: "0.5.0" },
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
console.error("BIM Personal Agent Gateway 0.5.0 started with 6 MCP tools.");
