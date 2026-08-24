import { createServer } from "node:http";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachCodexUsage } from "./codex-usage.mjs";
import { detailDiff, detailListItem, detailSection, sanitizeEvidenceView } from "./detail-utils.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const home = process.env.BIM_PERSONAL_AGENT_HOME
  || join(process.env.APPDATA || ".", "BIMPersonalAgent");
const activityPath = join(home, "events", "activity.jsonl");
const tasksRoot = join(home, "tasks");
const developerRoot = join(home, "developer-traces");
const taskStreamPath = join(tasksRoot, "events.jsonl");
const configPath = join(home, "config", "config.json");
const host = "127.0.0.1";
const port = parsePort(process.env.BIM_AGENT_CONSOLE_PORT, 4178);
const usageCache = new Map();
let usageRefreshPromise;
const buildMetadata = await readJson(join(root, "build-metadata.json")) || {
  semanticVersion: "0.8.0",
  buildHash: "development",
  commitHash: null,
  buildTimeUtc: "development",
  gatewaySchemaVersion: 3,
  consoleSchemaVersion: 3,
  buildId: "0.8.0-development",
};

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    if (request.method !== "GET") {
      return sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
    }
    if (url.pathname === "/health") {
      return sendJson(response, 200, { ok: true, service: "bim-agent-console", ...buildMetadata });
    }
    if (url.pathname === "/api/status") {
      const config = await readJson(configPath);
      const bridgePort = parsePort(String(config?.Port ?? process.env.BIM_PERSONAL_AGENT_PORT ?? "9686"), 9686);
      return sendJson(response, 200, {
        bridgeConnected: await canConnect("localhost", bridgePort),
        bridgePort,
        configVersion: config?.ConfigVersion ?? null,
        buildId: buildMetadata.buildId,
        developerModeAvailable: process.env.BIM_AGENT_DEVELOPER_MODE === "1",
        updatedAtUtc: new Date().toISOString(),
      });
    }
    if (url.pathname === "/api/tasks") {
      const limit = boundedLimit(url.searchParams.get("limit"), 100, 500);
      const tasks = await readTaskSummaries(limit);
      scheduleUsageRefresh(tasks);
      return sendJson(response, 200, { tasks: tasks.map(withCachedUsage), count: tasks.length });
    }
    const diffRoute = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})\/diff$/i);
    if (diffRoute) {
      const taskId = diffRoute[1];
      const baseId = safeRequestId(url.searchParams.get("base"));
      const compareId = safeRequestId(url.searchParams.get("compare"));
      if (!baseId || !compareId) return sendJson(response, 400, { error: "DIFF_RUNS_REQUIRED" });
      const [base, compare] = await Promise.all([
        readJson(join(tasksRoot, taskId, "details", `${baseId}.json`)),
        readJson(join(tasksRoot, taskId, "details", `${compareId}.json`)),
      ]);
      if (!base || !compare) return sendJson(response, 404, { error: "TASK_DETAIL_NOT_FOUND" });
      const developerRequested = url.searchParams.get("developer") === "1";
      if (developerRequested && process.env.BIM_AGENT_DEVELOPER_MODE !== "1") {
        return sendJson(response, 403, { error: "DEVELOPER_MODE_DISABLED" });
      }
      const [baseTrace, compareTrace] = developerRequested ? await Promise.all([
        readJson(join(developerRoot, taskId, `${baseId}.json`)),
        readJson(join(developerRoot, taskId, `${compareId}.json`)),
      ]) : [null, null];
      const basePayload = baseTrace ? { ...base, developerTrace: baseTrace } : base;
      const comparePayload = compareTrace ? { ...compare, developerTrace: compareTrace } : compare;
      return sendJson(response, 200, {
        diff: detailDiff(basePayload, comparePayload, {
          evidence: url.searchParams.get("evidence") === "1",
          includeRaw: developerRequested,
        }),
      });
    }
    const detailRoute = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})\/details(?:\/([0-9a-z_-]{1,120}))?$/i);
    if (detailRoute) {
      const taskId = detailRoute[1];
      const requestId = detailRoute[2];
      if (!requestId) {
        const details = await readTaskDetails(taskId);
        return sendJson(response, 200, { details: details.map(detailListItem), count: details.length });
      }
      const detail = await readJson(join(tasksRoot, taskId, "details", `${requestId}.json`));
      if (!detail || ![1, 2, 3].includes(detail.schemaVersion)) return sendJson(response, 404, { error: "TASK_DETAIL_NOT_FOUND" });
      const section = normalizeDetailSection(url.searchParams.get("section"));
      let payload = detailSection(detail, section, {
        offset: url.searchParams.get("offset"),
        limit: url.searchParams.get("limit"),
        query: url.searchParams.get("query"),
        status: url.searchParams.get("status"),
        evidence: url.searchParams.get("evidence") === "1",
      });
      if (section === "raw" && url.searchParams.get("developer") === "1") {
        if (process.env.BIM_AGENT_DEVELOPER_MODE !== "1") return sendJson(response, 403, { error: "DEVELOPER_MODE_DISABLED" });
        const developerTrace = await readJson(join(developerRoot, taskId, `${requestId}.json`));
        payload = {
          envelope: payload,
          developerTrace: url.searchParams.get("evidence") === "1" ? sanitizeEvidenceView(developerTrace || null) : developerTrace || null,
        };
      }
      if (section === "raw" && url.searchParams.get("download") === "1") {
        response.setHeader("Content-Disposition", `attachment; filename="bim-task-${taskId}-${requestId}.json"`);
      }
      return sendJson(response, 200, { section, detail: payload });
    }
    const taskRoute = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})(?:\/events)?$/i);
    if (taskRoute) {
      const taskId = taskRoute[1];
      if (url.pathname.endsWith("/events")) {
        const events = await readTaskEvents(taskId, boundedLimit(url.searchParams.get("limit"), 500, 2000));
        return sendJson(response, 200, { events, count: events.length });
      }
      const task = await readJson(join(tasksRoot, taskId, "summary.json"));
      if (!task || task.schemaVersion !== 2) return sendJson(response, 404, { error: "TASK_NOT_FOUND" });
      return sendJson(response, 200, { task: withCachedUsage(task) });
    }
    if (url.pathname === "/api/events/stream") {
      return openEventStream(request, response);
    }
    if (url.pathname === "/api/events") {
      const limit = boundedLimit(url.searchParams.get("limit"), 200, 1000);
      const events = await attachCodexUsage(await readLegacyEvents(limit));
      return sendJson(response, 200, { events: events.reverse(), count: events.length });
    }
    const asset = assets.get(url.pathname);
    if (!asset) return sendJson(response, 404, { error: "NOT_FOUND" });
    const [name, contentType] = asset;
    const body = await readFile(resolve(root, name));
    sendHeaders(response, 200, contentType);
    response.end(body);
  } catch (error) {
    sendJson(response, 500, { error: "CONSOLE_ERROR", message: error instanceof Error ? error.message : String(error) });
  }
});

