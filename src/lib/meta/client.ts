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
const META_CAPTION_MAX_LENGTH = 500;

export type MetaUsageSnapshot = {
  appPercent: number | null;
  pagePercent: number | null;
  businessPercent: number | null;
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
    return this.status === 429 || this.code === 4 || this.code === 17 || this.code === 32 || this.code === 80001;
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

function usageFromHeaders(headers: Headers): MetaUsageSnapshot {
  const business = parseBusinessUsage(
    parseUsageHeader(headers.get("x-business-use-case-usage")),
  );

  return {
    appPercent: usagePercentFromRecord(
      parseUsageHeader(headers.get("x-app-usage")),
    ),
    pagePercent: usagePercentFromRecord(
      parseUsageHeader(headers.get("x-page-usage")),
    ),
    businessPercent: business.percent,
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
    headers: {
      Accept: "application/json",
      ...headers,
    },
  });
  const body = await readJson(response);
  const usage = usageFromHeaders(response.headers);

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

async function fetchMetaCollection<T>(input: {
  initialUrl: URL;
  accessToken: string;
  appSecret: string;
  parseItem: (value: unknown) => T | null;
  maxPages?: number;
}): Promise<{ items: T[]; usage: MetaUsageSnapshot }> {
  const items: T[] = [];
  let usage = EMPTY_USAGE;
  let nextUrl: URL | null = input.initialUrl;
  const maxPages = Math.max(
    1,
    Math.min(META_MAX_COLLECTION_PAGES, input.maxPages ?? META_MAX_COLLECTION_PAGES),
  );

  for (let page = 0; page < maxPages && nextUrl; page += 1) {
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
    }

    const paging = isRecord(response.body.paging) ? response.body.paging : null;
    nextUrl = paging ? validateNextPageUrl(paging.next) : null;
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
