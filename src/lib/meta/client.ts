import "server-only";

import { createAppSecretProof } from "./crypto";

export const META_GRAPH_VERSION = "v25.0";
export const META_ALLOWED_SCOPES = [
  "ads_read",
  "instagram_basic",
  "pages_read_engagement",
  "pages_show_list",
] as const;

const META_DIALOG_ORIGIN = "https://www.facebook.com";
const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const META_COLLECTION_PAGE_SIZE = 25;
const META_MAX_COLLECTION_PAGES = 2;
const META_ABSOLUTE_MAX_COLLECTION_PAGES = 100;
const META_REQUEST_TIMEOUT_MS = 15_000;
const META_CAPTION_MAX_LENGTH = 500;

export type MetaUsageSnapshot = {
  appPercent: number | null;
  pagePercent: number | null;
  businessPercent: number | null;
  adAccountPercent?: number | null;
  insightsPercent?: number | null;
  retryAfterSeconds: number | null;
};

export type MetaAccessToken = {
  accessToken: string;
  expiresInSeconds: number | null;
  tokenType: string | null;
  usage: MetaUsageSnapshot;
};

export type MetaIdentity = {
  id: string;
};

export type MetaTokenDebug = {
  appId: string;
  userId: string;
  isValid: boolean;
  scopes: string[];
  granularScopes: Array<{
    scope: string;
    targetIds: string[];
  }>;
  expiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  usage: MetaUsageSnapshot;
};

export type MetaPageAsset = {
  id: string;
  name: string;
  accessToken: string;
  instagramAccount: {
    id: string;
    name: string | null;
    username: string | null;
  } | null;
};

export type MetaAdAccountAsset = {
  id: string;
  name: string;
};

export type MetaConnectionAssets = {
  pages: MetaPageAsset[];
  adAccounts: MetaAdAccountAsset[];
  usage: MetaUsageSnapshot;
};

export type MetaContentItem = {
  source: "facebook" | "instagram";
  id: string;
  contentType: "post" | "image" | "video" | "carousel" | "reel" | "unknown";
  captionExcerpt: string | null;
  permalinkUrl: string | null;
  previewUrl: string | null;
  publishedAt: string | null;
};

export type MetaContentResult = {
  items: MetaContentItem[];
  usage: MetaUsageSnapshot;
};

type MetaErrorBody = {
  error?: {
    code?: number;
    type?: string;
    error_subcode?: number;
  };
};

type MetaJsonResponse = {
  body: unknown;
  usage: MetaUsageSnapshot;
};

const EMPTY_USAGE: MetaUsageSnapshot = {
  appPercent: null,
  pagePercent: null,
  businessPercent: null,
  adAccountPercent: null,
  insightsPercent: null,
  retryAfterSeconds: null,
};

