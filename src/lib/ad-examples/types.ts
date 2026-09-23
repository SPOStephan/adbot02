/** Admin library grid page size — keeps the inspiration page short. */
export const AD_EXAMPLE_PAGE_SIZE = 24;

export const AD_EXAMPLE_PLATFORMS = [
  { value: "openai_ads", label: "ChatGPT Ads" },
  { value: "meta", label: "Meta Ads" },
  { value: "google", label: "Google Ads" },
  { value: "tiktok", label: "TikTok Ads" },
  { value: "linkedin", label: "LinkedIn Ads" },
  { value: "other", label: "Andere Plattform" },
] as const;

export const AD_EXAMPLE_OBJECTIVES = [
  { value: "awareness", label: "Bekanntheit / Reichweite" },
  { value: "traffic", label: "Website-Traffic" },
  { value: "engagement", label: "Interaktion" },
  { value: "leads", label: "Leads / Anfragen" },
  { value: "sales", label: "Verkäufe / Buchungen" },
  { value: "app_installs", label: "App-Installationen" },
  { value: "retention", label: "Bindung / Wiederkauf" },
  { value: "other", label: "Anderes Ziel" },
] as const;

export const AD_EXAMPLE_FUNNEL_STAGES = [
  { value: "awareness", label: "Awareness" },
  { value: "consideration", label: "Consideration" },
  { value: "conversion", label: "Conversion" },
  { value: "retention", label: "Retention" },
] as const;

export const AD_EXAMPLE_SOURCE_KINDS = [
  { value: "own_account", label: "Eigenes Werbekonto" },
  { value: "official_library", label: "Offizielle Anzeigenbibliothek" },
  { value: "chatgpt_ad_library", label: "ChatGPT Ad Library (chatgptadlibrary.com)" },
  { value: "advertiser_page", label: "Werbetreibender / Landingpage" },
  { value: "user_upload", label: "Manuell bereitgestellter Screenshot" },
  { value: "other", label: "Andere dokumentierte Quelle" },
] as const;

export const AD_EXAMPLE_EVIDENCE_LEVELS = [
  { value: "visual_only", label: "Nur Creative sichtbar" },
  { value: "public_transparency", label: "Öffentliche Transparenzdaten" },
  { value: "first_party_performance", label: "Eigene verifizierte Leistungsdaten" },
] as const;

export const AD_EXAMPLE_RIGHTS_BASES = [
  { value: "owned", label: "Eigenes Creative / eigene Rechte" },
  { value: "permission", label: "Nutzung mit Erlaubnis" },
  { value: "reference_only", label: "Nur interne Analyse / Referenz" },
] as const;

export type AdExamplePlatform = (typeof AD_EXAMPLE_PLATFORMS)[number]["value"];
export type AdExampleObjective = (typeof AD_EXAMPLE_OBJECTIVES)[number]["value"];
export type AdExampleFunnelStage = (typeof AD_EXAMPLE_FUNNEL_STAGES)[number]["value"];
export type AdExampleSourceKind = (typeof AD_EXAMPLE_SOURCE_KINDS)[number]["value"];
export type AdExampleEvidenceLevel = (typeof AD_EXAMPLE_EVIDENCE_LEVELS)[number]["value"];
export type AdExampleRightsBasis = (typeof AD_EXAMPLE_RIGHTS_BASES)[number]["value"];

export type AdExampleInput = {
  title: string;
  advertiserName: string;
  platform: AdExamplePlatform;
  industry: string;
  objective: AdExampleObjective;
  objectiveDetail: string;
  funnelStage: AdExampleFunnelStage;
  sourceKind: AdExampleSourceKind;
  sourceUrl: string | null;
  evidenceLevel: AdExampleEvidenceLevel;
  rightsBasis: AdExampleRightsBasis;
  rightsConfirmed: boolean;
  format: string;
  country: string;
  language: string;
  hookText: string;
  bodyText: string;
  ctaText: string;
  landingPageUrl: string | null;
  performanceNote: string;
  whyItWorks: string;
  tags: string[];
  qualityRating: number;
  useForGeneration: boolean;
  structureKind: "none" | "job" | "product" | "lead";
  structureSlotsText: string;
};

export type AdExampleView = AdExampleInput & {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  previewUrl: string;
  createdAt: string;
  updatedAt: string;
  legacy: boolean;
  triggeringPrompts: string[];
};

/** Canned ChatGPT-library sentence — never show this as if it were a trigger prompt. */
export function isGenericAdExampleObjectiveDetail(value: string): boolean {
  return /ChatGPT-Kontextanzeige aus öffentlicher Ad Library/i.test(value)
    || /^Interne Referenz aus chatgptadlibrary\.com/i.test(value);
}

export function labelForOption(
  options: readonly { value: string; label: string }[],
  value: string,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
