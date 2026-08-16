import "server-only";

import { randomUUID } from "node:crypto";

import {
  getMetaAdAccountSummary,
  getMetaAccountInsights,
  getMetaAdCreatives,
  getMetaAdInsights,
  getMetaAds,
  getMetaAdsByIds,
  getMetaAdSets,
  getMetaAdSetsByIds,
  getMetaCampaignInsights,
  getMetaCampaigns,
  getMetaCampaignsByIds,
  mergeMetaUsage,
  MetaCollectionLimitError,
  MetaGraphError,
  normalizeMetaAdAccountId,
  type MetaAd,
  type MetaAdCreative,
  type MetaAdInsight,
  type MetaAdSet,
  type MetaCampaign,
  type MetaCampaignInsight,
  type MetaMarketingCollection,
  type MetaUsageSnapshot,
} from "./client";
import { createAdminClient } from "../supabase/admin";

const META_INSIGHTS_ROLLING_DAYS = 37;

const EMPTY_USAGE: MetaUsageSnapshot = {
  appPercent: null,
  pagePercent: null,
  businessPercent: null,
  adAccountPercent: null,
  insightsPercent: null,
  retryAfterSeconds: null,
};

export class MetaMarketingDataError extends Error {
  readonly code:
    | "account_mismatch"
    | "duplicate_object"
    | "invalid_hierarchy"
    | "persistence_failed";

  constructor(code: MetaMarketingDataError["code"]) {
    super(`Meta Marketing snapshot rejected: ${code}`);
    this.name = "MetaMarketingDataError";
    this.code = code;
  }
}

export type MetaCampaignBudgetSharingSnapshot = {
  platform_campaign_id: string;
  is_adset_budget_sharing_enabled: boolean | null;
};

export type MetaMarketingSyncResult = {
  syncId: string;
  campaignBudgetSharingSnapshot: MetaCampaignBudgetSharingSnapshot[];
  campaignsCount: number;
  adSetsCount: number;
  adsCount: number;
  creativesCount: number;
  insightsCount: number;
  /** Sum of Meta insight spend rows written in this sync (account currency). */
  spendTotal: number;
  recommendationsCount: number;
  insightsSince: string;
  insightsUntil: string;
  usage: MetaUsageSnapshot;
};

function dateInTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = values.get("year");
    const month = values.get("month");
    const day = values.get("day");

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // A malformed account timezone must not produce a malformed API range.
  }

  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function completeInsightsDateRange(
  timeZone: string,
  now = new Date(),
): { since: string; until: string } {
  // Include account-local "today": Beitrag-Push spend often starts the same day
  // the campaign goes ACTIVE. Ending on yesterday left Ampel + dashboard at 0
  // while Meta Ads Manager already showed delivery.
  const until = dateInTimeZone(now, timeZone);

  return {
    since: addUtcDays(until, -(META_INSIGHTS_ROLLING_DAYS - 1)),
    until,
  };
}

export function sumInsightSpend(
  insights: ReadonlyArray<{ spend: string | null }>,
): number {
  let total = 0;

  for (const insight of insights) {
    const value = Number(insight.spend);
    if (Number.isFinite(value) && value > 0) {
      total += value;
    }
  }

  return total;
}

function countInsightSpendRows(
  insights: ReadonlyArray<{ spend: string | null }>,
): number {
  let count = 0;
  for (const insight of insights) {
    const value = Number(insight.spend);
    if (Number.isFinite(value) && value > 0) {
      count += 1;
    }
  }
  return count;
}

function serializeCampaignInsights(items: MetaCampaignInsight[]) {
  return items.map((item) => ({
    platform_campaign_id: item.campaignId,
    date_start: item.dateStart,
    date_stop: item.dateStop,
    spend: item.spend,
    impressions: item.impressions,
  }));
}

function assertUnique<T extends { id: string }>(items: T[]) {
  const ids = new Set<string>();

  for (const item of items) {
    if (ids.has(item.id)) {
      throw new MetaMarketingDataError("duplicate_object");
    }

    ids.add(item.id);
  }
}

