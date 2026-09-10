import "server-only";

import {
  OpenAIAdsApiError,
  type OpenAIAdsConversionInsight,
  type OpenAIAdsAd,
  type OpenAIAdsAdGroup,
  type OpenAIAdsCampaign,
  type OpenAIAdsInsight,
} from "@/lib/openai-ads/client";
import {
  loadOpenAIAdsClient,
  OpenAIAdsServiceError,
} from "@/lib/openai-ads/connection";
import { createAdminClient } from "@/lib/supabase/admin";

export const OPENAI_ADS_CRON_BATCH_SIZE = 5;
const SYNC_STALE_AFTER_SECONDS = 15 * 60;
const SUCCESS_INTERVAL_MS = 60 * 60 * 1000;
const ERROR_BACKOFF_MS = 15 * 60 * 1000;
const AUTH_BACKOFF_MS = 24 * 60 * 60 * 1000;
const FETCH_CONCURRENCY = 4;

type SyncResult = {
  outcome: "success" | "blocked" | "error";
  status: "success" | "blocked" | "error" | "reconnect_required";
  errorCode: string | null;
  counts: {
    campaigns: number;
    adGroups: number;
    ads: number;
    insights: number;
  };
};

function unixToIso(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function insightDate(insight: OpenAIAdsInsight): string | null {
  if (insight.readable_time && /^\d{4}-\d{2}-\d{2}$/.test(insight.readable_time)) {
    return insight.readable_time;
  }
  const iso = unixToIso(insight.start_time);
  return iso ? iso.slice(0, 10) : null;
}

function insightEndDate(insight: OpenAIAdsInsight): string | null {
  const iso = unixToIso(Math.max(0, insight.end_time - 1));
  return iso ? iso.slice(0, 10) : insightDate(insight);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
  return results;
}

function campaignPayload(campaign: OpenAIAdsCampaign) {
  const lifetime = campaign.budget.lifetime_spend_limit_micros ?? null;
  const daily = campaign.budget.daily_spend_limit_micros ?? null;
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective ?? campaign.bidding_type,
    bidding_type: campaign.bidding_type,
    budget_amount_micros: lifetime ?? daily,
    start_time: campaign.start_time,
    end_time: campaign.end_time,
    created_at: campaign.created_at,
    updated_at: campaign.updated_at,
    provider_data: {
      description: campaign.description,
      budget: campaign.budget,
      targeting: campaign.targeting ?? null,
      serving_issues: campaign.serving_issues ?? [],
    },
  };
}

function adGroupPayload(campaignId: string, adGroup: OpenAIAdsAdGroup) {
  return {
    id: adGroup.id,
    campaign_id: campaignId,
    name: adGroup.name,
    status: adGroup.status,
    billing_event_type: adGroup.bidding_config.billing_event_type,
    max_bid_micros: adGroup.bidding_config.max_bid_micros ?? null,
    bid_strategy: adGroup.bidding_config.strategy ?? null,
    created_at: adGroup.created_at,
    updated_at: adGroup.updated_at,
    provider_data: {
      description: adGroup.description,
      context_hints: adGroup.context_hints,
      bidding_config: adGroup.bidding_config,
      serving_issues: adGroup.serving_issues ?? [],
    },
  };
}

function adPayload(adGroupId: string, ad: OpenAIAdsAd) {
  return {
    id: ad.id,
    ad_group_id: adGroupId,
    name: ad.name,
    status: ad.status,
    review_status: ad.review_status,
    creative_type: ad.creative.type,
    target_url: ad.creative.target_url,
    created_at: ad.created_at,
    updated_at: ad.updated_at,
    provider_data: {
      creative: ad.creative,
      serving_issues: ad.serving_issues ?? [],
    },
  };
}

function insightPayload(
  insight: OpenAIAdsInsight,
  conversion: OpenAIAdsConversionInsight | undefined,
  conversionsAvailable: boolean,
) {
  return {
    campaign_id: insight.campaign_id,
    date: insightDate(insight),
    date_stop: insightEndDate(insight),
    impressions: insight.impressions ?? 0,
    clicks: insight.clicks ?? 0,
    spend: insight.spend ?? 0,
    conversions: conversionsAvailable ? (conversion?.conversions ?? 0) : null,
    data_status: insight.data_status ?? null,
    provider_data: {
      source_id: insight.id,
      start_time: insight.start_time,
      end_time: insight.end_time,
      click_through_conversions:
        conversion?.click_through_conversions ?? null,
      view_through_conversions:
        conversion?.view_through_conversions ?? null,
    },
  };
}

