import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createDeveloperTrace, createTaskExecutionDetail, sanitizePublicPayload } from "./task-detail.js";
import type { TaskExecutionDetailInput } from "./task-detail.js";

const startedAtUtc = "2026-08-05T01:00:00.000Z";

function previewInput(overrides: Partial<TaskExecutionDetailInput> = {}): TaskExecutionDetailInput {
  return {
    taskId: "10000000-0000-4000-8000-000000000001",
    requestId: "preview-request",
    publicTool: "run_bim_tool",
    toolId: "saved:dwg-block-family-preview",
    version: "1.2.0",
    risk: "readOnly",
    startedAtUtc,
    durationMs: 320,
    executionStatus: "succeeded",
    verificationStatus: "passed",
    input: {
      toolId: "saved:dwg-block-family-preview",
      arguments: { importInstanceId: 13719035, duplicateToleranceMm: 10 },
      verificationChecks: [
        { id: "source.reference.exists", description: "DWG reference exists" },
        { id: "preview.candidate_count.reported", description: "Candidate count is reported" },
        { id: "coordinate.anchors.within_tolerance", description: "Anchors are within tolerance" },
      ],
    },
    inputParameters: {
      "arguments.importInstanceId": { origin: "agent_resolved" },
      "arguments.duplicateToleranceMm": { origin: "default", defaultValue: 10, unit: "mm" },
    },
    result: {
      targetDwgTypeName: "B1F fire sprinkler.dwg",
      importInstanceId: 13719035,
      targetBlockName: "B1F fire sprinkler.dwg.bt11_10",
      requestedBlockCount: 137,
      anchorMaxResidualMm: 0,
      anchorAverageResidualMm: 0,
      anchorResidualToleranceMm: 1,
      anchors: [
        { candidateId: "ANCHOR-A", residualMm: 0, status: "passed" },
        { candidateId: "ANCHOR-B", residualMm: 0, status: "passed" },
        { candidateId: "ANCHOR-C", residualMm: 0, status: "passed" },
      ],
      ModelAfter: { ProjectName: "Coordination", ProjectFingerprint: "project-sha", RevitVersion: "2024", ActiveViewName: "B1F", ActiveViewId: 11061843 },
      TransactionStarted: false,
      ModelChanged: false,
      Verification: {
        Method: "result_assertion",
        Checks: [
          { CheckId: "source.reference.exists", Passed: true, Actual: 13719035 },
          { CheckId: "preview.candidate_count.reported", Passed: true, Actual: 137 },
          { CheckId: "coordinate.anchors.within_tolerance", Passed: true, Actual: 0, Expected: "<= 1 mm" },
        ],
      },
    },
    ...overrides,
  };
}

test("creates a generic v3 envelope while isolating Issue 100 data in domainData", () => {
  const detail = createTaskExecutionDetail(previewInput());
  assert.equal(detail.schemaVersion, 3);
  assert.equal(detail.tool.toolId, "saved:dwg-block-family-preview");
  assert.equal(detail.domain, "dwg_block_family_placement");
  assert.equal((detail.domainData.summary as Record<string, unknown>).candidateCount, 137);
  assert.equal((detail.domainData.anchors as unknown[]).length, 3);
  assert.equal(detail.inputOrigins["arguments.importInstanceId"].origin, "agent_resolved");
  assert.equal(detail.inputOrigins["arguments.duplicateToleranceMm"].origin, "default");
  assert.equal(detail.rawResult && typeof detail.rawResult, "object");
  assert.equal(detail.normalizedResult.normalizerId, "dwg_block_family_placement");
  assert.equal(detail.status, "verified");
  assert.equal(detail.verification.verificationScope, "full");
});

test("does not call a result assertion an independent Revit readback", () => {
  const detail = createTaskExecutionDetail(previewInput());
  assert.equal(detail.verification.claims[1].method, "result_assertion");
  assert.equal(detail.verification.claims[1].status, "passed");
});

test("marks a completed run partially verified when required claims are uncovered", () => {
  const input = previewInput();
  input.result = {
    ...(input.result as object),
    Verification: { Method: "reference_existence", Checks: [{ CheckId: "source.reference.exists", Passed: true }] },
  };
  const detail = createTaskExecutionDetail(input);
  assert.equal(detail.status, "completed_partially_verified");
  assert.equal(detail.verification.verificationScope, "partial");
  assert.deepEqual(detail.verification.uncoveredClaims.sort(), ["coordinate.anchors.within_tolerance", "preview.candidate_count.reported"]);
});

test("records model changes, lineage, rollback and an explicit error layer", () => {
  const detail = createTaskExecutionDetail(previewInput({
    executionStatus: "failed",
    errorCode: "REVIT_TRANSACTION_FAILED",
    errorMessage: "Transaction was rolled back.",
    result: {
      createVerifyResults: [{ candidateId: "DB-001", operationId: "op-1", createdElementId: 13727745, verificationId: "verify-1", status: "failed" }],
      CreatedElementIds: [13727745],
      ModifiedElementIds: [13727746],
      TransactionStarted: true,
      TransactionName: "Place families",
      RolledBack: true,
    },
  }));
  assert.equal(detail.status, "rolled_back");
  assert.equal(detail.error?.errorLayer, "revit_transaction");
  assert.deepEqual(detail.changes.modifiedElementIds, [13727746]);
  assert.equal(detail.lineage.records[0].candidateId, "DB-001");
  assert.ok(detail.lineage.edges.some((edge) => edge.relation === "verified_by"));
});

