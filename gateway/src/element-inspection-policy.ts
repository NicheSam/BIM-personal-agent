import type { BimTaskStep, BimTaskUnderstanding, JsonObject } from "./types.js";

export type ElementInspectionDetail = "summary" | "parameters" | "full";

export interface ElementInspectionRecommendation {
  shouldInspect: boolean;
  detail?: ElementInspectionDetail;
  maxParameters?: number;
  arguments?: JsonObject;
  beforeStepNumbers: number[];
  reason: string;
}

const selectedElementTerms = [
  "selected", "selection", "current selection", "picked", "this element", "this object",
  "current element", "active element", "chosen element",
  "\u9078\u53d6", "\u5df2\u9078", "\u76ee\u524d\u9078\u53d6", "\u9019\u500b\u5143\u7d20", "\u9019\u500b\u7269\u4ef6",
];

const elementObjectTerms = [
  "element", "object", "family instance", "instance", "family", "type", "category",
  "wall", "door", "window", "floor", "ceiling", "beam", "column", "pipe", "duct",
  "conduit", "cable tray", "fixture", "sprinkler", "equipment", "fitting",
  "\u5143\u7d20", "\u7269\u4ef6", "\u5143\u4ef6", "\u65cf", "\u985e\u578b", "\u985e\u5225",
  "\u7246", "\u9580", "\u7a97", "\u6a13\u677f", "\u5929\u82b1", "\u6881", "\u67f1", "\u7ba1",
  "\u6c34\u7ba1", "\u98a8\u7ba1", "\u96fb\u7ba1", "\u6a4b\u67b6", "\u5674\u982d", "\u7051\u6c34", "\u8a2d\u5099",
];

const parameterTerms = [
  "parameter", "parameters", "param", "property", "properties", "value", "mark",
  "comment", "type parameter", "instance parameter", "shared parameter",
  "\u53c3\u6578", "\u5c6c\u6027", "\u503c", "\u6a19\u8a18", "\u8a3b\u89e3", "\u985e\u578b\u53c3\u6578", "\u5be6\u4f8b\u53c3\u6578",
];

const mutationTerms = [
  "set", "edit", "change", "modify", "update", "write", "rename", "move", "delete",
  "replace", "apply", "assign", "override", "color", "tag",
  "\u8a2d\u5b9a", "\u7de8\u8f2f", "\u4fee\u6539", "\u8b8a\u66f4", "\u66f4\u65b0", "\u5beb\u5165",
  "\u547d\u540d", "\u79fb\u52d5", "\u522a\u9664", "\u5957\u7528", "\u6307\u6d3e", "\u4e0a\u8272", "\u6a19\u7c64",
];

const deepInspectionTerms = [
  "diagnose", "debug", "why", "wrong", "failure", "failed", "conflict", "clash",
  "cannot", "unable", "mismatch", "validate", "verify", "interpret",
  "\u8a3a\u65b7", "\u9664\u932f", "\u70ba\u4ec0\u9ebc", "\u932f", "\u5931\u6557", "\u885d\u7a81",
  "\u78b0\u649e", "\u4e0d\u80fd", "\u7121\u6cd5", "\u4e0d\u4e00\u81f4", "\u9a57\u8b49", "\u5224\u8b80",
];

const projectWideTerms = [
  "project info", "project information", "project status", "agent status", "all levels",
  "schema", "document info", "model summary", "dwg", "cad",
  "\u5c08\u6848\u8cc7\u6599", "\u5c08\u6848\u72c0\u614b", "\u6a21\u578b\u6458\u8981", "\u5168\u90e8\u6a13\u5c64",
  "\u5716\u5c64", "\u9023\u7d50\u5716", "\u5716\u9762",
];

export function decideElementInspection(task: BimTaskUnderstanding, query = ""): ElementInspectionRecommendation {
  const text = normalizeText([
    task.goal,
    ...task.actions,
    ...task.objects,
    ...(task.constraints ?? []),
    ...task.steps.flatMap((step) => [step.action, step.object ?? "", step.outcome]),
    query,
  ].join(" "));

  const selectedIntent = containsAny(text, selectedElementTerms) || hasExplicitElementId(text);
  if (!selectedIntent) {
    return noInspection("No current selection, this-element, or explicit ElementId intent was detected.");
  }
  const elementIntent = containsAny(text, elementObjectTerms);
  if (!elementIntent && containsAny(text, projectWideTerms)) {
    return noInspection("The request appears project-wide or CAD/source-driven, so selected element inspection is not the first step.");
  }

  const beforeStepNumbers = task.steps
    .map((step, index) => stepNeedsInspection(step) ? index + 1 : undefined)
    .filter((value): value is number => value !== undefined);
  const effectiveBeforeStepNumbers = beforeStepNumbers.length > 0 ? beforeStepNumbers : [1];

  const asksForParameters = containsAny(text, parameterTerms) || containsAny(text, mutationTerms);
  const asksForDeepInspection = containsAny(text, deepInspectionTerms);
  if (asksForDeepInspection) {
    return inspection("full", 160, effectiveBeforeStepNumbers, "Deep diagnosis or interpretation needs full selected-element context before deciding.");
  }
  if (asksForParameters) {
    return inspection("parameters", 80, effectiveBeforeStepNumbers, "Parameter-aware work needs selected-element identity and bounded instance/type parameters first.");
  }
  return inspection("summary", 20, effectiveBeforeStepNumbers, "Element-specific work needs lightweight selected-element context before choosing the next tool.");
}

function stepNeedsInspection(step: BimTaskStep): boolean {
  const text = normalizeText([step.action, step.object ?? "", step.outcome].join(" "));
  return containsAny(text, selectedElementTerms)
    || (containsAny(text, elementObjectTerms) && (containsAny(text, parameterTerms) || containsAny(text, mutationTerms) || containsAny(text, deepInspectionTerms)));
}

function inspection(
  detail: ElementInspectionDetail,
  maxParameters: number,
  beforeStepNumbers: number[],
  reason: string,
): ElementInspectionRecommendation {
  return {
    shouldInspect: true,
    detail,
    maxParameters,
    arguments: {
      detail,
      maxParameters,
      maxViewsScanned: 0,
      includeDocumentPath: false,
    },
    beforeStepNumbers,
    reason,
  };
}

function noInspection(reason: string): ElementInspectionRecommendation {
  return { shouldInspect: false, beforeStepNumbers: [], reason };
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
