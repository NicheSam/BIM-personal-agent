import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const objectSchema = { type: "object", additionalProperties: true } as const;
const argumentOriginsSchema = {
  type: "object",
  additionalProperties: { type: "string", enum: ["user_provided", "default", "agent_resolved", "tool_derived", "system_injected"] },
  description: "Optional JSON-path origin hints produced during argument resolution.",
} as const;
const taskUnderstandingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goal: { type: "string", minLength: 1, maxLength: 500 },
    displayTitle: { type: "string", minLength: 1, maxLength: 120, description: "Concise task title in the user's language for the BIM engineer workbench." },
    actions: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
    objects: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
    constraints: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
    steps: {
      type: "array", minItems: 1, maxItems: 20,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          action: { type: "string", minLength: 1, maxLength: 300 },
          object: { type: "string", minLength: 1, maxLength: 300 },
          outcome: { type: "string", minLength: 1, maxLength: 300 },
        },
        required: ["action", "outcome"],
      },
    },
    mode: { type: "string", enum: ["assess", "execute", "plan"] },
    domain: { type: "string", enum: ["mep", "constructability", "documentation", "quantity", "rfi", "clash"] },
    acceptanceCriteria: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 300 } },
    evidenceRequirements: { type: "array", minItems: 1, maxItems: 20, items: { type: "string", minLength: 1, maxLength: 300 } },
    loopMode: { type: "string", enum: ["observe", "bounded"] },
    complexity: { type: "string", enum: ["standard", "complex"], default: "standard" },
  },
  required: ["goal", "actions", "objects", "steps", "mode"],
} as const;
const manifestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    toolId: { type: "string", pattern: "^[a-z][a-z0-9-]{2,63}$" },
    capabilityKey: {
      type: "string",
      pattern: "^[a-z][a-z0-9_-]*(?:\\.[a-z][a-z0-9_-]*)+$",
      maxLength: 120,
      description: "Stable operation capability, independent of element IDs, quantities, colors, levels, or project-specific values. Reuse an existing capability before generating new C#.",
    },
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
const verificationCheckSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string", minLength: 1, maxLength: 80 },
    kind: { type: "string", enum: ["elementExists", "elementCount", "parameterEquals", "mepConnectivity", "clearance", "viewPlacement", "quantity", "evidence"] },
    stepId: { type: "string", minLength: 1, maxLength: 80 },
    elementIds: { type: "array", maxItems: 200, items: { type: "integer", minimum: 1 } },
    viewIds: { type: "array", maxItems: 200, items: { type: "integer", minimum: 1 } },
  },
  required: ["id", "kind"],
} as const;
const verificationChecksSchema = { type: "array", minItems: 1, maxItems: 20, items: verificationCheckSchema } as const;
const loopBudgetSchema = {
  type: "object", additionalProperties: false,
  properties: {
    maxAttempts: { type: "integer", minimum: 1, maximum: 3 },
    maxMcpCalls: { type: "integer", minimum: 1, maximum: 10 },
    maxDynamicSources: { type: "integer", minimum: 0, maximum: 2 },
    maxContextDeltas: { type: "integer", minimum: 0, maximum: 2 },
    maxAutoCorrectionElements: { type: "integer", minimum: 1, maximum: 200 },
  },
} as const;

export const publicTools: Tool[] = [
  {
    name: "get_agent_status",
    description: "Get BIM Personal Agent Gateway, Revit Bridge, active document, and tool catalog status.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { taskId: { type: "string", format: "uuid", description: "Optional task correlation ID." } },
    },
  },
  {
    name: "get_bim_context",
    description: "Get live Revit project, active view, levels, bounded selection, and optional active-view schema.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        taskId: { type: "string", format: "uuid", description: "Optional task correlation ID." },
        includeSchema: { type: "boolean", default: true },
        selectionLimit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        runId: { type: "string", format: "uuid" },
        snapshotId: { type: "string", format: "uuid" },
      },
    },
  },
  {
    name: "search_bim_tools",
    description: "After understanding and decomposing the BIM request, design a step-by-step workflow and return every recommended tool schema needed to complete it plus compact alternatives.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        taskId: { type: "string", format: "uuid", description: "Reuse this ID in later execution calls for one workbench task." },
        task: taskUnderstandingSchema,
        runId: { type: "string", format: "uuid", description: "Reuse the existing runId only for the single allowed refinement search." },
        startLoop: { type: "boolean", default: false, description: "Opt into Harness state and budgets. Gateway rollout mode decides observe or bounded correction." },
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
        taskId: { type: "string", format: "uuid", description: "Reuse the taskId returned by search_bim_tools when available." },
        toolId: { type: "string", maxLength: 140 },
        version: { type: "string", minLength: 1, maxLength: 80 },
        arguments: objectSchema,
        argumentOrigins: argumentOriginsSchema,
        developerMode: { type: "boolean", default: false, description: "Opt in to a private seven-day local developer trace." },
        runId: { type: "string", format: "uuid" },
        attempt: { type: "integer", minimum: 1, maximum: 3 },
        verificationChecks: verificationChecksSchema,
      },
      required: ["toolId", "arguments"],
    },
  },
  {
    name: "run_bim_plan",
    description: "Run one multi-step BIM plan with existing tools and inline Dynamic C#. Add runId and verificationChecks only when using the optional Harness.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        taskId: { type: "string", format: "uuid", description: "Reuse the taskId returned by search_bim_tools when available." },
        steps: {
          type: "array", minItems: 1, maxItems: 20,
          items: { oneOf: [
            {
              type: "object", additionalProperties: false,
              properties: {
                kind: { type: "string", const: "tool" },
                stepId: { type: "string", minLength: 1, maxLength: 80 },
                toolId: { type: "string", maxLength: 140 },
                version: { type: "string", minLength: 1, maxLength: 80 },
                arguments: objectSchema,
                argumentOrigins: argumentOriginsSchema,
              },
              required: ["kind", "stepId", "toolId", "arguments"],
            },
            {
              type: "object", additionalProperties: false,
              properties: {
                kind: { type: "string", const: "dynamic" },
                stepId: { type: "string", minLength: 1, maxLength: 80 },
                source: { type: "string", minLength: 1, maxLength: 60000 },
                manifest: manifestSchema,
                arguments: objectSchema,
                argumentOrigins: argumentOriginsSchema,
                saveOnSuccess: { type: "boolean", default: true },
              },
              required: ["kind", "stepId", "source", "manifest", "arguments"],
            },
          ] },
        },
        runId: { type: "string", format: "uuid" },
        attempt: { type: "integer", minimum: 1, maximum: 3 },
        verificationChecks: verificationChecksSchema,
        loopBudget: loopBudgetSchema,
        developerMode: { type: "boolean", default: false, description: "Opt in to a private seven-day local developer trace." },
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
        taskId: { type: "string", format: "uuid", description: "Reuse the taskId returned by search_bim_tools when available." },
        source: { type: "string", minLength: 1, maxLength: 60000 },
        arguments: objectSchema,
        argumentOrigins: argumentOriginsSchema,
        manifest: manifestSchema,
        saveOnSuccess: { type: "boolean", default: true },
        runId: { type: "string", format: "uuid" },
        attempt: { type: "integer", minimum: 1, maximum: 3 },
        verificationChecks: verificationChecksSchema,
        developerMode: { type: "boolean", default: false, description: "Opt in to a private seven-day local developer trace." },
      },
      required: ["source", "arguments", "manifest"],
    },
  },
];
