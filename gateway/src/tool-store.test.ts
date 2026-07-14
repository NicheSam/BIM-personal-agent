import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentError } from "./errors.js";
import { ToolStore } from "./tool-store.js";
import type { GeneratedToolManifestInput } from "./types.js";

const manifest: GeneratedToolManifestInput = {
  toolId: "set-reviewed-mark",
  name: "Set reviewed mark",
  description: "Sets a parameter supplied through validated inputs.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { value: { type: "string" } },
    required: ["value"],
  },
  risk: "reversibleMutation",
  binding: "portable",
  tags: ["parameter"],
};

test("saved tools are versioned and active tools are discoverable", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-store-"));
  try {
    const store = new ToolStore(root);
    const first = await store.save("public class Command {}", manifest, "active");
    const second = await store.save("public class Command { public int V => 2; }", manifest, "active");
    assert.equal(first.version, "1.0.0");
    assert.equal(second.version, "1.0.1");
    assert.equal((await store.list()).length, 2);
    assert.equal((await store.get(manifest.toolId)).manifest.version, "1.0.1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("portable tools reject hard-coded ElementId values", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-store-"));
  try {
    const store = new ToolStore(root);
    await assert.rejects(
      store.save("var id = new ElementId(12345);", manifest, "active"),
      (error: unknown) => error instanceof AgentError && error.code === "PORTABILITY_VALIDATION_FAILED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project-bound tools require a project fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-store-"));
  try {
    const store = new ToolStore(root);
    await assert.rejects(
      store.save("public class Command {}", { ...manifest, binding: "project" }, "active"),
      (error: unknown) => error instanceof AgentError && error.code === "PROJECT_FINGERPRINT_REQUIRED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("newer drafts do not hide the latest active tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-store-"));
  try {
    const store = new ToolStore(root);
    await store.save("public class Command { public int V => 1; }", manifest, "active");
    await store.save("public class Command { public int V => 2; }", manifest, "draft");
    assert.equal((await store.get(manifest.toolId)).manifest.version, "1.0.1");
    assert.equal((await store.getActive(manifest.toolId)).manifest.version, "1.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saved tool risk cannot be downgraded", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-store-"));
  try {
    const store = new ToolStore(root);
    await store.save("public class Command { }", { ...manifest, risk: "destructive" }, "active");
    await assert.rejects(
      store.save("public class Command { public int V => 2; }", manifest, "active"),
      (error: unknown) => error instanceof AgentError && error.code === "RISK_DOWNGRADE_BLOCKED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two verification failures degrade the newest tool and restore the previous active version", async () => {
  const root = await mkdtemp(join(tmpdir(), "bpa-store-"));
  try {
    const store = new ToolStore(root);
    await store.save("public class Command { public int V => 1; }", manifest, "active");
    const newest = await store.save("public class Command { public int V => 2; }", manifest, "active");
    await store.recordVerification(manifest.toolId, newest.version, false);
    await store.recordVerification(manifest.toolId, newest.version, false);
    assert.equal((await store.getActive(manifest.toolId)).manifest.version, "1.0.0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
