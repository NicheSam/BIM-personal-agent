import { AgentError } from "./errors.js";
import type { JsonObject, VerificationCheck, VerificationKind } from "./types.js";
import { requireObject } from "./validation.js";

const kinds: VerificationKind[] = [
  "elementExists", "elementCount", "parameterEquals", "mepConnectivity",
  "clearance", "viewPlacement", "quantity", "evidence",
];

export function parseVerificationChecks(value: unknown, required = true): VerificationCheck[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new AgentError("VALIDATION_ERROR", "verificationChecks must contain between 1 and 20 checks.");
  }
  return value.map((raw, index) => {
    const check = requireObject(raw, `verificationChecks[${index}]`);
    const id = readText(check.id, `verificationChecks[${index}].id`, 80);
    if (typeof check.kind !== "string" || !kinds.includes(check.kind as VerificationKind)) {
      throw new AgentError("VALIDATION_ERROR", `verificationChecks[${index}].kind is unsupported.`);
    }
    validateIds(check.elementIds, `verificationChecks[${index}].elementIds`);
    validateIds(check.viewIds, `verificationChecks[${index}].viewIds`);
    if (check.pairs !== undefined) {
      if (!Array.isArray(check.pairs) || check.pairs.length > 200) {
        throw new AgentError("VALIDATION_ERROR", `verificationChecks[${index}].pairs must contain at most 200 pairs.`);
      }
      for (const pair of check.pairs) {
        const item = requireObject(pair, "clearance pair");
        if (!isPositiveInteger(item.a) || !isPositiveInteger(item.b)) {
          throw new AgentError("VALIDATION_ERROR", "Clearance pair a and b must be positive ElementIds.");
        }
      }
    }
    return { ...check, id, kind: check.kind as VerificationKind } as VerificationCheck;
  });
}

export function sanitizeEvidence(data: unknown): JsonObject {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const record = data as JsonObject;
  const verification = record.Verification ?? record.verification;
  return {
    verdict: readScalar(record.Verdict ?? record.verdict),
    rolledBack: readScalar(record.RolledBack ?? record.rolledBack),
    executedSteps: readScalar(record.ExecutedSteps ?? record.executedSteps),
    verification: sanitizeVerification(verification),
  };
}

function sanitizeVerification(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as JsonObject;
  const checks = Array.isArray(record.Checks ?? record.checks) ? (record.Checks ?? record.checks) as unknown[] : [];
  return {
    passed: readScalar(record.Passed ?? record.passed),
    checks: checks.slice(0, 20).map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return {};
      const check = item as JsonObject;
      return {
        id: readScalar(check.Id ?? check.id),
        kind: readScalar(check.Kind ?? check.kind),
        stepId: readScalar(check.StepId ?? check.stepId),
        passed: readScalar(check.Passed ?? check.passed),
        message: typeof (check.Message ?? check.message) === "string" ? String(check.Message ?? check.message).slice(0, 300) : undefined,
        elementIds: sanitizeIds(check.ElementIds ?? check.elementIds),
      };
    }),
  };
}

function validateIds(value: unknown, field: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 200 || value.some((item) => !isPositiveInteger(item))) {
    throw new AgentError("VALIDATION_ERROR", `${field} must contain at most 200 positive ElementIds.`);
  }
}

function sanitizeIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isPositiveInteger).slice(0, 200);
}

function readText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AgentError("VALIDATION_ERROR", `${field} must be a non-empty string up to ${maximum} characters.`);
  }
  return value.trim();
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function readScalar(value: unknown): string | number | boolean | null | undefined {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}
