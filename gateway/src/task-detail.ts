import { createHash } from "node:crypto";
import { adaptExecutionDomain } from "./domain-adapters.js";
import type {
  JsonObject,
  TaskErrorLayer,
  TaskExecutionDetail,
  TaskExecutionStatus,
  TaskInputParameter,
  TaskModelIdentity,
  TaskRequiredClaim,
  TaskStageTrace,
  TaskVerificationClaim,
  TaskVerificationDetail,
  TaskVerificationStatus,
  ToolRisk,
} from "./types.js";

const credentialKey = /(api[-_]?key|access[-_]?token|refresh[-_]?token|password|passwd|secret|authorization|bearer|cookie|credential)/i;
const publicPrivateKey = /^(user(name)?|account|email|prompt|rawPrompt|codexUsage|mcpSchema|toolSchema|inputSchema)$/i;
const sourceKey = /^(sourceCode|commandSource|csharpSource|typescriptSource)$/i;

export interface TaskExecutionDetailInput {
  taskId: string;
  requestId: string;
  publicTool: string;
  toolId: string;
  version?: string;
  risk?: ToolRisk;
  startedAtUtc: string;
  durationMs: number;
  executionStatus: TaskExecutionStatus;
  verificationStatus: TaskVerificationStatus;
  input: JsonObject;
  inputParameters?: Record<string, TaskInputParameter>;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
  errorStack?: string;
  errorLayer?: TaskErrorLayer;
  stageTrace?: TaskStageTrace[];
}

export interface DeveloperTrace {
  schemaVersion: 1;
  taskId: string;
  requestId: string;
  createdAtUtc: string;
  input: unknown;
  rawResult?: unknown;
  error?: { code?: string; message?: string; stack?: string; errorLayer?: TaskErrorLayer };
  fieldMappings: Array<{ source: string; target: string }>;
}

interface CountReadbackVerification {
  requiredClaim: TaskRequiredClaim;
  payload: JsonObject;
}

export function createTaskExecutionDetail(input: TaskExecutionDetailInput): TaskExecutionDetail {
  const completedAtUtc = new Date().toISOString();
  const safeInput = sanitizePublicPayload(normalizeToolInput(input.publicTool, input.input));
  const rawResult = sanitizePublicPayload(input.result);
  let adapted;
  let normalizationError: Error | undefined;
  try {
    adapted = adaptExecutionDomain({ toolId: input.toolId, publicTool: input.publicTool, rawResult });
  } catch (error) {
    normalizationError = error instanceof Error ? error : new Error(String(error));
    adapted = adaptExecutionDomain({ toolId: "generic:fallback", publicTool: input.publicTool, rawResult });
  }
  const countReadback = inferCountReadbackVerification(input.result);
  const requiredClaims = mergeRequiredClaims(
    adapted.requiredClaims,
    requestedClaims(input.input),
    countReadback ? [countReadback.requiredClaim] : [],
  );
  const verification = extractVerification(input.result, requiredClaims, input.requestId, completedAtUtc, countReadback);
  const changes = extractChanges(rawResult, input.risk);
  const modelAfter = extractModelIdentity(findValueDeep(rawResult, ["modelAfter", "ModelAfter"]) ?? rawResult, completedAtUtc);
  const modelBefore = extractModelIdentity(findValueDeep(rawResult, ["modelBefore", "ModelBefore"]), input.startedAtUtc);
  const effectiveErrorLayer = normalizationError
    ? "result_normalization"
    : input.errorLayer ?? classifyErrorLayer(input.errorCode, input.errorMessage);
  const error = normalizationError
    ? explainError("RESULT_NORMALIZATION_FAILED", normalizationError.message, effectiveErrorLayer)
    : input.errorCode
      ? explainError(input.errorCode, input.errorMessage || input.errorCode, effectiveErrorLayer)
      : undefined;
  const status = deriveStatus(input.executionStatus, verification, changes.rolledBack, error);
  const source = findSource(input.input);
  return {
    schemaVersion: 3,
    taskId: input.taskId,
    requestId: input.requestId,
    runId: readStringDeep(input.input, "runId"),
    tool: {
      toolId: input.toolId,
      publicTool: input.publicTool,
      name: readStringDeep(input.input, "name"),
      kind: toolKind(input.publicTool, input.toolId),
      version: input.version,
      sourceHash: source ? sha256(source) : readStringDeep(rawResult, "sourceHash"),
      risk: input.risk,
    },
    domain: adapted.domain,
    domainSchemaVersion: adapted.domainSchemaVersion,
    domainData: sanitizePublicPayload(adapted.domainData) as JsonObject,
    startedAtUtc: input.startedAtUtc,
    completedAtUtc,
    durationMs: input.durationMs,
    executionStatus: input.executionStatus,
    verificationStatus: toLegacyVerificationStatus(verification),
    status,
    input: safeInput,
    inputOrigins: sanitizePublicPayload(input.inputParameters ?? {}) as Record<string, TaskInputParameter>,
    rawResult,
    normalizedResult: sanitizePublicPayload(adapted.normalizedResult) as TaskExecutionDetail["normalizedResult"],
    modelBefore,
    modelAfter,
    changes,
    lineage: adapted.lineage,
    verification,
    stageTrace: input.stageTrace ?? defaultStageTrace(input, completedAtUtc, effectiveErrorLayer, changes, verification),
    warnings: extractWarnings(rawResult),
    error,
    developerTraceRef: developerTraceEnabled(input.input) ? `${input.taskId}/${input.requestId}.json` : undefined,
    generatedAtUtc: completedAtUtc,
  };
}