export class MetaGraphError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly subcode: number | null;
  readonly usage: MetaUsageSnapshot;

  constructor(
    status: number,
    body: MetaErrorBody,
    usage: MetaUsageSnapshot = EMPTY_USAGE,
  ) {
    super("Meta Graph API request failed");
    this.name = "MetaGraphError";
    this.status = status;
    this.code = body.error?.code ?? null;
    this.subcode = body.error?.error_subcode ?? null;
    this.usage = usage;
  }

  get rateLimited() {
    return this.status === 429
      || this.code === 4
      || this.code === 17
      || this.code === 32
      || this.code === 613
      || this.code === 80001
      || this.code === 80004;
  }

  get reconnectRequired() {
    return this.code === 190;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asDateFromUnixSeconds(value: unknown): Date | null {
  const seconds = asFiniteNumber(value);

  if (!seconds || seconds <= 0) {
    return null;
  }

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampPercent(value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.min(100, value));
}

function maximum(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? Math.max(...present) : null;
}

function usagePercentFromRecord(value: unknown): number | null {
  if (!isRecord(value)) {
    return null;
  }

  return clampPercent(
    maximum([
      asFiniteNumber(value.call_count),
      asFiniteNumber(value.total_cputime),
      asFiniteNumber(value.total_time),
    ]),
  );
}

function usagePercentFromKeys(value: unknown, keys: string[]): number | null {
  if (!isRecord(value)) {
    return null;
  }

  return clampPercent(maximum(keys.map((key) => asFiniteNumber(value[key]))));
}

function parseUsageHeader(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const numeric = Number(value);

  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.ceil(numeric);
  }

  const date = new Date(value);
  const seconds = Math.ceil((date.getTime() - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function parseBusinessUsage(value: unknown): {
  percent: number | null;
  retryAfterSeconds: number | null;
} {
  if (!isRecord(value)) {
    return { percent: null, retryAfterSeconds: null };
  }

  const percentages: number[] = [];
  const regainSeconds: number[] = [];

  for (const entries of Object.values(value)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const entry of entries) {
      if (!isRecord(entry)) {
        continue;
      }

      const percent = usagePercentFromRecord(entry);
      const regainMinutes = asFiniteNumber(entry.estimated_time_to_regain_access);

      if (percent !== null) {
        percentages.push(percent);
      }

      if (regainMinutes !== null && regainMinutes > 0) {
        regainSeconds.push(Math.ceil(regainMinutes * 60));
      }
    }
  }

  return {
    percent: percentages.length ? Math.max(...percentages) : null,
    retryAfterSeconds: regainSeconds.length ? Math.max(...regainSeconds) : null,
  };
}

export function metaUsageFromHeaders(headers: Headers): MetaUsageSnapshot {
  const business = parseBusinessUsage(
    parseUsageHeader(headers.get("x-business-use-case-usage")),
  );
  const adAccount = parseUsageHeader(headers.get("x-ad-account-usage"));
  const insights = parseUsageHeader(headers.get("x-fb-ads-insights-throttle"));

  return {
    appPercent: usagePercentFromRecord(
      parseUsageHeader(headers.get("x-app-usage")),
    ),
    pagePercent: usagePercentFromRecord(
      parseUsageHeader(headers.get("x-page-usage")),
    ),
    businessPercent: business.percent,
    adAccountPercent: maximum([
      usagePercentFromRecord(adAccount),
      usagePercentFromKeys(adAccount, ["acc_id_util_pct"]),
    ]),
    insightsPercent: usagePercentFromKeys(insights, [
      "app_id_util_pct",
      "acc_id_util_pct",
    ]),
    retryAfterSeconds: maximum([
      parseRetryAfter(headers.get("retry-after")),
      business.retryAfterSeconds,
    ]),
  };
}

export function mergeMetaUsage(
  left: MetaUsageSnapshot,
  right: MetaUsageSnapshot,
): MetaUsageSnapshot {
  return {
    appPercent: maximum([left.appPercent, right.appPercent]),
    pagePercent: maximum([left.pagePercent, right.pagePercent]),
    businessPercent: maximum([left.businessPercent, right.businessPercent]),
    adAccountPercent: maximum([
      left.adAccountPercent ?? null,
      right.adAccountPercent ?? null,
    ]),
    insightsPercent: maximum([
      left.insightsPercent ?? null,
      right.insightsPercent ?? null,
    ]),
    retryAfterSeconds: maximum([
      left.retryAfterSeconds,
      right.retryAfterSeconds,
    ]),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchMetaJson(
  url: URL,
  headers: Record<string, string> = {},
): Promise<MetaJsonResponse> {
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(META_REQUEST_TIMEOUT_MS),
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });
  const body = await readJson(response);
  const usage = metaUsageFromHeaders(response.headers);

  if (!response.ok) {
    throw new MetaGraphError(
      response.status,
      isRecord(body) ? (body as MetaErrorBody) : {},
      usage,
    );
  }

  return { body, usage };
}

function addTokenProtection(
  url: URL,
  accessToken: string,
  appSecret: string,
): Record<string, string> {
  url.searchParams.set(
    "appsecret_proof",
    createAppSecretProof(accessToken, appSecret),
  );

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function safeHttpsUrl(value: unknown): string | null {
  const raw = asNonEmptyString(value);

  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function captionExcerpt(value: unknown): string | null {
  const text = asNonEmptyString(value)?.replace(/\s+/g, " ");
  return text ? text.slice(0, META_CAPTION_MAX_LENGTH) : null;
}

function validPublishedAt(value: unknown): string | null {
  const raw = asNonEmptyString(value);

  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function validateNextPageUrl(value: unknown): URL | null {
  const raw = asNonEmptyString(value);

  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);

    if (
      url.origin !== META_GRAPH_ORIGIN ||
      !url.pathname.startsWith(`/${META_GRAPH_VERSION}/`)
    ) {
      return null;
    }

    url.searchParams.delete("access_token");
    url.searchParams.delete("appsecret_proof");
    return url;
  } catch {
    return null;
  }
}

export class MetaCollectionLimitError extends Error {
  readonly reason: "items" | "pages" | "pagination";
  readonly usage: MetaUsageSnapshot;

  constructor(
    reason: "items" | "pages" | "pagination",
    usage: MetaUsageSnapshot,
  ) {
    super(`Meta collection could not be completed: ${reason}`);
    this.name = "MetaCollectionLimitError";
    this.reason = reason;
    this.usage = usage;
  }
}

async function fetchMetaCollection<T>(input: {
  initialUrl: URL;
  accessToken: string;
  appSecret: string;
  parseItem: (value: unknown) => T | null;
  maxPages?: number;
  maxItems?: number;
  requireComplete?: boolean;
}): Promise<{ items: T[]; usage: MetaUsageSnapshot }> {
  const items: T[] = [];
  const seenPageUrls = new Set<string>();
  let usage = EMPTY_USAGE;
  let nextUrl: URL | null = input.initialUrl;
  const maxPages = Math.max(
    1,
    Math.min(
      META_ABSOLUTE_MAX_COLLECTION_PAGES,
      input.maxPages ?? META_MAX_COLLECTION_PAGES,
    ),
  );
  const maxItems = Math.max(1, Math.min(100_000, input.maxItems ?? 5_000));

  for (let page = 0; page < maxPages && nextUrl; page += 1) {
    const pageKey = nextUrl.toString();

    if (seenPageUrls.has(pageKey)) {
      throw new MetaCollectionLimitError("pagination", usage);
    }

    seenPageUrls.add(pageKey);
    const headers = addTokenProtection(
      nextUrl,
      input.accessToken,
      input.appSecret,
    );
    const response = await fetchMetaJson(nextUrl, headers);
    usage = mergeMetaUsage(usage, response.usage);

    if (!isRecord(response.body) || !Array.isArray(response.body.data)) {
      throw new MetaGraphError(502, {}, usage);
    }

    for (const item of response.body.data) {
      const parsed = input.parseItem(item);

      if (parsed) {
        items.push(parsed);
      }

      if (items.length > maxItems) {
        throw new MetaCollectionLimitError("items", usage);
      }
    }

    const paging = isRecord(response.body.paging) ? response.body.paging : null;
    const rawNext = paging?.next;
    const parsedNext = paging ? validateNextPageUrl(rawNext) : null;

    if (input.requireComplete && rawNext && !parsedNext) {
      throw new MetaCollectionLimitError("pagination", usage);
    }

    nextUrl = parsedNext;
  }

  if (input.requireComplete && nextUrl) {
    throw new MetaCollectionLimitError("pages", usage);
  }

  return { items, usage };
}

export function createMetaLoginUrl(input: {
  appId: string;
  configId: string;
  redirectUri: string;
  state: string;
}): URL {
  const url = new URL(`/${META_GRAPH_VERSION}/dialog/oauth`, META_DIALOG_ORIGIN);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("config_id", input.configId);

  return url;
}

export async function exchangeCodeForAccessToken(input: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}): Promise<MetaAccessToken> {
  const url = new URL(
    `/${META_GRAPH_VERSION}/oauth/access_token`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("code", input.code);
  url.searchParams.set("redirect_uri", input.redirectUri);

  const { body, usage } = await fetchMetaJson(url);

  if (!isRecord(body) || typeof body.access_token !== "string") {
    throw new MetaGraphError(502, {}, usage);
  }

  return {
    accessToken: body.access_token,
    expiresInSeconds:
      typeof body.expires_in === "number" ? body.expires_in : null,
    tokenType: typeof body.token_type === "string" ? body.token_type : null,
    usage,
  };
}

export async function exchangeForLongLivedAccessToken(input: {
  appId: string;
  appSecret: string;
  shortLivedAccessToken: string;
}): Promise<MetaAccessToken> {
  const url = new URL(
    `/${META_GRAPH_VERSION}/oauth/access_token`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("fb_exchange_token", input.shortLivedAccessToken);

  const { body, usage } = await fetchMetaJson(url);

  if (!isRecord(body) || typeof body.access_token !== "string") {
    throw new MetaGraphError(502, {}, usage);
  }

  return {
    accessToken: body.access_token,
    expiresInSeconds:
      typeof body.expires_in === "number" ? body.expires_in : null,
    tokenType: typeof body.token_type === "string" ? body.token_type : null,
    usage,
  };
}

export async function debugMetaAccessToken(input: {
  appId: string;
  appSecret: string;
  accessToken: string;
}): Promise<MetaTokenDebug> {
  const url = new URL(`/${META_GRAPH_VERSION}/debug_token`, META_GRAPH_ORIGIN);
  url.searchParams.set("input_token", input.accessToken);
  url.searchParams.set("access_token", `${input.appId}|${input.appSecret}`);

  const { body, usage } = await fetchMetaJson(url);
  const data = isRecord(body) && isRecord(body.data) ? body.data : null;

  if (!data) {
    throw new MetaGraphError(502, {}, usage);
  }

  const scopes = Array.isArray(data.scopes)
    ? data.scopes.filter((value): value is string => typeof value === "string")
    : [];
  const granularScopes = Array.isArray(data.granular_scopes)
    ? data.granular_scopes.flatMap((value) => {
        if (!isRecord(value) || typeof value.scope !== "string") {
          return [];
        }

        return [
          {
            scope: value.scope,
            targetIds: Array.isArray(value.target_ids)
              ? value.target_ids.filter(
                  (target): target is string => typeof target === "string",
                )
              : [],
          },
        ];
      })
    : [];

  return {
    appId: asNonEmptyString(data.app_id) ?? "",
    userId: asNonEmptyString(data.user_id) ?? "",
    isValid: data.is_valid === true,
    scopes,
    granularScopes,
    expiresAt: asDateFromUnixSeconds(data.expires_at),
    dataAccessExpiresAt: asDateFromUnixSeconds(data.data_access_expires_at),
    usage,
  };
}

export function getGranularTargetIds(
  tokenDebug: MetaTokenDebug,
  scope: string,
): Set<string> {
  return new Set(
    tokenDebug.granularScopes
      .filter((item) => item.scope === scope)
      .flatMap((item) => item.targetIds),
  );
}

export async function getMetaIdentity(input: {
  accessToken: string;
  appSecret: string;
}): Promise<MetaIdentity> {
  const url = new URL(`/${META_GRAPH_VERSION}/me`, META_GRAPH_ORIGIN);
  url.searchParams.set("fields", "id");
  const { body, usage } = await fetchMetaJson(
    url,
    addTokenProtection(url, input.accessToken, input.appSecret),
  );

  if (!isRecord(body) || typeof body.id !== "string") {
    throw new MetaGraphError(502, {}, usage);
  }

  return { id: body.id };
}

function parsePageAsset(value: unknown): MetaPageAsset | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asNonEmptyString(value.id);
  const name = asNonEmptyString(value.name);
  const accessToken = asNonEmptyString(value.access_token);

  if (!id || !name || !accessToken) {
    return null;
  }

  const instagram = isRecord(value.instagram_business_account)
    ? value.instagram_business_account
    : null;
  const instagramId = instagram ? asNonEmptyString(instagram.id) : null;

  return {
    id,
    name: name.slice(0, 255),
    accessToken,
    instagramAccount: instagramId
      ? {
          id: instagramId,
          name: asNonEmptyString(instagram?.name)?.slice(0, 255) ?? null,
          username:
            asNonEmptyString(instagram?.username)?.slice(0, 255) ?? null,
        }
      : null,
  };
}

function parseAdAccount(value: unknown): MetaAdAccountAsset | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asNonEmptyString(value.id);
  const name = asNonEmptyString(value.name);

  return id && name ? { id, name: name.slice(0, 255) } : null;
}

function normalizeAdAccountId(value: string): string {
  return value.startsWith("act_") ? value.slice(4) : value;
}

export async function getMetaPageAssets(input: {
  accessToken: string;
  appSecret: string;
  allowedPageIds?: Set<string>;
}): Promise<{ pages: MetaPageAsset[]; usage: MetaUsageSnapshot }> {
  const pageUrl = new URL(`/${META_GRAPH_VERSION}/me/accounts`, META_GRAPH_ORIGIN);
  pageUrl.searchParams.set(
    "fields",
    "id,name,access_token,instagram_business_account{id,name,username}",
  );
  pageUrl.searchParams.set("limit", String(META_COLLECTION_PAGE_SIZE));

  const result = await fetchMetaCollection({
    initialUrl: pageUrl,
    accessToken: input.accessToken,
    appSecret: input.appSecret,
    parseItem: parsePageAsset,
  });

  return {
    pages: result.items.filter(
      (page) => !input.allowedPageIds?.size || input.allowedPageIds.has(page.id),
    ),
    usage: result.usage,
  };
}

export async function getMetaConnectionAssets(input: {
  accessToken: string;
  appSecret: string;
  allowedPageIds?: Set<string>;
  allowedAdAccountIds?: Set<string>;
}): Promise<MetaConnectionAssets> {
  const pagesResult = await getMetaPageAssets(input);
  const adAccountUrl = new URL(
    `/${META_GRAPH_VERSION}/me/adaccounts`,
    META_GRAPH_ORIGIN,
  );
  adAccountUrl.searchParams.set("fields", "id,name");
  adAccountUrl.searchParams.set("limit", String(META_COLLECTION_PAGE_SIZE));

  const adAccountsResult = await fetchMetaCollection({
    initialUrl: adAccountUrl,
    accessToken: input.accessToken,
    appSecret: input.appSecret,
    parseItem: parseAdAccount,
  });
  const allowedAdAccountIds = new Set(
    [...(input.allowedAdAccountIds ?? [])].map(normalizeAdAccountId),
  );
  const adAccounts = adAccountsResult.items.filter(
    (account) =>
      !allowedAdAccountIds.size ||
      allowedAdAccountIds.has(normalizeAdAccountId(account.id)),
  );

  return {
    pages: pagesResult.pages,
    adAccounts,
    usage: mergeMetaUsage(pagesResult.usage, adAccountsResult.usage),
  };
}

function parseFacebookPost(value: unknown): MetaContentItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asNonEmptyString(value.id);

  if (!id) {
    return null;
  }

  return {
    source: "facebook",
    id,
    contentType: safeHttpsUrl(value.full_picture) ? "image" : "post",
    captionExcerpt: captionExcerpt(value.message),
    permalinkUrl: safeHttpsUrl(value.permalink_url),
    previewUrl: safeHttpsUrl(value.full_picture),
    publishedAt: validPublishedAt(value.created_time),
  };
}

function instagramContentType(value: Record<string, unknown>): MetaContentItem["contentType"] {
  const productType = asNonEmptyString(value.media_product_type)?.toUpperCase();
  const mediaType = asNonEmptyString(value.media_type)?.toUpperCase();

  if (productType === "REELS") {
    return "reel";
  }

  if (mediaType === "CAROUSEL_ALBUM") {
    return "carousel";
  }

  if (mediaType === "VIDEO") {
    return "video";
  }

  if (mediaType === "IMAGE") {
    return "image";
  }

  return "unknown";
}

function parseInstagramMedia(value: unknown): MetaContentItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = asNonEmptyString(value.id);

  if (!id) {
    return null;
  }

  return {
    source: "instagram",
    id,
    contentType: instagramContentType(value),
    captionExcerpt: captionExcerpt(value.caption),
    permalinkUrl: safeHttpsUrl(value.permalink),
    previewUrl: safeHttpsUrl(value.thumbnail_url) ?? safeHttpsUrl(value.media_url),
    publishedAt: validPublishedAt(value.timestamp),
  };
}

