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
