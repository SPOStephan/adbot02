export const platformIds = ["meta", "google", "tiktok", "pinterest"] as const;

export type PlatformId = (typeof platformIds)[number];

export type PlatformDefinition = {
  id: PlatformId;
  name: string;
  description: string;
  configured: boolean;
  requiredEnvironmentVariables: string[];
};

const definitions: Record<
  PlatformId,
  Omit<PlatformDefinition, "configured">
> = {
  meta: {
    id: "meta",
    name: "Meta Ads",
    description: "Facebook und Instagram Kampagnen",
    requiredEnvironmentVariables: ["META_APP_ID", "META_APP_SECRET"],
  },
  google: {
    id: "google",
    name: "Google Ads",
    description: "Search, Display und Performance Max",
    requiredEnvironmentVariables: [
      "GOOGLE_ADS_CLIENT_ID",
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_DEVELOPER_TOKEN",
    ],
  },
  tiktok: {
    id: "tiktok",
    name: "TikTok Ads",
    description: "Video-Kampagnen und Creatives",
    requiredEnvironmentVariables: ["TIKTOK_APP_ID", "TIKTOK_APP_SECRET"],
  },
  pinterest: {
    id: "pinterest",
    name: "Pinterest Ads",
    description: "Visuelle Kampagnen und Conversions",
    requiredEnvironmentVariables: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"],
  },
};

export function isPlatformId(value: string): value is PlatformId {
  return platformIds.includes(value as PlatformId);
}

export function getPlatformCatalog(): PlatformDefinition[] {
  return platformIds.map((id) => {
    const definition = definitions[id];
    const configured = definition.requiredEnvironmentVariables.every(
      (variable) => Boolean(process.env[variable]),
    );

    return { ...definition, configured };
  });
}