export async function getFacebookPublishedPosts(input: {
  pageId: string;
  pageAccessToken: string;
  appSecret: string;
}): Promise<MetaContentResult> {
  const url = new URL(
    `/${META_GRAPH_VERSION}/${encodeURIComponent(input.pageId)}/published_posts`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set(
    "fields",
    "id,message,permalink_url,created_time,full_picture",
  );
  url.searchParams.set("limit", String(META_COLLECTION_PAGE_SIZE));

  return fetchMetaCollection({
    initialUrl: url,
    accessToken: input.pageAccessToken,
    appSecret: input.appSecret,
    parseItem: parseFacebookPost,
  });
}

export async function getInstagramMedia(input: {
  instagramAccountId: string;
  pageAccessToken: string;
  appSecret: string;
}): Promise<MetaContentResult> {
  const url = new URL(
    `/${META_GRAPH_VERSION}/${encodeURIComponent(input.instagramAccountId)}/media`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url",
  );
  url.searchParams.set("limit", String(META_COLLECTION_PAGE_SIZE));

  return fetchMetaCollection({
    initialUrl: url,
    accessToken: input.pageAccessToken,
    appSecret: input.appSecret,
    parseItem: parseInstagramMedia,
  });
}


const META_MARKETING_PAGE_SIZE = 100;
const META_MARKETING_MAX_PAGES = 50;
const META_MARKETING_MAX_OBJECTS = 10_000;
const META_CREATIVE_BATCH_SIZE = 50;
const META_INSIGHTS_MAX_ROWS = 50_000;
const META_MARKETING_NAME_MAX_LENGTH = 500;
const META_CREATIVE_TEXT_MAX_LENGTH = 5_000;

export type MetaAdAccountSummary = {
  id: string;
  name: string;
  currency: string;
  timezoneName: string;
  timezoneOffsetHoursUtc: number | null;
  accountStatus: number | null;
};

export type MetaCampaign = {
  id: string;
  accountId: string | null;
  name: string;
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  budgetRemainingMinor: string | null;
  spendCapMinor: string | null;
  bidStrategy: string | null;
  isAdSetBudgetSharingEnabled: boolean | null;
  specialAdCategories: string[];
  startTime: string | null;
  stopTime: string | null;
  createdTime: string | null;
  updatedTime: string | null;
};

export type MetaAdSet = {
  id: string;
  accountId: string | null;
  campaignId: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  destinationType: string | null;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  budgetRemainingMinor: string | null;
  bidAmountMinor: string | null;
  bidStrategy: string | null;
  startTime: string | null;
  endTime: string | null;
  createdTime: string | null;
  updatedTime: string | null;
};

export type MetaAd = {
  id: string;
  accountId: string | null;
  campaignId: string;
  adSetId: string;
  creativeId: string | null;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  createdTime: string | null;
  updatedTime: string | null;
};

export type MetaAdCreative = {
  id: string;
  accountId: string | null;
  name: string | null;
  title: string | null;
  body: string | null;
  callToActionType: string | null;
  thumbnailUrl: string | null;
  effectiveObjectStoryId: string | null;
  effectiveInstagramMediaId: string | null;
  instagramPermalinkUrl: string | null;
  objectType: string | null;
  status: string | null;
};

export type MetaActionMetric = {
  actionType: string;
  value: string;
};

export type MetaAdInsight = {
  accountId: string | null;
  campaignId: string;
  campaignName: string | null;
  adSetId: string;
  adSetName: string | null;
  adId: string;
  adName: string | null;
  dateStart: string;
  dateStop: string;
  impressions: string | null;
  reach: string | null;
  frequency: string | null;
  clicks: string | null;
  inlineLinkClicks: string | null;
  spend: string | null;
  cpm: string | null;
  cpc: string | null;
  ctr: string | null;
  actions: MetaActionMetric[];
  actionValues: MetaActionMetric[];
  costPerActionType: MetaActionMetric[];
  attributionSetting: string | null;
};

export type MetaMarketingCollection<T> = {
  items: T[];
  usage: MetaUsageSnapshot;
};

function boundedText(value: unknown, maxLength: number): string | null {
  return asNonEmptyString(value)?.replace(/\s+/g, " ").slice(0, maxLength) ?? null;
}

function metaObjectId(value: unknown): string | null {
  const candidate = asNonEmptyString(value);
  return candidate && /^\d{1,32}$/.test(candidate) ? candidate : null;
}

function metaAccountId(value: unknown): string | null {
  const candidate = asNonEmptyString(value);

  if (!candidate) {
    return null;
  }

  const normalized = candidate.startsWith("act_") ? candidate.slice(4) : candidate;
  return /^\d{1,32}$/.test(normalized) ? normalized : null;
}

export function normalizeMetaAdAccountId(value: string): string {
  const id = metaAccountId(value);

  if (!id) {
    throw new TypeError("Invalid Meta ad account ID");
  }

  return `act_${id}`;
}

function enumString(value: unknown): string | null {
  const candidate = asNonEmptyString(value);
  return candidate && /^[A-Z0-9_]{1,100}$/i.test(candidate) ? candidate : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nonNegativeNumericString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }

  const candidate = asNonEmptyString(value);

  if (!candidate || !/^\d{1,30}(?:\.\d{1,12})?$/.test(candidate)) {
    return null;
  }

  return candidate;
}

