import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTaskEvent, AgentTaskSummary, TaskExecutionDetail } from "./types.js";
import type { DeveloperTrace } from "./task-detail.js";

export class TaskStore {
  readonly root: string;
  readonly streamPath: string;
  readonly developerRoot: string;
  private queueTail: Promise<void> = Promise.resolve();

  constructor(home = process.env.BIM_PERSONAL_AGENT_HOME || join(process.env.APPDATA || ".", "BIMPersonalAgent")) {
    this.root = join(home, "tasks");
    this.streamPath = join(this.root, "events.jsonl");
    this.developerRoot = join(home, "developer-traces");
  }

  async ensure(summary: AgentTaskSummary): Promise<AgentTaskSummary> {
    return this.enqueue(async () => {
      const existing = await this.readSummary(summary.taskId);
      if (existing) return existing;
      await mkdir(this.taskPath(summary.taskId), { recursive: true });
      await this.writeSummary(summary);
      return summary;
    });
  }

  async append(event: Omit<AgentTaskEvent, "sequence">): Promise<AgentTaskEvent> {
    return this.enqueue(async () => {
      const current = await this.readSummary(event.taskId);
      if (!current) throw new Error(`Task ${event.taskId} does not exist.`);
      const stored: AgentTaskEvent = { ...event, sequence: current.eventCount + 1 };
      const line = `${JSON.stringify(stored)}\n`;
      await mkdir(this.taskPath(event.taskId), { recursive: true });
      await appendFile(this.eventsPath(event.taskId), line, "utf8");
      await appendFile(this.streamPath, line, "utf8");
      const summary: AgentTaskSummary = {
        ...current,
        updatedAtUtc: stored.timestampUtc,
        lastRequestId: stored.requestId,
        phase: stored.phase,
        executionStatus: stored.executionStatus,
        verificationStatus: stored.verificationStatus,
        eventCount: stored.sequence,
        toolIds: stored.toolId && !current.toolIds.includes(stored.toolId)
          ? [...current.toolIds, stored.toolId]
          : current.toolIds,
        durationMs: stored.durationMs === undefined
          ? current.durationMs
          : (current.durationMs ?? 0) + stored.durationMs,
        errorCode: stored.errorCode,
      };
      await this.writeSummary(summary);
      return stored;
    });
  }

  async get(taskId: string): Promise<AgentTaskSummary | undefined> {
    return this.readSummary(taskId);
  }

  async list(limit = 100): Promise<AgentTaskSummary[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      const summaries = await Promise.all(entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readSummary(entry.name)));
      return summaries
        .filter((item): item is AgentTaskSummary => Boolean(item))
        .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))
        .slice(0, Math.max(1, Math.min(limit, 500)));
    } catch {
      return [];
    }
  }

  async events(taskId: string, limit = 500): Promise<AgentTaskEvent[]> {
    try {
      const lines = (await readFile(this.eventsPath(taskId), "utf8")).trim().split(/\r?\n/).filter(Boolean);
      return lines.slice(-Math.max(1, Math.min(limit, 2000))).map((line) => JSON.parse(line) as AgentTaskEvent);
    } catch {
      return [];
    }
  }

  async saveDetail(detail: TaskExecutionDetail, developerTrace?: DeveloperTrace): Promise<void> {
    return this.enqueue(async () => {
      const current = await this.readSummary(detail.taskId);
      if (!current) throw new Error(`Task ${detail.taskId} does not exist.`);
      const persistedAtUtc = new Date().toISOString();
      const persistedDetail: TaskExecutionDetail = {
        ...detail,
        stageTrace: detail.stageTrace.map((stage) => stage.stage === "persistence"
          ? { ...stage, status: "completed", startedAtUtc: persistedAtUtc, completedAtUtc: persistedAtUtc, durationMs: 0 }
          : stage),
      };
      await mkdir(this.detailsPath(detail.taskId), { recursive: true });
      await writeFile(this.detailPath(detail.taskId, detail.requestId), `${JSON.stringify(persistedDetail)}\n`, "utf8");
      if (developerTrace) {
        await mkdir(join(this.developerRoot, detail.taskId), { recursive: true });
        await writeFile(join(this.developerRoot, detail.taskId, `${detail.requestId}.json`), `${JSON.stringify(developerTrace)}\n`, "utf8");
        await this.pruneDeveloperTraces();
      }
      const details = await this.details(detail.taskId);
      await this.writeSummary({
        ...current,
        detailCount: details.length,
        engineeringStatus: detail.status,
      });
    });
  }

  async developerTrace(taskId: string, requestId: string): Promise<DeveloperTrace | undefined> {
    if (!/^[0-9a-f-]{36}$/i.test(taskId) || !/^[0-9a-z_-]{1,120}$/i.test(requestId)) return undefined;
    try {
      return JSON.parse(await readFile(join(this.developerRoot, taskId, `${requestId}.json`), "utf8")) as DeveloperTrace;
    } catch {
      return undefined;
    }
  }

  async details(taskId: string): Promise<TaskExecutionDetail[]> {
    try {
      const entries = await readdir(this.detailsPath(taskId), { withFileTypes: true });
      const details = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => JSON.parse(await readFile(join(this.detailsPath(taskId), entry.name), "utf8")) as TaskExecutionDetail));
      return details.sort((left, right) => left.startedAtUtc.localeCompare(right.startedAtUtc));
    } catch {
      return [];
    }
  }

  private taskPath(taskId: string): string {
    return join(this.root, taskId);
  }

  private summaryPath(taskId: string): string {
    return join(this.taskPath(taskId), "summary.json");
  }

  private eventsPath(taskId: string): string {
    return join(this.taskPath(taskId), "events.jsonl");
  }

  private detailsPath(taskId: string): string {
    return join(this.taskPath(taskId), "details");
  }

  private detailPath(taskId: string, requestId: string): string {
    if (!/^[0-9a-z_-]{1,120}$/i.test(requestId)) throw new Error("Invalid task detail requestId.");
    return join(this.detailsPath(taskId), `${requestId}.json`);
  }

  private async readSummary(taskId: string): Promise<AgentTaskSummary | undefined> {
    try {
      return JSON.parse(await readFile(this.summaryPath(taskId), "utf8")) as AgentTaskSummary;
    } catch {
      return undefined;
    }
  }

  private async writeSummary(summary: AgentTaskSummary): Promise<void> {
    await mkdir(this.taskPath(summary.taskId), { recursive: true });
    await writeFile(this.summaryPath(summary.taskId), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  private async pruneDeveloperTraces(): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    try {
      const taskDirectories = await readdir(this.developerRoot, { withFileTypes: true });
      for (const directory of taskDirectories.filter((entry) => entry.isDirectory())) {
        const files = await readdir(join(this.developerRoot, directory.name), { withFileTypes: true });
        for (const file of files.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))) {
          const payload = JSON.parse(await readFile(join(this.developerRoot, directory.name, file.name), "utf8")) as DeveloperTrace;
          if (Date.parse(payload.createdAtUtc) < cutoff) {
            const { unlink } = await import("node:fs/promises");
            await unlink(join(this.developerRoot, directory.name, file.name));
          }
        }
      }
    } catch {
      // Retention cleanup must not fail the execution record.
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queueTail.then(operation, operation);
    this.queueTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