function classifyError(error: unknown) {
  if (error instanceof OpenAIAdsApiError) {
    const auth = error.status === 401 || error.status === 403;
    return {
      code: auth ? "credential_rejected" : error.code ?? "provider_error",
      reconnectRequired: auth,
      backoffMs: auth
        ? AUTH_BACKOFF_MS
        : error.retryAfterSeconds
          ? Math.max(ERROR_BACKOFF_MS, error.retryAfterSeconds * 1000)
          : ERROR_BACKOFF_MS,
    };
  }
  if (error instanceof OpenAIAdsServiceError) {
    const auth = [
      "credential_missing",
      "credential_decryption_failed",
      "credential_rejected",
    ].includes(error.code);
    return {
      code: error.code,
      reconnectRequired: auth,
      backoffMs: auth ? AUTH_BACKOFF_MS : ERROR_BACKOFF_MS,
    };
  }
  return {
    code: "sync_failed",
    reconnectRequired: false,
    backoffMs: ERROR_BACKOFF_MS,
  };
}

async function recordFailure(input: {
  platformAccountId: string;
  syncRunId: string | null;
  code: string;
  backoffMs: number;
}) {
  const admin = createAdminClient();
  const now = new Date();
  const next = new Date(now.getTime() + input.backoffMs).toISOString();

  const { data: account } = await admin
    .from("platform_accounts")
    .select("provider_consecutive_failures")
    .eq("id", input.platformAccountId)
    .maybeSingle();
  const failures = Math.max(
    1,
    Number(account?.provider_consecutive_failures ?? 0) + 1,
  );

  await admin
    .from("platform_accounts")
    .update({
      provider_sync_status: "error",
      provider_sync_error_code: input.code,
      provider_backoff_until: next,
      provider_next_sync_at: next,
      provider_consecutive_failures: failures,
      updated_at: now.toISOString(),
    })
    .eq("id", input.platformAccountId)
    .eq("platform", "openai_ads");

  if (input.syncRunId) {
    await admin
      .from("ad_platform_sync_runs")
      .update({
        status: "error",
        completed_at: now.toISOString(),
        error_code: input.code,
      })
      .eq("id", input.syncRunId);
  }
}