function isoDate(value: unknown): string | null {
  const candidate = asNonEmptyString(value);

  if (!candidate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return null;
  }

  const date = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate
    ? null
    : candidate;
}

function platformTimestamp(value: unknown): string | null {
  return validPublishedAt(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.flatMap((entry) => {
    const parsed = enumString(entry);
    return parsed ? [parsed] : [];
  }))].slice(0, 20);
}

function actionMetrics(value: unknown): MetaActionMetric[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byType = new Map<string, string>();

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const actionType = boundedText(entry.action_type, 200);
    const metricValue = nonNegativeNumericString(entry.value);

    if (actionType && metricValue) {
      byType.set(actionType, metricValue);
    }
  }

  return [...byType.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionType, value]) => ({ actionType, value }));
}

function parseAdAccountSummary(value: unknown): MetaAdAccountSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = metaAccountId(value.id);
  const name = boundedText(value.name, META_MARKETING_NAME_MAX_LENGTH);
  const currency = asNonEmptyString(value.currency)?.toUpperCase();
  const timezoneName = asNonEmptyString(value.timezone_name);

  if (!id || !name || !currency || !/^[A-Z]{3}$/.test(currency) || !timezoneName) {
    return null;
  }

  return {
    id,
    name,
    currency,
    timezoneName: timezoneName.slice(0, 100),
    timezoneOffsetHoursUtc: asFiniteNumber(value.timezone_offset_hours_utc),
    accountStatus: asFiniteNumber(value.account_status),
  };
}

