import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AgentError } from "./errors.js";
import type { JsonObject, LoopRunState } from "./types.js";

export class RunStore {
  readonly root: string;

  constructor(home = process.env.BIM_PERSONAL_AGENT_HOME || join(process.env.APPDATA || ".", "BIMPersonalAgent")) {
    this.root = join(home, "runs");
  }

  async create(state: LoopRunState): Promise<void> {
    await this.write(state);
  }

  async get(runId: string): Promise<LoopRunState> {
    validateRunId(runId);
    try {
      return JSON.parse(await readFile(join(this.root, runId, "state.json"), "utf8")) as LoopRunState;
    } catch {
      throw new AgentError("LOOP_RUN_NOT_FOUND", `Loop run was not found: ${runId}`);
    }
  }

  async write(state: LoopRunState): Promise<void> {
    validateRunId(state.runId);
    const directory = join(this.root, state.runId);
    const destination = join(directory, "state.json");
    const temporary = join(directory, `state.${process.pid}.tmp`);
    await mkdir(directory, { recursive: true });
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, destination);
  }

  async appendEvidence(runId: string, evidence: JsonObject): Promise<void> {
    validateRunId(runId);
    const path = join(this.root, runId, "evidence.jsonl");
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify({ timestampUtc: new Date().toISOString(), ...evidence })}\n`, "utf8");
  }
}

function validateRunId(runId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    throw new AgentError("VALIDATION_ERROR", "runId must be a UUID.");
  }
}
