import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AgentError } from "./errors.js";
import type {
  GeneratedToolManifestInput,
  SavedToolManifest,
  ToolStatus,
} from "./types.js";

const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const ABSOLUTE_PATH_PATTERN = /["'](?:[a-zA-Z]:\\|\\\\)[^"']*["']/;
const HARDCODED_ELEMENT_ID_PATTERN = /new\s+(?:Autodesk\.Revit\.DB\.)?ElementId\s*\(\s*\d+\s*\)/;

export class ToolStore {
  readonly root: string;

  constructor(root = defaultHome()) {
    this.root = join(root, "tools");
  }

  async list(statuses: ToolStatus[] = ["active"]): Promise<SavedToolManifest[]> {
    const manifests: SavedToolManifest[] = [];
    for (const toolId of await safeDirectories(this.root)) {
      for (const version of await safeDirectories(join(this.root, toolId))) {
        if (!VERSION_PATTERN.test(version)) {
          continue;
        }
        try {
          const manifest = JSON.parse(await readFile(join(this.root, toolId, version, "manifest.json"), "utf8")) as SavedToolManifest;
          if (statuses.includes(manifest.status)) {
            manifests.push(manifest);
          }
        } catch {
          // Ignore incomplete staging directories and corrupt versions; they stay unavailable.
        }
      }
    }
    return manifests.sort((left, right) => left.toolId.localeCompare(right.toolId) || compareVersions(right.version, left.version));
  }

  async get(toolId: string, version?: string): Promise<{ manifest: SavedToolManifest; source: string }> {
    validateToolId(toolId);
    const versions = (await safeDirectories(join(this.root, toolId))).filter((item) => VERSION_PATTERN.test(item));
    const selected = version || versions.sort(compareVersions).at(-1);
    if (!selected || !VERSION_PATTERN.test(selected)) {
      throw new AgentError("TOOL_NOT_FOUND", `Saved tool was not found: ${toolId}`);
    }
    try {
      const base = join(this.root, toolId, selected);
      return {
        manifest: JSON.parse(await readFile(join(base, "manifest.json"), "utf8")) as SavedToolManifest,
        source: await readFile(join(base, "command.cs"), "utf8"),
      };
    } catch {
      throw new AgentError("TOOL_NOT_FOUND", `Saved tool version was not found: ${toolId}@${selected}`);
    }
  }

  async getActive(toolId: string, version?: string): Promise<{ manifest: SavedToolManifest; source: string }> {
    if (version) {
      const selected = await this.get(toolId, version);
      if (selected.manifest.status !== "active") {
        throw new AgentError("TOOL_NOT_ACTIVE", `Saved tool is not active: ${toolId}@${version}`);
      }
      return selected;
    }

    const active = (await this.list(["active"]))
      .filter((manifest) => manifest.toolId === toolId)
      .sort((left, right) => compareVersions(right.version, left.version))[0];
    if (!active) {
      throw new AgentError("TOOL_NOT_ACTIVE", `Saved tool has no active version: ${toolId}`);
    }
    return this.get(toolId, active.version);
  }

  async save(
    source: string,
    input: GeneratedToolManifestInput,
    status: "active" | "draft",
    projectFingerprint?: string,
  ): Promise<SavedToolManifest> {
    validateGeneratedToolManifest(input);
    if (input.binding === "project" && !projectFingerprint) {
      throw new AgentError("PROJECT_FINGERPRINT_REQUIRED", "Project-bound tools require a live project fingerprint.");
    }
    validatePortableSource(source, input.binding);
    await this.assertRiskNotDowngraded(input.toolId, input.risk);
    const version = await this.nextVersion(input.toolId);
    const now = new Date().toISOString();
    const manifest: SavedToolManifest = {
      schemaVersion: 1,
      toolId: input.toolId,
      name: input.name.trim(),
      version,
      description: input.description.trim(),
      inputSchema: input.inputSchema,
      risk: input.risk,
      status,
      binding: input.binding,
      projectFingerprint: input.binding === "project" ? projectFingerprint : undefined,
      requiredContext: input.requiredContext ?? [],
      tags: [...new Set(["saved", ...(input.tags ?? [])])].slice(0, 20),
      sourceHash: createHash("sha256").update(source, "utf8").digest("hex"),
      revitVersions: ["2024"],
      createdAt: now,
      lastValidatedAt: status === "active" ? now : null,
      provenance: "codex-generated",
    };

    const toolRoot = join(this.root, input.toolId);
    const staging = join(toolRoot, `.tmp-${randomUUID()}`);
    const destination = join(toolRoot, version);
    await mkdir(staging, { recursive: true });
    await writeFile(join(staging, "command.cs"), source, "utf8");
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await rename(staging, destination);
    return manifest;
  }

