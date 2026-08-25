import type { BimTaskUnderstanding, JsonObject, ToolRisk } from "./types.js";

export type TargetInspectionDetail = "summary" | "parameters" | "full";
export type TargetSource = "current_selection" | "explicit_element_id" | "tool_returned_element_ids" | "created_element_ids" | "candidate_review";

export interface TargetingPolicy {
  requiresTargeting: boolean;
  targetSources: TargetSource[];
  resolution: "not_required" | "locked_target" | "needs_candidate_review" | "post_operation_target";
  reason: string;
  postOperation: {
    inspectCreated: boolean;
    inspectModified: boolean;
    detail: TargetInspectionDetail;
    maxParameters: number;
    maxAutoTargets: number;
    maxSuggestedTargets: number;
  };
}

export interface TargetInspectionRecommendation {
  source: "created" | "modified";
  elementIds: number[];
  omittedCount: number;
  toolId: "builtin:inspect_element_context";
  arguments: JsonObject;
  reason: string;
}

export interface PostOperationTargeting {
  hasTargets: boolean;
  createdElementIds: number[];
  modifiedElementIds: number[];
  recommendedInspections: TargetInspectionRecommendation[];
  reason: string;
}

const selectionTerms = [
  "selected", "selection", "current selection", "picked", "this element", "this object",
  "\u9078\u53d6", "\u5df2\u9078", "\u76ee\u524d\u9078\u53d6", "\u9019\u500b\u5143\u7d20", "\u9019\u500b\u7269\u4ef6",
];

const targetingTerms = [
  "find", "locate", "identify", "target", "select", "choose", "candidate", "nearest", "matching",
  "\u627e", "\u5b9a\u4f4d", "\u8b58\u5225", "\u9396\u5b9a", "\u9078\u64c7", "\u5019\u9078", "\u6700\u8fd1", "\u7b26\u5408",
];

const creationTerms = [
  "create", "place", "draw", "insert", "generate", "duplicate", "convert",
  "\u5efa\u7acb", "\u653e\u7f6e", "\u7e6a\u88fd", "\u63d2\u5165", "\u7522\u751f", "\u8907\u88fd", "\u8f49\u63db",
];

const mutationTerms = [
  "set", "edit", "change", "modify", "update", "write", "move", "override", "color", "tag",
  "\u8a2d\u5b9a", "\u7de8\u8f2f", "\u4fee\u6539", "\u8b8a\u66f4", "\u66f4\u65b0", "\u5beb\u5165", "\u79fb\u52d5", "\u5957\u7528", "\u4e0a\u8272", "\u6a19\u7c64",
];

const deepTerms = [
  "diagnose", "debug", "why", "wrong", "conflict", "clash", "verify", "validate",
  "\u8a3a\u65b7", "\u9664\u932f", "\u70ba\u4ec0\u9ebc", "\u932f", "\u885d\u7a81", "\u78b0\u649e", "\u9a57\u8b49",
];

export function planTargeting(task: BimTaskUnderstanding, query = ""): TargetingPolicy {
  const text = normalizeText([
    task.goal,
    ...task.actions,
    ...task.objects,
    ...(task.constraints ?? []),
    ...task.steps.flatMap((step) => [step.action, step.object ?? "", step.outcome]),
    query,
  ].join(" "));

  const selected = containsAny(text, selectionTerms);
  const explicitElementId = hasExplicitElementId(text);
  const targets = containsAny(text, targetingTerms);
  const creates = containsAny(text, creationTerms);
  const mutates = containsAny(text, mutationTerms);
  const deep = containsAny(text, deepTerms);

  const sources = new Set<TargetSource>();
  if (selected) sources.add("current_selection");
  if (explicitElementId) sources.add("explicit_element_id");
  if (targets) sources.add("candidate_review");
  if (creates || mutates) sources.add("tool_returned_element_ids");
  if (creates) sources.add("created_element_ids");

  const detail: TargetInspectionDetail = deep ? "full" : mutates ? "parameters" : "summary";
  const requiresTargeting = selected || explicitElementId || targets || creates || mutates;
  const resolution = selected || explicitElementId
    ? "locked_target"
    : targets
      ? "needs_candidate_review"
      : creates || mutates
        ? "post_operation_target"
        : "not_required";

  return {
    requiresTargeting,
    targetSources: [...sources],
    resolution,
    reason: reasonFor(resolution),
    postOperation: {
      inspectCreated: creates,
      inspectModified: mutates,
      detail,
      maxParameters: detail === "full" ? 40 : detail === "parameters" ? 80 : 20,
      maxAutoTargets: 1,
      maxSuggestedTargets: 10,
    },
  };
}

