import { renderDomain } from "./domain-renderers.mjs";

const evidenceKey = /^(user(name)?|account|email|.*token.*|api[-_]?key|password|secret|authorization|cookie|credential|localPath|filePath|sourceCode|commandSource|csharpSource|typescriptSource|prompt|rawPrompt|mcpSchema|toolSchema|inputSchema|codexUsage|developerTraceRef|stack)$/i;
const collectionKey = /(candidates?|placements?|items?|rows?|records?|results?|claims?|checks?)/i;

export function detailListItem(detail) {
  detail = projectStoredCountReadback(detail);
  if (detail.schemaVersion === 3) {
    return {
      schemaVersion: 3,
      taskId: detail.taskId,
      requestId: detail.requestId,
      runId: detail.runId,
      toolId: detail.tool?.toolId,
      publicTool: detail.tool?.publicTool,
      toolKind: detail.tool?.kind,
      version: detail.tool?.version,
      sourceHash: detail.tool?.sourceHash,
      risk: detail.tool?.risk,
      domain: detail.domain,
      domainSchemaVersion: detail.domainSchemaVersion,
      startedAtUtc: detail.startedAtUtc,
      completedAtUtc: detail.completedAtUtc,
      durationMs: detail.durationMs,
      executionStatus: detail.executionStatus,
      verificationStatus: detail.verificationStatus,
      status: detail.status,
      engineeringStatus: detail.status,
      warningCount: Array.isArray(detail.warnings) ? detail.warnings.length : 0,
      model: detail.modelAfter || {},
      changes: detail.changes || {},
      error: detail.error,
      developerTraceAvailable: Boolean(detail.developerTraceRef),
    };
  }
  return {
    schemaVersion: detail.schemaVersion,
    taskId: detail.taskId,
    requestId: detail.requestId,
    runId: detail.runId,
    toolId: detail.toolId,
    publicTool: detail.publicTool,
    toolKind: detail.toolKind,
    version: detail.version,
    sourceHash: detail.sourceHash,
    risk: detail.risk,
    startedAtUtc: detail.startedAtUtc,
    completedAtUtc: detail.completedAtUtc,
    durationMs: detail.durationMs,
    executionStatus: detail.executionStatus,
    verificationStatus: detail.verificationStatus,
    status: detail.engineeringStatus,
    engineeringStatus: detail.engineeringStatus,
    warningCount: Array.isArray(detail.warnings) ? detail.warnings.length : 0,
    engineeringSummary: detail.engineeringSummary || {},
    model: detail.model,
    changes: detail.changes,
    error: detail.error,
  };
}

