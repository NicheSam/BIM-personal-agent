import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentActivityEvent } from "./types.js";

export class ActivityStore {
  readonly path: string;

  constructor(home = process.env.BIM_PERSONAL_AGENT_HOME || join(process.env.APPDATA || ".", "BIMPersonalAgent")) {
    this.path = join(home, "events", "activity.jsonl");
  }

  async record(event: AgentActivityEvent): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify(event)}\n`, "utf8");
    } catch {
      // Activity history must never change the Revit command result.
    }
  }

  async list(limit = 200): Promise<AgentActivityEvent[]> {
    try {
      const lines = (await readFile(this.path, "utf8")).trim().split(/\r?\n/).filter(Boolean);
      return lines.slice(-Math.max(1, Math.min(limit, 1000))).map((line) => JSON.parse(line) as AgentActivityEvent);
    } catch {
      return [];
    }
  }
}
