import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LoopController } from "./loop-controller.js";
import { RunStore } from "./run-store.js";
import type { BimTaskUnderstanding } from "./types.js";

function task(domain: BimTaskUnderstanding["domain"], loopMode: BimTaskUnderstanding["loopMode"] = "bounded"): BimTaskUnderstanding {
  return {
    goal: "Complete a bounded BIM task",
    actions: ["inspect", "modify"],
    objects: ["elements"],
    steps: [{ action: "modify", object: "elements", outcome: "criteria pass" }],
    mode: "plan",
    domain,
    acceptanceCriteria: ["criteria pass"],
    evidenceRequirements: ["ElementIds"],
    loopMode,
    complexity: "standard",
  };
}

test("bounded loops stop when the same failure repeats", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-loop-"));
  try {
    const controller = new LoopController(new RunStore(root), "bounded");
    let run = await controller.start(task("mep"));
    assert.equal(run.effectiveMode, "bounded");
    run = await controller.consume(run.runId, ["call", "attempt"], 1);
    await controller.recordOutcome(run.runId, "failed", "failed", { check: "connectivity" }, "VERIFICATION_FAILED");
    await controller.consume(run.runId, ["call", "attempt"], 2);
    run = await controller.recordOutcome(run.runId, "failed", "failed", { check: "connectivity" }, "VERIFICATION_FAILED");
    assert.equal(run.phase, "stopped");
    assert.equal(run.stopReason, "SAME_ERROR_REPEATED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("domain profiles guide planning without disabling bounded correction", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-loop-"));
  try {
    const controller = new LoopController(new RunStore(root), "bounded");
    const run = await controller.start(task("rfi"));
    assert.equal(run.effectiveMode, "bounded");
    assert.equal(run.budget.maxAttempts, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an observe gateway remains a hard deployment boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-loop-"));
  try {
    const controller = new LoopController(new RunStore(root), "observe");
    const run = await controller.start(task("mep"));
    assert.equal(run.effectiveMode, "observe");
    assert.equal(run.budget.maxAttempts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loop budgets reject excess refinement searches", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-loop-"));
  try {
    const controller = new LoopController(new RunStore(root), "bounded");
    const run = await controller.start(task("mep"));
    await controller.consume(run.runId, ["call", "search"]);
    await assert.rejects(() => controller.consume(run.runId, ["call", "search"]), /Loop budget exceeded: searches/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
