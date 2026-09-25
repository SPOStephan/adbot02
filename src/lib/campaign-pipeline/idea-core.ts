export const CAMPAIGN_IDEA_SOURCE_TYPES = [
  "LINK",
  "SCREENSHOT",
  "KEYWORDS",
] as const;

export type CampaignIdeaSourceType = (typeof CAMPAIGN_IDEA_SOURCE_TYPES)[number];

export const CAMPAIGN_IDEA_STATUSES = [
  "QUEUED",
  "READY",
  "REALIZING",
  "REALIZED",
  "FAILED",
  "ARCHIVED",
] as const;

export type CampaignIdeaStatus = (typeof CAMPAIGN_IDEA_STATUSES)[number];

export type CampaignIdeaCore = {
  product: string;
  offer: string;
  audience: string;
  hook_pattern: string;
  tone: string;
  visual_motif: string;
  funnel_angle: string;
  core_summary: string;
  forbidden_verbatim: string[];
  not_for_direct_use: true;
};

export type CampaignIdeaRealizedCopy = {
  primaryText: string;
  headline: string;
  description: string;
};

export type CampaignIdeaView = {
  id: string;
  sourceType: CampaignIdeaSourceType;
  status: CampaignIdeaStatus;
  sourceUrl: string | null;
  keywords: string | null;
  notes: string | null;
  screenshotAssetId: string | null;
  extractedCore: CampaignIdeaCore;
  extractedAt: string | null;
  lastError: string | null;
  destinationUrl: string | null;
  objective: string | null;
  realizedCopy: CampaignIdeaRealizedCopy | null;
  realizedAssetId: string | null;
  realizedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function asText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function asTextList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    const text = asText(entry, maxLen);
    if (text && !items.includes(text)) items.push(text);
    if (items.length >= maxItems) break;
  }
  return items;
}

export function emptyIdeaCore(summary: string): CampaignIdeaCore {
  return {
    product: "",
    offer: "",
    audience: "",
    hook_pattern: "",
    tone: "",
    visual_motif: "",
    funnel_angle: "",
    core_summary: asText(summary, 400) || "Idee erfasst — Kern folgt nach der Analyse.",
    forbidden_verbatim: [],
    not_for_direct_use: true,
  };
}

export function parseIdeaCore(value: unknown): CampaignIdeaCore {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const summary = asText(record.core_summary, 400);
  return {
    product: asText(record.product, 160),
    offer: asText(record.offer, 240),
    audience: asText(record.audience, 160),
    hook_pattern: asText(record.hook_pattern, 240),
    tone: asText(record.tone, 80),
    visual_motif: asText(record.visual_motif, 200),
    funnel_angle: asText(record.funnel_angle, 200),
    core_summary: summary || "Idee erfasst — Kern folgt nach der Analyse.",
    forbidden_verbatim: asTextList(record.forbidden_verbatim, 8, 160),
    not_for_direct_use: true,
  };
}

export function parseRealizedCopy(value: unknown): CampaignIdeaRealizedCopy | null {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const primaryText = asText(record.primaryText ?? record.primary_text, 2_200);
  const headline = asText(record.headline ?? record.name, 255);
  const description = asText(record.description, 255);
  if (!primaryText || !headline) return null;
  return { primaryText, headline, description };
}

export function ideaCoreHasSubstance(core: CampaignIdeaCore): boolean {
  return Boolean(
    core.product ||
      core.offer ||
      core.hook_pattern ||
      (core.core_summary && core.core_summary.length >= 24),
  );
}
