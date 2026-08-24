import assert from "node:assert/strict";
import test from "node:test";
import { publicTools } from "./public-tools.js";

test("Codex sees exactly six stable Agent tools", () => {
  assert.equal(publicTools.length, 6);
  assert.equal(new Set(publicTools.map((tool) => tool.name)).size, 6);
  assert.deepEqual(publicTools.map((tool) => tool.name), [
    "get_agent_status",
    "get_bim_context",
    "search_bim_tools",
    "run_bim_tool",
    "run_bim_plan",
    "execute_dynamic_csharp",
  ]);
});

test("tool search requires a structured task before discovery", () => {
  const search = publicTools.find((tool) => tool.name === "search_bim_tools");
  assert.ok(search);
  assert.deepEqual(search.inputSchema.required, ["task"]);
  assert.ok(search.inputSchema.properties);
  assert.equal((search.inputSchema.properties.startLoop as { default?: boolean }).default, false);
});

test("plans remain directly callable without Harness fields", () => {
  const plan = publicTools.find((tool) => tool.name === "run_bim_plan");
  assert.ok(plan);
  assert.deepEqual(plan.inputSchema.required, ["steps"]);
});
