import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [, , toolName, rawArguments = "{}"] = process.argv;
if (!toolName) {
  throw new Error("Usage: npm run call:live -- <tool-name> '<json-arguments>'");
}

let args;
try {
  const json = rawArguments.startsWith("base64:")
    ? Buffer.from(rawArguments.slice("base64:".length), "base64").toString("utf8")
    : rawArguments.startsWith("file:")
      ? readFileSync(resolve(rawArguments.slice("file:".length)), "utf8")
      : rawArguments;
  args = JSON.parse(json);
} catch (error) {
  throw new Error(`Arguments must be valid JSON: ${error.message}`);
}

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
const client = new Client({ name: "bpa-live-call", version: "1.0.0" }, { capabilities: {} });

try {
  await client.connect(transport);
  const response = await client.callTool({ name: toolName, arguments: args });
  const text = response.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("Agent did not return a text envelope.");
  }
  console.log(text);
  if (response.isError) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
