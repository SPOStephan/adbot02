import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  debugMetaAccessToken,
  exchangeCodeForAccessToken,
  META_GRAPH_VERSION,
  MetaGraphError,
  resolvePersistedMetaAccessToken,
} from "@/lib/meta/client";

import { MetaAdLibraryError } from "./errors";
import { META_AD_LIBRARY_FIELDS } from "./types";

const GRAPH_ORIGIN = "https://graph.facebook.com";
const DIALOG_ORIGIN = "https://www.facebook.com";
const REQUEST_TIMEOUT_MS = 20_000;

type LibraryOAuthState = {
  v: 1;
  purpose: "meta_ad_library";
  sub: string;
  nonce: string;
  iat: number;
  exp: number;
};

function graphErrorMessage(error: unknown): string {
  if (error instanceof MetaGraphError) {
    return (
      error.errorUserMessage ||
      error.graphMessage ||
      `Meta Graph Fehler ${error.code ?? error.status}.`
    );
  }
  return error instanceof Error ? error.message : "Unbekannter Graph-Fehler.";
}

export function createLibraryOAuthState(userId: string, secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: LibraryOAuthState = {
    v: 1,
    purpose: "meta_ad_library",
    sub: userId,
    nonce: randomBytes(16).toString("hex"),
    iat: issuedAt,
    exp: issuedAt + 10 * 60,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function readLibraryOAuthState(
  value: string | null,
  secret: string,
): LibraryOAuthState | null {
  if (!value || !value.includes(".")) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LibraryOAuthState;
    const now = Math.floor(Date.now() / 1000);
    if (
      parsed.v !== 1 ||
      parsed.purpose !== "meta_ad_library" ||
      !parsed.sub ||
      parsed.exp < now
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createLibraryLoginUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): URL {
  const url = new URL(`/${META_GRAPH_VERSION}/dialog/oauth`, DIALOG_ORIGIN);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "public_profile");
  return url;
}

export async function persistLibraryUserToken(input: {
  appId: string;
  appSecret: string;
  shortLivedAccessToken: string;
}): Promise<{ accessToken: string; expiresInSeconds: number | null; metaUserId: string | null }> {
  let persisted;
  try {
    persisted = await resolvePersistedMetaAccessToken({
      appId: input.appId,
      appSecret: input.appSecret,
      codeAccessToken: {
        accessToken: input.shortLivedAccessToken,
        expiresInSeconds: null,
        tokenType: null,
        usage: {
          appPercent: null,
          pagePercent: null,
          businessPercent: null,
          retryAfterSeconds: null,
        },
      },
    });
  } catch (error) {
    throw new MetaAdLibraryError(
      "token_exchange_failed",
      502,
      `Token-Austausch fehlgeschlagen: ${graphErrorMessage(error)}`,
    );
  }

  const debug = await debugMetaAccessToken({
    appId: input.appId,
    appSecret: input.appSecret,
    accessToken: persisted.accessToken,
  }).catch((error: unknown) => {
    throw new MetaAdLibraryError(
      "token_debug_failed",
      502,
      `Token-Prüfung fehlgeschlagen: ${graphErrorMessage(error)}`,
    );
  });

  if (!debug.isValid) {
    throw new MetaAdLibraryError("token_invalid", 401, "Der Library-Token ist ungültig.");
  }
  if (debug.appId && debug.appId !== input.appId) {
    throw new MetaAdLibraryError(
      "token_wrong_app",
      409,
      "Dieser Token gehört nicht zur Library-App. Bitte keinen Kunden-Meta-Token verwenden.",
    );
  }

  return {
    accessToken: persisted.accessToken,
    expiresInSeconds: persisted.expiresInSeconds,
    metaUserId: debug.userId,
  };
}

export async function exchangeLibraryCode(input: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}) {
  try {
    const shortLived = await exchangeCodeForAccessToken({
      appId: input.appId,
      appSecret: input.appSecret,
      code: input.code,
      redirectUri: input.redirectUri,
    });
    return persistLibraryUserToken({
      appId: input.appId,
      appSecret: input.appSecret,
      shortLivedAccessToken: shortLived.accessToken,
    });
  } catch (error) {
    if (error instanceof MetaAdLibraryError) throw error;
    throw new MetaAdLibraryError(
      "oauth_exchange_failed",
      502,
      `OAuth-Code konnte nicht eingelöst werden: ${graphErrorMessage(error)}`,
    );
  }
}

export async function exchangePastedLibraryToken(input: {
  appId: string;
  appSecret: string;
  accessToken: string;
}) {
  return persistLibraryUserToken({
    appId: input.appId,
    appSecret: input.appSecret,
    shortLivedAccessToken: input.accessToken,
  });
}

export type AdsArchiveQuery = {
  accessToken: string;
  searchTerms: string;
  countries: string[];
  adActiveStatus: "ACTIVE" | "ALL" | "INACTIVE";
  deliveryDateMin?: string | null;
  deliveryDateMax?: string | null;
  limit: number;
};

export async function fetchAdsArchive(query: AdsArchiveQuery): Promise<{
  ads: unknown[];
  pagingAfter: string | null;
}> {
  const url = new URL(`/${META_GRAPH_VERSION}/ads_archive`, GRAPH_ORIGIN);
  url.searchParams.set("access_token", query.accessToken);
  url.searchParams.set("search_terms", query.searchTerms);
  url.searchParams.set("ad_reached_countries", JSON.stringify(query.countries));
  url.searchParams.set("ad_type", "ALL");
  url.searchParams.set("ad_active_status", query.adActiveStatus);
  url.searchParams.set("fields", META_AD_LIBRARY_FIELDS);
  url.searchParams.set("limit", String(query.limit));
  if (query.deliveryDateMin) {
    url.searchParams.set("ad_delivery_date_min", query.deliveryDateMin);
  }
  if (query.deliveryDateMax) {
    url.searchParams.set("ad_delivery_date_max", query.deliveryDateMax);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new MetaAdLibraryError(
      "ads_archive_unreachable",
      502,
      "ads_archive war nicht erreichbar.",
    );
  }

  const body = (await response.json().catch(() => null)) as {
    data?: unknown;
    paging?: { cursors?: { after?: string } };
    error?: { message?: string; code?: number; error_user_msg?: string };
  } | null;

  if (!response.ok || !body) {
    const message =
      body?.error?.error_user_msg ||
      body?.error?.message ||
      `ads_archive HTTP ${response.status}`;
    throw new MetaAdLibraryError(
      response.status === 429 || body?.error?.code === 613
        ? "rate_limited"
        : "ads_archive_failed",
      response.status === 429 ? 429 : 502,
      message.slice(0, 400),
    );
  }

  return {
    ads: Array.isArray(body.data) ? body.data : [],
    pagingAfter: body.paging?.cursors?.after ?? null,
  };
}

export function utcDateDaysAgo(days: number, now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - Math.max(0, days));
  return date.toISOString().slice(0, 10);
}
