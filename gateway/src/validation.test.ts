import assert from "node:assert/strict";
import test from "node:test";
import { normalizeArguments } from "./validation.js";

const schema = {
  type: "object",
  properties: {
    importInstanceId: { type: "integer" },
    duplicateToleranceMm: { type: "number", default: 10, unit: "mm" },
  },
  required: ["importInstanceId"],
  additionalProperties: false,
};

test("argument normalization records defaults at the point they are applied", () => {
  const normalized = normalizeArguments(schema, { importInstanceId: 13719035 });
  assert.equal(normalized.arguments.duplicateToleranceMm, 10);
  assert.deepEqual(normalized.parameters.duplicateToleranceMm, {
    origin: "default",
    defaultValue: 10,
    unit: "mm",
  });
});

test("argument normalization records an explicit value without losing the declared default", () => {
  const normalized = normalizeArguments(schema, { importInstanceId: 13719035, duplicateToleranceMm: 20 });
  assert.deepEqual(normalized.parameters.duplicateToleranceMm, {
    origin: "user_provided",
    defaultValue: 10,
    unit: "mm",
  });
});

test("argument normalization preserves agent and tool provenance hints", () => {
  const normalized = normalizeArguments(schema, { importInstanceId: 13719035 }, { importInstanceId: "agent_resolved" });
  assert.equal(normalized.parameters.importInstanceId.origin, "agent_resolved");
  assert.equal(normalized.parameters.duplicateToleranceMm.origin, "default");
});
