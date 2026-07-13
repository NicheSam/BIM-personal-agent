import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ActivityStore } from "./activity-store.js";

test("activity store records sanitized event envelopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-activity-"));
  try {
    const store = new ActivityStore(root);
    await store.record({
      schemaVersion: 1,
      requestId: "request-1",
      startedAtUtc: "2026-07-13T00:00:00.000Z",
      completedAtUtc: "2026-07-13T00:00:01.000Z",
      kind: "operation",
      title: "Modify element parameter",
      toolId: "builtin:modify_element_parameter",
      risk: "reversibleMutation",
      status: "succeeded",
      durationMs: 1000,
      scope: { elementIds: [42], parameterName: "Comments" },
    });
    const events = await store.list();
    assert.equal(events.length, 1);
    assert.equal(events[0].scope?.elementIds?.[0], 42);
    const raw = await readFile(store.path, "utf8");
    assert.equal(raw.includes("newValue"), false);
    assert.equal(raw.includes("source"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
