import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTaskExecutionDetail } from "../build/task-detail.js";
import { detailDiff } from "../../console/detail-utils.mjs";

const root = resolve(import.meta.dirname, "..", "..");
const fixtureRoot = resolve(root, "tests", "fixtures", "task-detail");
const outputRoot = resolve(root, "docs", "examples", "task-detail-v3");
const reviewHome = resolve(root, "output", "console-v3-review");
const fixtureNames = {
  success: "issue-100-success.json",
  partial: "issue-100-preview.json",
  verificationFailed: "create-verify.json",
  executionFailed: "issue-100-execution-failed.json",
};

await mkdir(outputRoot, { recursive: true });
const envelopes = {};
for (const [name, fixtureName] of Object.entries(fixtureNames)) {
  const input = JSON.parse(await readFile(resolve(fixtureRoot, fixtureName), "utf8"));
  const envelope = createTaskExecutionDetail(input);
  envelopes[name] = envelope;
  await writeFile(resolve(outputRoot, `${name}.json`), `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}
const diff = detailDiff(envelopes.partial, envelopes.success);
await writeFile(resolve(outputRoot, "partial-to-success.diff.json"), `${JSON.stringify(diff, null, 2)}\n`, "utf8");
await rm(reviewHome, { recursive: true, force: true });
const reviewTaskId = envelopes.success.taskId;
const reviewDetailRoot = resolve(reviewHome, "tasks", reviewTaskId, "details");
await mkdir(reviewDetailRoot, { recursive: true });
envelopes.partial.domainData.candidates = Array.from({ length: 137 }, (_, index) => ({
  candidateId: `DB-${String(index + 1).padStart(3, "0")}`,
  status: index % 17 === 0 ? "review_required" : "ready",
}));
for (const envelope of Object.values(envelopes)) {
  await writeFile(resolve(reviewDetailRoot, `${envelope.requestId}.json`), `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}
await writeFile(resolve(reviewHome, "tasks", reviewTaskId, "summary.json"), `${JSON.stringify({
  schemaVersion: 2,
  taskId: reviewTaskId,
  title: "Issue 100 execution envelope review",
  createdAtUtc: envelopes.partial.startedAtUtc,
  updatedAtUtc: envelopes.success.completedAtUtc,
  firstRequestId: envelopes.partial.requestId,
  lastRequestId: envelopes.success.requestId,
  phase: "completed",
  executionStatus: "succeeded",
  verificationStatus: "passed",
  engineeringStatus: "verified",
  eventCount: 0,
  detailCount: Object.keys(envelopes).length,
  toolIds: [...new Set(Object.values(envelopes).map((envelope) => envelope.tool.toolId))],
}, null, 2)}\n`, "utf8");
process.stdout.write(`${outputRoot}\n${reviewHome}\n`);
