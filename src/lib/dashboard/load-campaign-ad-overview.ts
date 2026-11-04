import "server-only";

import { buildMetaAdPreviewCombinations } from "@/lib/meta/ad-preview-combinations";
import {
  buildCampaignAdOverview,
  type CampaignAdOverviewItem,
} from "@/lib/meta/campaign-ad-overview";
import { metaConversionReport } from "@/lib/meta/conversion-events";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_CAMPAIGNS = 200;
const IN_CHUNK = 100;
const SIGNED_IMAGE_TTL_SECONDS = 60 * 60;

type Row = Record<string, unknown>;
type AdminClient = ReturnType<typeof createAdminClient>;

export type CampaignAdOverviewData = {
  items: CampaignAdOverviewItem[];
  advertiserName: string;
  error: boolean;
};

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += IN_CHUNK) {
    result.push(values.slice(index, index + IN_CHUNK));
  }
  return result;
}

/** Runs one `.in()` query per chunk so long id lists never exceed URL limits. */
async function selectIn(
  values: readonly string[],
  query: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Row[]> {
  if (values.length === 0) return [];
  const results = await Promise.all(chunks([...new Set(values)]).map(query));
  const rows: Row[] = [];
  for (const result of results) {
    if (result.error) throw result.error;
    if (Array.isArray(result.data)) rows.push(...(result.data as Row[]));
  }
  return rows;
}

function ids(rows: readonly Row[], key: string): string[] {
  return rows.flatMap((row) =>
    typeof row[key] === "string" && row[key] ? [row[key] as string] : [],
  );
}

function planAssetIds(plans: readonly Row[]): string[] {
  return plans.flatMap((plan) => {
    const payload = plan.planned_payload as Row | null;
    const assetIds = payload && Array.isArray(payload.brand_asset_ids)
      ? payload.brand_asset_ids
      : [];
    return assetIds.filter(
      (assetId): assetId is string =>
        typeof assetId === "string" && /^[0-9a-f-]{36}$/i.test(assetId),
    );
  });
}

/** Events whose counts already live in performance_data columns. */
const COLUMN_BACKED_EVENTS = new Set(["LEAD", "PURCHASE"]);

/**
 * Adds reporting for each campaign's stored optimization event. Raw action
 * sums come from meta_campaign_conversion_actions_30d and are only read for
 * campaigns optimised on another event than LEAD/PURCHASE. Any read problem
 * (e.g. view not yet migrated) leaves those reports without counts instead of
 * failing the overview.
 */
async function attachConversionReports(
  admin: AdminClient,
  userId: string,
  items: CampaignAdOverviewItem[],
  performance: readonly Row[],
): Promise<CampaignAdOverviewItem[]> {
  const withEvent = items.filter((item) => item.optimizationEventType);
  if (withEvent.length === 0) return items;
  const performanceByCampaign = new Map(
    performance.map((row) => [String(row.campaign_id ?? ""), row]),
  );
  const actionCampaignIds = withEvent
    .filter((item) => !COLUMN_BACKED_EVENTS.has(item.optimizationEventType ?? ""))
    .map((item) => item.id);
  const actionsByCampaign = new Map<string, Row>();
  if (actionCampaignIds.length > 0) {
    try {
      const rows = await selectIn(actionCampaignIds, (chunk) =>
        admin
          .from("meta_campaign_conversion_actions_30d")
          .select("campaign_id,actions,action_values")
          .eq("user_id", userId)
          .in("campaign_id", chunk),
      );
      for (const row of rows) actionsByCampaign.set(String(row.campaign_id ?? ""), row);
    } catch (error) {
      console.warn("[campaign-ad-overview] conversion actions unavailable", error);
    }
  }
  const asMap = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  return items.map((item) => {
    if (!item.optimizationEventType) return item;
    const perf = performanceByCampaign.get(item.id);
    const actions = actionsByCampaign.get(item.id);
    return {
      ...item,
      conversion: metaConversionReport({
        customEventType: item.optimizationEventType,
        spend: perf?.spend,
        leads: perf?.leads,
        purchases: perf?.purchases,
        purchaseValue: perf?.purchase_value,
        actions: asMap(actions?.actions),
        actionValues: asMap(actions?.action_values),
      }),
    };
  });
}

/** Short-lived storage URLs for viewers without an Adbot session (Adbot Funnel). */
async function signBrandAssetImages(
  admin: AdminClient,
  userId: string,
  assetIds: readonly string[],
): Promise<Map<string, string>> {
  const assets = await selectIn(assetIds, (chunk) =>
    admin
      .from("brand_assets")
      .select("id,storage_bucket,storage_path,status")
      .eq("user_id", userId)
      .eq("library_scope", "CUSTOMER")
      .in("id", chunk),
  );
  const pathsByBucket = new Map<string, Array<{ id: string; path: string }>>();
  for (const asset of assets) {
    if (asset.status === "REVOKED") continue;
    const bucket = typeof asset.storage_bucket === "string" ? asset.storage_bucket : "";
    const path = typeof asset.storage_path === "string" ? asset.storage_path : "";
    if (!bucket || !path) continue;
    const list = pathsByBucket.get(bucket) ?? [];
    list.push({ id: String(asset.id), path });
    pathsByBucket.set(bucket, list);
  }
  const urls = new Map<string, string>();
  for (const [bucket, entries] of pathsByBucket) {
    const { data } = await admin.storage
      .from(bucket)
      .createSignedUrls(entries.map((entry) => entry.path), SIGNED_IMAGE_TTL_SECONDS);
    for (const signed of data ?? []) {
      const entry = entries.find((candidate) => candidate.path === signed.path);
      if (entry && signed.signedUrl) urls.set(entry.id, signed.signedUrl);
    }
  }
  return urls;
}

/** Latest SUCCEEDED automatic and customer status decisions, newest first. */
async function loadStatusDecisions(
  admin: AdminClient,
  userId: string,
  platformAccountId: string | null,
): Promise<Row[]> {
  let query = admin
    .from("mutation_plans")
    .select("source_rule_key,planned_payload,terminal_at")
    .eq("user_id", userId)
    .eq("status", "SUCCEEDED")
    .in("source_rule_key", ["lead_underperformer_pause_v1", "customer_status_change"]);
  if (platformAccountId) query = query.eq("platform_account_id", platformAccountId);
  const { data, error } = await query
    .order("terminal_at", { ascending: false, nullsFirst: false })
    .limit(MAX_CAMPAIGNS);
  if (error) throw error;
  return (data ?? []) as Row[];
}

/**
 * Loads every current Meta campaign of one customer with its ads, creatives
 * and the Adbot launch plan behind it. Read-only; scoped by user id (and the
 * selected ad account when given).
 */
export async function loadCampaignAdOverview(input: {
  userId: string;
  platformAccountId?: string | null;
  currency?: string;
  /** "portal": images via the logged-in media preview route; "signed": storage URLs. */
  imageMode: "portal" | "signed";
}): Promise<CampaignAdOverviewData> {
  const admin = createAdminClient();
  const empty: CampaignAdOverviewData = {
    items: [],
    advertiserName: "Deine Facebook-Seite",
    error: false,
  };

  try {
    let campaignQuery = admin
      .from("campaigns")
      .select(
        "id,platform_campaign_id,name,objective,status,effective_status,daily_budget_minor,lifetime_budget_minor,start_time,stop_time,platform_updated_time",
      )
      .eq("user_id", input.userId)
      .eq("is_current", true);
    if (input.platformAccountId) {
      campaignQuery = campaignQuery.eq("platform_account_id", input.platformAccountId);
    }
    let brandQuery = admin
      .from("brand_profiles")
      .select("display_name,brand_name")
      .eq("user_id", input.userId)
      .eq("status", "ACTIVE");
    if (input.platformAccountId) {
      brandQuery = brandQuery.eq("platform_account_id", input.platformAccountId);
    }
    const [campaignResult, brandResult] = await Promise.all([
      campaignQuery
        .order("platform_updated_time", { ascending: false, nullsFirst: false })
        .limit(MAX_CAMPAIGNS),
      brandQuery.order("version", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (campaignResult.error) throw campaignResult.error;
    const campaigns = (campaignResult.data ?? []) as Row[];
    const brand = (brandResult.data ?? null) as Row | null;
    const advertiserName =
      (typeof brand?.display_name === "string" && brand.display_name.trim()) ||
      (typeof brand?.brand_name === "string" && brand.brand_name.trim()) ||
      empty.advertiserName;
    if (campaigns.length === 0) return { ...empty, advertiserName };

    const campaignIds = ids(campaigns, "id");
    const platformCampaignIds = ids(campaigns, "platform_campaign_id");

    const [adGroups, campaignBindings, performance, autoPauses] = await Promise.all([
      selectIn(campaignIds, (chunk) =>
        admin
          .from("ad_groups")
          .select("id,campaign_id")
          .eq("user_id", input.userId)
          .eq("is_current", true)
          .in("campaign_id", chunk),
      ),
      selectIn(platformCampaignIds, (chunk) =>
        admin
          .from("remote_object_bindings")
          .select("plan_id,local_campaign_id,remote_object_id")
          .eq("user_id", input.userId)
          .eq("object_type", "CAMPAIGN")
          .in("remote_object_id", chunk),
      ),
      selectIn(campaignIds, (chunk) =>
        admin
          .from("meta_campaign_performance_30d")
          .select(
            "campaign_id,currency,spend,impressions,inline_link_clicks,leads,purchases,purchase_value",
          )
          .eq("user_id", input.userId)
          .in("campaign_id", chunk),
      ),
      loadStatusDecisions(admin, input.userId, input.platformAccountId ?? null),
    ]);

    const [ads, plans] = await Promise.all([
      selectIn(ids(adGroups, "id"), (chunk) =>
        admin
          .from("ads")
          .select("id,ad_group_id,platform_ad_id,status,effective_status,platform_creative_id")
          .eq("user_id", input.userId)
          .eq("is_current", true)
          .in("ad_group_id", chunk),
      ),
      selectIn(ids(campaignBindings, "plan_id"), (chunk) =>
        admin
          .from("mutation_plans")
          .select("id,source_rule_key,planned_payload")
          .eq("user_id", input.userId)
          .in("id", chunk),
      ),
    ]);

    const [creatives, signedImages] = await Promise.all([
      selectIn(ids(ads, "platform_creative_id"), (chunk) =>
        admin
          .from("creatives")
          .select(
            "platform_creative_id,title,body,call_to_action_type,thumbnail_url,instagram_permalink_url,content",
          )
          .eq("user_id", input.userId)
          .eq("is_current", true)
          .in("platform_creative_id", chunk),
      ),
      input.imageMode === "signed"
        ? signBrandAssetImages(admin, input.userId, planAssetIds(plans))
        : Promise.resolve(new Map<string, string>()),
    ]);

    const items = buildCampaignAdOverview({
      campaigns,
      adGroups,
      ads,
      creatives,
      plans,
      campaignBindings,
      performance,
      autoPauses,
      currency: input.currency ?? "EUR",
      now: Date.now(),
      brandAssetImageUrl: (assetId) =>
        input.imageMode === "portal"
          ? `/api/media-library/preview?assetId=${encodeURIComponent(assetId)}`
          : (signedImages.get(assetId) ?? null),
      buildCombinations: buildMetaAdPreviewCombinations,
    });
    const withConversions = await attachConversionReports(
      admin,
      input.userId,
      items,
      performance,
    );
    return { items: withConversions, advertiserName, error: false };
  } catch (error) {
    console.error("[campaign-ad-overview] load failed", error);
    return { ...empty, error: true };
  }
}