export function createDeveloperTrace(input: TaskExecutionDetailInput, detail: TaskExecutionDetail): DeveloperTrace | undefined {
  if (!developerTraceEnabled(input.input)) return undefined;
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    requestId: input.requestId,
    createdAtUtc: detail.generatedAtUtc,
    input: sanitizeCredentialsOnly(input.input),
    rawResult: sanitizeCredentialsOnly(input.result),
    error: input.errorCode || input.errorMessage || input.errorStack ? {
      code: input.errorCode,
      message: input.errorMessage,
      stack: input.errorStack,
      errorLayer: detail.error?.errorLayer,
    } : undefined,
    fieldMappings: detail.normalizedResult.fieldMappings,
  };
}

export function sanitizePublicPayload(value: unknown, key = "", depth = 0): unknown {
  if (credentialKey.test(key)) return { redacted: true, reason: "credential_omitted" };
  if (publicPrivateKey.test(key)) return { redacted: true, reason: "private_or_schema_field" };
  if (sourceKey.test(key)) return { redacted: true, reason: "source_code_omitted" };
  if (/^source$/i.test(key) && looksLikeSourceCode(value)) return { redacted: true, reason: "source_code_omitted" };
  if (typeof value === "string" && /^[a-z]:\\/i.test(value)) return { redacted: true, reason: "local_path_omitted" };
  if (depth > 40) return { truncated: true, reason: "maximum_depth" };
  if (Array.isArray(value)) return value.map((item) => sanitizePublicPayload(item, "", depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject).map(([childKey, child]) => [
    childKey,
    sanitizePublicPayload(child, childKey, depth + 1),
  ]));
}

function looksLikeSourceCode(value: unknown): boolean {
  return typeof value === "string" && /(public\s+(class|static)|using\s+Autodesk|namespace\s+|=>|\binterface\s+|\bimport\s+.*from\s+)/i.test(value);
}

export const sanitizeStoredPayload = sanitizePublicPayload;

function sanitizeCredentialsOnly(value: unknown, key = "", depth = 0): unknown {
  if (credentialKey.test(key)) return { redacted: true, reason: "credential_omitted" };
  if (depth > 60) return { truncated: true, reason: "maximum_depth" };
  if (Array.isArray(value)) return value.map((item) => sanitizeCredentialsOnly(item, "", depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject).map(([childKey, child]) => [
    childKey,
    sanitizeCredentialsOnly(child, childKey, depth + 1),
  ]));
}