export function classifyMetaInsightSnapshot(input: {
  ads: Pick<MetaAd, "id" | "campaignId" | "adSetId">[];
  insights: Pick<
    MetaAdInsight,
    "adId" | "campaignId" | "adSetId" | "dateStart" | "dateStop"
  >[];
  since: string;
  until: string;
}): {
  missingAdReferences: number;
  parentMismatches: number;
  nonDailyRows: number;
  outOfRangeRows: number;
} {
  const adsById = new Map(input.ads.map((ad) => [ad.id, ad]));
  let missingAdReferences = 0;
  let parentMismatches = 0;
  let nonDailyRows = 0;
  let outOfRangeRows = 0;

  for (const insight of input.insights) {
    const ad = adsById.get(insight.adId);

    if (!ad) {
      missingAdReferences += 1;
    } else if (
      insight.campaignId !== ad.campaignId ||
      insight.adSetId !== ad.adSetId
    ) {
      parentMismatches += 1;
    }

    if (insight.dateStart !== insight.dateStop) {
      nonDailyRows += 1;
    }

    if (insight.dateStart < input.since || insight.dateStart > input.until) {
      outOfRangeRows += 1;
    }
  }

  return {
    missingAdReferences,
    parentMismatches,
    nonDailyRows,
    outOfRangeRows,
  };
}

function mergeUniqueById<T extends { id: string }>(
  current: T[],
  additions: T[],
): T[] {
  const merged = [...current];
  const knownIds = new Set(current.map((item) => item.id));

  for (const item of additions) {
    if (!knownIds.has(item.id)) {
      merged.push(item);
      knownIds.add(item.id);
    }
  }

  return merged;
}

function missingReferencedIds(
  knownIds: Iterable<string>,
  referencedIds: Iterable<string>,
): string[] {
  const known = new Set(knownIds);
  return [...new Set(referencedIds)].filter((id) => !known.has(id)).sort();
}

/**
 * Soft-load Meta marketing collections. Graph #100 / incomplete pagination
 * must never abort the whole Abruf — callers prune orphans or heal account-only.
 */
async function loadMarketingCollectionSafely<T>(
  label: string,
  load: () => Promise<MetaMarketingCollection<T>>,
): Promise<MetaMarketingCollection<T> & { softFailed: boolean }> {
  try {
    const result = await load();
    return { ...result, softFailed: false };
  } catch (error) {
    if (error instanceof MetaGraphError) {
      if (error.rateLimited || error.reconnectRequired) {
        throw error;
      }

      console.warn(`Meta ${label} rejected; continuing with empty collection`, {
        code: error.code,
        subcode: error.subcode,
        diagnostic: error.diagnosticDetail,
      });
      return { items: [], usage: error.usage, softFailed: true };
    }

    if (error instanceof MetaCollectionLimitError) {
      console.warn(`Meta ${label} incomplete; continuing with empty collection`, {
        reason: error.reason,
      });
      return { items: [], usage: error.usage, softFailed: true };
    }

    throw error;
  }
}

function pruneMarketingHierarchy(input: {
  campaigns: MetaCampaign[];
  adSets: MetaAdSet[];
  ads: MetaAd[];
  insights: MetaAdInsight[];
}): {
  campaigns: MetaCampaign[];
  adSets: MetaAdSet[];
  ads: MetaAd[];
  insights: MetaAdInsight[];
  dropped: {
    adSets: number;
    ads: number;
    insights: number;
  };
} {
  const campaignIds = new Set(input.campaigns.map((campaign) => campaign.id));
  const adSets = input.adSets.filter((adSet) =>
    campaignIds.has(adSet.campaignId),
  );
  const adSetIds = new Set(adSets.map((adSet) => adSet.id));
  const adSetsById = new Map(adSets.map((adSet) => [adSet.id, adSet]));
  const ads = input.ads.filter((ad) => {
    const adSet = adSetsById.get(ad.adSetId);
    return (
      campaignIds.has(ad.campaignId) &&
      adSetIds.has(ad.adSetId) &&
      adSet?.campaignId === ad.campaignId
    );
  });
  const adIds = new Set(ads.map((ad) => ad.id));
  const insights = input.insights.filter((insight) => adIds.has(insight.adId));

  return {
    campaigns: input.campaigns,
    adSets,
    ads,
    insights,
    dropped: {
      adSets: input.adSets.length - adSets.length,
      ads: input.ads.length - ads.length,
      insights: input.insights.length - insights.length,
    },
  };
}