function parseCampaign(value: unknown): MetaCampaign | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = metaObjectId(value.id);
  const name = boundedText(value.name, META_MARKETING_NAME_MAX_LENGTH);

  if (!id || !name) {
    return null;
  }

  return {
    id,
    accountId: metaAccountId(value.account_id),
    name,
    objective: enumString(value.objective),
    status: enumString(value.status),
    effectiveStatus: enumString(value.effective_status),
    dailyBudgetMinor: nonNegativeNumericString(value.daily_budget),
    lifetimeBudgetMinor: nonNegativeNumericString(value.lifetime_budget),
    budgetRemainingMinor: nonNegativeNumericString(value.budget_remaining),
    spendCapMinor: nonNegativeNumericString(value.spend_cap),
    bidStrategy: enumString(value.bid_strategy),
    isAdSetBudgetSharingEnabled: optionalBoolean(
      value.is_adset_budget_sharing_enabled,
    ),
    specialAdCategories: stringArray(value.special_ad_categories),
    startTime: platformTimestamp(value.start_time),
    stopTime: platformTimestamp(value.stop_time),
    createdTime: platformTimestamp(value.created_time),
    updatedTime: platformTimestamp(value.updated_time),
  };
}

function parseAdSet(value: unknown): MetaAdSet | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = metaObjectId(value.id);
  const campaignId = metaObjectId(value.campaign_id);
  const name = boundedText(value.name, META_MARKETING_NAME_MAX_LENGTH);

  if (!id || !campaignId || !name) {
    return null;
  }

  return {
    id,
    accountId: metaAccountId(value.account_id),
    campaignId,
    name,
    status: enumString(value.status),
    effectiveStatus: enumString(value.effective_status),
    optimizationGoal: enumString(value.optimization_goal),
    billingEvent: enumString(value.billing_event),
    destinationType: enumString(value.destination_type),
    dailyBudgetMinor: nonNegativeNumericString(value.daily_budget),
    lifetimeBudgetMinor: nonNegativeNumericString(value.lifetime_budget),
    budgetRemainingMinor: nonNegativeNumericString(value.budget_remaining),
    bidAmountMinor: nonNegativeNumericString(value.bid_amount),
    bidStrategy: enumString(value.bid_strategy),
    startTime: platformTimestamp(value.start_time),
    endTime: platformTimestamp(value.end_time),
    createdTime: platformTimestamp(value.created_time),
    updatedTime: platformTimestamp(value.updated_time),
  };
}

