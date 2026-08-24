import type {
  JsonObject,
  TaskLineageEdge,
  TaskLineageRecord,
  TaskNormalizedResult,
  TaskRequiredClaim,
} from "./types.js";

export interface DomainAdapterResult {
  domain: string;
  domainSchemaVersion: number;
  domainData: JsonObject;
  normalizedResult: TaskNormalizedResult;
  lineage: { records: TaskLineageRecord[]; edges: TaskLineageEdge[] };
  requiredClaims: TaskRequiredClaim[];
}

export interface DomainAdapterContext {
  toolId: string;
  publicTool: string;
  rawResult: unknown;
}

interface DomainAdapter {
  id: string;
  version: number;
  matches(context: DomainAdapterContext): boolean;
  normalize(context: DomainAdapterContext): DomainAdapterResult;
}

export function adaptExecutionDomain(context: DomainAdapterContext): DomainAdapterResult {
  const adapter = domainAdapters().find((candidate) => candidate.matches(context));
  return adapter ? adapter.normalize(context) : genericAdapter(context);
}


const elementContextAdapter: DomainAdapter = {
  id: "element_context",
  version: 1,
  matches({ toolId, rawResult }) {
    return toolId === "builtin:inspect_element_context"
      || findScalar(rawResult, ["SchemaVersion"]) === "bim-agent.element-context.v1"
      || findValueDeep(rawResult, ["AgentSummary"]) !== undefined;
  },
  normalize({ rawResult }) {
    const summary = (findValueDeep(rawResult, ["AgentSummary"]) as JsonObject | undefined) ?? compactObject({
      ElementId: findScalar(rawResult, ["ElementId"]),
      Name: findScalar(rawResult, ["Name"]),
      Category: findScalar(rawResult, ["Category"]),
      TypeName: findScalar(rawResult, ["TypeName"]),
      ClassName: findScalar(rawResult, ["ClassName"]),
      ParameterCount: findScalar(rawResult, ["ParameterCount"]),
    });
    const parameters = objectValue(findValueDeep(rawResult, ["Parameters"])) ?? {};
    const typeParameters = objectValue(findValueDeep(rawResult, ["TypeParameters"])) ?? {};
    const relationships = findArrayDeep(rawResult, ["Relationships"]) ?? [];
    const selection = objectValue(findValueDeep(rawResult, ["Selection"]));
    const status = findScalar(rawResult, ["Status"]);
    const elementId = numberValue(summary, "ElementId", "elementId");
    const records: TaskLineageRecord[] = elementId
      ? [{ elementId, status: typeof status === "string" ? status : "inspected" }]
      : [];
    const fieldMappings = Object.keys(summary).map((key) => ({ source: `rawResult.AgentSummary.${key}`, target: `domainData.summary.${key}` }));
    return {
      domain: this.id,
      domainSchemaVersion: this.version,
      domainData: compactObject({
        summary,
        parameters,
        typeParameters,
        relationships,
        geometry: objectValue(findValueDeep(rawResult, ["Geometry"])),
        location: objectValue(findValueDeep(rawResult, ["Location"])),
        viewContext: objectValue(findValueDeep(rawResult, ["ViewContext"])),
        selection,
      }),
      normalizedResult: {
        normalizerId: this.id,
        normalizerVersion: this.version,
        value: {
          status,
          summary,
          collections: {
            parameters: arrayLength(parameters, ["Records"]) ?? 0,
            typeParameters: arrayLength(typeParameters, ["Records"]) ?? 0,
            relationships: relationships.length,
            selection: selection ? arrayLength(selection, ["Elements"]) ?? 0 : 0,
          },
        },
        fieldMappings,
      },
      lineage: { records, edges: [] },
      requiredClaims: [],
    };
  },
};