function normalizeToolInput(publicTool: string, input: JsonObject): unknown {
  if (publicTool === "run_bim_tool") return {
    toolId: input.toolId,
    version: input.version,
    arguments: input.arguments ?? {},
    argumentOrigins: input.argumentOrigins,
    runId: input.runId,
    attempt: input.attempt,
    verificationChecks: input.verificationChecks,
  };
  if (publicTool === "execute_dynamic_csharp") {
    const manifest = objectValue(input.manifest);
    return {
      manifest: manifest ? {
        toolId: manifest.toolId,
        name: manifest.name,
        description: manifest.description,
        risk: manifest.risk,
        binding: manifest.binding,
      } : undefined,
      arguments: input.arguments ?? {},
      argumentOrigins: input.argumentOrigins,
      runId: input.runId,
      attempt: input.attempt,
      saveOnSuccess: input.saveOnSuccess,
      verificationChecks: input.verificationChecks,
    };
  }
  if (publicTool === "run_bim_plan") return {
    steps: Array.isArray(input.steps) ? input.steps.map((raw) => {
      const step = objectValue(raw);
      if (!step) return raw;
      const source = typeof step.source === "string" ? step.source : undefined;
      const manifest = objectValue(step.manifest);
      return {
        kind: step.kind,
        stepId: step.stepId,
        toolId: step.toolId,
        version: step.version,
        arguments: step.arguments ?? {},
        argumentOrigins: step.argumentOrigins,
        manifest: manifest ? {
          toolId: manifest.toolId,
          name: manifest.name,
          description: manifest.description,
          risk: manifest.risk,
          binding: manifest.binding,
        } : undefined,
        sourceHash: source ? sha256(source) : undefined,
      };
    }) : [],
    runId: input.runId,
    attempt: input.attempt,
    loopBudget: input.loopBudget,
    verificationChecks: input.verificationChecks,
  };
  const { taskId: _taskId, developerMode: _developerMode, ...rest } = input;
  return rest;
}

function extractVerification(
  rawResult: unknown,
  requiredClaims: TaskRequiredClaim[],
  requestId: string,
  completedAtUtc: string,
  countReadback?: CountReadbackVerification,
): TaskVerificationDetail {
  const payload = mergeVerificationPayload(findBestVerificationPayload(rawResult), countReadback?.payload);
  const rawChecks = readArrayByKeys(payload, "Checks", "checks") ?? [];
  const method = readStringByKeys(payload, "Method", "method", "VerificationMethod", "verificationMethod");
  const verificationRequestId = readStringByKeys(payload, "RequestId", "requestId") ?? (rawChecks.length ? requestId : undefined);
  const verifiedAtUtc = readStringByKeys(payload, "VerifiedAtUtc", "verifiedAtUtc", "TimestampUtc", "timestampUtc")
    ?? (rawChecks.length ? completedAtUtc : undefined);
  const claims = rawChecks.map((check, index) => normalizeClaim(check, index, method, verificationRequestId, verifiedAtUtc));
  const coveredClaims = requiredClaims
    .filter((required) => claims.some((claim) => claim.claimId === required.claimId && claim.status !== "not_checked"))
    .map((claim) => claim.claimId);
  const uncoveredClaims = requiredClaims.filter((claim) => claim.required && !coveredClaims.includes(claim.claimId)).map((claim) => claim.claimId);
  const scope = requiredClaims.length === 0 || claims.length === 0
    ? "none"
    : uncoveredClaims.length === 0
      ? "full"
      : "partial";
  return {
    requested: requiredClaims.length > 0,
    status: claims.some((claim) => claim.status === "failed")
      ? "failed"
      : scope === "full"
        ? "passed"
        : claims.length
          ? "insufficient_evidence"
          : requiredClaims.length
            ? "insufficient_evidence"
            : "not_requested",
    method,
    verifiedAtUtc,
    verificationRequestId,
    checkedElementCount: uniqueEvidenceElementCount(claims),
    passedCount: claims.filter((claim) => claim.status === "passed").length,
    failedCount: claims.filter((claim) => claim.status === "failed").length,
    verificationScope: scope,
    requiredClaims,
    claims,
    coveredClaims,
    uncoveredClaims,
    rawPayload: sanitizePublicPayload(payload),
  };
}