function validateHierarchy(input: {
  accountId: string;
  campaigns: MetaCampaign[];
  adSets: MetaAdSet[];
  ads: MetaAd[];
  creatives: MetaAdCreative[];
  insights: MetaAdInsight[];
}): "ok" | "account_mismatch" | "invalid_hierarchy" {
  const expectedAccountId = normalizeMetaAdAccountId(input.accountId).slice(4);

  try {
    assertUnique(input.campaigns);
    assertUnique(input.adSets);
    assertUnique(input.ads);
    assertUnique(input.creatives);
  } catch {
    return "invalid_hierarchy";
  }

  const accountScopedItems = [
    ...input.campaigns,
    ...input.adSets,
    ...input.ads,
    ...input.creatives,
  ];

  if (
    accountScopedItems.some(
      (item) => item.accountId !== null && item.accountId !== expectedAccountId,
    )
  ) {
    return "account_mismatch";
  }

  const campaignIds = new Set(input.campaigns.map((campaign) => campaign.id));
  const adSetsById = new Map(input.adSets.map((adSet) => [adSet.id, adSet]));

  if (
    input.adSets.some((adSet) => !campaignIds.has(adSet.campaignId)) ||
    input.ads.some((ad) => {
      const adSet = adSetsById.get(ad.adSetId);
      return (
        !campaignIds.has(ad.campaignId) ||
        !adSet ||
        adSet.campaignId !== ad.campaignId
      );
    }) ||
    input.insights.some(
      (insight) =>
        insight.accountId !== null && insight.accountId !== expectedAccountId,
    )
  ) {
    return "invalid_hierarchy";
  }

  return "ok";
}

function serializeCampaigns(items: MetaCampaign[]) {
  return items.map((item) => ({
    platform_campaign_id: item.id,
    account_id: item.accountId,
    name: item.name,
    objective: item.objective,
    status: item.status,
    effective_status: item.effectiveStatus,
    daily_budget_minor: item.dailyBudgetMinor,
    lifetime_budget_minor: item.lifetimeBudgetMinor,
    budget_remaining_minor: item.budgetRemainingMinor,
    spend_cap_minor: item.spendCapMinor,
    bid_strategy: item.bidStrategy,
    is_adset_budget_sharing_enabled: item.isAdSetBudgetSharingEnabled,
    special_ad_categories: item.specialAdCategories,
    start_time: item.startTime,
    stop_time: item.stopTime,
    platform_created_time: item.createdTime,
    platform_updated_time: item.updatedTime,
  }));
}

function serializeAdSets(items: MetaAdSet[]) {
  return items.map((item) => ({
    platform_ad_set_id: item.id,
    platform_campaign_id: item.campaignId,
    account_id: item.accountId,
    name: item.name,
    status: item.status,
    effective_status: item.effectiveStatus,
    optimization_goal: item.optimizationGoal,
    billing_event: item.billingEvent,
    destination_type: item.destinationType,
    daily_budget_minor: item.dailyBudgetMinor,
    lifetime_budget_minor: item.lifetimeBudgetMinor,
    budget_remaining_minor: item.budgetRemainingMinor,
    bid_amount_minor: item.bidAmountMinor,
    bid_strategy: item.bidStrategy,
    start_time: item.startTime,
    end_time: item.endTime,
    platform_created_time: item.createdTime,
    platform_updated_time: item.updatedTime,
  }));
}

function serializeAds(items: MetaAd[]) {
  return items.map((item) => ({
    platform_ad_id: item.id,
    platform_campaign_id: item.campaignId,
    platform_ad_set_id: item.adSetId,
    platform_creative_id: item.creativeId,
    account_id: item.accountId,
    name: item.name,
    status: item.status,
    effective_status: item.effectiveStatus,
    platform_created_time: item.createdTime,
    platform_updated_time: item.updatedTime,
  }));
}

