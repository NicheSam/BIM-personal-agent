import type { BimDomain, LoopMode, VerificationKind } from "./types.js";

export interface DomainProfile {
  domain: BimDomain;
  name: string;
  operationGuidance: "bounded" | "reportOnly" | "queryOnly";
  defaultVerification: VerificationKind[];
  guidance: string;
}

const profiles: Record<BimDomain, DomainProfile> = {
  mep: {
    domain: "mep",
    name: "MEP",
    operationGuidance: "bounded",
    defaultVerification: ["elementCount", "parameterEquals", "mepConnectivity", "clearance"],
    guidance: "Verify systems, levels, dimensions, connectors, quantities, positions, and parameters.",
  },
  constructability: {
    domain: "constructability",
    name: "Constructability review",
    operationGuidance: "reportOnly",
    defaultVerification: ["clearance", "evidence"],
    guidance: "Prefer reporting headroom, installation and maintenance space, sequencing, and ElementId evidence. Modify only when the task explicitly requires a reversible, verifiable correction.",
  },
  documentation: {
    domain: "documentation",
    name: "Documentation",
    operationGuidance: "bounded",
    defaultVerification: ["viewPlacement", "elementCount", "parameterEquals"],
    guidance: "Verify sheet numbers, title blocks, viewports, scales, annotations, and schedules. Never overwrite output files in the loop.",
  },
  quantity: {
    domain: "quantity",
    name: "Quantity takeoff",
    operationGuidance: "queryOnly",
    defaultVerification: ["quantity", "evidence"],
    guidance: "Prefer query-only recounting with explicit filters, units, missing parameters, and tolerances. Modify only when the task explicitly requires a reversible, verifiable correction.",
  },
  rfi: {
    domain: "rfi",
    name: "RFI",
    operationGuidance: "reportOnly",
    defaultVerification: ["evidence"],
    guidance: "Prefer report-only evidence with views, ElementIds, parameters, conflict conditions, and assumptions. Modify only when the task explicitly requires a reversible, verifiable correction.",
  },
  clash: {
    domain: "clash",
    name: "Clash review",
    operationGuidance: "reportOnly",
    defaultVerification: ["clearance", "evidence"],
    guidance: "Prefer reporting deduplicated element pairs, locations, distances, systems, and severity. Move elements only when the task explicitly requires a reversible, verifiable correction.",
  },
};

export function getDomainProfile(domain: BimDomain): DomainProfile {
  return profiles[domain];
}

export function inferDomain(text: string): BimDomain {
  const value = text.toLowerCase();
  if (/(rfi|疑義|釋疑)/i.test(value)) return "rfi";
  if (/(clash|碰撞|干涉)/i.test(value)) return "clash";
  if (/(quantity|takeoff|數量|估算|統計)/i.test(value)) return "quantity";
  if (/(sheet|viewport|title block|print|圖紙|出圖|圖框|標註)/i.test(value)) return "documentation";
  if (/(construct|clearance|headroom|施工檢討|淨高|維修空間)/i.test(value)) return "constructability";
  return "mep";
}

export function effectiveLoopMode(requested: LoopMode, gatewayMode: LoopMode): LoopMode {
  return requested === "bounded" && gatewayMode === "bounded" ? "bounded" : "observe";
}
