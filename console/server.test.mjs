import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

test("Console serves v3 details, paging, evidence masking, health metadata, and run diff", async () => {
  const home = await mkdtemp(join(tmpdir(), "bpa-console-v3-"));
  const taskId = "95855e7e-d6d0-4d84-bc01-968ded9446e0";
  const detailRoot = join(home, "tasks", taskId, "details");
  await mkdir(detailRoot, { recursive: true });
  const exampleRoot = resolve(dirname(new URL(import.meta.url).pathname.slice(1)), "..", "docs", "examples", "task-detail-v3");
  const base = JSON.parse(await readFile(join(exampleRoot, "partial.json"), "utf8"));
  const compare = JSON.parse(await readFile(join(exampleRoot, "success.json"), "utf8"));
  base.domainData.candidates = Array.from({ length: 45 }, (_, index) => ({ candidateId: `DB-${String(index + 1).padStart(3, "0")}`, status: index === 44 ? "review_required" : "ready" }));
  await writeFile(join(detailRoot, `${base.requestId}.json`), JSON.stringify(base), "utf8");
  await writeFile(join(detailRoot, `${compare.requestId}.json`), JSON.stringify(compare), "utf8");
  await writeFile(join(home, "tasks", taskId, "summary.json"), JSON.stringify({
    schemaVersion: 2,
    taskId,
    title: "Issue 100 fixture",
    createdAtUtc: base.startedAtUtc,
    updatedAtUtc: compare.completedAtUtc,
    firstRequestId: base.requestId,
    lastRequestId: compare.requestId,
    phase: "completed",
    executionStatus: "succeeded",
    verificationStatus: "passed",
    engineeringStatus: "verified",
    eventCount: 0,
    detailCount: 2,
    toolIds: [base.tool.toolId],
  }), "utf8");

  const port = await freePort();
  const child = spawn(process.execPath, [resolve(dirname(new URL(import.meta.url).pathname.slice(1)), "server.mjs")], {
    env: { ...process.env, BIM_PERSONAL_AGENT_HOME: home, BIM_AGENT_CONSOLE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForServer(child, port);
    const health = await getJson(port, "/health");
    assert.equal(health.ok, true);
    assert.equal(typeof health.buildId, "string");

    const list = await getJson(port, `/api/tasks/${taskId}/details`);
    assert.equal(list.count, 2);
    assert.ok(list.details.every((detail) => detail.schemaVersion === 3));

    const page = await getJson(port, `/api/tasks/${taskId}/details/${base.requestId}?section=result&limit=20&offset=20`);
    assert.equal(page.detail.collection.total, 45);
    assert.equal(page.detail.collection.items.length, 20);
    assert.equal(page.detail.collection.items[0].candidateId, "DB-021");

    const filtered = await getJson(port, `/api/tasks/${taskId}/details/${base.requestId}?section=result&query=DB-045&status=review_required`);
    assert.equal(filtered.detail.collection.filteredTotal, 1);

    const evidence = await getJson(port, `/api/tasks/${taskId}/details/${base.requestId}?section=raw&evidence=1`);
    assert.equal(evidence.detail.domainData.summary.linkedDwg, "B1F消防撒水.dwg");

    const diff = await getJson(port, `/api/tasks/${taskId}/diff?base=${base.requestId}&compare=${compare.requestId}`);
    assert.ok(diff.diff.changeCount > 0);

    const developerResponse = await fetch(`http://127.0.0.1:${port}/api/tasks/${taskId}/details/${base.requestId}?section=raw&developer=1`);
    assert.equal(developerResponse.status, 403);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolveExit) => setTimeout(resolveExit, 1_000))]);
    await rm(home, { recursive: true, force: true });
  }
});

async function freePort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  server.close();
  await once(server, "close");
  return port;
}

async function waitForServer(child, port) {
  let errorText = "";
  child.stderr.on("data", (chunk) => { errorText += chunk.toString(); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Console exited early: ${errorText}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Console did not start: ${errorText}`);
}

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  assert.equal(response.ok, true, `${path} returned ${response.status}`);
  return response.json();
}
