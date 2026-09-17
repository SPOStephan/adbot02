export const META_AD_LIBRARY_DAILY_CAP = 200;
export const META_AD_LIBRARY_PROBE_LIMIT = 5;
export const META_AD_LIBRARY_FETCH_DEFAULT = 25;
export const META_AD_LIBRARY_FETCH_MAX = 50;
export const META_AD_LIBRARY_DEFAULT_COUNTRIES = ["DE", "AT", "CH"] as const;
export const META_AD_LIBRARY_DEFAULT_LONG_RUNNING_DAYS = 90;

export const META_AD_LIBRARY_REDIRECT_PATH = "/api/admin/meta-ad-library/callback";

export const META_AD_LIBRARY_FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_creative_link_captions",
  "ad_creative_link_descriptions",
  "ad_creative_link_titles",
  "ad_snapshot_url",
  "languages",
  "publisher_platforms",
  "eu_total_reach",
  "bylines",
  "currency",
  "spend",
  "impressions",
].join(",");

export type ArchivedAdKind = "commercial" | "political" | "unknown";

export type ArchivedAdRecord = {
  id: string;
  pageId: string | null;
  pageName: string;
  bodies: string[];
  titles: string[];
  captions: string[];
  descriptions: string[];
  snapshotUrl: string | null;
  languages: string[];
  platforms: string[];
  deliveryStart: string | null;
  deliveryStop: string | null;
  euTotalReach: number | null;
  bylines: string | null;
  kind: ArchivedAdKind;
  daysRunning: number | null;
};

export type MetaAdLibrarySearchInput = {
  searchTerms: string;
  countries: string[];
  longRunningDays: number;
  limit: number;
  industry: string;
  objective: string;
};

export type MetaAdLibraryProbeAd = {
  id: string;
  pageName: string;
  hookText: string;
  bodyText: string;
  ctaText: string;
  daysRunning: number | null;
  kind: ArchivedAdKind;
  sourceUrl: string;
  languages: string[];
};

export type MetaAdLibraryProbeResult = {
  searchedAt: string;
  searchTerms: string;
  countries: string[];
  longRunningDays: number;
  returned: number;
  commercial: number;
  political: number;
  unknown: number;
  longRunning: number;
  commercialScopeLooksUsable: boolean;
  warning: string | null;
  ads: MetaAdLibraryProbeAd[];
};

export type MetaAdLibraryAppStatus = {
  libraryAppConfigured: boolean;
  libraryAppId: string | null;
  isolatedFromProductApp: boolean;
  productAppConfigured: boolean;
  tokenPresent: boolean;
  tokenSource: "env" | "connection" | null;
  tokenExpiresAt: string | null;
  encryptionReady: boolean;
  redirectUri: string;
  fetchedToday: number;
  dailyCap: number;
  lastProbe: MetaAdLibraryProbeResult | null;
  lastProbeAt: string | null;
  lastProbeOk: boolean | null;
  migrationNeeded: boolean;
};

export const EMPTY_META_AD_LIBRARY_STATUS: MetaAdLibraryAppStatus = {
  libraryAppConfigured: false,
  libraryAppId: null,
  isolatedFromProductApp: false,
  productAppConfigured: false,
  tokenPresent: false,
  tokenSource: null,
  tokenExpiresAt: null,
  encryptionReady: false,
  redirectUri: "",
  fetchedToday: 0,
  dailyCap: META_AD_LIBRARY_DAILY_CAP,
  lastProbe: null,
  lastProbeAt: null,
  lastProbeOk: null,
  migrationNeeded: false,
};
