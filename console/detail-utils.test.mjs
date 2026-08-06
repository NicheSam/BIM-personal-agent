import assert from "node:assert/strict";
import test from "node:test";
import { detailDiff, detailSection, sanitizeEvidenceView } from "./detail-utils.mjs";

test("result collections are paged instead of returned in full", () => {
  const detail = { result: { Candidates: Array.from({ length: 137 }, (_, index) => ({ candidateId: `DB-${index + 1}`, status: index % 2 ? "ready" : "review" })) } };
  const page = detailSection(detail, "result", { offset: 20, limit: 20 });
  assert.equal(page.collection.total, 137);
  assert.equal(page.collection.items.length, 20);
  assert.equal(page.collection.items[0].candidateId, "DB-21");
  assert.deepEqual(page.value.Candidates, { deferred: true, total: 137, path: "Candidates" });
});

test("summary keeps only the persisted engineering summary instead of inferring from the title", () => {
  const detail = { taskId: "task-1", requestId: "request-1", engineeringSummary: { candidateCount: 137 }, model: {}, changes: {} };
  const summary = detailSection(detail, "summary");
  assert.equal(summary.engineeringSummary.candidateCount, 137);
  assert.equal("title" in summary.engineeringSummary, false);
});

test("projects stored saved-tool count readback into legacy v3 summaries", () => {
  const elementIds = [13724629, 13724635, 13724665];
  const summary = detailSection({
    schemaVersion: 3,
    taskId: "task-legacy-count-readback",
    requestId: "request-legacy-count-readback",
    tool: { toolId: "saved:set-selected-active-view-style", kind: "saved", risk: "reversibleMutation" },
    status: "not_verified",
    verificationStatus: "not_requested",
    changes: { transactionName: "BIM Personal Agent: Set selected elements", createdElementIds: [], modifiedElementIds: [], deletedElementIds: [] },
    verification: { status: "not_requested", requiredClaims: [], claims: [], coveredClaims: [], uncoveredClaims: [] },
    rawResult: { Result: { AppliedCount: 3, VerifiedCount: 3, ElementIds: elementIds } },
  }, "summary");
  assert.deepEqual(summary.changes.modifiedElementIds, elementIds);
  assert.equal(summary.changes.modelChanged, true);
  assert.equal(summary.verification.status, "passed");
  assert.equal(summary.verification.checkedElementCount, elementIds.length);
  assert.equal(summary.verificationStatus, "passed");
  assert.equal(summary.status, "verified");
});

test("does not project stored saved-tool changes when count readback disagrees", () => {
  const summary = detailSection({
    schemaVersion: 3,
    taskId: "task-legacy-count-mismatch",
    requestId: "request-legacy-count-mismatch",
    tool: { toolId: "saved:set-selected-active-view-style", kind: "saved", risk: "reversibleMutation" },
    status: "not_verified",
    verificationStatus: "not_requested",
    changes: { transactionName: "BIM Personal Agent: Set selected elements", createdElementIds: [], modifiedElementIds: [], deletedElementIds: [] },
    verification: { status: "not_requested", requiredClaims: [], claims: [], coveredClaims: [], uncoveredClaims: [] },
    rawResult: { Result: { AppliedCount: 3, VerifiedCount: 2, ElementIds: [13724629, 13724635] } },
  }, "summary");
  assert.deepEqual(summary.changes.modifiedElementIds, []);
  assert.equal(summary.verification.status, "failed");
  assert.equal(summary.verificationStatus, "failed");
  assert.equal(summary.status, "verification_failed");
});

test("candidate query and status filters apply before pagination", () => {
  const detail = { result: { candidates: [{ candidateId: "DB-001", status: "ready" }, { candidateId: "DB-137", status: "review" }] } };
  const page = detailSection(detail, "result", { query: "137", status: "review", limit: 20 });
  assert.equal(page.collection.filteredTotal, 1);
  assert.equal(page.collection.items[0].candidateId, "DB-137");
});

test("nested plan results page the engineering candidates instead of the outer step list", () => {
  const detail = {
    result: {
      execution: {
        Results: [{ Data: { Result: { targetCandidates: Array.from({ length: 137 }, (_, index) => ({ candidateId: `DB-${index + 1}` })) } } }],
        Verification: { Checks: [{ id: "source-exists" }, { id: "view-exists" }] },
      },
    },
  };
  const page = detailSection(detail, "result", { offset: 120, limit: 20 });
  assert.equal(page.collection.path, "execution.Results.0.Data.Result.targetCandidates");
  assert.equal(page.collection.total, 137);
  assert.equal(page.collection.items.length, 17);
  assert.equal(page.collection.items[0].candidateId, "DB-121");
  assert.deepEqual(page.value.execution.Results[0].Data.Result.targetCandidates, {
    deferred: true,
    total: 137,
    path: "execution.Results.0.Data.Result.targetCandidates",
  });
});