const streamClients = new Set();
let streamOffset = 0;
let streamRemainder = "";
let streamPumping = false;

async function initializeStreamOffset() {
  try {
    streamOffset = (await stat(taskStreamPath)).size;
  } catch {
    streamOffset = 0;
  }
}

function openEventStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  response.write("retry: 2000\n\n");
  streamClients.add(response);
  const close = () => streamClients.delete(response);
  request.once("close", close);
  response.once("close", close);
}

async function pumpTaskEvents() {
  if (streamPumping || streamClients.size === 0) return;
  streamPumping = true;
  try {
    const size = (await stat(taskStreamPath)).size;
    if (size < streamOffset) {
      streamOffset = 0;
      streamRemainder = "";
    }
    if (size === streamOffset) return;
    const handle = await open(taskStreamPath, "r");
    try {
      const buffer = Buffer.alloc(size - streamOffset);
      await handle.read(buffer, 0, buffer.length, streamOffset);
      streamOffset = size;
      const lines = `${streamRemainder}${buffer.toString("utf8")}`.split(/\r?\n/);
      streamRemainder = lines.pop() || "";
      for (const line of lines) {
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event?.schemaVersion !== 2 || typeof event.eventId !== "string") continue;
        const payload = `id: ${event.eventId}\nevent: task-event\ndata: ${JSON.stringify(event)}\n\n`;
        for (const client of streamClients) client.write(payload);
      }
    } finally {
      await handle.close();
    }
  } catch {
    // The task stream is created on the first V0.6 task.
  } finally {
    streamPumping = false;
  }
}

async function readTaskSummaries(limit) {
  try {
    const entries = await readdir(tasksRoot, { withFileTypes: true });
    const tasks = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name))
      .map((entry) => readJson(join(tasksRoot, entry.name, "summary.json"))));
    return tasks
      .filter((task) => task?.schemaVersion === 2)
      .sort((left, right) => String(right.updatedAtUtc).localeCompare(String(left.updatedAtUtc)))
      .slice(0, limit);
  } catch {
    return [];
  }
}