export function recommendTargetInspections(data: unknown, risk?: ToolRisk): PostOperationTargeting {
  const payload = unwrapExecution(data);
  const created = uniqueIds([
    ...readIdsByKeys(payload, ["ActualCreatedElementIds", "actualCreatedElementIds", "CreatedElementIds", "createdElementIds"]),
    ...readSinglesByKeys(payload, ["CreatedElementId", "createdElementId"]),
  ]);
  const explicitModified = uniqueIds(readIdsByKeys(payload, ["ActualModifiedElementIds", "actualModifiedElementIds", "ModifiedElementIds", "modifiedElementIds"]));
  const projectedModified = risk === "reversibleMutation" ? projectAppliedIds(payload) : [];
  const modified = uniqueIds([...explicitModified, ...projectedModified].filter((id) => !created.includes(id)));
  const recommendations: TargetInspectionRecommendation[] = [];

  if (created.length > 0) {
    recommendations.push(makeRecommendation("created", created, "full", 40, "Created elements should be inspected after creation to confirm identity, geometry, level, and parameters."));
  }
  if (modified.length > 0) {
    recommendations.push(makeRecommendation("modified", modified, "parameters", 80, "Modified elements should be inspected after mutation when the operation returns a bounded ElementId set."));
  }

  return {
    hasTargets: created.length + modified.length > 0,
    createdElementIds: created,
    modifiedElementIds: modified,
    recommendedInspections: recommendations,
    reason: recommendations.length
      ? "Operation returned concrete ElementIds that can be locked for Element Lens follow-up."
      : "No created or modified ElementIds were found in the operation result.",
  };
}

function makeRecommendation(
  source: "created" | "modified",
  ids: number[],
  detail: TargetInspectionDetail,
  maxParameters: number,
  reason: string,
): TargetInspectionRecommendation {
  const maxSuggestedTargets = 10;
  const elementIds = ids.slice(0, maxSuggestedTargets);
  return {
    source,
    elementIds,
    omittedCount: Math.max(0, ids.length - elementIds.length),
    toolId: "builtin:inspect_element_context",
    arguments: {
      elementId: elementIds.length === 1 ? elementIds[0] : undefined,
      detail,
      maxParameters,
      maxViewsScanned: 0,
      includeDocumentPath: false,
    },
    reason: elementIds.length === 1
      ? reason
      : `${reason} Multiple targets require candidate review or sampled inspection before using a single-object lens.`,
  };
}

function reasonFor(resolution: TargetingPolicy["resolution"]): string {
  if (resolution === "locked_target") return "The task references a current selection or explicit ElementId, so the target can be locked before operation.";
  if (resolution === "needs_candidate_review") return "The task asks BIM Agent to find or select a target; candidates must be resolved before Element Lens is used.";
  if (resolution === "post_operation_target") return "The task can produce target ElementIds during execution; inspect created or modified IDs after the operation.";
  return "The task does not require object targeting.";
}

function projectAppliedIds(value: unknown): number[] {
  const appliedCount = readNumberByKeys(value, ["AppliedCount", "appliedCount"]);
  const verifiedCount = readNumberByKeys(value, ["VerifiedCount", "verifiedCount"]);
  const elementIds = uniqueIds(readIdsByKeys(value, ["ElementIds", "elementIds"]));
  if (appliedCount === undefined || verifiedCount === undefined) return [];
  if (appliedCount <= 0 || appliedCount !== verifiedCount || elementIds.length !== appliedCount) return [];
  return elementIds;
}

function unwrapExecution(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  return (data as JsonObject).execution ?? (data as JsonObject).Execution ?? data;
}

function readIdsByKeys(value: unknown, keys: string[]): number[] {
  const ids: number[] = [];
  visitObjects(value, (record) => {
    for (const key of keys) {
      const candidate = record[key];
      if (!Array.isArray(candidate)) continue;
      for (const item of candidate) {
        if (typeof item === "number" && Number.isInteger(item) && item > 0) ids.push(item);
      }
    }
  });
  return ids;
}

function readSinglesByKeys(value: unknown, keys: string[]): number[] {
  const ids: number[] = [];
  visitObjects(value, (record) => {
    for (const key of keys) {
      const candidate = record[key];
      if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) ids.push(candidate);
    }
  });
  return ids;
}

function readNumberByKeys(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const key of keys) {
    const candidate = (value as JsonObject)[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function visitObjects(value: unknown, visitor: (record: JsonObject) => void, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 16) return;
  if (Array.isArray(value)) {
    for (const item of value) visitObjects(item, visitor, depth + 1);
    return;
  }
  const record = value as JsonObject;
  visitor(record);
  for (const child of Object.values(record)) visitObjects(child, visitor, depth + 1);
}

function uniqueIds(ids: number[]): number[] {
  return [...new Set(ids)].sort((left, right) => left - right);
}

function containsAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasExplicitElementId(text: string): boolean {
  return /\belement\s*id\s*[:#]?\s*\d+\b/i.test(text)
    || /\belementid\s*[:#]?\s*\d+\b/i.test(text)
    || /\u5143\u7d20\s*id\s*[:\uff1a]?\s*\d+/i.test(text);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}
