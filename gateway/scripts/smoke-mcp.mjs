import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gatewayPath = resolve(process.env.BIM_AGENT_GATEWAY_PATH || resolve(sourceRoot, "build", "index.js"));
const root = dirname(gatewayPath);
const home = await mkdtemp(resolve(tmpdir(), "bpa-mcp-smoke-"));
const transport = new StdioClientTransport({
  command: process.env.BIM_AGENT_NODE || process.execPath,
  args: [gatewayPath],
  cwd: root,
  env: {
    PATH: process.env.PATH || "",
    APPDATA: process.env.APPDATA || home,
    BIM_PERSONAL_AGENT_HOME: home,
  },
  stderr: "pipe",
});
const client = new Client({ name: "bpa-smoke", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  if (listed.tools.length !== 6) {
    throw new Error(`Expected 6 tools, received ${listed.tools.length}`);
  }

  const durations = [];
  for (let index = 0; index < 50; index += 1) {
    const startedAt = performance.now();
    const response = await client.callTool({
      name: "search_bim_tools",
      arguments: {
        task: {
          goal: "Read project information",
          actions: ["read"],
          objects: ["project"],
          steps: [{ action: "read", object: "project", outcome: "project information is returned" }],
          mode: "assess",
        },
        limit: 5,
      },
    });
    durations.push(performance.now() - startedAt);
    const text = response.content?.find((item) => item.type === "text")?.text;
    const envelope = JSON.parse(text || "null");
    if (!envelope?.success || !Array.isArray(envelope?.data?.workflow) || envelope.data.workflow.length === 0) {
      throw new Error("Tool search did not return a successful catalog result.");
    }
  }

  durations.sort((left, right) => left - right);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  if (p95 > 250) {
    throw new Error(`Gateway search p95 ${p95.toFixed(1)}ms exceeded 250ms.`);
  }
  console.log(JSON.stringify({ tools: listed.tools.length, calls: durations.length, p95Ms: Number(p95.toFixed(1)) }));
} finally {
  await client.close();
  await rm(home, { recursive: true, force: true });
}
