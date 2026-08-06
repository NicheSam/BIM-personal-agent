import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { AgentError } from "./errors.js";
import type { JsonObject, JsonSchema, TaskInputParameter } from "./types.js";

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

export function normalizeArguments(schema: JsonSchema, argumentsValue: unknown, originHints?: Record<string, TaskInputParameter["origin"]>): {
  arguments: JsonObject;
  parameters: Record<string, TaskInputParameter>;
};
export function normalizeArguments(
  schema: JsonSchema,
  argumentsValue: unknown,
  originHints?: Record<string, TaskInputParameter["origin"]>,
): { arguments: JsonObject; parameters: Record<string, TaskInputParameter> } {
  const specified = structuredClone(requireObject(argumentsValue ?? {}, "arguments"));
  const normalized = applyDefaults(schema, specified) as JsonObject;
  validateArguments(schema, normalized);
  const parameters: Record<string, TaskInputParameter> = {};
  collectParameters(schema, normalized, specified, "", parameters, originHints ?? {});
  return { arguments: normalized, parameters };
}

function applyDefaults(schema: JsonSchema, value: unknown): unknown {
  if (value === undefined && Object.hasOwn(schema, "default")) return structuredClone(schema.default);
  if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const result = { ...(value as JsonObject) };
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, JsonSchema> : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      const child = applyDefaults(childSchema, result[key]);
      if (child !== undefined) result[key] = child;
    }
    return result;
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items && typeof schema.items === "object") {
    return value.map((item) => applyDefaults(schema.items as JsonSchema, item));
  }
  return value;
}

function collectParameters(
  schema: JsonSchema,
  normalized: unknown,
  specified: unknown,
  path: string,
  output: Record<string, TaskInputParameter>,
  originHints: Record<string, TaskInputParameter["origin"]>,
): void {
  if (schema.type === "object" && normalized && typeof normalized === "object" && !Array.isArray(normalized)) {
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, JsonSchema> : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      const childPath = path ? `${path}.${key}` : key;
      const specifiedObject = specified && typeof specified === "object" && !Array.isArray(specified) ? specified as JsonObject : {};
      collectParameters(childSchema, (normalized as JsonObject)[key], specifiedObject[key], childPath, output, originHints);
    }
    return;
  }
  if (normalized === undefined || !path) return;
  const hasDefault = Object.hasOwn(schema, "default");
  const unit = typeof schema.unit === "string" ? schema.unit : typeof schema["x-unit"] === "string" ? schema["x-unit"] as string : undefined;
  output[path] = {
    origin: originHints[path] ?? (specified === undefined && hasDefault ? "default" : "user_provided"),
    ...(hasDefault ? { defaultValue: schema.default } : {}),
    ...(unit ? { unit } : {}),
  };
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .slice(0, 10)
    .map((error) => `${error.instancePath || "/"} ${error.message || "is invalid"}`)
    .join("; ") || "Arguments do not match the tool schema.";
}