async function readTaskEvents(taskId, limit) {
  try {
    const lines = (await readFile(join(tasksRoot, taskId, "events.jsonl"), "utf8")).trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).flatMap((line) => {
      try {
        const event = JSON.parse(line);
        return event?.schemaVersion === 2 ? [event] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function readTaskDetails(taskId) {
  try {
    const root = join(tasksRoot, taskId, "details");
    const entries = await readdir(root, { withFileTypes: true });
    const details = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson(join(root, entry.name))));
    return details
      .filter((detail) => [1, 2, 3].includes(detail?.schemaVersion))
      .sort((left, right) => String(right.startedAtUtc).localeCompare(String(left.startedAtUtc)));
  } catch {
    return [];
  }
}

function normalizeDetailSection(value) {
  return ["summary", "input", "result", "verification", "raw"].includes(value) ? value : "summary";
}

function scheduleUsageRefresh(tasks) {
  if (usageRefreshPromise) return;
  usageRefreshPromise = refreshUsage(tasks).finally(() => {
    setTimeout(() => { usageRefreshPromise = undefined; }, 15_000);
  });
}

async function refreshUsage(tasks) {
  const requestRows = [];
  const taskByRequest = new Map();
  for (const task of tasks.slice(0, 100)) {
    const events = await readTaskEvents(task.taskId, 1000);
    for (const requestId of new Set(events.map((event) => event.requestId).filter(Boolean))) {
      requestRows.push({ requestId, startedAtUtc: task.createdAtUtc, completedAtUtc: task.updatedAtUtc });
      taskByRequest.set(requestId, task.taskId);
    }
  }
  const enriched = await attachCodexUsage(requestRows);
  const usageByTask = new Map();
  for (const row of enriched) {
    const taskId = taskByRequest.get(row.requestId);
    if (!taskId || !row.codexUsage) continue;
    if (!usageByTask.has(taskId)) usageByTask.set(taskId, new Map());
    usageByTask.get(taskId).set(row.codexUsage.taskKey, row.codexUsage);
  }
  for (const [taskId, byTurn] of usageByTask) {
    usageCache.set(taskId, combineUsage([...byTurn.values()]));
  }
}

function combineUsage(items) {
  const total = {
    source: "codex-session",
    model: items.map((item) => item.model).filter(Boolean).join(", "),
    inputTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    turnCount: items.length,
    turns: items.map((item) => ({
      taskKey: item.taskKey,
      model: item.model,
      inputTokens: item.inputTokens,
      cachedInputTokens: item.cachedInputTokens,
      uncachedInputTokens: item.uncachedInputTokens,
      outputTokens: item.outputTokens,
      reasoningOutputTokens: item.reasoningOutputTokens,
      totalTokens: item.totalTokens,
    })),
  };
  for (const item of items) {
    for (const key of ["inputTokens", "cachedInputTokens", "uncachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"]) {
      total[key] += Number(item[key] || 0);
    }
  }
  return total;
}

function withCachedUsage(task) {
  const codexUsage = usageCache.get(task.taskId);
  return codexUsage ? { ...task, codexUsage } : task;
}

async function readLegacyEvents(limit) {
  try {
    const lines = (await readFile(activityPath, "utf8")).trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).flatMap((line) => {
      try {
        const event = JSON.parse(line);
        return event?.schemaVersion === 1 ? [event] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

function canConnect(targetHost, targetPort) {
  return new Promise((resolveConnection) => {
    const socket = connect({ host: targetHost, port: targetPort });
    const finish = (connected) => {
      socket.destroy();
      resolveConnection(connected);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function sendJson(response, status, payload) {
  sendHeaders(response, status, "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendHeaders(response, status, contentType) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'",
  });
}

function boundedLimit(value, fallback, maximum) {
  return Math.max(1, Math.min(Number.parseInt(value || String(fallback), 10) || fallback, maximum));
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : fallback;
}

function safeRequestId(value) {
  return typeof value === "string" && /^[0-9a-z_-]{1,120}$/i.test(value) ? value : undefined;
}

await initializeStreamOffset();
const streamTimer = setInterval(pumpTaskEvents, 500);
const heartbeatTimer = setInterval(() => {
  for (const client of streamClients) client.write(": heartbeat\n\n");
}, 15_000);

server.listen(port, host, () => {
  console.log(`BIM Agent Console http://${host}:${port}`);
});

function shutdown() {
  clearInterval(streamTimer);
  clearInterval(heartbeatTimer);
  for (const client of streamClients) client.end();
  server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
