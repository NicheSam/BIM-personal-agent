import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const CACHE_MS = 5_000;
const MAX_SESSION_FILES = 120;
let cache = { signature: "", expiresAt: 0, usageByRequestId: new Map() };

export async function attachCodexUsage(events, options = {}) {
  const requestIds = new Set(events.map((event) => event?.requestId).filter(isUuid));
  if (requestIds.size === 0) return events;
  const signature = [...requestIds].sort().join(",");
  let usageByRequestId;
  if (cache.signature === signature && cache.expiresAt > Date.now()) {
    usageByRequestId = cache.usageByRequestId;
  } else {
    const sessionsRoot = options.sessionsRoot || join(homedir(), ".codex", "sessions");
    usageByRequestId = await findCodexUsage(sessionsRoot, requestIds, events);
    cache = { signature, expiresAt: Date.now() + CACHE_MS, usageByRequestId };
  }
  return events.map((event) => {
    const codexUsage = usageByRequestId.get(event.requestId);
    return codexUsage ? { ...event, codexUsage } : event;
  });
}

export function parseCodexSessionText(text, requestIds, fallbackSessionId = "session") {
  const parser = createSessionParser(new Set(requestIds), fallbackSessionId);
  for (const line of text.split(/\r?\n/)) parser.consume(line);
  return parser.finish();
}

async function findCodexUsage(sessionsRoot, requestIds, events) {
  const oldestEvent = Math.min(...events.map((event) => Date.parse(event.startedAtUtc)).filter(Number.isFinite));
  const threshold = Number.isFinite(oldestEvent) ? oldestEvent - 24 * 60 * 60 * 1000 : 0;
  const files = (await listSessionFiles(sessionsRoot))
    .filter((file) => file.modifiedAt >= threshold)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, MAX_SESSION_FILES);
  const candidates = new Map();
  const matched = new Set();
  for (const file of files) {
    const parsed = await parseCodexSessionFile(file.path, requestIds);
    for (const candidate of parsed) {
      if (!candidates.has(candidate.requestId)) candidates.set(candidate.requestId, []);
      candidates.get(candidate.requestId).push(candidate);
      matched.add(candidate.requestId);
    }
    if (matched.size === requestIds.size) break;
  }
  const result = new Map();
  for (const event of events) {
    const matches = candidates.get(event.requestId) || [];
    if (matches.length === 0) continue;
    const eventTime = Date.parse(event.completedAtUtc);
    const selected = matches.sort((left, right) => distanceToTask(eventTime, left) - distanceToTask(eventTime, right))[0];
    result.set(event.requestId, withoutInternalTimes(selected));
  }
  return result;
}

async function parseCodexSessionFile(path, requestIds) {
  const parser = createSessionParser(requestIds, path);
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) parser.consume(line);
  return parser.finish();
}

function createSessionParser(requestIds, fallbackSessionId) {
  let sessionId = fallbackSessionId;
  let currentModel = "unknown";
  let lastTimestamp;
  let turn = createTurn("turn-unknown", undefined, currentModel);
  const matches = [];

  const finalize = (endedAtUtc) => {
    if (turn.requestIds.size > 0 && turn.usage.totalTokens > 0) {
      for (const requestId of turn.requestIds) {
        matches.push({
          requestId,
          taskKey: `${sessionId}:${turn.turnId}`,
          source: "codex-session",
          model: turn.model || currentModel,
          ...turn.usage,
          taskStartedAtUtc: turn.startedAtUtc,
          taskEndedAtUtc: endedAtUtc,
        });
      }
    }
  };

  return {
    consume(line) {
      if (!line || (!line.includes("session_meta") && !line.includes("turn_context")
        && !line.includes("thread_settings_applied") && !line.includes("token_count")
        && !line.includes("mcp_tool_call_end"))) return;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        return;
      }
      lastTimestamp = typeof row.timestamp === "string" ? row.timestamp : lastTimestamp;
      if (row.type === "session_meta" && typeof row.payload?.id === "string") {
        sessionId = row.payload.id;
        if (typeof row.payload.model === "string") currentModel = row.payload.model;
        return;
      }
      if (row.type === "turn_context") {
        finalize(row.timestamp);
        currentModel = typeof row.payload?.model === "string" ? row.payload.model : currentModel;
        turn = createTurn(row.payload?.turn_id || `turn-${row.timestamp || "unknown"}`, row.timestamp, currentModel);
        return;
      }
      if (row.type !== "event_msg") return;
      if (row.payload?.type === "thread_settings_applied" && typeof row.payload?.thread_settings?.model === "string") {
        currentModel = row.payload.thread_settings.model;
        turn.model = currentModel;
        return;
      }
      if (row.payload?.type === "token_count") {
        addUsage(turn.usage, row.payload?.info?.last_token_usage);
        return;
      }
      if (row.payload?.type === "mcp_tool_call_end" && row.payload?.invocation?.server === "bim-personal-agent") {
        const requestId = extractGatewayRequestId(row.payload?.result);
        if (requestId && requestIds.has(requestId)) turn.requestIds.add(requestId);
      }
    },
    finish() {
      finalize(lastTimestamp);
      return matches;
    },
  };
}

function createTurn(turnId, startedAtUtc, model) {
  return {
    turnId,
    startedAtUtc,
    model,
    requestIds: new Set(),
    usage: {
      inputTokens: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  };
}

function addUsage(total, raw) {
  if (!raw || typeof raw !== "object") return;
  const input = positiveNumber(raw.input_tokens);
  const cached = Math.min(input, positiveNumber(raw.cached_input_tokens));
  const output = positiveNumber(raw.output_tokens);
  total.inputTokens += input;
  total.cachedInputTokens += cached;
  total.uncachedInputTokens += Math.max(0, input - cached);
  total.outputTokens += output;
  total.reasoningOutputTokens += positiveNumber(raw.reasoning_output_tokens);
  total.totalTokens += positiveNumber(raw.total_tokens) || input + output;
}

function extractGatewayRequestId(result) {
  const content = result?.Ok?.content ?? result?.ok?.content ?? result?.content;
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (typeof item?.text !== "string") continue;
    try {
      const parsed = JSON.parse(item.text);
      if (isUuid(parsed?.requestId)) return parsed.requestId;
    } catch {
      const match = item.text.match(/"requestId"\s*:\s*"([0-9a-f-]{36})"/i);
      if (match && isUuid(match[1])) return match[1];
    }
  }
  return undefined;
}

async function listSessionFiles(root) {
  const files = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          files.push({ path, modifiedAt: (await stat(path)).mtimeMs });
        } catch {}
      }
    }
  };
  await visit(root);
  return files;
}

function distanceToTask(eventTime, task) {
  if (!Number.isFinite(eventTime)) return Number.MAX_SAFE_INTEGER;
  const start = Date.parse(task.taskStartedAtUtc || task.taskEndedAtUtc);
  const end = Date.parse(task.taskEndedAtUtc || task.taskStartedAtUtc);
  if (Number.isFinite(start) && Number.isFinite(end) && eventTime >= start && eventTime <= end) return 0;
  if (Number.isFinite(start) && eventTime < start) return start - eventTime;
  if (Number.isFinite(end)) return eventTime - end;
  return Number.MAX_SAFE_INTEGER;
}

function withoutInternalTimes(candidate) {
  const { requestId: _requestId, taskStartedAtUtc: _started, taskEndedAtUtc: _ended, ...usage } = candidate;
  return usage;
}

function positiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}