function normalizeClaim(
  value: unknown,
  index: number,
  method?: string,
  verificationId?: string,
  verifiedAtUtc?: string,
): TaskVerificationClaim {
  const raw = objectValue(value) ?? {};
  const claimId = readStringByKeys(raw, "ClaimId", "claimId", "CheckId", "checkId", "Id", "id") ?? `claim-${index + 1}`;
  const passed = readBooleanDeep(raw, "Passed", "passed");
  const elementIds = readNumberArrayDeep(raw, "ElementIds", "elementIds", "CreatedElementIds", "createdElementIds");
  const singleElementId = readNumberDeep(raw, "ElementId", "elementId", "CreatedElementId", "createdElementId");
  if (singleElementId !== undefined && !elementIds.includes(singleElementId)) elementIds.push(singleElementId);
  return {
    ...raw,
    claimId,
    target: readStringByKeys(raw, "Target", "target"),
    expected: findValueDeep(raw, ["Expected", "expected"]),
    actual: findValueDeep(raw, ["Actual", "actual"]),
    status: passed === true ? "passed" : passed === false ? "failed" : "not_checked",
    method: readStringByKeys(raw, "Method", "method") ?? method,
    verificationId: readStringByKeys(raw, "VerificationId", "verificationId") ?? verificationId,
    verifiedAtUtc,
    source: readStringByKeys(raw, "Source", "source"),
    evidenceRefs: [
      ...elementIds.map((id) => `element:${id}`),
      ...readStringArrayDeep(raw, "EvidenceRefs", "evidenceRefs"),
    ],
  };
}

function requestedClaims(input: JsonObject): TaskRequiredClaim[] {
  if (!Array.isArray(input.verificationChecks)) return [];
  return input.verificationChecks.flatMap((value) => {
    const check = objectValue(value);
    if (!check || typeof check.id !== "string") return [];
    return [{ claimId: check.id, description: typeof check.description === "string" ? check.description : check.id, required: true }];
  });
}

function mergeRequiredClaims(...groups: TaskRequiredClaim[][]): TaskRequiredClaim[] {
  const byId = new Map<string, TaskRequiredClaim>();
  for (const group of groups) for (const claim of group) byId.set(claim.claimId, claim);
  return [...byId.values()];
}

function extractModelIdentity(value: unknown, capturedAtUtc: string): TaskModelIdentity {
  const activeView = findObjectDeep(value, ["ActiveView", "activeView"]);
  const level = findObjectDeep(value, ["OwnerLevel", "ownerLevel", "Level", "level"]);
  const scopeElementIds = readNumberArrayDeep(value, "ScopeElementIds", "scopeElementIds", "ElementIds", "elementIds");
  return {
    projectName: readStringDeep(value, "ProjectName", "projectName", "DocumentTitle", "documentTitle", "project"),
    projectFingerprint: readStringDeep(value, "ProjectFingerprint", "projectFingerprint"),
    revitVersion: readStringDeep(value, "RevitVersion", "revitVersion"),
    activeView: readStringByKeys(activeView, "Name", "name") ?? readStringDeep(value, "ActiveViewName", "activeViewName", "ViewName", "viewName"),
    activeViewId: readNumberByKeys(activeView, "Id", "id") ?? readNumberDeep(value, "ActiveViewId", "activeViewId", "ViewId", "viewId"),
    level: readStringByKeys(level, "Name", "name") ?? readStringDeep(value, "LevelName", "levelName"),
    levelId: readNumberByKeys(level, "Id", "id") ?? readNumberDeep(value, "LevelId", "levelId"),
    capturedAtUtc,
    scopeElementIds,
    scopeHash: scopeElementIds.length ? sha256(scopeElementIds.slice().sort((a, b) => a - b).join(",")) : undefined,
  };
}

