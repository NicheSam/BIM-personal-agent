import { mkdir, appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ToolPerformanceRecord, ToolPerformanceSummary } from "./types.js";

export class TelemetryStore {
  readonly path: string;

  constructor(home = process.env.BIM_PERSONAL_AGENT_HOME || join(process.env.APPDATA || ".", "BIMPersonalAgent")) {
    this.path = join(home, "telemetry", "tool-performance.jsonl");
  }

  async record(record: Omit<ToolPerformanceRecord, "timestampUtc">): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${JSON.stringify({ timestampUtc: new Date().toISOString(), ...record })}\n`, "utf8");
    } catch {
      // Telemetry must never change command success or failure.
    }
  }

  async summaries(): Promise<Record<string, ToolPerformanceSummary>> {
    let lines: string[];
    try {
      lines = (await readFile(this.path, "utf8")).trim().split(/\r?\n/).slice(-5000);
    } catch {
      return {};
    }
    const groups = new Map<string, ToolPerformanceRecord[]>();
    for (const line of lines) {
      try {
        const record = JSON.parse(line) as ToolPerformanceRecord;
        const group = groups.get(record.toolId) ?? [];
        group.push(record);
        groups.set(record.toolId, group);
      } catch {
        // Skip malformed telemetry lines.
      }
    }
    return Object.fromEntries([...groups.entries()].map(([toolId, records]) => {
      const durations = records.map((item) => item.durationMs).sort((a, b) => a - b);
      const successRate = records.filter((item) => item.success).length / records.length;
      const p95 = durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)];
      const health = records.length < 3 ? "baseline" : successRate >= 0.95 && p95 <= 3000 ? "healthy" : "degraded";
      return [toolId, {
        samples: records.length,
        successRate,
        p95DurationMs: p95,
        averageResponseBytes: records.reduce((sum, item) => sum + item.responseBytes, 0) / records.length,
        health,
      } satisfies ToolPerformanceSummary];
    }));
  }
}