test("result view separates three coordinate anchors from the paged candidate collection", () => {
  const detail = {
    schemaVersion: 3,
    domain: "dwg_block_family_placement",
    domainSchemaVersion: 1,
    domainData: {
      summary: { candidateCount: 137 },
      anchors: [
        { candidateId: "DB-001", residualMm: 0, toleranceMm: 1 },
        { candidateId: "DB-068", residualMm: 0, toleranceMm: 1 },
        { candidateId: "DB-137", residualMm: 0, toleranceMm: 1 },
      ],
      candidates: Array.from({ length: 137 }, (_, index) => ({ candidateId: `DB-${index + 1}`, status: "ready" })),
    },
    normalizedResult: { normalizerId: "dwg_block_family_placement", normalizerVersion: 1, value: {}, fieldMappings: [] },
    rawResult: {},
    lineage: { records: [], edges: [] },
  };
  const page = detailSection(detail, "result", { limit: 20 });
  assert.equal(page.domainView.tables[0].rows.length, 3);
  assert.equal(page.domainView.tables[0].rows[0].candidateId, "DB-001");
  assert.equal(page.collection.items.length, 20);
  assert.equal(page.collection.total, 137);
});

test("v3 input view keeps values separate from recorded origins", () => {
  const detail = {
    schemaVersion: 3,
    input: { arguments: { toleranceMm: 20 } },
    inputOrigins: { "arguments.toleranceMm": { origin: "user_provided", defaultValue: 10, unit: "mm" } },
  };
  const input = detailSection(detail, "input");
  assert.equal(input.input.arguments.toleranceMm, 20);
  assert.equal(input.inputOrigins["arguments.toleranceMm"].origin, "user_provided");
});

test("run diff reports input, model, claim, and developer trace changes", () => {
  const base = {
    schemaVersion: 3,
    taskId: "task",
    requestId: "base",
    tool: { toolId: "saved:test" },
    domain: "generic_revit_operation",
    domainSchemaVersion: 1,
    status: "completed_partially_verified",
    input: { arguments: { toleranceMm: 10 } },
    changes: { createdElementIds: [] },
    verification: { uncoveredClaims: ["placement.readback"] },
    developerTrace: { rawResult: { internal: "before" } },
  };
  const compare = {
    ...base,
    requestId: "compare",
    status: "verified",
    input: { arguments: { toleranceMm: 20 } },
    changes: { createdElementIds: [13727745] },
    verification: { uncoveredClaims: [] },
    developerTrace: { rawResult: { internal: "after" } },
  };
  const diff = detailDiff(base, compare, { includeRaw: true });
  assert.ok(diff.changes.some((change) => change.path === "input.arguments.toleranceMm"));
  assert.ok(diff.changes.some((change) => change.path === "changes.createdElementIds[0]"));
  assert.ok(diff.changes.some((change) => change.section === "developer"));
});

test("CandidateId and created ElementId both locate create and verify rows", () => {
  const detail = { result: { createVerifyResults: [
    { candidateId: "DB-001", createdElementId: 13727745, status: "verified" },
    { candidateId: "DB-002", createdElementId: 13727746, status: "failed" },
  ] } };
  assert.equal(detailSection(detail, "result", { query: "DB-001" }).collection.filteredTotal, 1);
  assert.equal(detailSection(detail, "result", { query: "13727746" }).collection.items[0].candidateId, "DB-002");
  assert.equal(detailSection(detail, "result", { status: "failed" }).collection.filteredTotal, 1);
});

test("evidence mode hides local identity but preserves engineering evidence", () => {
  const safe = sanitizeEvidenceView({
    userName: "User",
    localPath: "C:\\Users\\User\\model.rvt",
    projectFingerprint: "7bde954c12345678",
    projectName: "Waterfront",
    elementId: 13727745,
    tokenUsage: 1000,
  });
  assert.deepEqual(safe.userName, { redacted: true, reason: "evidence_mode" });
  assert.deepEqual(safe.localPath, { redacted: true, reason: "evidence_mode" });
  assert.equal(safe.projectFingerprint, "7bde954c12345678");
  assert.equal(safe.projectName, "Waterfront");
  assert.equal(safe.elementId, 13727745);
  assert.deepEqual(safe.tokenUsage, { redacted: true, reason: "evidence_mode" });
});

test("evidence mode preserves source hashes while removing prompts, schemas, source, and credentials", () => {
  const safe = sanitizeEvidenceView({
    sourceHash: "a".repeat(64),
    source: "public class Command {}",
    verificationSource: "Independent Revit API readback",
    prompt: "create elements",
    mcpSchema: { type: "object" },
    cookie: "session=secret",
    linkedDwg: "B1F消防撒水.dwg",
    candidateId: "DB-001",
  });
  assert.equal(safe.sourceHash, "a".repeat(64));
  assert.equal(safe.linkedDwg, "B1F消防撒水.dwg");
  assert.equal(safe.candidateId, "DB-001");
  assert.equal(safe.verificationSource, "Independent Revit API readback");
  for (const key of ["source", "prompt", "mcpSchema", "cookie"]) {
    assert.deepEqual(safe[key], { redacted: true, reason: "evidence_mode" });
  }
});