  private async nextVersion(toolId: string): Promise<string> {
    const versions = (await safeDirectories(join(this.root, toolId))).filter((item) => VERSION_PATTERN.test(item));
    if (versions.length === 0) {
      return "1.0.0";
    }
    const [major, minor, patch] = versions.sort(compareVersions).at(-1)!.split(".").map(Number);
    return `${major}.${minor}.${patch + 1}`;
  }

  private async assertRiskNotDowngraded(toolId: string, risk: GeneratedToolManifestInput["risk"]): Promise<void> {
    const previous = (await this.list(["active", "draft"])).filter((manifest) => manifest.toolId === toolId);
    const highestRisk = previous.reduce((highest, manifest) => Math.max(highest, riskRank(manifest.risk)), -1);
    if (highestRisk > riskRank(risk)) {
      throw new AgentError("RISK_DOWNGRADE_BLOCKED", `Saved tool risk cannot be downgraded: ${toolId}`);
    }
  }
}

function defaultHome(): string {
  const appData = process.env.BIM_PERSONAL_AGENT_HOME || process.env.APPDATA;
  if (!appData) {
    throw new AgentError("CONFIGURATION_ERROR", "APPDATA or BIM_PERSONAL_AGENT_HOME is required.");
  }
  return process.env.BIM_PERSONAL_AGENT_HOME || join(appData, "BIMPersonalAgent");
}

function validateToolId(toolId: string): void {
  if (!TOOL_ID_PATTERN.test(toolId)) {
    throw new AgentError("VALIDATION_ERROR", "toolId must be a lowercase kebab-case identifier between 3 and 64 characters.");
  }
}

export function validateGeneratedToolManifest(input: GeneratedToolManifestInput): void {
  validateToolId(input.toolId);
  if (!input.name?.trim() || input.name.length > 120 || !input.description?.trim() || input.description.length > 1000) {
    throw new AgentError("VALIDATION_ERROR", "Tool name and description are required and exceed no configured limits.");
  }
  if (!input.inputSchema || input.inputSchema.type !== "object") {
    throw new AgentError("VALIDATION_ERROR", "Saved tool inputSchema must describe an object.");
  }
  if (!["readOnly", "reversibleMutation", "destructive"].includes(input.risk)) {
    throw new AgentError("VALIDATION_ERROR", "Tool risk must be readOnly, reversibleMutation, or destructive.");
  }
  if (!["portable", "project"].includes(input.binding)) {
    throw new AgentError("VALIDATION_ERROR", "Tool binding must be portable or project.");
  }
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string"))) {
    throw new AgentError("VALIDATION_ERROR", "Tool tags must be an array of strings.");
  }
  if (input.requiredContext !== undefined
    && (!Array.isArray(input.requiredContext) || input.requiredContext.some((item) => typeof item !== "string"))) {
    throw new AgentError("VALIDATION_ERROR", "Tool requiredContext must be an array of strings.");
  }
}

function validatePortableSource(source: string, binding: "portable" | "project"): void {
  if (binding !== "portable") {
    return;
  }
  if (ABSOLUTE_PATH_PATTERN.test(source)) {
    throw new AgentError("PORTABILITY_VALIDATION_FAILED", "Portable tools cannot contain absolute Windows paths.");
  }
  if (HARDCODED_ELEMENT_ID_PATTERN.test(source)) {
    throw new AgentError("PORTABILITY_VALIDATION_FAILED", "Portable tools cannot contain hard-coded ElementId values.");
  }
}

async function safeDirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name);
  } catch {
    return [];
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function riskRank(risk: GeneratedToolManifestInput["risk"]): number {
  return risk === "destructive" ? 2 : risk === "reversibleMutation" ? 1 : 0;
}