test("projects saved-tool applied and verified counts into model changes and verification", () => {
  const elementIds = [13724629, 13724635, 13724665];
  const detail = createTaskExecutionDetail(previewInput({
    toolId: "saved:set-selected-active-view-style",
    version: "1.0.1",
    risk: "reversibleMutation",
    verificationStatus: "not_requested",
    input: {
      toolId: "saved:set-selected-active-view-style",
      arguments: { red: 255, green: 0, blue: 255, transparency: 0 },
    },
    result: {
      TransactionName: "BIM Personal Agent: Set selected elements to a verified active-view color and transparency",
      ActualCreatedElementIds: [],
      ActualDeletedElementIds: [],
      Result: {
        ViewId: 13717166,
        ViewName: "SC test view",
        AppliedCount: elementIds.length,
        VerifiedCount: elementIds.length,
        ElementIds: elementIds,
      },
    },
  }));
  assert.deepEqual(detail.changes.modifiedElementIds, elementIds);
  assert.equal(detail.changes.modelChanged, true);
  assert.equal(detail.verification.status, "passed");
  assert.equal(detail.verification.checkedElementCount, elementIds.length);
  assert.equal(detail.verificationStatus, "passed");
  assert.equal(detail.status, "verified");
});

test("does not overstate saved-tool scope when applied, verified, and element counts disagree", () => {
  const detail = createTaskExecutionDetail(previewInput({
    toolId: "saved:set-selected-active-view-style",
    risk: "reversibleMutation",
    verificationStatus: "not_requested",
    input: { toolId: "saved:set-selected-active-view-style", arguments: {} },
    result: {
      TransactionName: "BIM Personal Agent: Set selected elements",
      Result: {
        AppliedCount: 3,
        VerifiedCount: 2,
        ElementIds: [13724629, 13724635],
      },
    },
  }));
  assert.deepEqual(detail.changes.modifiedElementIds, []);
  assert.equal(detail.changes.modelChanged, undefined);
  assert.equal(detail.verification.status, "failed");
  assert.equal(detail.verificationStatus, "failed");
  assert.equal(detail.status, "verification_failed");
});


test("adapts built-in element context inspection into an Element Lens domain", () => {
  const detail = createTaskExecutionDetail(previewInput({
    toolId: "builtin:inspect_element_context",
    version: "bim-agent-element-context-v1",
    risk: "readOnly",
    verificationStatus: "not_requested",
    input: { toolId: "builtin:inspect_element_context", arguments: { detail: "full", maxParameters: 10 } },
    result: {
      SchemaVersion: "bim-agent.element-context.v1",
      Status: "ok",
      AgentSummary: {
        ElementId: 13724629,
        Name: "Pipe A",
        Category: "Pipes",
        TypeName: "PVC",
        ParameterCount: 12,
        WritableParameterCount: 4,
      },
      Parameters: { TotalCount: 10, Records: [{ Name: "Mark", ValueDisplay: "P-1" }] },
      TypeParameters: { TotalCount: 2, Records: [{ Name: "Diameter", ValueDisplay: "100 mm" }] },
      Relationships: [{ Relation: "type", ElementId: 123, Name: "PVC" }],
    },
  }));
  assert.equal(detail.domain, "element_context");
  assert.equal((detail.domainData.summary as Record<string, unknown>).ElementId, 13724629);
  assert.equal(((detail.domainData.parameters as Record<string, unknown>).Records as unknown[]).length, 1);
  assert.equal(detail.normalizedResult.normalizerId, "element_context");
  assert.equal(detail.lineage.records[0].elementId, 13724629);
});

test("public persistence removes private payloads while developer trace retains diagnostics", () => {
  const input = previewInput({
    input: { ...previewInput().input, developerMode: true, prompt: "private", apiKey: "secret", source: "public class Command {}" },
    result: { localPath: "C:\\Users\\User\\private.json", rawPrompt: "private", accessToken: "secret", value: 42 },
    errorCode: "REVIT_COMMAND_FAILED",
    errorMessage: "failed",
    errorStack: "stack trace",
  });
  const detail = createTaskExecutionDetail(input);
  const trace = createDeveloperTrace(input, detail);
  assert.deepEqual((detail.rawResult as Record<string, unknown>).localPath, { redacted: true, reason: "local_path_omitted" });
  assert.deepEqual((detail.rawResult as Record<string, unknown>).rawPrompt, { redacted: true, reason: "private_or_schema_field" });
  assert.equal((trace?.input as Record<string, unknown>).prompt, "private");
  assert.deepEqual((trace?.input as Record<string, unknown>).apiKey, { redacted: true, reason: "credential_omitted" });
  assert.equal(trace?.error?.stack, "stack trace");
});

test("public sanitizer never exposes credentials or absolute local paths", () => {
  assert.deepEqual(sanitizePublicPayload({ password: "x", path: "C:\\Users\\User\\x.txt" }), {
    password: { redacted: true, reason: "credential_omitted" },
    path: { redacted: true, reason: "local_path_omitted" },
  });
});

test("Issue 100 fixtures cover success, partial verification, readback failure, and execution failure", async () => {
  const load = async (name: string) => JSON.parse(await readFile(resolve("..", "tests", "fixtures", "task-detail", name), "utf8")) as TaskExecutionDetailInput;
  const success = createTaskExecutionDetail(await load("issue-100-success.json"));
  const partial = createTaskExecutionDetail(await load("issue-100-preview.json"));
  const readbackFailure = createTaskExecutionDetail(await load("create-verify.json"));
  const executionFailure = createTaskExecutionDetail(await load("issue-100-execution-failed.json"));
  assert.equal(success.status, "verified");
  assert.equal(partial.status, "completed_partially_verified");
  assert.equal(readbackFailure.status, "verification_failed");
  assert.equal(executionFailure.status, "execution_failed");
  assert.equal(executionFailure.error?.errorLayer, "revit_command");
});