function parseAd(value: unknown): MetaAd | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = metaObjectId(value.id);
  const campaignId = metaObjectId(value.campaign_id);
  const adSetId = metaObjectId(value.adset_id);
  const name = boundedText(value.name, META_MARKETING_NAME_MAX_LENGTH);
  const creative = isRecord(value.creative) ? value.creative : null;

  if (!id || !campaignId || !adSetId || !name) {
    return null;
  }

  return {
    id,
    accountId: metaAccountId(value.account_id),
    campaignId,
    adSetId,
    creativeId: creative ? metaObjectId(creative.id) : null,
    name,
    status: enumString(value.status),
    effectiveStatus: enumString(value.effective_status),
    createdTime: platformTimestamp(value.created_time),
    updatedTime: platformTimestamp(value.updated_time),
  };
}

function parseAdCreative(value: unknown): MetaAdCreative | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = metaObjectId(value.id);

  if (!id) {
    return null;
  }

  return {
    id,
    accountId: metaAccountId(value.account_id),
    name: boundedText(value.name, META_MARKETING_NAME_MAX_LENGTH),
    title: boundedText(value.title, META_CREATIVE_TEXT_MAX_LENGTH),
    body: boundedText(value.body, META_CREATIVE_TEXT_MAX_LENGTH),
    callToActionType: enumString(value.call_to_action_type),
    thumbnailUrl: safeHttpsUrl(value.thumbnail_url),
    effectiveObjectStoryId: boundedText(value.effective_object_story_id, 100),
    effectiveInstagramMediaId: metaObjectId(value.effective_instagram_media_id),
    instagramPermalinkUrl: safeHttpsUrl(value.instagram_permalink_url),
    objectType: enumString(value.object_type),
    status: enumString(value.status),
  };
}