function serializeCreatives(items: MetaAdCreative[]) {
  return items.map((item) => ({
    platform_creative_id: item.id,
    account_id: item.accountId,
    name: item.name,
    title: item.title,
    body: item.body,
    call_to_action_type: item.callToActionType,
    image_hash: item.imageHash,
    image_url: item.imageUrl,
    thumbnail_url: item.thumbnailUrl,
    effective_object_story_id: item.effectiveObjectStoryId,
    effective_instagram_media_id: item.effectiveInstagramMediaId,
    instagram_permalink_url: item.instagramPermalinkUrl,
    object_type: item.objectType,
    status: item.status,
  }));
}

function actionMetricMap(
  items: MetaAdInsight["actions"],
): Record<string, string> {
  return Object.fromEntries(
    items.map((item) => [item.actionType, item.value] as const),
  );
}

function serializeInsights(items: MetaAdInsight[]) {
  return items.map((item) => ({
    platform_campaign_id: item.campaignId,
    campaign_name: item.campaignName,
    platform_ad_set_id: item.adSetId,
    ad_set_name: item.adSetName,
    platform_ad_id: item.adId,
    ad_name: item.adName,
    account_id: item.accountId,
    date_start: item.dateStart,
    date_stop: item.dateStop,
    impressions: item.impressions,
    reach: item.reach,
    frequency: item.frequency,
    clicks: item.clicks,
    inline_link_clicks: item.inlineLinkClicks,
    spend: item.spend,
    cpm: item.cpm,
    cpc: item.cpc,
    ctr: item.ctr,
    actions: actionMetricMap(item.actions),
    action_values: actionMetricMap(item.actionValues),
    cost_per_action_type: actionMetricMap(item.costPerActionType),
    attribution_setting: item.attributionSetting,
  }));
}

function persistedCount(value: unknown, key: string, fallback: number): number {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[key] === "number"
  ) {
    return (value as Record<string, number>)[key];
  }

  return fallback;
}

function persistenceDiagnostic(error: {
  code?: string;
  message?: string;
}): { sqlState: string; message: string } {
  const sqlState =
    typeof error.code === "string" && /^[A-Z0-9]{4,10}$/i.test(error.code)
      ? error.code
      : "unknown";
  const message =
    typeof error.message === "string"
      ? error.message
          .replace(/'(?:[^']|'')*'/g, "'[redacted]'")
          .replace(/"(?:[^"\\]|\\.)*"/g, '"[redacted]"')
          .replace(/\b\d{6,}\b/g, "[redacted]")
          .replace(/https?:\/\/\S+/gi, "[redacted-url]")
          .slice(0, 240)
      : "No database message available";

  return { sqlState, message };
}

