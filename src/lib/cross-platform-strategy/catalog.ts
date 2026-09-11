export const STRATEGY_PLATFORM_IDS = [
  "meta",
  "google",
  "openai_ads",
  "tiktok",
  "pinterest",
  "microsoft",
  "linkedin",
  "x",
  "reddit",
  "snapchat",
] as const;

export const STRATEGY_OBJECTIVES = [
  "awareness",
  "traffic",
  "engagement",
  "leads",
  "app_promotion",
  "sales",
] as const;

export const STRATEGY_CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "ZAR",
] as const;

export type StrategyPlatformId = (typeof STRATEGY_PLATFORM_IDS)[number];
export type StrategyObjective = (typeof STRATEGY_OBJECTIVES)[number];
export type StrategyCurrency = (typeof STRATEGY_CURRENCIES)[number];

export type StrategyPlatformProfile = {
  id: StrategyPlatformId;
  name: string;
  description: string;
  integrationStage: "live" | "next" | "roadmap";
  supportedObjectives: readonly StrategyObjective[];
};

export const STRATEGY_PLATFORM_CATALOG: readonly StrategyPlatformProfile[] = [
  {
    id: "meta",
    name: "Meta Ads",
    description: "Facebook und Instagram für Reichweite, Nachfrage und Conversion.",
    integrationStage: "live",
    supportedObjectives: STRATEGY_OBJECTIVES,
  },
  {
    id: "google",
    name: "Google Ads",
    description: "Search, Display, YouTube und Performance Max für vorhandene Nachfrage.",
    integrationStage: "next",
    supportedObjectives: STRATEGY_OBJECTIVES,
  },
  {
    id: "openai_ads",
    name: "ChatGPT Ads",
    description: "Kontextuelle Nachfrage und Empfehlungen in ChatGPT.",
    integrationStage: "live",
    supportedObjectives: ["awareness", "traffic", "engagement", "leads", "sales"],
  },
  {
    id: "tiktok",
    name: "TikTok Ads",
    description: "Video-Discovery, Aufmerksamkeit und Nachfragegenerierung.",
    integrationStage: "roadmap",
    supportedObjectives: STRATEGY_OBJECTIVES,
  },
  {
    id: "pinterest",
    name: "Pinterest Ads",
    description: "Visuelle Inspiration mit starkem Planungs- und Kaufkontext.",
    integrationStage: "roadmap",
    supportedObjectives: ["awareness", "traffic", "leads", "sales"],
  },
  {
    id: "microsoft",
    name: "Microsoft Advertising",
    description: "Search- und Audience-Nachfrage im Microsoft-Netzwerk.",
    integrationStage: "roadmap",
    supportedObjectives: STRATEGY_OBJECTIVES,
  },
  {
    id: "linkedin",
    name: "LinkedIn Ads",
    description: "Beruflicher B2B-Kontext für Reichweite, Leads und Recruiting.",
    integrationStage: "roadmap",
    supportedObjectives: ["awareness", "traffic", "engagement", "leads", "sales"],
  },
  {
    id: "x",
    name: "X Ads",
    description: "Aktuelle Themen, öffentliche Konversationen und Reichweite.",
    integrationStage: "roadmap",
    supportedObjectives: ["awareness", "traffic", "engagement", "app_promotion", "sales"],
  },
  {
    id: "reddit",
    name: "Reddit Ads",
    description: "Community- und Interessen-Kontext für spezialisierte Zielgruppen.",
    integrationStage: "roadmap",
    supportedObjectives: ["awareness", "traffic", "leads", "app_promotion", "sales"],
  },
  {
    id: "snapchat",
    name: "Snapchat Ads",
    description: "Mobile Video- und AR-Reichweite für jüngere Zielgruppen.",
    integrationStage: "roadmap",
    supportedObjectives: STRATEGY_OBJECTIVES,
  },
] as const;

export function isStrategyPlatformId(value: string): value is StrategyPlatformId {
  return STRATEGY_PLATFORM_IDS.includes(value as StrategyPlatformId);
}

export function isStrategyObjective(value: string): value is StrategyObjective {
  return STRATEGY_OBJECTIVES.includes(value as StrategyObjective);
}

export function isStrategyCurrency(value: string): value is StrategyCurrency {
  return STRATEGY_CURRENCIES.includes(value as StrategyCurrency);
}

export function getStrategyPlatformProfile(
  platform: StrategyPlatformId,
): StrategyPlatformProfile {
  const profile = STRATEGY_PLATFORM_CATALOG.find((item) => item.id === platform);
  if (!profile) {
    throw new Error(`Unbekannte Strategieplattform: ${platform}`);
  }
  return profile;
}
