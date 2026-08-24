import assert from "node:assert/strict";
import test from "node:test";
import { parseCodexSessionText } from "./codex-usage.mjs";

const firstRequest = "11111111-1111-4111-8111-111111111111";
const secondRequest = "22222222-2222-4222-8222-222222222222";

test("Codex task usage is shared by every BIM event in the same natural-language turn", () => {
  const rows = [
    row("2026-07-14T01:00:00.000Z", "session_meta", { id: "session-1", model: "gpt-test" }),
    row("2026-07-14T01:00:01.000Z", "turn_context", { turn_id: "turn-1", model: "gpt-test" }),
    tokenRow("2026-07-14T01:00:02.000Z", 100, 40, 10, 2),
    toolRow("2026-07-14T01:00:03.000Z", firstRequest),
    tokenRow("2026-07-14T01:00:04.000Z", 200, 100, 20, 5),
    toolRow("2026-07-14T01:00:05.000Z", secondRequest),
    tokenRow("2026-07-14T01:00:06.000Z", 50, 50, 5, 1),
    row("2026-07-14T01:01:00.000Z", "turn_context", { turn_id: "turn-2", model: "gpt-test" }),
  ].join("\n");
  const usage = parseCodexSessionText(rows, [firstRequest, secondRequest]);
  assert.equal(usage.length, 2);
  assert.equal(usage[0].taskKey, usage[1].taskKey);
  assert.equal(usage[0].inputTokens, 350);
  assert.equal(usage[0].cachedInputTokens, 190);
  assert.equal(usage[0].uncachedInputTokens, 160);
  assert.equal(usage[0].outputTokens, 35);
  assert.equal(usage[0].reasoningOutputTokens, 8);
  assert.equal(usage[0].totalTokens, 385);
});

test("request ids in unrelated text or another MCP server are not associated", () => {
  const rows = [
    row("2026-07-14T01:00:00.000Z", "session_meta", { id: "session-1" }),
    row("2026-07-14T01:00:01.000Z", "turn_context", { turn_id: "turn-1" }),
    row("2026-07-14T01:00:02.000Z", "event_msg", { type: "user_message", message: firstRequest }),
    toolRow("2026-07-14T01:00:03.000Z", firstRequest, "another-server"),
    tokenRow("2026-07-14T01:00:04.000Z", 100, 0, 10, 0),
  ].join("\n");
  assert.deepEqual(parseCodexSessionText(rows, [firstRequest]), []);
});

function row(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload });
}

function toolRow(timestamp, requestId, server = "bim-personal-agent") {
  return row(timestamp, "event_msg", {
    type: "mcp_tool_call_end",
    invocation: { server, tool: "run_bim_tool" },
    result: { Ok: { content: [{ type: "text", text: JSON.stringify({ requestId, success: true }) }] } },
  });
}

function tokenRow(timestamp, input, cached, output, reasoning) {
  return row(timestamp, "event_msg", {
    type: "token_count",
    info: {
      last_token_usage: {
        input_tokens: input,
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_output_tokens: reasoning,
        total_tokens: input + output,
      },
    },
  });
}
