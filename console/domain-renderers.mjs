const renderers = new Map();

export function registerDomainRenderer(domain, renderer) {
  renderers.set(domain, renderer);
}

export function renderDomain(detail) {
  const renderer = renderers.get(detail.domain) || genericRenderer;
  return renderer(detail.domainData || {}, detail);
}


registerDomainRenderer("element_context", (domainData) => {
  const summary = domainData.summary || {};
  const labels = {
    ElementId: "Element ID",
    Name: "Name",
    Category: "Category",
    TypeName: "Type",
    ClassName: "Class",
    LevelName: "Level",
    ParameterCount: "Parameter count",
    TypeParameterCount: "Type parameter count",
    WritableParameterCount: "Writable parameters",
    ReadOnlyParameterCount: "Read-only parameters",
    HasBoundingBox: "Has bounding box",
    LocationKind: "Location",
    RelationshipCount: "Relationships",
    ViewContextKind: "View context",
    ReadOnly: "Read-only tool",
  };
  const summaryKeys = [
    "ElementId",
    "Name",
    "Category",
    "TypeName",
    "ClassName",
    "LevelName",
    "ParameterCount",
    "TypeParameterCount",
    "WritableParameterCount",
    "ReadOnlyParameterCount",
    "HasBoundingBox",
    "LocationKind",
    "RelationshipCount",
    "ViewContextKind",
    "ReadOnly",
    ...Object.keys(summary),
  ];
  const uniqueSummaryKeys = [...new Set(summaryKeys)].filter((key) => summary[key] !== undefined);
  return {
    title: "Element Lens / Revit element context",
    summaryRows: uniqueSummaryKeys.map((key) => ({ key, label: labels[key] || key, value: summary[key] })),
    tables: [
      { id: "parameters", title: "Instance parameters", rows: Array.isArray(domainData.parameters?.Records) ? domainData.parameters.Records.slice(0, 50) : [] },
      { id: "typeParameters", title: "Type parameters", rows: Array.isArray(domainData.typeParameters?.Records) ? domainData.typeParameters.Records.slice(0, 50) : [] },
      { id: "relationships", title: "Element relationships", rows: Array.isArray(domainData.relationships) ? domainData.relationships.slice(0, 50) : [] },
      { id: "selection", title: "Selection candidates", rows: Array.isArray(domainData.selection?.Elements) ? domainData.selection.Elements.slice(0, 50) : [] },
    ],
  };
});

registerDomainRenderer("dwg_block_family_placement", (domainData) => {
  const summary = domainData.summary || {};
  const labels = {
    linkedDwg: "連結圖檔 / Linked DWG",
    importInstanceId: "匯入元件 / ImportInstance ID",
    blockName: "圖塊 / CAD Block",
    candidateCount: "候選數 / Candidates",
    readyCount: "可建立 / Ready",
    duplicateCount: "重複 / Duplicates",
    reviewRequiredCount: "需檢查 / Review required",
    blockedCount: "受阻 / Blocked",
    failureCount: "失敗 / Failures",
    coordinateStatus: "座標狀態 / Coordinate status",
    anchorCount: "錨點 / Anchors",
    anchorMaximumResidualMm: "最大殘差 / Max residual (mm)",
    anchorAverageResidualMm: "平均殘差 / Average residual (mm)",
    anchorToleranceMm: "容許誤差 / Tolerance (mm)",
    duplicateToleranceMm: "重複容差 / Duplicate tolerance (mm)",
    familySymbolId: "族群類型 / FamilySymbol ID",
    familySymbolName: "族群類型名稱 / FamilySymbol",
    levelId: "樓層 / Level ID",
    levelName: "樓層名稱 / Level",
    offsetMm: "偏移 / Offset (mm)",
    createdCount: "建立數 / Created",
    verifiedCreatedCount: "驗證建立數 / Verified created",
    positionMaximumDeltaMm: "最大位置差 / Max position delta (mm)",
    rotationMaximumDeltaDegrees: "最大角度差 / Max rotation delta (deg)",
    beforeElementCount: "執行前數量 / Before element count",
    afterElementCount: "執行後數量 / After element count",
  };
  const previewKeys = ["linkedDwg", "importInstanceId", "blockName", "candidateCount", "readyCount", "duplicateCount", "reviewRequiredCount", "blockedCount", "failureCount", "coordinateStatus", "anchorCount", "anchorMaximumResidualMm", "anchorAverageResidualMm", "anchorToleranceMm", "duplicateToleranceMm"];
  const placementKeys = ["familySymbolId", "familySymbolName", "levelId", "levelName", "offsetMm", "createdCount", "verifiedCreatedCount", "positionMaximumDeltaMm", "rotationMaximumDeltaDegrees", "beforeElementCount", "afterElementCount"];
  const hasPreview = Array.isArray(domainData.candidates) && domainData.candidates.length > 0
    || Array.isArray(domainData.anchors) && domainData.anchors.length > 0
    || summary.candidateCount !== undefined;
  const hasPlacement = Array.isArray(domainData.placements) && domainData.placements.length > 0
    || summary.createdCount !== undefined
    || summary.familySymbolId !== undefined;
  const visibleKeys = [...new Set([
    ...(hasPreview ? previewKeys : []),
    ...(hasPlacement ? placementKeys : []),
    ...Object.keys(summary),
  ])];
  return {
    title: "DWG圖塊族群放置 / DWG block family placement",
    summaryRows: visibleKeys.map((key) => ({ key, label: labels[key] || key, value: summary[key] })),
    tables: [
      { id: "anchors", title: "座標錨點 / Coordinate anchors", rows: Array.isArray(domainData.anchors) ? domainData.anchors.slice(0, 20) : [] },
    ],
  };
});

function genericRenderer(domainData, detail) {
  return {
    title: detail.domain || "Generic Revit operation",
    summaryRows: Object.entries(domainData.summary || {}).slice(0, 40).map(([key, value]) => ({ key, label: key, value })),
    tables: [],
  };
}
