import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const objectSchema = { type: "object", additionalProperties: true } as const;
const taskUnderstandingSchema = {
  type: "object", additionalProperties: false,
  properties: {
    goal: { type: "string", minLength: 1, maxLength: 500 },
    actions: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
    objects: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
    constraints: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
    steps: { type: "array", minItems: 1, maxItems: 20, items: {
      type: "object", additionalProperties: false,
      properties: { action: { type: "string", minLength: 1, maxLength: 300 }, object: { type: "string", minLength: 1, maxLength: 300 }, outcome: { type: "string", minLength: 1, maxLength: 300 } },
      required: ["action", "outcome"],
    } },
    mode: { type: "string", enum: ["assess", "execute", "plan"] },
  },
  required: ["goal", "actions", "objects", "steps", "mode"],
} as const;
const manifestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    toolId: { type: "string", pattern: "^[a-z][a-z0-9-]{2,63}$" },
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", minLength: 1, maxLength: 1000 },
    inputSchema: { type: "object" },
    risk: { type: "string", enum: ["readOnly", "reversibleMutation", "destructive"] },
    binding: { type: "string", enum: ["portable", "project"] },
    requiredContext: { type: "array", items: { type: "string" }, maxItems: 20 },
    tags: { type: "array", items: { type: "string" }, maxItems: 20 },
  },
  required: ["toolId", "name", "description", "inputSchema", "risk", "binding"],
} as const;

export const publicTools: Tool[] = [
  {
    name: "get_agent_status",
    description: "Get BIM Personal Agent Gateway, Revit Bridge, active document, and tool catalog status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_bim_context",
    description: "Get live Revit project, active view, levels, bounded selection, and optional active-view schema.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        includeSchema: { type: "boolean", default: true },
        selectionLimit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: "search_bim_tools",
    description: "After understanding and decomposing the BIM request, design a step-by-step workflow and return every recommended tool schema needed to complete it plus compact alternatives.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        task: taskUnderstandingSchema,
        query: { type: "string", maxLength: 500, description: "Optional refinement hint; do not replace the structured task." },
        limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        includeExperimental: { type: "boolean", default: false },
      },
      required: ["task"],
    },
  },
  {
    name: "run_bim_tool",
    description: "Run one built-in or saved Revit tool by toolId after validating its arguments and project binding.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        toolId: { type: "string", maxLength: 140 },
        version: { type: "string", minLength: 1, maxLength: 80 },
        arguments: objectSchema,
      },
      required: ["toolId", "arguments"],
    },
  },
  {
    name: "run_bim_plan",
    description: "Validate and atomically run 1-20 non-destructive same-document Revit tool steps through one TransactionGroup.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        steps: {
          type: "array", minItems: 1, maxItems: 20,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              toolId: { type: "string", maxLength: 140 },
              version: { type: "string", minLength: 1, maxLength: 80 },
              arguments: objectSchema,
            },
            required: ["toolId", "arguments"],
          },
        },
      },
      required: ["steps"],
    },
  },
  {
    name: "execute_dynamic_csharp",
    description: "Compile and execute parameterized C# in the Revit host. Successful commands are saved as reusable internal tools by default.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        source: { type: "string", minLength: 1, maxLength: 60000 },
        arguments: objectSchema,
        manifest: manifestSchema,
        saveOnSuccess: { type: "boolean", default: true },
      },
      required: ["source", "arguments", "manifest"],
    },
  },
];
