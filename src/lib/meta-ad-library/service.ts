import "server-only";

import { randomUUID } from "node:crypto";

import { enqueueCollectorDrafts } from "@/lib/ad-library-collector/service";
import { createAdminClient } from "@/lib/supabase/admin";

import { fetchAdsArchive, utcDateDaysAgo } from "./client";
import {
  loadLibraryConnection,
  probeSummaryFromRow,
  resolveLibraryAccessToken,
  saveLibraryProbeSummary,
} from "./connection";
import { readMetaAdLibraryAppConfig, requireMetaAdLibraryApp } from "./env";
import { MetaAdLibraryError } from "./errors";
import {
  archivedAdToCollectorRecord,
  archivedAdToProbe,
  normalizeCountryCodes,
  parseArchivedAd,
} from "./map";
import {
  META_AD_LIBRARY_DAILY_CAP,
  META_AD_LIBRARY_DEFAULT_COUNTRIES,
  META_AD_LIBRARY_DEFAULT_LONG_RUNNING_DAYS,
  META_AD_LIBRARY_FETCH_DEFAULT,
  META_AD_LIBRARY_FETCH_MAX,
  META_AD_LIBRARY_PROBE_LIMIT,
  type MetaAdLibraryAppStatus,
  type MetaAdLibraryProbeResult,
  type MetaAdLibrarySearchInput,
} from "./types";

function clampLimit(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

export function parseSearchInput(
  body: Record<string, unknown>,
  mode: "probe" | "fetch",
): MetaAdLibrarySearchInput {
  const searchTerms = typeof body.searchTerms === "string" ? body.searchTerms.trim() : "";
  if (searchTerms.length < 2 || searchTerms.length > 100) {
    throw new MetaAdLibraryError(
      "invalid_search",
      400,
      "Suchbegriff muss zwischen 2 und 100 Zeichen haben.",
    );
  }
  const countries = normalizeCountryCodes(body.countries);
  const resolvedCountries =
    countries.length > 0 ? countries : [...META_AD_LIBRARY_DEFAULT_COUNTRIES];
  const longRunningDays = clampLimit(
    body.longRunningDays,
    META_AD_LIBRARY_DEFAULT_LONG_RUNNING_DAYS,
    3650,
  );
  return {
    searchTerms,
    countries: resolvedCountries,
    longRunningDays: body.longRunningDays === 0 || body.longRunningDays === "0" ? 0 : longRunningDays,
    limit:
      mode === "probe"
        ? META_AD_LIBRARY_PROBE_LIMIT
        : clampLimit(body.limit, META_AD_LIBRARY_FETCH_DEFAULT, META_AD_LIBRARY_FETCH_MAX),
    industry: typeof body.industry === "string" ? body.industry.trim() : "",
    objective: typeof body.objective === "string" ? body.objective.trim() : "other",
  };
}

export async function countMetaCollectorFetchedToday(): Promise<number> {
  const admin = createAdminClient();
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count, error } = await admin
    .from("ad_library_collector_items")
    .select("id", { count: "exact", head: true })
    .eq("provider", "meta")
    .gte("created_at", start.toISOString());
  if (error) return 0;
  return count ?? 0;
}

export async function loadMetaAdLibraryStatus(): Promise<MetaAdLibraryAppStatus> {
  const config = readMetaAdLibraryAppConfig();
  const { row, migrationNeeded } = await loadLibraryConnection();
  let tokenPresent = Boolean(config.accessTokenEnv);
  let tokenSource: MetaAdLibraryAppStatus["tokenSource"] = config.accessTokenEnv
    ? "env"
    : null;
  let tokenExpiresAt: string | null = null;
  if (row && config.appId && row.app_id === config.appId) {
    tokenPresent = true;
    tokenSource = "connection";
    tokenExpiresAt = row.token_expires_at;
  }
  return {
    libraryAppConfigured: config.libraryAppConfigured,
    libraryAppId: config.appId,
    isolatedFromProductApp: config.isolatedFromProductApp,
    productAppConfigured: config.productAppConfigured,
    tokenPresent,
    tokenSource,
    tokenExpiresAt,
    encryptionReady: config.encryptionReady,
    redirectUri: config.redirectUri,
    fetchedToday: await countMetaCollectorFetchedToday(),
    dailyCap: META_AD_LIBRARY_DAILY_CAP,
    lastProbe: probeSummaryFromRow(row?.last_probe_summary),
    lastProbeAt: row?.last_probe_at ?? null,
    lastProbeOk: row?.last_probe_ok ?? null,
    migrationNeeded,
  };
}