function extractChanges(result: unknown, risk?: ToolRisk) {
  const transactionName = readStringDeep(result, "TransactionName", "transactionName");
  const createdElementIds = readNumberArrayDeep(result, "ActualCreatedElementIds", "actualCreatedElementIds", "CreatedElementIds", "createdElementIds");
  const deletedElementIds = readNumberArrayDeep(result, "ActualDeletedElementIds", "actualDeletedElementIds", "DeletedElementIds", "deletedElementIds");
  const explicitModifiedElementIds = readNumberArrayDeep(result, "ActualModifiedElementIds", "actualModifiedElementIds", "ModifiedElementIds", "modifiedElementIds");
  const appliedCount = readNumberDeep(result, "AppliedCount", "appliedCount");
  const appliedElementIds = [...new Set(readNumberArrayDeep(result, "ElementIds", "elementIds"))];
  const canProjectAppliedElements = risk === "reversibleMutation"
    && Boolean(transactionName)
    && createdElementIds.length === 0
    && deletedElementIds.length === 0
    && Number.isInteger(appliedCount)
    && (appliedCount ?? 0) > 0
    && appliedElementIds.length === appliedCount;
  const modifiedElementIds = explicitModifiedElementIds.length
    ? explicitModifiedElementIds
    : canProjectAppliedElements ? appliedElementIds : [];
  const transactionStarted = readBooleanDeep(result, "TransactionStarted", "transactionStarted")
    ?? (transactionName ? true : risk === "readOnly" ? false : undefined);
  const explicitChanged = readBooleanDeep(result, "ModelChanged", "modelChanged");
  const modelChanged = explicitChanged ?? (createdElementIds.length + modifiedElementIds.length + deletedElementIds.length > 0
    ? true
    : risk === "readOnly" || transactionStarted === false ? false : undefined);
  return {
    transactionStarted,
    transactionName,
    createdElementIds,
    modifiedElementIds,
    deletedElementIds,
    modelChanged,
    rolledBack: readBooleanDeep(result, "RolledBack", "rolledBack"),
  };
}

function inferCountReadbackVerification(result: unknown): CountReadbackVerification | undefined {
  const appliedCount = readNumberDeep(result, "AppliedCount", "appliedCount");
  const verifiedCount = readNumberDeep(result, "VerifiedCount", "verifiedCount");
  const elementIds = [...new Set(readNumberArrayDeep(result, "ElementIds", "elementIds"))];
  if (!Number.isInteger(appliedCount) || !Number.isInteger(verifiedCount) || (appliedCount ?? 0) <= 0) return undefined;
  const passed = appliedCount === verifiedCount && elementIds.length === appliedCount;
  const claimId = "result.applied_elements_verified";
  return {
    requiredClaim: {
      claimId,
      description: "Every applied element was read back and verified",
      required: true,
    },
    payload: {
      Method: "tool_result_readback",
      Checks: [{
        CheckId: claimId,
        Passed: passed,
        Expected: appliedCount,
        Actual: verifiedCount,
        ElementIds: passed ? elementIds : [],
        Method: "tool_result_readback",
        Source: "tool_result",
      }],
    },
  };
}

function mergeVerificationPayload(reported?: JsonObject, countReadback?: JsonObject): JsonObject | undefined {
  if (!reported) return countReadback;
  if (!countReadback) return reported;
  return {
    ...reported,
    Checks: [
      ...(readArrayByKeys(reported, "Checks", "checks") ?? []),
      ...(readArrayByKeys(countReadback, "Checks", "checks") ?? []),
    ],
  };
}

function deriveStatus(
  executionStatus: TaskExecutionStatus,
  verification: TaskVerificationDetail,
  rolledBack: boolean | undefined,
  error?: TaskExecutionDetail["error"],
): TaskExecutionDetail["status"] {
  if (rolledBack) return "rolled_back";
  if (executionStatus === "failed" || executionStatus === "unknown" || (error && error.errorLayer !== "independent_verification")) return "execution_failed";
  if (verification.claims.some((claim) => claim.status === "failed")) return "verification_failed";
  if (verification.verificationScope === "full" && verification.uncoveredClaims.length === 0 && verification.requiredClaims.length > 0) return "verified";
  if (verification.claims.length > 0 || verification.verificationScope === "partial") return "completed_partially_verified";
  return "not_verified";
}

