import "server-only";

import { randomUUID } from "node:crypto";

import {
  getMetaAdAccountSummary,
  getMetaAdCreatives,
  getMetaAdInsights,
  getMetaAds,
  getMetaAdSets,
  getMetaCampaigns,
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

export type MetaMarketingSyncResult = {
  syncId: string;
  campaignsCount: number;
  adSetsCount: number;
  adsCount: number;
  creativesCount: number;
  insightsCount: number;
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
  const yesterday = new Date(now.getTime() - 86_400_000);
  const until = dateInTimeZone(yesterday, timeZone);

  return {
    since: addUtcDays(until, -(META_INSIGHTS_ROLLING_DAYS - 1)),
    until,
  };
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
  const adSetIds = new Set(input.adSets.map((adSet) => adSet.id));

  if (
    input.adSets.some((adSet) => !campaignIds.has(adSet.campaignId)) ||
    input.ads.some(
      (ad) =>
        !campaignIds.has(ad.campaignId) ||
        !adSetIds.has(ad.adSetId),
    ) ||
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
    thumbnail_url: item.thumbnailUrl,
    effective_object_story_id: item.effectiveObjectStoryId,
    effective_instagram_media_id: item.effectiveInstagramMediaId,
    instagram_permalink_url: item.instagramPermalinkUrl,
    object_type: item.objectType,
    status: item.status,
  }));
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
    actions: item.actions,
    action_values: item.actionValues,
    cost_per_action_type: item.costPerActionType,
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
  const adSetsResult = await getMetaAdSets(input);
  usage = mergeMetaUsage(usage, adSetsResult.usage);
  const adsResult = await getMetaAds(input);
  usage = mergeMetaUsage(usage, adsResult.usage);
  const creativesResult = await getMetaAdCreatives({
    creativeIds: adsResult.items.flatMap((ad) => ad.creativeId ? [ad.creativeId] : []),
    accessToken: input.accessToken,
    appSecret: input.appSecret,
  });
  usage = mergeMetaUsage(usage, creativesResult.usage);
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

  validateHierarchy({
    accountId: input.adAccountId,
    campaigns: campaignsResult.items,
    adSets: adSetsResult.items,
    ads: adsResult.items,
    creatives: creativesResult.items,
    insights: insightsResult.items,
  });

  const syncId = randomUUID();
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
    p_campaigns: serializeCampaigns(campaignsResult.items),
    p_ad_sets: serializeAdSets(adSetsResult.items),
    p_ads: serializeAds(adsResult.items),
    p_creatives: serializeCreatives(creativesResult.items),
    p_insights: serializeInsights(insightsResult.items),
    p_insights_since: dateRange.since,
    p_insights_until: dateRange.until,
    p_usage: usage,
  });

  if (error) {
    throw new MetaMarketingDataError("persistence_failed");
  }

  const persisted = Array.isArray(data) ? data[0] : data;

  return {
    syncId,
    campaignsCount: persistedCount(
      persisted,
      "campaigns_count",
      campaignsResult.items.length,
    ),
    adSetsCount: persistedCount(
      persisted,
      "ad_sets_count",
      adSetsResult.items.length,
    ),
    adsCount: persistedCount(persisted, "ads_count", adsResult.items.length),
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
    recommendationsCount: persistedCount(persisted, "recommendations_count", 0),
    insightsSince: dateRange.since,
    insightsUntil: dateRange.until,
    usage,
  };
}