export function detailSection(detail, section, options = {}) {
  detail = projectStoredCountReadback(detail);
  if (detail.schemaVersion !== 3) return legacyDetailSection(detail, section, options);
  const offset = clampInteger(options.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInteger(options.limit, 1, 100, 20);
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
  const status = typeof options.status === "string" ? options.status.trim().toLowerCase() : "";
  let payload;
  if (section === "summary") {
    payload = {
      ...detailListItem(detail),
      modelBefore: detail.modelBefore,
      modelAfter: detail.modelAfter,
      changes: detail.changes,
      verification: verificationSummary(detail.verification),
      lineageCount: detail.lineage?.records?.length || 0,
      stageTrace: detail.stageTrace,
      domainView: renderDomain(detail),
    };
  } else if (section === "input") {
    payload = { input: detail.input, inputOrigins: detail.inputOrigins || {} };
  } else if (section === "verification") {
    payload = paginateCollection(detail.verification, offset, limit, ["claims"], query, status);
  } else if (section === "raw") {
    payload = detail;
  } else {
    const resultView = {
      rawResult: detail.rawResult,
      normalizedResult: detail.normalizedResult,
      domainData: detail.domainData,
      lineage: detail.lineage,
    };
    payload = paginateCollection(resultView, offset, limit, undefined, query, status);
    payload.domainView = renderDomain(detail);
  }
  return options.evidence === true ? sanitizeEvidenceView(payload) : payload;
}

function projectStoredCountReadback(detail) {
  if (detail?.schemaVersion !== 3) return detail;
  const toolId = detail.tool?.toolId || "";
  if (detail.tool?.kind !== "saved" && !String(toolId).startsWith("saved:")) return detail;
  const appliedCount = readFiniteNumberDeep(detail.rawResult, "AppliedCount", "appliedCount");
  const verifiedCount = readFiniteNumberDeep(detail.rawResult, "VerifiedCount", "verifiedCount");
  if (!Number.isInteger(appliedCount) || !Number.isInteger(verifiedCount) || appliedCount <= 0) return detail;
  const elementIds = [...new Set(readNumberArrayDeep(detail.rawResult, "ElementIds", "elementIds"))];
  const passed = appliedCount === verifiedCount && elementIds.length === appliedCount;
  const claimId = "result.applied_elements_verified";
  const verification = {
    ...(detail.verification || {}),
    requested: true,
    status: passed ? "passed" : "failed",
    method: "tool_result_readback",
    checkedElementCount: passed ? elementIds.length : undefined,
    passedCount: passed ? 1 : 0,
    failedCount: passed ? 0 : 1,
    verificationScope: "full",
    requiredClaims: [{ claimId, description: "Every applied element was read back and verified", required: true }],
    claims: [{
      claimId,
      expected: appliedCount,
      actual: verifiedCount,
      status: passed ? "passed" : "failed",
      method: "tool_result_readback",
      source: "tool_result",
      evidenceRefs: passed ? elementIds.map((id) => `element:${id}`) : [],
    }],
    coveredClaims: [claimId],
    uncoveredClaims: [],
  };
  const currentChanges = detail.changes || {};
  const transactionName = currentChanges.transactionName || readStringDeep(detail.rawResult, "TransactionName", "transactionName");
  const canProjectChanges = detail.tool?.risk === "reversibleMutation"
    && Boolean(transactionName)
    && !(currentChanges.createdElementIds?.length)
    && !(currentChanges.deletedElementIds?.length)
    && passed;
  const changes = canProjectChanges ? {
    ...currentChanges,
    transactionStarted: currentChanges.transactionStarted ?? true,
    transactionName,
    modifiedElementIds: currentChanges.modifiedElementIds?.length ? currentChanges.modifiedElementIds : elementIds,
    modelChanged: true,
  } : currentChanges;
  return {
    ...detail,
    verification,
    verificationStatus: passed ? "passed" : "failed",
    status: passed ? "verified" : "verification_failed",
    changes,
  };
}

function findValueDeep(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 12) return undefined;
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, child] of Object.entries(value)) if (normalized.has(key.toLowerCase())) return child;
  for (const child of Object.values(value)) {
    const found = findValueDeep(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function readFiniteNumberDeep(value, ...keys) {
  const found = findValueDeep(value, keys);
  return typeof found === "number" && Number.isFinite(found) ? found : undefined;
}

function readNumberArrayDeep(value, ...keys) {
  const found = findValueDeep(value, keys);
  return Array.isArray(found) ? found.filter((item) => typeof item === "number" && Number.isFinite(item)) : [];
}

function readStringDeep(value, ...keys) {
  const found = findValueDeep(value, keys);
  return typeof found === "string" && found ? found : undefined;
}

export function detailDiff(base, compare, options = {}) {
  const sections = {
    identity: ["tool", "domain", "domainSchemaVersion", "status"],
    input: ["input", "inputOrigins"],
    result: ["normalizedResult", "domainData"],
    model: ["modelBefore", "modelAfter", "changes"],
    lineage: ["lineage"],
    verification: ["verification"],
    diagnostics: ["warnings", "error", "stageTrace"],
  };
  if (options.includeRaw === true) sections.developer = ["developerTrace"];
  const changes = [];
  for (const [section, keys] of Object.entries(sections)) {
    for (const key of keys) compareValues(base?.[key], compare?.[key], key, section, changes);
  }
  if (options.includeRaw === true) compareValues(base?.rawResult, compare?.rawResult, "rawResult", "raw", changes);
  const payload = {
    base: detailListItem(base),
    compare: detailListItem(compare),
    changeCount: changes.length,
    sectionCounts: Object.fromEntries(Object.keys(sections).map((section) => [section, changes.filter((change) => change.section === section).length])),
    truncated: changes.length > 2000,
    changes: changes.slice(0, 2000),
  };
  return options.evidence === true ? sanitizeEvidenceView(payload) : payload;
}

export function sanitizeEvidenceView(value, key = "", depth = 0) {
  if (evidenceKey.test(key)) return { redacted: true, reason: "evidence_mode" };
  if (/^source$/i.test(key) && looksLikeSourceCode(value)) return { redacted: true, reason: "evidence_mode" };
  if (typeof value === "string" && /^[a-z]:\\/i.test(value)) return "[local path hidden]";
  if (depth > 40) return { truncated: true, reason: "maximum_depth" };
  if (Array.isArray(value)) return value.map((item) => sanitizeEvidenceView(item, "", depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeEvidenceView(child, childKey, depth + 1)]));
}

function looksLikeSourceCode(value) {
  return typeof value === "string" && /(public\s+(class|static)|using\s+Autodesk|namespace\s+|=>|\binterface\s+|\bimport\s+.*from\s+)/i.test(value);
}

function legacyDetailSection(detail, section, options) {
  const offset = clampInteger(options.offset, 0, Number.MAX_SAFE_INTEGER, 0);
  const limit = clampInteger(options.limit, 1, 100, 20);
  const query = typeof options.query === "string" ? options.query.trim().toLowerCase() : "";
  const status = typeof options.status === "string" ? options.status.trim().toLowerCase() : "";
  let payload;
  if (section === "summary") payload = detailListItem(detail);
  else if (section === "input") payload = { input: detail.input, inputOrigins: detail.inputOrigins || detail.inputParameters || {} };
  else if (section === "verification") payload = paginateCollection(detail.verification, offset, limit, ["checks"], query, status);
  else if (section === "raw") payload = detail;
  else payload = paginateCollection(detail.result, offset, limit, undefined, query, status);
  return options.evidence === true ? sanitizeEvidenceView(payload) : payload;
}

function verificationSummary(verification = {}) {
  return {
    status: verification.status,
    verificationScope: verification.verificationScope,
    requiredCount: verification.requiredClaims?.length || 0,
    claimCount: verification.claims?.length || 0,
    coveredCount: verification.coveredClaims?.length || 0,
    uncoveredCount: verification.uncoveredClaims?.length || 0,
    checkedElementCount: verification.checkedElementCount,
    passedCount: verification.passedCount,
    failedCount: verification.failedCount,
  };
}

function paginateCollection(value, offset, limit, preferredPath, query, status) {
  const match = findCollection(value, preferredPath);
  if (!match) return { value, collection: null };
  const filtered = match.items.filter((item) => matchesItem(item, query, status));
  return {
    value: replaceAtPath(value, match.path, { deferred: true, total: match.items.length, path: match.path.join(".") }),
    collection: {
      path: match.path.join("."),
      total: match.items.length,
      filteredTotal: filtered.length,
      offset,
      limit,
      items: filtered.slice(offset, offset + limit),
    },
  };
}

function matchesItem(item, query, status) {
  if (query && !searchIdentity(item).includes(query)) return false;
  if (!status) return true;
  if (!item || typeof item !== "object") return String(item).toLowerCase().includes(status);
  const statusValue = Object.entries(item).find(([key]) => /(status|result|verdict)$/i.test(key))?.[1];
  return String(statusValue ?? "").toLowerCase() === status;
}

function searchIdentity(item) {
  if (!item || typeof item !== "object") return String(item).toLowerCase();
  return Object.entries(item)
    .filter(([key]) => /(sourceId|candidateId|previewId|operationId|elementId|createdElementId|verificationId)$/i.test(key))
    .map(([, value]) => String(value).toLowerCase())
    .join(" ");
}

function findCollection(value, preferredPath) {
  const matches = [];
  visit(value, [], matches);
  if (preferredPath) {
    const preferred = matches.find((item) => item.path.join(".").toLowerCase() === preferredPath.join(".").toLowerCase());
    if (preferred) return preferred;
  }
  return matches.filter((item) => collectionKey.test(item.path.at(-1) || "")).sort((left, right) => right.items.length - left.items.length)[0]
    || matches.sort((left, right) => right.items.length - left.items.length)[0];
}

function visit(value, path, matches, depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    matches.push({ path, items: value });
    value.forEach((item, index) => visit(item, [...path, index], matches, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) visit(child, [...path, key], matches, depth + 1);
}

function replaceAtPath(value, path, replacement) {
  if (path.length === 0) return replacement;
  if (!value || typeof value !== "object") return value;
  const [head, ...tail] = path;
  if (Array.isArray(value)) return value.map((item, index) => index === head ? replaceAtPath(item, tail, replacement) : item);
  return { ...value, [head]: replaceAtPath(value[head], tail, replacement) };
}

function compareValues(before, after, path, section, output, depth = 0) {
  if (output.length > 2000 || depth > 20) return;
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const maximum = Math.max(before.length, after.length);
    for (let index = 0; index < maximum; index += 1) compareValues(before[index], after[index], `${path}[${index}]`, section, output, depth + 1);
    return;
  }
  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) compareValues(before[key], after[key], path ? `${path}.${key}` : key, section, output, depth + 1);
    return;
  }
  output.push({ section, path, before, after });
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}
