import { createHash, randomUUID } from "node:crypto";
import { AgentError } from "./errors.js";
import type { JsonObject } from "./types.js";

interface Snapshot {
  createdAt: number;
  fingerprint?: string;
  context: JsonObject;
}

export class ContextSnapshotStore {
  private readonly snapshots = new Map<string, Snapshot>();

  capture(value: unknown, previousSnapshotId?: string): JsonObject {
    const context = asObject(value);
    this.prune();
    if (previousSnapshotId) {
      const previous = this.snapshots.get(previousSnapshotId);
      if (!previous) throw new AgentError("CONTEXT_SNAPSHOT_NOT_FOUND", `Context snapshot was not found: ${previousSnapshotId}`);
      const fingerprint = readString(context, "ProjectFingerprint", "projectFingerprint");
      if (previous.fingerprint && fingerprint && previous.fingerprint !== fingerprint) {
        throw new AgentError("ACTIVE_DOCUMENT_CHANGED", "The active Revit document changed after the context snapshot.");
      }
      const delta = topLevelDelta(previous.context, context);
      ensurePayloadLimit(delta, 24 * 1024, "Context delta");
      const snapshotId = this.save(context);
      return {
        ProjectFingerprint: fingerprint,
        SnapshotId: snapshotId,
        PreviousSnapshotId: previousSnapshotId,
        SnapshotMode: "delta",
        Changed: Object.keys(delta),
        Delta: delta,
      };
    }
    ensurePayloadLimit(context, 64 * 1024, "Initial context");
    return { ...context, SnapshotId: this.save(context), SnapshotMode: "full" };
  }

  private save(context: JsonObject): string {
    const id = randomUUID();
    this.snapshots.set(id, {
      createdAt: Date.now(),
      fingerprint: readString(context, "ProjectFingerprint", "projectFingerprint"),
      context,
    });
    return id;
  }

  private prune(): void {
    const expired = Date.now() - 10 * 60 * 1000;
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.createdAt < expired) this.snapshots.delete(id);
    }
    while (this.snapshots.size > 50) this.snapshots.delete(this.snapshots.keys().next().value as string);
  }
}

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentError("INVALID_BRIDGE_RESPONSE", "Revit context must be an object.");
  }
  return value as JsonObject;
}

function topLevelDelta(previous: JsonObject, current: JsonObject): JsonObject {
  const delta: JsonObject = {};
  for (const key of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (stableHash(previous[key]) !== stableHash(current[key])) delta[key] = current[key] ?? null;
  }
  return delta;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null), "utf8").digest("hex");
}

function ensurePayloadLimit(value: unknown, maximum: number, label: string): void {
  const size = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  if (size > maximum) {
    throw new AgentError("CONTEXT_PAYLOAD_TOO_LARGE", `${label} is ${size} bytes; reduce includeSchema or selectionLimit.`);
  }
}

function readString(value: JsonObject, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof value[key] === "string") return value[key] as string;
  return undefined;
}