async function searchArchive(input: MetaAdLibrarySearchInput) {
  requireMetaAdLibraryApp();
  const token = await resolveLibraryAccessToken();
  const longRunningAnchor =
    input.longRunningDays > 0 ? utcDateDaysAgo(input.longRunningDays) : null;
  let result = await fetchAdsArchive({
    accessToken: token.accessToken,
    searchTerms: input.searchTerms,
    countries: input.countries,
    adActiveStatus: "ACTIVE",
    deliveryDateMin: longRunningAnchor,
    deliveryDateMax: longRunningAnchor,
    limit: input.limit,
  });
  let usedLongRunningWindow = Boolean(longRunningAnchor);
  if (result.ads.length < 1 && longRunningAnchor) {
    result = await fetchAdsArchive({
      accessToken: token.accessToken,
      searchTerms: input.searchTerms,
      countries: input.countries,
      adActiveStatus: "ACTIVE",
      limit: Math.min(input.limit * 2, META_AD_LIBRARY_FETCH_MAX),
    });
    usedLongRunningWindow = false;
  }
  const now = Date.now();
  const parsed = result.ads
    .map((ad) => parseArchivedAd(ad, now))
    .filter((ad): ad is NonNullable<typeof ad> => Boolean(ad));
  const filtered =
    input.longRunningDays > 0 && !usedLongRunningWindow
      ? parsed.filter(
          (ad) => ad.daysRunning != null && ad.daysRunning >= input.longRunningDays,
        )
      : parsed;
  return filtered.slice(0, input.limit);
}

function buildProbeResult(
  input: MetaAdLibrarySearchInput,
  ads: ReturnType<typeof parseArchivedAd>[],
): MetaAdLibraryProbeResult {
  const records = ads.filter((ad): ad is NonNullable<typeof ad> => Boolean(ad));
  const commercial = records.filter((ad) => ad.kind === "commercial").length;
  const political = records.filter((ad) => ad.kind === "political").length;
  const unknown = records.filter((ad) => ad.kind === "unknown").length;
  const longRunning = records.filter(
    (ad) =>
      input.longRunningDays === 0 ||
      (ad.daysRunning != null && ad.daysRunning >= input.longRunningDays),
  ).length;
  let warning: string | null = null;
  if (records.length < 1) {
    warning =
      "Keine Treffer. Suchbegriff, Land (EU) und Identitätsprüfung prüfen. Kommerzielle Ads nur bei EU/UK-Auslieferung.";
  } else if (commercial < 1 && political > 0) {
    warning =
      "Nur Political/Issue-Ads. Für Hotels/SaaS/Beauty in DE braucht die API kommerzielle EU-Treffer.";
  }
  return {
    searchedAt: new Date().toISOString(),
    searchTerms: input.searchTerms,
    countries: input.countries,
    longRunningDays: input.longRunningDays,
    returned: records.length,
    commercial,
    political,
    unknown,
    longRunning,
    commercialScopeLooksUsable: commercial > 0,
    warning,
    ads: records.map(archivedAdToProbe),
  };
}

export async function probeMetaAdLibrary(
  body: Record<string, unknown>,
): Promise<MetaAdLibraryProbeResult> {
  const input = parseSearchInput(body, "probe");
  const ads = await searchArchive(input);
  const summary = buildProbeResult(input, ads);
  await saveLibraryProbeSummary({ ok: ads.length > 0, summary });
  return summary;
}

export async function fetchMetaAdLibraryToStaging(input: {
  body: Record<string, unknown>;
  createdBy: string | null;
}): Promise<{
  probe: MetaAdLibraryProbeResult;
  upserted: number;
  skippedDailyCap: number;
  batchId: string;
}> {
  const search = parseSearchInput(input.body, "fetch");
  const fetchedToday = await countMetaCollectorFetchedToday();
  const remaining = META_AD_LIBRARY_DAILY_CAP - fetchedToday;
  if (remaining <= 0) {
    throw new MetaAdLibraryError(
      "daily_cap",
      429,
      `Tageslimit ${META_AD_LIBRARY_DAILY_CAP} Library-Ads ist erreicht.`,
    );
  }
  const limited = { ...search, limit: Math.min(search.limit, remaining) };
  const ads = await searchArchive(limited);
  const probe = buildProbeResult(limited, ads);
  await saveLibraryProbeSummary({ ok: ads.length > 0, summary: probe });
  if (ads.length < 1) {
    return { probe, upserted: 0, skippedDailyCap: 0, batchId: "" };
  }
  const batchId = `meta-library-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const records = ads.map((ad) =>
    archivedAdToCollectorRecord(ad, {
      industry: limited.industry,
      objective: limited.objective,
      country: limited.countries[0] ?? "DE",
      collectorBatchId: batchId,
      searchTerms: limited.searchTerms,
      longRunningDays: limited.longRunningDays,
    }),
  );
  const enqueued = await enqueueCollectorDrafts({
    records,
    createdBy: input.createdBy,
    batchId,
  });
  return {
    probe,
    upserted: enqueued.upserted,
    skippedDailyCap: search.limit - limited.limit,
    batchId,
  };
}