function parseAdInsight(value: unknown): MetaAdInsight | null {
  if (!isRecord(value)) {
    return null;
  }

  const campaignId = metaObjectId(value.campaign_id);
  const adSetId = metaObjectId(value.adset_id);
  const adId = metaObjectId(value.ad_id);
  const dateStart = isoDate(value.date_start);
  const dateStop = isoDate(value.date_stop);

  if (!campaignId || !adSetId || !adId || !dateStart || !dateStop) {
    return null;
  }

  return {
    accountId: metaAccountId(value.account_id),
    campaignId,
    campaignName: boundedText(value.campaign_name, META_MARKETING_NAME_MAX_LENGTH),
    adSetId,
    adSetName: boundedText(value.adset_name, META_MARKETING_NAME_MAX_LENGTH),
    adId,
    adName: boundedText(value.ad_name, META_MARKETING_NAME_MAX_LENGTH),
    dateStart,
    dateStop,
    impressions: nonNegativeNumericString(value.impressions),
    reach: nonNegativeNumericString(value.reach),
    frequency: nonNegativeNumericString(value.frequency),
    clicks: nonNegativeNumericString(value.clicks),
    inlineLinkClicks: nonNegativeNumericString(value.inline_link_clicks),
    spend: nonNegativeNumericString(value.spend),
    cpm: nonNegativeNumericString(value.cpm),
    cpc: nonNegativeNumericString(value.cpc),
    ctr: nonNegativeNumericString(value.ctr),
    actions: actionMetrics(value.actions),
    actionValues: actionMetrics(value.action_values),
    costPerActionType: actionMetrics(value.cost_per_action_type),
    attributionSetting: enumString(value.attribution_setting),
  };
}

