export const CAMPAIGN_GEO_PLACE_KINDS = [
  "country",
  "region",
  "city",
  "other",
] as const;

export type CampaignGeoPlaceKind = (typeof CAMPAIGN_GEO_PLACE_KINDS)[number];

export type CampaignGeoTarget = {
  placeLabel: string;
  placeKind: CampaignGeoPlaceKind;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number | null;
  openaiLocationId: string | null;
  metaLocationKey: string | null;
};

export type CampaignGeoSearchHit = {
  placeLabel: string;
  placeKind: CampaignGeoPlaceKind;
  countryCode: string | null;
  latitude: number;
  longitude: number;
};

export type PlatformGeoCapability = {
  id: "meta" | "openai_ads" | "google" | "tiktok" | "pinterest";
  name: string;
  supportsPlace: boolean;
  supportsRadius: boolean;
  launchWired: boolean;
  note: string;
};

export const CITY_RADIUS_FALLBACK_KM = 25;
export const META_RADIUS_MIN_KM = 1;
export const META_RADIUS_MAX_KM = 80;

export const PLATFORM_GEO_CAPABILITIES: PlatformGeoCapability[] = [
  {
    id: "meta",
    name: "Meta Ads",
    supportsPlace: true,
    supportsRadius: true,
    launchWired: true,
    note: "Umkreis als custom_locations, sonst Land. Wohnort (home).",
  },
  {
    id: "openai_ads",
    name: "ChatGPT Ads",
    supportsPlace: true,
    supportsRadius: false,
    launchWired: true,
    note: "Ort ja. Radius gibt es bei OpenAI nicht — nächster passender Standort.",
  },
  {
    id: "google",
    name: "Google Ads",
    supportsPlace: true,
    supportsRadius: true,
    launchWired: false,
    note: "Proximity-Targeting, sobald der Google-Launch existiert.",
  },
  {
    id: "tiktok",
    name: "TikTok Ads",
    supportsPlace: true,
    supportsRadius: true,
    launchWired: false,
    note: "Standort plus Radius, sobald der TikTok-Launch existiert.",
  },
  {
    id: "pinterest",
    name: "Pinterest Ads",
    supportsPlace: true,
    supportsRadius: false,
    launchWired: false,
    note: "Nur Ort/Land, kein vergleichbarer Radius.",
  },
];
