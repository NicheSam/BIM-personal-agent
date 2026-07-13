import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { AgentError } from "./errors.js";
import type { JsonObject, JsonSchema } from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
const validators = new WeakMap<object, ValidateFunction>();

export function requireObject(value: unknown, name: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentError("VALIDATION_ERROR", `${name} must be an object.`);
  }
  return value as JsonObject;
}

export function validateArguments(schema: JsonSchema, argumentsValue: unknown): JsonObject {
  const args = requireObject(argumentsValue ?? {}, "arguments");
  let validate = validators.get(schema);
  if (!validate) {
    try {
      const compiled = ajv.compile(schema);
      validators.set(schema, compiled);
      validate = compiled;
    } catch (error) {
      throw new AgentError("INVALID_TOOL_SCHEMA", error instanceof Error ? error.message : String(error));
    }
  }
  if (!validate) {
    throw new AgentError("INVALID_TOOL_SCHEMA", "Tool schema did not produce a validator.");
  }
  if (!validate(args)) {
    throw new AgentError("VALIDATION_ERROR", formatErrors(validate.errors));
  }
  return args;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 10)
    .map((error) => `${error.instancePath || "/"} ${error.message || "is invalid"}`)
    .join("; ") || "Arguments do not match the tool schema.";
}