function classifyErrorLayer(code?: string, message?: string): TaskErrorLayer {
  const value = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  if (/client[_ -]?input|missing input|required input/.test(value)) return "client_input";
  if (/task[_ -]?understanding|agent[_ -]?resolution|could not resolve/.test(value)) return "agent_resolution";
  if (/schema|argument|validation/.test(value)) return "mcp_schema";
  if (/websocket|transport|socket|timeout|closed/.test(value)) return "websocket_transport";
  if (/transaction|rollback|commit/.test(value)) return "revit_transaction";
  if (/verification|claim|readback/.test(value)) return "independent_verification";
  if (/revit|command|compile|c#/.test(value)) return "revit_command";
  return "typescript_dispatch";
}

function explainError(code: string, technicalMessage: string, errorLayer: TaskErrorLayer) {
  const known: Record<string, [string, string]> = {
    insufficient_anchor_points: [
      "可用的座標參考點不足，無法證明整批結果符合定位條件。",
      "確認 CAD Block 名稱與參考點，補足至少三個分散且不共線的點後重新預覽。",
    ],
    REVIT_COMMAND_TIMEOUT_UNCERTAIN: [
      "Revit 在限制時間內沒有回覆，目前不能確定模型是否完成操作。",
      "先在 Revit 檢查模型與 Undo 紀錄，不要直接重試修改命令。",
    ],
  };
  const [engineeringMessage, suggestedAction] = known[code] ?? [
    "這次執行未產生可確認的工程結果。",
    "依錯誤層檢查輸入、傳輸、Revit Transaction 或驗證紀錄後再決定是否重試。",
  ];
  return { code, errorLayer, technicalMessage, engineeringMessage, suggestedAction };
}

function defaultStageTrace(
  input: TaskExecutionDetailInput,
  completedAtUtc: string,
  failedLayer: TaskErrorLayer,
  changes: ReturnType<typeof extractChanges>,
  verification: TaskVerificationDetail,
): TaskStageTrace[] {
  const stages: TaskStageTrace["stage"][] = ["client_input", "agent_resolution", "mcp_schema", "typescript_dispatch"];
  if (["run_bim_tool", "run_bim_plan", "execute_dynamic_csharp"].includes(input.publicTool)) {
    stages.push("websocket_transport", "revit_command", "revit_transaction", "result_normalization", "independent_verification", "persistence");
  }
  const failed = Boolean(input.errorCode);
  const failureIndex = stages.indexOf(failedLayer);
  return stages.map((stage) => {
    let status: TaskStageTrace["status"] = "not_observed";
    if (failed && stage === failedLayer) status = "failed";
    else if (failed && failureIndex >= 0 && stages.indexOf(stage) > failureIndex) status = "skipped";
    else if (stage === "mcp_schema" || stage === "typescript_dispatch") status = "completed";
    else if (["websocket_transport", "revit_command", "result_normalization"].includes(stage) && input.executionStatus === "succeeded") status = "completed";
    else if (stage === "revit_transaction") status = changes.transactionStarted === true ? "completed" : changes.transactionStarted === false ? "skipped" : "not_observed";
    else if (stage === "independent_verification") status = verification.claims.length ? "completed" : verification.requested ? "not_observed" : "skipped";
    else if (stage === "persistence") status = "pending";
    return {
      stage,
      status,
      startedAtUtc: status === "not_observed" || status === "skipped" || status === "pending" ? undefined : input.startedAtUtc,
      completedAtUtc: status === "completed" || status === "failed" ? completedAtUtc : undefined,
      durationMs: stage === "typescript_dispatch" ? input.durationMs : undefined,
      errorCode: failed && stage === failedLayer ? input.errorCode : undefined,
    };
  });
}

function toLegacyVerificationStatus(value: TaskVerificationDetail): TaskVerificationStatus {
  if (value.status === "passed") return "passed";
  if (value.status === "failed") return "failed";
  if (value.status === "insufficient_evidence") return "insufficient_evidence";
  return value.requested ? "pending" : "not_requested";
}

function developerTraceEnabled(input: JsonObject): boolean {
  return input.developerMode === true || process.env.BIM_AGENT_DEVELOPER_TRACE === "1";
}

function toolKind(publicTool: string, toolId: string): TaskExecutionDetail["tool"]["kind"] {
  if (publicTool === "run_bim_plan") return "plan";
  if (publicTool === "execute_dynamic_csharp" || toolId.startsWith("dynamic:")) return "dynamic";
  if (toolId.startsWith("saved:")) return "saved";
  if (toolId.startsWith("builtin:")) return "builtin";
  return "agent";
}

function extractWarnings(result: unknown): unknown[] {
  const warnings = findValueDeep(result, ["Warnings", "warnings"]);
  if (Array.isArray(warnings)) return warnings;
  if (warnings !== undefined && warnings !== null && warnings !== "") return [warnings];
  return [];
}

function findSource(input: JsonObject): string | undefined {
  if (typeof input.source === "string") return input.source;
  if (!Array.isArray(input.steps)) return undefined;
  const sources = input.steps.flatMap((step) => objectValue(step) && typeof objectValue(step)?.source === "string" ? [objectValue(step)?.source as string] : []);
  return sources.length ? sources.join("\n") : undefined;
}

function findBestVerificationPayload(value: unknown): JsonObject | undefined {
  const candidates: JsonObject[] = [];
  collectNamedObjects(value, "verification", candidates);
  collectNamedObjects(value, "Verification", candidates);
  return candidates.sort((left, right) => verificationPayloadScore(right) - verificationPayloadScore(left))[0];
}

function collectNamedObjects(value: unknown, targetKey: string, result: JsonObject[], depth = 0): void {
  if (!value || typeof value !== "object" || depth > 14) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNamedObjects(item, targetKey, result, depth + 1);
    return;
  }
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key.toLowerCase() === targetKey.toLowerCase() && child && typeof child === "object" && !Array.isArray(child)) result.push(child as JsonObject);
    collectNamedObjects(child, targetKey, result, depth + 1);
  }
}

