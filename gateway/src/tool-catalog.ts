import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentError } from "./errors.js";
import { ToolStore } from "./tool-store.js";
import type { ToolDescriptor, ToolPerformanceSummary } from "./types.js";

export class ToolCatalog {
  private readonly builtins: ToolDescriptor[];

  constructor(private readonly store: ToolStore, builtins?: ToolDescriptor[]) {
    this.builtins = builtins ?? loadBuiltins();
  }

  async counts(): Promise<Record<string, number>> {
    const saved = await this.store.list(["active", "draft"]);
    return [...this.builtins, ...saved].reduce<Record<string, number>>((counts, tool) => {
      counts[tool.status] = (counts[tool.status] || 0) + 1;
      return counts;
    }, { totalBuiltin: this.builtins.length, totalSaved: saved.length });
  }

  async search(
    query: string,
    limit: number,
    includeExperimental: boolean,
    performance: Record<string, ToolPerformanceSummary> = {},
    directoryTerms: string[] = [],
  ): Promise<ToolDescriptor[]> {
    const savedById = new Map<string, ToolDescriptor>();
    for (const saved of await this.store.list(["active"])) {
      if (!savedById.has(saved.toolId)) {
        savedById.set(saved.toolId, toPublicSavedTool(saved));
      }
    }
    const saved = [...savedById.values()];
    const candidates = [...this.builtins, ...saved]
      .filter((tool) => tool.status !== "disabled")
      .filter((tool) => includeExperimental || tool.status !== "experimental")
      .map((tool) => ({ ...tool, performance: performance[tool.toolId] }));
    const tokens = query.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter(Boolean);
    return candidates
      .map((tool) => ({ tool, score: score(tool, query.toLowerCase(), tokens, directoryTerms) }))
      .filter((item) => item.score > 0 || tokens.length === 0)
      .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map((item) => item.tool);
  }

  async resolve(toolId: string, version?: string): Promise<{ descriptor: ToolDescriptor; source?: string }> {
    const builtin = this.builtins.find((tool) => tool.toolId === toolId);
    if (builtin) {
      if (builtin.status === "disabled") {
        throw new AgentError("TOOL_DISABLED", `Tool is disabled by policy: ${toolId}`);
      }
      if (version && version !== builtin.version) {
        throw new AgentError("TOOL_VERSION_MISMATCH", `Built-in tool version is ${builtin.version}, not ${version}.`);
      }
      return { descriptor: builtin };
    }
    if (!toolId.startsWith("saved:")) {
      throw new AgentError("TOOL_NOT_FOUND", `Unknown tool: ${toolId}`);
    }
    const saved = await this.store.getActive(toolId.slice("saved:".length), version);
    return { descriptor: toPublicSavedTool(saved.manifest), source: saved.source };
  }
}

function toPublicSavedTool(tool: ToolDescriptor): ToolDescriptor {
  return { ...tool, toolId: tool.toolId.startsWith("saved:") ? tool.toolId : `saved:${tool.toolId}` };
}

function loadBuiltins(): ToolDescriptor[] {
  const path = join(dirname(fileURLToPath(import.meta.url)), "catalog", "builtin-tools.json");
  const tools = JSON.parse(readFileSync(path, "utf8")) as ToolDescriptor[];
  if (tools.length !== 152 || new Set(tools.map((tool) => tool.toolId)).size !== tools.length) {
    throw new AgentError("CATALOG_INVALID", "Built-in catalog must contain 152 unique tools.");
  }
  return tools;
}

function score(tool: ToolDescriptor, query: string, tokens: string[], directoryTerms: string[]): number {
  const name = `${tool.name} ${tool.toolId}`.toLowerCase();
  const capability = (tool.capabilityKey || "").replace(/[._-]+/g, " ").toLowerCase();
  const description = tool.description.toLowerCase();
  const tags = tool.tags.join(" ").toLowerCase();
  let value = 0;
  if (name === query || tool.toolId.toLowerCase() === query) value += 120;
  if (tool.capabilityKey?.toLowerCase() === query) value += 140;
  if (name.includes(query) && query.length > 1) value += 50;
  for (const token of tokens) {
    if (name.includes(token)) value += 20;
    if (capability.includes(token)) value += 24;
    if (tags.includes(token)) value += 10;
    if (description.includes(token)) value += 5;
  }
  const directoryText = `${name} ${capability} ${description} ${tags}`;
  for (const term of directoryTerms) {
    if (directoryText.includes(term.toLowerCase())) value += 8;
  }
  if (value === 0) return 0;
  value += tool.status === "active" ? 30 : tool.status === "validated" ? 20 : 0;
  if (tool.performance?.health === "degraded") value -= 15;
  return value;
}
