import "server-only";

import { createClient } from "@/lib/supabase/server";

export type OpenAIAdsDashboardCampaign = {
  id: string;
  remoteId: string;
  name: string;
  status: string | null;
  objective: string | null;
  budgetMicros: number | null;
  dailyBudgetMicros: number | null;
  startTime: string | null;
  stopTime: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  ctr: number | null;
  cpc: number | null;
  costPerConversion: number | null;
  roas: number | null;
};

export type OpenAIAdsDashboardLaunch = {
  id: string;
  status: string;
  reviewStatus: string | null;
  campaignId: string | null;
  adGroupId: string | null;
  adId: string | null;
  errorCode: string | null;
  createdAt: string;
  activatedAt: string | null;
};

export type OpenAIAdsDashboardAccount = {
  id: string;
  remoteAccountId: string;
  name: string;
  connectedAt: string | null;
  accountStatus: string | null;
  reviewStatus: string | null;
  reviewReason: string | null;
  conversionInsightsAvailable: boolean;
  currency: string;
  timezone: string | null;
  adsManagerUrl: string | null;
  syncStatus: string;
  syncErrorCode: string | null;
  lastSyncStartedAt: string | null;
  lastSuccessAt: string | null;
  nextSyncAt: string | null;
  counts: {
    campaigns: number;
    adGroups: number;
    ads: number;
    insights: number;
  };
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number | null;
    conversionValue: number;
  };
  campaigns: OpenAIAdsDashboardCampaign[];
  launches: OpenAIAdsDashboardLaunch[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadOpenAIAdsDashboard(
  userId: string,
): Promise<OpenAIAdsDashboardAccount[]> {
  const supabase = await createClient();
  const { data: accountRows, error: accountError } = await supabase
    .from("platform_accounts")
    .select(
      "id,platform_account_id,account_name,connected_at,provider_metadata,provider_sync_status,provider_sync_error_code,provider_last_sync_started_at,provider_last_success_at,provider_next_sync_at,provider_campaign_count,provider_ad_group_count,provider_ad_count,provider_insight_count",
    )
    .eq("user_id", userId)
    .eq("platform", "openai_ads")
    .is("revoked_at", null)
    .order("connected_at", { ascending: true });

  if (accountError) {
    console.error("openai_ads_dashboard_accounts_failed", {
      code: accountError.code,
    });
    throw new Error("OpenAI-Ads-Konten konnten nicht geladen werden.");
  }

  return Promise.all(
    (accountRows ?? []).map(async (accountRow) => {
      const accountId = String(accountRow.id);
      const [campaignResult, performanceResult, accountDailyResult, launchResult] =
        await Promise.all([
          supabase
            .from("campaigns")
            .select(
              "id,platform_campaign_id,name,status,objective,budget_amount_micros,daily_budget_amount_micros,start_time,stop_time",
            )
            .eq("user_id", userId)
            .eq("platform_account_id", accountId)
            .eq("is_current", true)
            .order("platform_updated_time", { ascending: false }),
          supabase
            .from("cross_platform_campaign_performance_30d")
            .select(
              "campaign_id,spend,impressions,clicks,conversions,conversion_value,ctr,cpc,cost_per_conversion,roas",
            )
            .eq("user_id", userId)
            .eq("platform_account_id", accountId)
            .eq("platform", "openai_ads"),
          supabase
            .from("cross_platform_account_performance_daily")
            .select(
              "spend,impressions,clicks,conversions,conversion_value",
            )
            .eq("user_id", userId)
            .eq("platform_account_id", accountId)
            .eq("platform", "openai_ads"),
          supabase
            .from("ad_platform_launches")
            .select(
              "id,status,review_status,remote_campaign_id,remote_ad_group_id,remote_ad_id,error_code,created_at,activated_at",
            )
            .eq("user_id", userId)
            .eq("platform_account_id", accountId)
            .eq("platform", "openai_ads")
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

      const firstError =
        campaignResult.error ??
        performanceResult.error ??
        accountDailyResult.error ??
        launchResult.error;
      if (firstError) {
        console.error("openai_ads_dashboard_data_failed", {
          accountId,
          code: firstError.code,
        });
        throw new Error("OpenAI-Ads-Dashboarddaten konnten nicht geladen werden.");
      }

      const performanceByCampaign = new Map(
        (performanceResult.data ?? []).map((row) => [String(row.campaign_id), row]),
      );
      const campaigns: OpenAIAdsDashboardCampaign[] = (
        campaignResult.data ?? []
      ).map((row) => {
        const performance = performanceByCampaign.get(String(row.id));
        return {
          id: String(row.id),
          remoteId: String(row.platform_campaign_id),
          name: String(row.name),
          status: text(row.status),
          objective: text(row.objective),
          budgetMicros: nullableNumber(row.budget_amount_micros),
          dailyBudgetMicros: nullableNumber(row.daily_budget_amount_micros),
          startTime: text(row.start_time),
          stopTime: text(row.stop_time),
          spend: number(performance?.spend),
          impressions: number(performance?.impressions),
          clicks: number(performance?.clicks),
          conversions: nullableNumber(performance?.conversions),
          ctr: nullableNumber(performance?.ctr),
          cpc: nullableNumber(performance?.cpc),
          costPerConversion: nullableNumber(performance?.cost_per_conversion),
          roas: nullableNumber(performance?.roas),
        };
      });

      const accountDailyRows = accountDailyResult.data ?? [];
      const totals = accountDailyRows.reduce(
        (sum, row) => ({
          spend: sum.spend + number(row.spend),
          impressions: sum.impressions + number(row.impressions),
          clicks: sum.clicks + number(row.clicks),
          conversions: sum.conversions + number(row.conversions),
          conversionValue:
            sum.conversionValue + number(row.conversion_value),
        }),
        {
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          conversionValue: 0,
        },
      );
      const hasConversionData = accountDailyRows.some(
        (row) => row.conversions !== null && row.conversions !== undefined,
      );

      const metadata = isRecord(accountRow.provider_metadata)
        ? accountRow.provider_metadata
        : {};
      return {
        id: accountId,
        remoteAccountId: String(accountRow.platform_account_id),
        name: text(accountRow.account_name) ?? "OpenAI Ads",
        connectedAt: text(accountRow.connected_at),
        accountStatus: text(metadata.account_status),
        reviewStatus: text(metadata.review_status),
        reviewReason: text(metadata.review_reason),
        conversionInsightsAvailable:
          metadata.conversion_insights_status === "available",
        currency: text(metadata.currency_code)?.toUpperCase() ?? "EUR",
        timezone: text(metadata.timezone),
        adsManagerUrl: text(metadata.url),
        syncStatus: text(accountRow.provider_sync_status) ?? "idle",
        syncErrorCode: text(accountRow.provider_sync_error_code),
        lastSyncStartedAt: text(accountRow.provider_last_sync_started_at),
        lastSuccessAt: text(accountRow.provider_last_success_at),
        nextSyncAt: text(accountRow.provider_next_sync_at),
        counts: {
          campaigns: number(accountRow.provider_campaign_count),
          adGroups: number(accountRow.provider_ad_group_count),
          ads: number(accountRow.provider_ad_count),
          insights: number(accountRow.provider_insight_count),
        },
        totals: {
          ...totals,
          conversions: hasConversionData ? totals.conversions : null,
        },
        campaigns,
        launches: (launchResult.data ?? []).map((row) => ({
          id: String(row.id),
          status: String(row.status),
          reviewStatus: text(row.review_status),
          campaignId: text(row.remote_campaign_id),
          adGroupId: text(row.remote_ad_group_id),
          adId: text(row.remote_ad_id),
          errorCode: text(row.error_code),
          createdAt: String(row.created_at),
          activatedAt: text(row.activated_at),
        })),
      };
    }),
  );
}