function verificationPayloadScore(payload: JsonObject): number {
  const checks = readArrayByKeys(payload, "Checks", "checks") ?? [];
  return checks.length * 10 + Object.keys(payload).length;
}

function uniqueEvidenceElementCount(claims: TaskVerificationClaim[]): number | undefined {
  const ids = new Set(claims.flatMap((claim) => claim.evidenceRefs.filter((ref) => ref.startsWith("element:"))));
  return ids.size || undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function findObjectDeep(value: unknown, keys: string[]): JsonObject | undefined {
  return objectValue(findValueDeep(value, keys));
}

function findValueDeep(value: unknown, keys: string[], depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 12) return undefined;
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, child] of Object.entries(value as JsonObject)) if (normalized.has(key.toLowerCase())) return child;
  for (const child of Object.values(value as JsonObject)) {
    if (!child || typeof child !== "object") continue;
    const found = findValueDeep(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function readStringDeep(value: unknown, ...keys: string[]): string | undefined {
  const found = findValueDeep(value, keys);
  return typeof found === "string" && found.length > 0 ? found : undefined;
}

function readNumberDeep(value: unknown, ...keys: string[]): number | undefined {
  const found = findValueDeep(value, keys);
  return typeof found === "number" && Number.isFinite(found) ? found : undefined;
}

function readBooleanDeep(value: unknown, ...keys: string[]): boolean | undefined {
  const found = findValueDeep(value, keys);
  return typeof found === "boolean" ? found : undefined;
}

function readNumberArrayDeep(value: unknown, ...keys: string[]): number[] {
  const found = findValueDeep(value, keys);
  return Array.isArray(found) ? found.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function readStringArrayDeep(value: unknown, ...keys: string[]): string[] {
  const found = findValueDeep(value, keys);
  return Array.isArray(found) ? found.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}

function readStringByKeys(value: JsonObject | undefined, ...keys: string[]): string | undefined {
  if (!value) return undefined;
  for (const key of keys) if (typeof value[key] === "string" && value[key]) return value[key] as string;
  return undefined;
}

function readNumberByKeys(value: JsonObject | undefined, ...keys: string[]): number | undefined {
  if (!value) return undefined;
  for (const key of keys) if (typeof value[key] === "number" && Number.isFinite(value[key])) return value[key] as number;
  return undefined;
}

function readArrayByKeys(value: JsonObject | undefined, ...keys: string[]): unknown[] | undefined {
  if (!value) return undefined;
  for (const key of keys) if (Array.isArray(value[key])) return value[key] as unknown[];
  return undefined;
}
