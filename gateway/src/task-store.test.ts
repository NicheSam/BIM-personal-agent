import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TaskReporter } from "./task-reporter.js";
import { TaskStore } from "./task-store.js";
import { createTaskExecutionDetail } from "./task-detail.js";

test("task reporter groups ordered execution events under one task", async () => {
  const home = await mkdtemp(join(tmpdir(), "bpa-task-store-"));
  try {
    const store = new TaskStore(home);
    const reporter = new TaskReporter(store, "http://127.0.0.1:4178");
    await reporter.ensure("task-001", "Set selected elements green", "request-001");
    await reporter.publish({
      taskId: "task-001",
      requestId: "request-001",
      source: "gateway",
      phase: "received",
      eventType: "task.received",
      title: "Set selected elements green",
      executionStatus: "pending",
      verificationStatus: "not_requested",
    });
    await reporter.publish({
      taskId: "task-001",
      requestId: "request-001",
      source: "bridge",
      phase: "completed",
      eventType: "bridge.completed",
      title: "Set selected elements green",
      executionStatus: "succeeded",
      verificationStatus: "passed",
      toolId: "saved:set-elements-green",
      durationMs: 42,
    });
    await reporter.publish({
      taskId: "task-001",
      requestId: "request-002",
      source: "gateway",
      phase: "completed",
      eventType: "gateway.completed",
      title: "Set selected elements green",
      executionStatus: "succeeded",
      verificationStatus: "passed",
      toolId: "saved:set-elements-green",
      durationMs: 8,
    });

    const summary = await store.get("task-001");
    const events = await store.events("task-001");
    assert.equal(summary?.eventCount, 3);
    assert.equal(summary?.durationMs, 50);
    assert.equal(summary?.executionStatus, "succeeded");
    assert.equal(summary?.verificationStatus, "passed");
    assert.deepEqual(summary?.toolIds, ["saved:set-elements-green"]);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
    assert.equal((await store.list())[0].taskId, "task-001");

    await store.saveDetail(createTaskExecutionDetail({
      taskId: "task-001",
      requestId: "request-001",
      publicTool: "run_bim_tool",
      toolId: "builtin:test",
      risk: "readOnly",
      startedAtUtc: "2026-08-04T00:00:00.000Z",
      durationMs: 12,
      executionStatus: "succeeded",
      verificationStatus: "not_requested",
      input: { arguments: { id: 1 } },
      result: { ElementId: 1 },
    }));
    const detailSummary = await store.get("task-001");
    assert.equal(detailSummary?.detailCount, 1);
    assert.equal(detailSummary?.engineeringStatus, "not_verified");
    assert.equal((await store.details("task-001"))[0].requestId, "request-001");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