const dwgBlockFamilyPlacementAdapter: DomainAdapter = {
  id: "dwg_block_family_placement",
  version: 1,
  matches({ toolId, rawResult }) {
    return /dwg.*block|block.*family|family.*dwg/i.test(toolId)
      || findValueDeep(rawResult, ["targetBlockName", "requestedBlockName", "anchorMaxResidualMm", "createVerifyResults"]) !== undefined;
  },
  normalize({ rawResult }) {
    const summary = compactObject({
      linkedDwg: findScalar(rawResult, ["targetDwgTypeName", "linkedDwgName"]),
      importInstanceId: findScalar(rawResult, ["importInstanceId", "linkedDwgId", "cadId"]),
      blockName: findScalar(rawResult, ["targetBlockName", "requestedBlockName", "blockName"]),
      candidateCount: findScalar(rawResult, ["requestedBlockCount", "totalCandidateCount", "candidateCount"]),
      readyCount: findScalar(rawResult, ["readyToCreateCount", "readyCount"]),
      duplicateCount: findScalar(rawResult, ["duplicateExistingCount", "duplicateCount"]),
      reviewRequiredCount: findScalar(rawResult, ["reviewRequiredCount"]),
      blockedCount: findScalar(rawResult, ["blockedCount"]),
      failureCount: findScalar(rawResult, ["failureCount"]),
      truncated: findScalar(rawResult, ["truncated"]),
      coordinateStatus: findScalar(rawResult, ["statusCode", "coordinateStatus"]),
      anchorCount: arrayLength(rawResult, ["anchors", "coordinateAnchors"]),
      anchorMaximumResidualMm: findScalar(rawResult, ["anchorMaxResidualMm", "maxResidualMm"]),
      anchorAverageResidualMm: findScalar(rawResult, ["anchorAverageResidualMm", "averageResidualMm"]),
      anchorToleranceMm: findScalar(rawResult, ["anchorResidualToleranceMm", "anchorToleranceMm"]),
      duplicateToleranceMm: findScalar(rawResult, ["duplicateToleranceMm"]),
      familySymbolId: findScalar(rawResult, ["familySymbolId"]),
      familySymbolName: findScalar(rawResult, ["familySymbolName"]),
      levelId: findScalar(rawResult, ["levelId"]),
      levelName: findScalar(rawResult, ["levelName"]),
      offsetMm: findScalar(rawResult, ["offsetMm"]),
      createdCount: findScalar(rawResult, ["createdCount"]),
      verifiedCreatedCount: findScalar(rawResult, ["verifiedCreatedCount"]),
      positionMaximumDeltaMm: findScalar(rawResult, ["positionMaximumDeltaMm", "maxPositionDeltaMm"]),
      rotationMaximumDeltaDegrees: findScalar(rawResult, ["rotationMaximumDeltaDegrees", "maxRotationDeltaDegrees"]),
      beforeElementCount: findScalar(rawResult, ["beforeElementCount"]),
      afterElementCount: findScalar(rawResult, ["afterElementCount"]),
    });
    const anchors = findArrayDeep(rawResult, ["anchors", "coordinateAnchors"]) ?? [];
    const placements = findArrayDeep(rawResult, ["createVerifyResults", "placementResults", "createdItems"]) ?? [];
    const candidates = findArrayDeep(rawResult, ["targetCandidates", "candidates"]) ?? [];
    const sourceId = summary.importInstanceId === undefined ? undefined : `source:${summary.importInstanceId}`;
    const records = [...candidates, ...placements].flatMap((value) => toLineageRecord(value, sourceId));
    const edges = buildLineageEdges(records);
    const requiredClaims: TaskRequiredClaim[] = [];
    if (summary.importInstanceId !== undefined || summary.linkedDwg !== undefined) {
      requiredClaims.push({ claimId: "source.reference.exists", description: "The selected linked/imported DWG reference exists.", required: true });
    }
    if (summary.candidateCount !== undefined) {
      requiredClaims.push({ claimId: "preview.candidate_count.reported", description: "The preview candidate count is reported by the tool.", required: true });
    }
    if (anchors.length > 0 || summary.anchorMaximumResidualMm !== undefined) {
      requiredClaims.push({ claimId: "coordinate.anchors.within_tolerance", description: "Coordinate anchors satisfy the configured tolerance.", required: true });
    }
    for (const record of records.filter((item) => item.candidateId && item.elementId)) {
      requiredClaims.push({
        claimId: `placement.${record.candidateId}.readback`,
        description: `${record.candidateId} is independently read back from Revit.`,
        required: true,
      });
    }
    const fieldMappings = Object.keys(summary).map((key) => ({ source: `rawResult..${key}`, target: `domainData.summary.${key}` }));
    return {
      domain: this.id,
      domainSchemaVersion: this.version,
      domainData: { summary, anchors, candidates, placements },
      normalizedResult: {
        normalizerId: this.id,
        normalizerVersion: this.version,
        value: {
          summary,
          collections: {
            anchors: anchors.length,
            candidates: candidates.length,
            placements: placements.length,
          },
        },
        fieldMappings,
      },
      lineage: { records, edges },
      requiredClaims,
    };
  },
};