export async function syncOpenAIAdsAccount(input: {
  platformAccountId: string;
  userId?: string;
}): Promise<SyncResult> {
  const emptyCounts = { campaigns: 0, adGroups: 0, ads: 0, insights: 0 };
  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin.rpc(
    "claim_ad_platform_sync",
    {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId ?? null,
      p_stale_after_seconds: SYNC_STALE_AFTER_SECONDS,
    },
  );

  if (claimError) {
    throw new OpenAIAdsServiceError(
      "sync_claim_failed",
      500,
      "Der OpenAI-Ads-Abruf konnte nicht sicher gestartet werden.",
    );
  }
  if (claimed !== true) {
    return {
      outcome: "blocked",
      status: "blocked",
      errorCode: "sync_already_running_or_backoff",
      counts: emptyCounts,
    };
  }

  let syncRunId: string | null = null;
  try {
    const loaded = await loadOpenAIAdsClient(input);
    const { data: syncRun, error: syncRunError } = await admin
      .from("ad_platform_sync_runs")
      .insert({
        user_id: loaded.connection.user_id,
        platform_account_id: input.platformAccountId,
        platform: "openai_ads",
        status: "running",
      })
      .select("id")
      .single();

    if (syncRunError || !syncRun) {
      throw new OpenAIAdsServiceError(
        "sync_run_storage_failed",
        500,
        "Der OpenAI-Ads-Abruf konnte nicht protokolliert werden.",
      );
    }
    syncRunId = syncRun.id as string;

    const account = await loaded.client.getAdAccount();
    if (account.id !== loaded.connection.platform_account_id) {
      throw new OpenAIAdsServiceError(
        "remote_account_mismatch",
        409,
        "Der gespeicherte API-Key gehört nicht mehr zum erwarteten Werbekonto.",
      );
    }

    const campaigns = await loaded.client.listCampaigns();
    const groupedAdGroups = await mapWithConcurrency(
      campaigns,
      FETCH_CONCURRENCY,
      async (campaign) => ({
        campaignId: campaign.id,
        items: await loaded.client.listAdGroups(campaign.id),
      }),
    );
    const adGroups = groupedAdGroups.flatMap(({ campaignId, items }) =>
      items.map((item) => ({ campaignId, item })),
    );
    const groupedAds = await mapWithConcurrency(
      adGroups,
      FETCH_CONCURRENCY,
      async ({ item }) => ({
        adGroupId: item.id,
        items: await loaded.client.listAds(item.id),
      }),
    );
    const ads = groupedAds.flatMap(({ adGroupId, items }) =>
      items.map((item) => ({ adGroupId, item })),
    );

    const endUnix = Math.floor(Date.now() / 3_600_000) * 3_600;
    const startUnix = Math.max(946684800, endUnix - 30 * 24 * 60 * 60);
    const insights =
      endUnix > startUnix
        ? await loaded.client.listDailyCampaignInsights({ startUnix, endUnix })
        : [];
    let conversionInsights: OpenAIAdsConversionInsight[] = [];
    let conversionsAvailable = campaigns.length === 0;
    if (campaigns.length > 0 && endUnix > startUnix) {
      try {
        const chunks: string[][] = [];
        for (let index = 0; index < campaigns.length; index += 500) {
          chunks.push(campaigns.slice(index, index + 500).map((item) => item.id));
        }
        const chunkResults = await mapWithConcurrency(
          chunks,
          2,
          (campaignIds) =>
            loaded.client.listDailyCampaignConversions({
              startUnix,
              endUnix,
              campaignIds,
            }),
        );
        conversionInsights = chunkResults.flat();
        conversionsAvailable = true;
      } catch {
        conversionInsights = [];
        conversionsAvailable = false;
      }
    }
    const conversionByCampaignDate = new Map(
      conversionInsights
        .filter((item) => item.date)
        .map((item) => [`${item.entity_id}:${item.date}`, item]),
    );

    const accountPayload = {
      id: account.id,
      name: account.name,
      url: account.url,
      preview_url: account.preview_url,
      account_status: account.status,
      timezone: account.timezone,
      currency_code: account.currency_code,
      review_status: account.review.status,
      review_reason: account.review.reason ?? null,
      api_version: "v1",
      conversion_insights_status: conversionsAvailable
        ? "available"
        : "unavailable",
    };
    const campaignRows = campaigns.map(campaignPayload);
    const adGroupRows = adGroups.map(({ campaignId, item }) =>
      adGroupPayload(campaignId, item),
    );
    const adRows = ads.map(({ adGroupId, item }) => adPayload(adGroupId, item));
    const insightRows = insights
      .map((insight) => {
        const date = insightDate(insight);
        const conversion =
          date && insight.campaign_id
            ? conversionByCampaignDate.get(`${insight.campaign_id}:${date}`)
            : undefined;
        return insightPayload(insight, conversion, conversionsAvailable);
      })
      .filter((row) => row.campaign_id && row.date);

    const { data: snapshotCounts, error: snapshotError } = await admin.rpc(
      "replace_openai_ads_snapshot",
      {
        p_user_id: loaded.connection.user_id,
        p_platform_account_id: input.platformAccountId,
        p_sync_run_id: syncRunId,
        p_account: accountPayload,
        p_campaigns: campaignRows,
        p_ad_groups: adGroupRows,
        p_ads: adRows,
        p_insights: insightRows,
      },
    );

    if (snapshotError) {
      console.error("openai_ads_snapshot_replace_failed", {
        code: snapshotError.code,
        platformAccountId: input.platformAccountId,
      });
      throw new OpenAIAdsServiceError(
        "snapshot_storage_failed",
        500,
        "Der OpenAI-Ads-Snapshot konnte nicht atomar gespeichert werden.",
      );
    }

    const counts = {
      campaigns: Number(snapshotCounts?.campaigns ?? campaignRows.length),
      adGroups: Number(snapshotCounts?.ad_groups ?? adGroupRows.length),
      ads: Number(snapshotCounts?.ads ?? adRows.length),
      insights: Number(snapshotCounts?.insights ?? insightRows.length),
    };

    return {
      outcome: "success",
      status: "success",
      errorCode: null,
      counts,
    };
  } catch (error) {
    const classified = classifyError(error);
    await recordFailure({
      platformAccountId: input.platformAccountId,
      syncRunId,
      code: classified.code,
      backoffMs: classified.backoffMs,
    });
    console.error("openai_ads_sync_failed", {
      platformAccountId: input.platformAccountId,
      code: classified.code,
      kind:
        error instanceof OpenAIAdsApiError
          ? "provider"
          : error instanceof OpenAIAdsServiceError
            ? "service"
            : "internal",
    });

    return {
      outcome: "error",
      status: classified.reconnectRequired ? "reconnect_required" : "error",
      errorCode: classified.code,
      counts: emptyCounts,
    };
  }
}

export async function getDueOpenAIAdsAccountIds(limit: number) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("platform_accounts")
    .select("id")
    .eq("platform", "openai_ads")
    .is("revoked_at", null)
    .or(`provider_next_sync_at.is.null,provider_next_sync_at.lte.${now}`)
    .or(`provider_backoff_until.is.null,provider_backoff_until.lte.${now}`)
    .order("provider_next_sync_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(20, limit)));

  if (error) {
    throw new OpenAIAdsServiceError(
      "due_connections_unavailable",
      500,
      "Fällige OpenAI-Ads-Verbindungen konnten nicht geladen werden.",
    );
  }

  return (data ?? [])
    .map((row) => (typeof row.id === "string" ? row.id : null))
    .filter((id): id is string => Boolean(id));
}

export function nextSuccessfulSyncAt(now = Date.now()): string {
  return new Date(now + SUCCESS_INTERVAL_MS).toISOString();
}
