export type LeadPerformanceGoal = "volume" | "quality";

export type LeadPerformancePixelStatus = {
  capiViaConnection: boolean;
  capiProbeStatus: "untested" | "ok" | "denied" | "error";
};

export function metaOptimizationGoal(
  performanceGoal: LeadPerformanceGoal,
): "OFFSITE_CONVERSIONS" | "QUALITY_LEAD" {
  return performanceGoal === "quality" ? "QUALITY_LEAD" : "OFFSITE_CONVERSIONS";
}

export function canUseQualifiedLeadOptimization(
  pixel: LeadPerformancePixelStatus | null | undefined,
): boolean {
  return Boolean(
    pixel && (pixel.capiViaConnection || pixel.capiProbeStatus === "ok"),
  );
}