function domainAdapters(): DomainAdapter[] {
  return [elementContextAdapter, dwgBlockFamilyPlacementAdapter];
}

function genericAdapter(context: DomainAdapterContext): DomainAdapterResult {
  return {
    domain: "generic_revit_operation",
    domainSchemaVersion: 1,
    domainData: {},
    normalizedResult: {
      normalizerId: "generic_revit_operation",
      normalizerVersion: 1,
      value: context.rawResult,
      fieldMappings: [],
    },
    lineage: { records: collectGenericLineage(context.rawResult), edges: [] },
    requiredClaims: [],
  };
}

function collectGenericLineage(value: unknown): TaskLineageRecord[] {
  const records: TaskLineageRecord[] = [];
  visit(value, (candidate) => {
    const record = toLineageRecord(candidate)[0];
    if (record && Object.keys(record).some((key) => key !== "status")) records.push(record);
  });
  return records.slice(0, 10_000);
}

function toLineageRecord(value: unknown, fallbackSourceId?: string): TaskLineageRecord[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const item = value as JsonObject;
  const elementId = numberValue(item, "createdElementId", "CreatedElementId", "elementId", "ElementId");
  const record = compactObject({
    sourceId: stringValue(item, "sourceId", "SourceId") ?? fallbackSourceId,
    candidateId: stringValue(item, "candidateId", "CandidateId"),
    previewId: stringValue(item, "previewId", "PreviewId"),
    operationId: stringValue(item, "operationId", "OperationId"),
    elementId,
    verificationId: stringValue(item, "verificationId", "VerificationId"),
    status: stringValue(item, "status", "Status"),
  }) as TaskLineageRecord;
  return Object.keys(record).length ? [record] : [];
}

function buildLineageEdges(records: TaskLineageRecord[]): TaskLineageEdge[] {
  const edges: TaskLineageEdge[] = [];
  for (const record of records) {
    const source = record.sourceId;
    const candidate = record.candidateId ? `candidate:${record.candidateId}` : undefined;
    const preview = record.previewId ? `preview:${record.previewId}` : undefined;
    const operation = record.operationId ? `operation:${record.operationId}` : undefined;
    const element = record.elementId ? `element:${record.elementId}` : undefined;
    const verification = record.verificationId ? `verification:${record.verificationId}` : undefined;
    if (source && candidate) edges.push({ from: source, to: candidate, relation: "produced_candidate" });
    if (candidate && preview) edges.push({ from: candidate, to: preview, relation: "included_in_preview" });
    if (candidate && operation) edges.push({ from: candidate, to: operation, relation: "executed_by" });
    if (operation && element) edges.push({ from: operation, to: element, relation: "created_or_modified" });
    else if (candidate && element) edges.push({ from: candidate, to: element, relation: "created_or_modified" });
    if (element && verification) edges.push({ from: element, to: verification, relation: "verified_by" });
  }
  return edges;
}

function visit(value: unknown, callback: (value: unknown) => void, depth = 0): void {
  if (!value || typeof value !== "object" || depth > 12) return;
  callback(value);
  if (Array.isArray(value)) for (const item of value) visit(item, callback, depth + 1);
  else for (const child of Object.values(value as JsonObject)) visit(child, callback, depth + 1);
}

function findValueDeep(value: unknown, keys: string[], depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 12) return undefined;
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, child] of Object.entries(value as JsonObject)) if (normalized.has(key.toLowerCase())) return child;
  for (const child of Object.values(value as JsonObject)) {
    const found = findValueDeep(child, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findArrayDeep(value: unknown, keys: string[]): unknown[] | undefined {
  const found = findValueDeep(value, keys);
  return Array.isArray(found) ? found : undefined;
}

function arrayLength(value: unknown, keys: string[]): number | undefined {
  return findArrayDeep(value, keys)?.length;
}

function findScalar(value: unknown, keys: string[]): string | number | boolean | undefined {
  const found = findValueDeep(value, keys);
  return ["string", "number", "boolean"].includes(typeof found) ? found as string | number | boolean : undefined;
}

function stringValue(value: JsonObject, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof value[key] === "string" && value[key]) return value[key] as string;
  return undefined;
}

function numberValue(value: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof value[key] === "number" && Number.isFinite(value[key])) return value[key] as number;
  return undefined;
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function compactObject<T extends JsonObject>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
