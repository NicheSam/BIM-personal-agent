import assert from "node:assert/strict";
import test from "node:test";
import { ContextSnapshotStore } from "./context-snapshots.js";

test("context snapshots return only changed top-level values", () => {
  const store = new ContextSnapshotStore();
  const first = store.capture({ ProjectFingerprint: "project-1", ActiveView: { Id: 1 }, Selection: { Count: 0 } });
  const second = store.capture(
    { ProjectFingerprint: "project-1", ActiveView: { Id: 1 }, Selection: { Count: 2 } },
    String(first.SnapshotId),
  );
  assert.equal(second.SnapshotMode, "delta");
  assert.deepEqual(second.Changed, ["Selection"]);
  assert.deepEqual(second.Delta, { Selection: { Count: 2 } });
});

test("context snapshots stop when the active project changes", () => {
  const store = new ContextSnapshotStore();
  const first = store.capture({ ProjectFingerprint: "project-1" });
  assert.throws(() => store.capture({ ProjectFingerprint: "project-2" }, String(first.SnapshotId)), /active Revit document changed/i);
});
