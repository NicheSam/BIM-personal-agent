import type { BimDomain, LoopMode, VerificationKind } from "./types.js";

export interface DomainProfile {
  domain: BimDomain;
  name: string;
  mutationPolicy: "bounded" | "reportOnly" | "queryOnly";
  defaultVerification: VerificationKind[];
  guidance: string;
}

const profiles: Record<BimDomain, DomainProfile> = {
  mep: {
    domain: "mep",
    name: "MEP",
    mutationPolicy: "bounded",
    defaultVerification: ["elementCount", "parameterEquals", "mepConnectivity", "clearance"],
    guidance: "Verify systems, levels, dimensions, connectors, quantities, positions, and parameters.",
  },
  constructability: {
    domain: "constructability",
    name: "Constructability review",
    mutationPolicy: "reportOnly",
    defaultVerification: ["clearance", "evidence"],
    guidance: "Report headroom, installation and maintenance space, sequencing, and ElementId evidence. Do not modify the model.",
  },
  documentation: {
    domain: "documentation",
    name: "Documentation",
    mutationPolicy: "bounded",
    defaultVerification: ["viewPlacement", "elementCount", "parameterEquals"],
    guidance: "Verify sheet numbers, title blocks, viewports, scales, annotations, and schedules. Never overwrite output files in the loop.",
  },
  quantity: {
    domain: "quantity",
    name: "Quantity takeoff",
    mutationPolicy: "queryOnly",
    defaultVerification: ["quantity", "evidence"],
    guidance: "Recount categories and aggregates with explicit filters, units, missing parameters, and tolerances. Do not modify the model.",
  },
  rfi: {
    domain: "rfi",
    name: "RFI",
    mutationPolicy: "reportOnly",
    defaultVerification: ["evidence"],
    guidance: "Require views, ElementIds, parameters, conflict conditions, and assumptions. Do not modify the model.",
  },
  clash: {
    domain: "clash",
    name: "Clash review",
    mutationPolicy: "reportOnly",
    defaultVerification: ["clearance", "evidence"],
    guidance: "Report deduplicated element pairs, locations, distances, systems, and severity. Do not move elements automatically.",
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

export function effectiveLoopMode(domain: BimDomain, requested: LoopMode, gatewayMode: LoopMode): LoopMode {
  return requested === "bounded" && gatewayMode === "bounded" && profiles[domain].mutationPolicy === "bounded"
    ? "bounded"
    : "observe";
}