export async function getMetaAdAccountSummary(input: {
  adAccountId: string;
  accessToken: string;
  appSecret: string;
}): Promise<{ account: MetaAdAccountSummary; usage: MetaUsageSnapshot }> {
  const adAccountId = normalizeMetaAdAccountId(input.adAccountId);
  const url = new URL(
    `/${META_GRAPH_VERSION}/${encodeURIComponent(adAccountId)}`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set(
    "fields",
    "id,name,currency,timezone_name,timezone_offset_hours_utc,account_status",
  );
  const { body, usage } = await fetchMetaJson(
    url,
    addTokenProtection(url, input.accessToken, input.appSecret),
  );
  const account = parseAdAccountSummary(body);

  if (!account) {
    throw new MetaGraphError(502, {}, usage);
  }

  return { account, usage };
}

function marketingCollectionUrl(adAccountId: string, edge: string, fields: string): URL {
  const url = new URL(
    `/${META_GRAPH_VERSION}/${encodeURIComponent(normalizeMetaAdAccountId(adAccountId))}/${edge}`,
    META_GRAPH_ORIGIN,
  );
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", String(META_MARKETING_PAGE_SIZE));
  return url;
}

export function getMetaCampaigns(input: {
  adAccountId: string;
  accessToken: string;
  appSecret: string;
}): Promise<MetaMarketingCollection<MetaCampaign>> {
  return fetchMetaCollection({
    initialUrl: marketingCollectionUrl(
      input.adAccountId,
      "campaigns",
      "id,account_id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining,spend_cap,bid_strategy,is_adset_budget_sharing_enabled,special_ad_categories,start_time,stop_time,created_time,updated_time",
    ),
    accessToken: input.accessToken,
    appSecret: input.appSecret,
    parseItem: parseCampaign,
    maxPages: META_MARKETING_MAX_PAGES,
    maxItems: META_MARKETING_MAX_OBJECTS,
    requireComplete: true,
  });
}

export function getMetaAdSets(input: {
  adAccountId: string;
  accessToken: string;
  appSecret: string;
}): Promise<MetaMarketingCollection<MetaAdSet>> {
  return fetchMetaCollection({
    initialUrl: marketingCollectionUrl(
      input.adAccountId,
      "adsets",
      "id,account_id,campaign_id,name,status,effective_status,optimization_goal,billing_event,destination_type,daily_budget,lifetime_budget,budget_remaining,bid_amount,bid_strategy,start_time,end_time,created_time,updated_time",
    ),
    accessToken: input.accessToken,
    appSecret: input.appSecret,
    parseItem: parseAdSet,
    maxPages: META_MARKETING_MAX_PAGES,
    maxItems: META_MARKETING_MAX_OBJECTS,
    requireComplete: true,
  });
}

export function getMetaAds(input: {
  adAccountId: string;
  accessToken: string;
  appSecret: string;
}): Promise<MetaMarketingCollection<MetaAd>> {
  return fetchMetaCollection({
    initialUrl: marketingCollectionUrl(
      input.adAccountId,
      "ads",
      "id,account_id,campaign_id,adset_id,creative{id},name,status,effective_status,created_time,updated_time",
    ),
    accessToken: input.accessToken,
    appSecret: input.appSecret,
    parseItem: parseAd,
    maxPages: META_MARKETING_MAX_PAGES,
    maxItems: META_MARKETING_MAX_OBJECTS,
    requireComplete: true,
  });
}

export async function getMetaAdCreatives(input: {
  creativeIds: string[];
  accessToken: string;
  appSecret: string;
}): Promise<MetaMarketingCollection<MetaAdCreative>> {
  const creativeIds = [...new Set(input.creativeIds.flatMap((value) => {
    const id = metaObjectId(value);
    return id ? [id] : [];
  }))].sort();

  if (creativeIds.length > META_MARKETING_MAX_OBJECTS) {
    throw new MetaCollectionLimitError("items", EMPTY_USAGE);
  }

  const items: MetaAdCreative[] = [];
  let usage = EMPTY_USAGE;

  for (let index = 0; index < creativeIds.length; index += META_CREATIVE_BATCH_SIZE) {
    const ids = creativeIds.slice(index, index + META_CREATIVE_BATCH_SIZE);
    const url = new URL(`/${META_GRAPH_VERSION}/`, META_GRAPH_ORIGIN);
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set(
      "fields",
      "id,account_id,name,title,body,call_to_action_type,thumbnail_url,effective_object_story_id,effective_instagram_media_id,instagram_permalink_url,object_type,status",
    );
    url.searchParams.set("thumbnail_width", "640");
    url.searchParams.set("thumbnail_height", "360");
    const response = await fetchMetaJson(
      url,
      addTokenProtection(url, input.accessToken, input.appSecret),
    );
    usage = mergeMetaUsage(usage, response.usage);

    if (!isRecord(response.body)) {
      throw new MetaGraphError(502, {}, usage);
    }

    for (const id of ids) {
      const creative = parseAdCreative(response.body[id]);

      if (creative) {
        items.push(creative);
      }
    }
  }

  return { items, usage };
}

export function getMetaAdInsights(input: {
  adAccountId: string;
  accessToken: string;
  appSecret: string;
  since: string;
  until: string;
}): Promise<MetaMarketingCollection<MetaAdInsight>> {
  const since = isoDate(input.since);
  const until = isoDate(input.until);

  if (!since || !until) {
    throw new TypeError("Invalid Meta insights date range");
  }

  const sinceDate = new Date(`${since}T00:00:00.000Z`);
  const untilDate = new Date(`${until}T00:00:00.000Z`);
  const durationDays = Math.floor((untilDate.getTime() - sinceDate.getTime()) / 86_400_000) + 1;

  if (untilDate < sinceDate || durationDays > 93) {
    throw new RangeError("Meta insights date range must contain 1 to 93 days");
  }

  const url = marketingCollectionUrl(
    input.adAccountId,
    "insights",
    "account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,impressions,reach,frequency,clicks,inline_link_clicks,spend,cpm,cpc,ctr,actions,action_values,cost_per_action_type,attribution_setting",
  );
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("use_account_attribution_setting", "true");

  return fetchMetaCollection({
    initialUrl: url,
    accessToken: input.accessToken,
    appSecret: input.appSecret,
    parseItem: parseAdInsight,
    maxPages: META_MARKETING_MAX_PAGES,
    maxItems: META_INSIGHTS_MAX_ROWS,
    requireComplete: true,
  });
}
