import "server-only";

import { randomUUID } from "node:crypto";

import {
  getMetaAdAccountSummary,
  getMetaAdCreatives,
  getMetaAdInsights,
  getMetaAds,
  getMetaAdsByIds,
  getMetaAdSets,
  getMetaAdSetsByIds,
  getMetaCampaigns,
  getMetaCampaignsByIds,
  mergeMetaUsage,
  normalizeMetaAdAccountId,
  type MetaAd,
  type MetaAdCreative,
  type MetaAdInsight,
  type MetaAdSet,
  type MetaCampaign,
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
  insights: ReadonlyArray<Pick<MetaAdInsight, "spend">>,
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

function validateHierarchy(input: {
  accountId: string;
  campaigns: MetaCampaign[];
  adSets: MetaAdSet[];
  ads: MetaAd[];
  creatives: MetaAdCreative[];
  insights: MetaAdInsight[];
}) {
  const expectedAccountId = normalizeMetaAdAccountId(input.accountId).slice(4);

  assertUnique(input.campaigns);
  assertUnique(input.adSets);
  assertUnique(input.ads);
  assertUnique(input.creatives);

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
    throw new MetaMarketingDataError("account_mismatch");
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
    throw new MetaMarketingDataError("invalid_hierarchy");
  }
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

  const campaignsResult = await getMetaCampaigns(input);
  usage = mergeMetaUsage(usage, campaignsResult.usage);
  let campaigns = campaignsResult.items;
  const adSetsResult = await getMetaAdSets(input);
  usage = mergeMetaUsage(usage, adSetsResult.usage);
  let adSets = adSetsResult.items;
  const adsResult = await getMetaAds(input);
  usage = mergeMetaUsage(usage, adsResult.usage);
  let ads = adsResult.items;
  const dateRange = completeInsightsDateRange(
    accountResult.account.timezoneName,
    input.now,
  );
  const insightsResult = await getMetaAdInsights({
    ...input,
    since: dateRange.since,
    until: dateRange.until,
  });
  usage = mergeMetaUsage(usage, insightsResult.usage);

  const missingAdIds = missingReferencedIds(
    ads.map((ad) => ad.id),
    insightsResult.items.map((insight) => insight.adId),
  );
  const historicalAdsResult = await getMetaAdsByIds({
    adIds: missingAdIds,
    accessToken: input.accessToken,
    appSecret: input.appSecret,
  });
  usage = mergeMetaUsage(usage, historicalAdsResult.usage);
  ads = mergeUniqueById(ads, historicalAdsResult.items);

  const missingAdSetIds = missingReferencedIds(
    adSets.map((adSet) => adSet.id),
    ads.map((ad) => ad.adSetId),
  );
  const historicalAdSetsResult = await getMetaAdSetsByIds({
    adSetIds: missingAdSetIds,
    accessToken: input.accessToken,
    appSecret: input.appSecret,
  });
  usage = mergeMetaUsage(usage, historicalAdSetsResult.usage);
  adSets = mergeUniqueById(adSets, historicalAdSetsResult.items);

  const missingCampaignIds = missingReferencedIds(
    campaigns.map((campaign) => campaign.id),
    [
      ...adSets.map((adSet) => adSet.campaignId),
      ...ads.map((ad) => ad.campaignId),
    ],
  );
  const historicalCampaignsResult = await getMetaCampaignsByIds({
    campaignIds: missingCampaignIds,
    accessToken: input.accessToken,
    appSecret: input.appSecret,
  });
  usage = mergeMetaUsage(usage, historicalCampaignsResult.usage);
  campaigns = mergeUniqueById(campaigns, historicalCampaignsResult.items);

  const unresolvedHierarchy = {
    ads: missingReferencedIds(
      ads.map((ad) => ad.id),
      insightsResult.items.map((insight) => insight.adId),
    ).length,
    adSets: missingReferencedIds(
      adSets.map((adSet) => adSet.id),
      ads.map((ad) => ad.adSetId),
    ).length,
    campaigns: missingReferencedIds(
      campaigns.map((campaign) => campaign.id),
      [
        ...adSets.map((adSet) => adSet.campaignId),
        ...ads.map((ad) => ad.campaignId),
      ],
    ).length,
  };

  if (Object.values(unresolvedHierarchy).some((count) => count > 0)) {
    console.error("Meta Marketing historical hierarchy unresolved", {
      requestedAds: missingAdIds.length,
      resolvedAds: historicalAdsResult.items.length,
      requestedAdSets: missingAdSetIds.length,
      resolvedAdSets: historicalAdSetsResult.items.length,
      requestedCampaigns: missingCampaignIds.length,
      resolvedCampaigns: historicalCampaignsResult.items.length,
      ...unresolvedHierarchy,
    });
    throw new MetaMarketingDataError("invalid_hierarchy");
  }

  if (
    missingAdIds.length > 0 ||
    missingAdSetIds.length > 0 ||
    missingCampaignIds.length > 0
  ) {
    console.info("Meta Marketing historical hierarchy hydrated", {
      ads: historicalAdsResult.items.length,
      adSets: historicalAdSetsResult.items.length,
      campaigns: historicalCampaignsResult.items.length,
    });
  }

  const creativesResult = await getMetaAdCreatives({
    creativeIds: ads.flatMap((ad) => ad.creativeId ? [ad.creativeId] : []),
    accessToken: input.accessToken,
    appSecret: input.appSecret,
  });
  usage = mergeMetaUsage(usage, creativesResult.usage);

  validateHierarchy({
    accountId: input.adAccountId,
    campaigns,
    adSets,
    ads,
    creatives: creativesResult.items,
    insights: insightsResult.items,
  });

  const insightSnapshotDiagnostic = classifyMetaInsightSnapshot({
    ads,
    insights: insightsResult.items,
    since: dateRange.since,
    until: dateRange.until,
  });

  if (Object.values(insightSnapshotDiagnostic).some((count) => count > 0)) {
    console.error("Meta Marketing insight snapshot preflight rejected", {
      ...insightSnapshotDiagnostic,
      adsCount: ads.length,
      insightsCount: insightsResult.items.length,
    });
    throw new MetaMarketingDataError("invalid_hierarchy");
  }

  const syncId = randomUUID();
  const serializedCampaigns = serializeCampaigns(campaigns);
  const campaignBudgetSharingSnapshot = serializedCampaigns.map((campaign) => ({
    platform_campaign_id: campaign.platform_campaign_id,
    is_adset_budget_sharing_enabled:
      campaign.is_adset_budget_sharing_enabled,
  }));
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("replace_meta_marketing_snapshot", {
    p_platform_account_id: input.platformAccountId,
    p_user_id: input.userId,
    p_sync_id: syncId,
    p_account: {
      meta_ad_account_id: accountResult.account.id,
      name: accountResult.account.name,
      currency: accountResult.account.currency,
      timezone_name: accountResult.account.timezoneName,
      timezone_offset_hours_utc: accountResult.account.timezoneOffsetHoursUtc,
      account_status: accountResult.account.accountStatus,
    },
    p_campaigns: serializedCampaigns,
    p_ad_sets: serializeAdSets(adSets),
    p_ads: serializeAds(ads),
    p_creatives: serializeCreatives(creativesResult.items),
    p_insights: serializeInsights(insightsResult.items),
    p_insights_since: dateRange.since,
    p_insights_until: dateRange.until,
    p_usage: usage,
  });

  if (error) {
    console.error(
      "Meta Marketing snapshot persistence failed",
      persistenceDiagnostic(error),
    );
    throw new MetaMarketingDataError("persistence_failed");
  }

  const persisted = Array.isArray(data) ? data[0] : data;
  const spendTotal = sumInsightSpend(insightsResult.items);

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
      insightsResult.items.length,
    ),
    spendTotal,
    recommendationsCount: persistedCount(persisted, "recommendations_count", 0),
    insightsSince: dateRange.since,
    insightsUntil: dateRange.until,
    usage,
  };
}