export async function syncMetaMarketingSnapshot(input: {
  platformAccountId: string;
  userId: string;
  adAccountId: string;
  accessToken: string;
  appSecret: string;
  now?: Date;
}): Promise<MetaMarketingSyncResult> {
  let usage = EMPTY_USAGE;
  const accountResult = await getMetaAdAccountSummary(input);
  usage = mergeMetaUsage(usage, accountResult.usage);
  const expectedAccountId = normalizeMetaAdAccountId(input.adAccountId).slice(4);

  if (accountResult.account.id !== expectedAccountId) {
    throw new MetaMarketingDataError("account_mismatch");
  }

  const dateRange = completeInsightsDateRange(
    accountResult.account.timezoneName,
    input.now,
  );
  const accountPayload = {
    meta_ad_account_id: accountResult.account.id,
    name: accountResult.account.name,
    currency: accountResult.account.currency,
    timezone_name: accountResult.account.timezoneName,
    timezone_offset_hours_utc: accountResult.account.timezoneOffsetHoursUtc,
    account_status: accountResult.account.accountStatus,
  };

  // Readiness FIRST — never leave EUR/sync_id null because later collections fail.
  const readinessHeal = await healMarketingAccountReady({
    platformAccountId: input.platformAccountId,
    userId: input.userId,
    account: accountPayload,
    usage,
    dateRange,
    campaignInsights: [],
    accountInsights: [],
  });

  try {
    const campaignsResult = await loadMarketingCollectionSafely(
      "campaigns",
      () => getMetaCampaigns(input),
    );
    usage = mergeMetaUsage(usage, campaignsResult.usage);
    let campaigns = campaignsResult.items;
    let collectionsSoftFailed = campaignsResult.softFailed;

    const adSetsResult = await loadMarketingCollectionSafely("adsets", () =>
      getMetaAdSets(input),
    );
    usage = mergeMetaUsage(usage, adSetsResult.usage);
    let adSets = adSetsResult.items;
    collectionsSoftFailed = collectionsSoftFailed || adSetsResult.softFailed;

    const adsResult = await loadMarketingCollectionSafely("ads", () =>
      getMetaAds(input),
    );
    usage = mergeMetaUsage(usage, adsResult.usage);
    let ads = adsResult.items;
    collectionsSoftFailed = collectionsSoftFailed || adsResult.softFailed;

    const insightsResult = await loadMarketingCollectionSafely(
      "ad insights",
      () =>
        getMetaAdInsights({
          ...input,
          since: dateRange.since,
          until: dateRange.until,
        }),
    );
    usage = mergeMetaUsage(usage, insightsResult.usage);
    let insights = insightsResult.items;
    collectionsSoftFailed = collectionsSoftFailed || insightsResult.softFailed;

    // Campaign + account level: fewer join failure modes than ad grain, and the
    // source of truth for dashboard totals when ad rows lag behind delivery.
    const campaignInsightsResult = await loadMarketingCollectionSafely(
      "campaign insights",
      () =>
        getMetaCampaignInsights({
          ...input,
          since: dateRange.since,
          until: dateRange.until,
        }),
    );
    usage = mergeMetaUsage(usage, campaignInsightsResult.usage);
    collectionsSoftFailed =
      collectionsSoftFailed || campaignInsightsResult.softFailed;

    const accountInsightsResult = await loadMarketingCollectionSafely(
      "account insights",
      () =>
        getMetaAccountInsights({
          ...input,
          since: dateRange.since,
          until: dateRange.until,
        }),
    );
    usage = mergeMetaUsage(usage, accountInsightsResult.usage);
    collectionsSoftFailed =
      collectionsSoftFailed || accountInsightsResult.softFailed;

    const missingAdIds = missingReferencedIds(
      ads.map((ad) => ad.id),
      insights.map((insight) => insight.adId),
    );
    const historicalAdsResult = await loadMarketingCollectionSafely(
      "historical ads",
      () =>
        getMetaAdsByIds({
          adIds: missingAdIds,
          accessToken: input.accessToken,
          appSecret: input.appSecret,
        }),
    );
    usage = mergeMetaUsage(usage, historicalAdsResult.usage);
    ads = mergeUniqueById(ads, historicalAdsResult.items);
    collectionsSoftFailed =
      collectionsSoftFailed || historicalAdsResult.softFailed;

    const missingAdSetIds = missingReferencedIds(
      adSets.map((adSet) => adSet.id),
      ads.map((ad) => ad.adSetId),
    );
    const historicalAdSetsResult = await loadMarketingCollectionSafely(
      "historical adsets",
      () =>
        getMetaAdSetsByIds({
          adSetIds: missingAdSetIds,
          accessToken: input.accessToken,
          appSecret: input.appSecret,
        }),
    );
    usage = mergeMetaUsage(usage, historicalAdSetsResult.usage);
    adSets = mergeUniqueById(adSets, historicalAdSetsResult.items);
    collectionsSoftFailed =
      collectionsSoftFailed || historicalAdSetsResult.softFailed;

    const missingCampaignIds = missingReferencedIds(
      campaigns.map((campaign) => campaign.id),
      [
        ...adSets.map((adSet) => adSet.campaignId),
        ...ads.map((ad) => ad.campaignId),
      ],
    );
    const historicalCampaignsResult = await loadMarketingCollectionSafely(
      "historical campaigns",
      () =>
        getMetaCampaignsByIds({
          campaignIds: missingCampaignIds,
          accessToken: input.accessToken,
          appSecret: input.appSecret,
        }),
    );
    usage = mergeMetaUsage(usage, historicalCampaignsResult.usage);
    campaigns = mergeUniqueById(campaigns, historicalCampaignsResult.items);
    collectionsSoftFailed =
      collectionsSoftFailed || historicalCampaignsResult.softFailed;

    // Beitrag-Push campaigns must stay in the snapshot even when Meta's account
    // edge omits completed/archived objects — otherwise is_current flips false.
    const adminForBoost = createAdminClient();
    const { data: boostLinkRows } = await adminForBoost
      .from("meta_organic_boost_links")
      .select("plan_id")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .limit(100);
    const boostPlanIds = [
      ...new Set(
        (boostLinkRows ?? [])
          .map((row) => (typeof row.plan_id === "string" ? row.plan_id : null))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let boostCampaignIds: string[] = [];
    if (boostPlanIds.length > 0) {
      const { data: boostBindings } = await adminForBoost
        .from("remote_object_bindings")
        .select("remote_object_id")
        .eq("user_id", input.userId)
        .eq("platform_account_id", input.platformAccountId)
        .eq("object_type", "CAMPAIGN")
        .in("plan_id", boostPlanIds);
      boostCampaignIds = [
        ...new Set(
          (boostBindings ?? [])
            .map((row) =>
              typeof row.remote_object_id === "string"
                ? row.remote_object_id
                : null,
            )
            .filter((id): id is string => Boolean(id)),
        ),
      ];
    }
    const knownCampaignIds = new Set(campaigns.map((campaign) => campaign.id));
    const missingBoostCampaignIds = boostCampaignIds.filter(
      (id) => !knownCampaignIds.has(id),
    );
    if (missingBoostCampaignIds.length > 0) {
      const boostHistorical = await loadMarketingCollectionSafely(
        "boost campaigns",
        () =>
          getMetaCampaignsByIds({
            campaignIds: missingBoostCampaignIds,
            accessToken: input.accessToken,
            appSecret: input.appSecret,
          }),
      );
      usage = mergeMetaUsage(usage, boostHistorical.usage);
      campaigns = mergeUniqueById(campaigns, boostHistorical.items);
      collectionsSoftFailed =
        collectionsSoftFailed || boostHistorical.softFailed;
    }

    const pruned = pruneMarketingHierarchy({
      campaigns,
      adSets,
      ads,
      insights,
    });
    campaigns = pruned.campaigns;
    adSets = pruned.adSets;
    ads = pruned.ads;
    insights = pruned.insights.filter(
      (insight) =>
        insight.accountId === null ||
        insight.accountId === accountPayload.meta_ad_account_id,
    );
    if (
      pruned.dropped.adSets > 0 ||
      pruned.dropped.ads > 0 ||
      pruned.dropped.insights > 0
    ) {
      console.warn("Meta Marketing hierarchy pruned orphans instead of failing", {
        ...pruned.dropped,
        collectionsSoftFailed,
      });
    }

    if (campaigns.length === 0) {
      console.warn(
        "Meta Marketing campaigns empty after load/prune; keeping account heal",
        { collectionsSoftFailed },
      );
      return {
        ...readinessHeal,
        usage,
        spendTotal: Math.max(
          sumInsightSpend(accountInsightsResult.items),
          sumInsightSpend(campaignInsightsResult.items),
        ),
      };
    }

    const creativesResult = await loadMarketingCollectionSafely(
      "creatives",
      () =>
        getMetaAdCreatives({
          creativeIds: ads.flatMap((ad) =>
            ad.creativeId ? [ad.creativeId] : [],
          ),
          accessToken: input.accessToken,
          appSecret: input.appSecret,
        }),
    );
    usage = mergeMetaUsage(usage, creativesResult.usage);

    const hierarchyStatus = validateHierarchy({
      accountId: input.adAccountId,
      campaigns,
      adSets,
      ads,
      creatives: creativesResult.items,
      insights,
    });
    if (hierarchyStatus === "account_mismatch") {
      throw new MetaMarketingDataError("account_mismatch");
    }
    if (hierarchyStatus === "invalid_hierarchy") {
      console.warn(
        "Meta Marketing hierarchy still invalid after prune; keeping account heal",
      );
      return {
        ...readinessHeal,
        usage,
        spendTotal: Math.max(
          sumInsightSpend(accountInsightsResult.items),
          sumInsightSpend(campaignInsightsResult.items),
        ),
      };
    }

    const insightSnapshotDiagnostic = classifyMetaInsightSnapshot({
      ads,
      insights,
      since: dateRange.since,
      until: dateRange.until,
    });
    // Drop diagnostic outliers instead of aborting the Abruf (was marketing_invalid_hierarchy).
    if (Object.values(insightSnapshotDiagnostic).some((count) => count > 0)) {
      console.warn("Meta Marketing insight snapshot pruned diagnostic outliers", {
        ...insightSnapshotDiagnostic,
        adsCount: ads.length,
        insightsCount: insights.length,
      });
      insights = insights.filter((insight) => {
        const ad = ads.find((row) => row.id === insight.adId);
        if (!ad) return false;
        if (
          insight.campaignId !== ad.campaignId ||
          insight.adSetId !== ad.adSetId
        ) {
          return false;
        }
        if (insight.dateStart !== insight.dateStop) return false;
        if (
          insight.dateStart < dateRange.since ||
          insight.dateStart > dateRange.until
        ) {
          return false;
        }
        return true;
      });
    }

    const syncId = randomUUID();
    const serializedCampaigns = serializeCampaigns(campaigns);
    const campaignBudgetSharingSnapshot = serializedCampaigns.map(
      (campaign) => ({
        platform_campaign_id: campaign.platform_campaign_id,
        is_adset_budget_sharing_enabled:
          campaign.is_adset_budget_sharing_enabled,
      }),
    );
    const admin = adminForBoost;
    const { data, error } = await admin.rpc("replace_meta_marketing_snapshot", {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
      p_sync_id: syncId,
      p_account: accountPayload,
      p_campaigns: serializedCampaigns,
      p_ad_sets: serializeAdSets(adSets),
      p_ads: serializeAds(ads),
      p_creatives: serializeCreatives(creativesResult.items),
      p_insights: serializeInsights(insights),
      p_insights_since: dateRange.since,
      p_insights_until: dateRange.until,
      p_usage: usage,
    });

    if (error) {
      console.error(
        "Meta Marketing snapshot persistence failed",
        persistenceDiagnostic(error),
      );
      return {
        ...readinessHeal,
        usage,
        spendTotal: Math.max(
          sumInsightSpend(accountInsightsResult.items),
          sumInsightSpend(campaignInsightsResult.items),
        ),
      };
    }

    // Soft-expire from replace_meta_marketing_snapshot must not hide Beitrag-Push.
    const { error: retainError } = await admin.rpc(
      "retain_meta_organic_boost_campaigns",
      {
        p_platform_account_id: input.platformAccountId,
        p_user_id: input.userId,
      },
    );
    if (retainError) {
      // RPC absent until migration applied; snapshot still usable.
    }

    const persisted = Array.isArray(data) ? data[0] : data;

    const adSpendTotal = sumInsightSpend(insights);
    const campaignSpendTotal = sumInsightSpend(campaignInsightsResult.items);
    const accountSpendTotal = sumInsightSpend(accountInsightsResult.items);
    const spendToday = sumInsightSpend(
      accountInsightsResult.items.filter(
        (row) => row.dateStart === dateRange.until,
      ),
    );
    // Prefer account rollup, then campaign, then ad — never under-report a higher
    // authoritative Meta total when a finer grain lagged.
    const spendTotal = Math.max(
      accountSpendTotal,
      campaignSpendTotal,
      adSpendTotal,
    );
    const insightSpendRows = Math.max(
      countInsightSpendRows(accountInsightsResult.items),
      countInsightSpendRows(campaignInsightsResult.items),
      countInsightSpendRows(insights),
    );

    const { error: spendError } = await admin.rpc(
      "apply_meta_campaign_insight_spend",
      {
        p_platform_account_id: input.platformAccountId,
        p_user_id: input.userId,
        p_campaign_insights: serializeCampaignInsights(
          campaignInsightsResult.items,
        ),
        p_account_spend_total: spendTotal,
        p_account_spend_today: spendToday,
        p_insight_spend_rows: insightSpendRows,
        p_insights_until: dateRange.until,
      },
    );

    if (spendError) {
      console.error(
        "Meta campaign insight spend persistence failed",
        persistenceDiagnostic(spendError),
      );
      // Snapshot already written — do not fail Abruf for spend rollup alone.
    }

    return {
      syncId,
      campaignBudgetSharingSnapshot,
      campaignsCount: persistedCount(
        persisted,
        "campaigns_count",
        campaigns.length,
      ),
      adSetsCount: persistedCount(
        persisted,
        "ad_sets_count",
        adSets.length,
      ),
      adsCount: persistedCount(persisted, "ads_count", ads.length),
      creativesCount: persistedCount(
        persisted,
        "creatives_count",
        creativesResult.items.length,
      ),
      insightsCount: persistedCount(
        persisted,
        "insights_count",
        insights.length,
      ),
      spendTotal,
      recommendationsCount: persistedCount(
        persisted,
        "recommendations_count",
        0,
      ),
      insightsSince: dateRange.since,
      insightsUntil: dateRange.until,
      usage,
    };
  } catch (error) {
    if (
      error instanceof MetaMarketingDataError &&
      error.code === "account_mismatch"
    ) {
      throw error;
    }
    if (
      error instanceof MetaGraphError &&
      (error.rateLimited || error.reconnectRequired)
    ) {
      throw error;
    }
    console.warn(
      "Meta Marketing snapshot best-effort failed after account heal; keeping readiness",
      error instanceof Error ? error.message : "unknown",
    );
    return readinessHeal;
  }
}

async function healMarketingAccountReady(input: {
  platformAccountId: string;
  userId: string;
  account: {
    meta_ad_account_id: string;
    name: string | null;
    currency: string;
    timezone_name: string | null;
    timezone_offset_hours_utc: number | null;
    account_status: number | null;
  };
  usage: MetaUsageSnapshot;
  dateRange: { since: string; until: string };
  campaignInsights: MetaCampaignInsight[];
  accountInsights: Array<{ dateStart: string; spend: string | null }>;
}): Promise<MetaMarketingSyncResult> {
  const syncId = randomUUID();
  const admin = createAdminClient();
  const healedAt = new Date().toISOString();
  const { error: rpcError } = await admin.rpc(
    "heal_meta_marketing_account_ready",
    {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
      p_sync_id: syncId,
      p_account: input.account,
      p_usage: input.usage,
    },
  );

  if (rpcError) {
    // SQL may not be applied yet — direct update must still clear ACCOUNT_UNAVAILABLE.
    console.warn(
      "heal_meta_marketing_account_ready RPC unavailable; using direct update",
      persistenceDiagnostic(rpcError),
    );
    const { error: updateError } = await admin
      .from("platform_accounts")
      .update({
        marketing_meta_ad_account_id: input.account.meta_ad_account_id,
        marketing_currency: input.account.currency,
        marketing_timezone_name: input.account.timezone_name,
        marketing_timezone_offset_hours_utc:
          input.account.timezone_offset_hours_utc,
        marketing_account_status: input.account.account_status,
        marketing_sync_status: "success",
        marketing_sync_error_code: null,
        marketing_last_success_at: healedAt,
        marketing_backoff_until: null,
        marketing_consecutive_failures: 0,
        marketing_sync_id: syncId,
        marketing_usage: input.usage,
        updated_at: healedAt,
      })
      .eq("id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("platform", "meta");

    if (updateError) {
      console.error(
        "Meta Marketing account heal failed",
        persistenceDiagnostic(updateError),
      );
      throw new MetaMarketingDataError("persistence_failed");
    }
  }

  const spendTotal = Math.max(
    sumInsightSpend(input.accountInsights),
    sumInsightSpend(input.campaignInsights),
  );

  return {
    syncId,
    campaignBudgetSharingSnapshot: [],
    campaignsCount: 0,
    adSetsCount: 0,
    adsCount: 0,
    creativesCount: 0,
    insightsCount: 0,
    spendTotal,
    recommendationsCount: 0,
    insightsSince: input.dateRange.since,
    insightsUntil: input.dateRange.until,
    usage: input.usage,
  };
}
