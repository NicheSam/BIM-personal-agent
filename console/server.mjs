import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const home = process.env.BIM_PERSONAL_AGENT_HOME
  || join(process.env.APPDATA || ".", "BIMPersonalAgent");
const activityPath = join(home, "events", "activity.jsonl");
const configPath = join(home, "config", "config.json");
const host = "127.0.0.1";
const port = parsePort(process.env.BIM_AGENT_CONSOLE_PORT, 4178);

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
      return sendJson(response, 200, { ok: true, service: "bim-agent-console" });
    }
    if (url.pathname === "/api/status") {
      const config = await readJson(configPath);
      const bridgePort = parsePort(String(config?.Port ?? process.env.BIM_PERSONAL_AGENT_PORT ?? "9686"), 9686);
      return sendJson(response, 200, {
        bridgeConnected: await canConnect("localhost", bridgePort),
        bridgePort,
        configVersion: config?.ConfigVersion ?? null,
        updatedAtUtc: new Date().toISOString(),
      });
    }
    if (url.pathname === "/api/events") {
      const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "200", 10) || 200, 1000));
      const events = await readEvents(limit);
      return sendJson(response, 200, { events: events.reverse(), count: events.length });
    }
    const asset = assets.get(url.pathname);
    if (!asset) {
      return sendJson(response, 404, { error: "NOT_FOUND" });
    }
    const [name, contentType] = asset;
    const body = await readFile(resolve(root, name));
    sendHeaders(response, 200, contentType);
    response.end(body);
  } catch (error) {
    sendJson(response, 500, { error: "CONSOLE_ERROR", message: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`BIM Agent Console http://${host}:${port}`);
});

process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());

async function readEvents(limit) {
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
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
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

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value || String(fallback), 10);
  return Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : fallback;
}
