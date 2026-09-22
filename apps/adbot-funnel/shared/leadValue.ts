import type { FunnelAnswers, FunnelConfig, LeadQuality } from "./funnel";

export const LEAD_QUALITY_VALUES = ["good", "bad"] as const;

export const DEFAULT_LEAD_QUALITY_META = {
  currency: "EUR",
  goodEventName: "Subscribe",
  badEventName: "DisqualifiedLead",
  goodValue: 100,
  badValue: 0,
} as const;

export const LEAD_QUALITY_LABELS: Record<LeadQuality, string> = {
  good: "Gut",
  bad: "Schlecht",
};

export function parseLeadValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric =
    typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 10_000) {
    return undefined;
  }
  return Math.round(numeric * 100) / 100;
}

/** Sums configured option values for the selected answers. Undefined if no option has a value. */
export function computeApplicationLeadValue(
  config: FunnelConfig,
  answers: FunnelAnswers,
): number | undefined {
  let sum = 0;
  let found = false;

  for (const page of config.pages) {
    if (page.type !== "choice-grid" && page.type !== "choice-list") continue;
    const selected = new Set(answers[page.questionKey] ?? []);
    for (const option of page.options) {
      if (!selected.has(option.value)) continue;
      const value = parseLeadValue(option.leadValue);
      if (value === undefined) continue;
      sum += value;
      found = true;
    }
  }

  return found ? Math.round(sum * 100) / 100 : undefined;
}

export function resolveQualityEventName(quality: LeadQuality): string {
  return quality === "good"
    ? DEFAULT_LEAD_QUALITY_META.goodEventName
    : DEFAULT_LEAD_QUALITY_META.badEventName;
}

export function resolveQualityEventValue(
  quality: LeadQuality,
  applicationValue?: number,
  configured?: { good?: number; bad?: number },
): number {
  if (quality === "good") {
    const configuredGood = parseLeadValue(configured?.good);
    if (configuredGood !== undefined) return configuredGood;
    if (applicationValue !== undefined) return applicationValue;
    return DEFAULT_LEAD_QUALITY_META.goodValue;
  }

  const configuredBad = parseLeadValue(configured?.bad);
  return configuredBad ?? DEFAULT_LEAD_QUALITY_META.badValue;
}
