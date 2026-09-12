import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  decideMetaCreativeOptimization,
  META_CREATIVE_ATTRIBUTION_CONTRACT,
  type MetaCreativeCandidateEvidence,
} from "@/lib/meta/creative-format-decision";
import {
  getMetaCreativeOptimizationInsights,
  type MetaCreativeOptimizationInsight,
  type MetaUsageSnapshot,
} from "@/lib/meta/client";
import { parseMetaCurrencyMinor } from "@/lib/meta/money";
import { isMetaFormatKey, type MetaFormatKey } from "@/lib/media-library/meta-formats";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const META_IMAGE_HASH_PATTERN = /^[a-f0-9]{16,128}$/i;
const EMPTY_USAGE: MetaUsageSnapshot = {
  appPercent: null,
  pagePercent: null,
  businessPercent: null,
  adAccountPercent: null,
  insightsPercent: null,
  retryAfterSeconds: null,
};

export type MetaCreativeOptimizerResult = {
  status: "DONE" | "NO_ELIGIBLE_DATA";
  groupsConsidered: number;
  testsQueued: number;
  pausesQueued: number;
  testsCompletedWithoutWinner: number;
  existingPlans: number;
  skipped: number;
  failed: number;
  usage: MetaUsageSnapshot;
};

type JsonRecord = Record<string, unknown>;

type CampaignRow = {
  id: string;
  platform_campaign_id: string;
  objective: string | null;
  effective_status: string | null;
  status: string | null;
  last_seen_sync_id: string | null;
};

type AdGroupRow = {
  id: string;
  platform_ad_group_id: string;
  campaign_id: string;
  optimization_goal: string | null;
  effective_status: string | null;
  status: string | null;
  last_seen_sync_id: string | null;
};

type AdRow = {
  id: string;
  platform_ad_id: string;
  ad_group_id: string;
  creative_id: string | null;
  effective_status: string | null;
  status: string | null;
  last_seen_sync_id: string | null;
};

type CreativeRow = {
  id: string;
  content: JsonRecord | null;
};

type AssetRow = {
  id: string;
  sha256: string;
  meta_image_hash: string | null;
  width: number | null;
  height: number | null;
  brand_profile_id: string | null;
  metadata: JsonRecord | null;
  source_type: string;
  asset_role: string;
  library_scope: string | null;
  status: string;
  moderation_status: string;
  reviewed_at: string | null;
  mime_type: string;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string;
};

type ActiveAdContext = {
  ad: AdRow;
  adGroup: AdGroupRow;
  campaign: CampaignRow;
  creative: CreativeRow | null;
  asset: AssetRow | null;
};

type CycleRow = {
  id: string;
  ad_set_id: string;
  baseline_ad_id: string;
  candidate_ad_id: string | null;
  baseline_asset_id: string;
  candidate_asset_id: string;
  status: string;
  measurement_start_date: string | null;
  measurement_end_date: string | null;
};

type OptimizerPolicyRow = {
  id: string;
  allow_new_launches: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function active(status: string | null, effectiveStatus: string | null): boolean {
  return (effectiveStatus ?? status)?.toUpperCase() === "ACTIVE";
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(value.getTime())) throw new TypeError("Invalid Meta insights date");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function fixedDates(start: string | null, end: string | null): string[] | null {
  if (!start || !end || addUtcDays(start, 6) !== end) return null;
  return Array.from({ length: 7 }, (_, index) => addUtcDays(start, index));
}

function integerMetric(value: string | null): number | null {
  if (value === null || !/^\d{1,20}(?:\.0+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function metadataString(metadata: JsonRecord | null, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function assetFormat(asset: AssetRow | null): MetaFormatKey | null {
  const key = metadataString(asset?.metadata ?? null, "meta_format_key");
  return key && isMetaFormatKey(key) ? key : null;
}

function assetFamilyRoot(asset: AssetRow): string {
  const parent = metadataString(asset.metadata, "parent_asset_id");
  return parent && UUID_PATTERN.test(parent) ? parent : asset.id;
}

function eligibleCandidateAsset(asset: AssetRow): boolean {
  const readySource = asset.source_type === "UPLOADED" || asset.source_type === "GENERATED";
  const usableRole = asset.asset_role === "UPLOAD_EDITABLE"
    || asset.asset_role === "GENERATED"
    || asset.asset_role === "LOCKED_PHOTO";
  const usableImage = asset.mime_type === "image/png" || asset.mime_type === "image/jpeg";
  const hasProviderImage = asset.meta_image_hash !== null
    && META_IMAGE_HASH_PATTERN.test(asset.meta_image_hash);
  const hasUpload = Boolean(asset.storage_bucket && asset.storage_path);
  return readySource
    && usableRole
    && asset.library_scope === "CUSTOMER"
    && asset.status === "READY"
    && asset.moderation_status === "APPROVED"
    && asset.reviewed_at !== null
    && asset.brand_profile_id !== null
    && SHA256_PATTERN.test(asset.sha256)
    && usableImage
    && (hasProviderImage || hasUpload);
}

function chooseCandidateAsset(
  baseline: AssetRow | null,
  assets: AssetRow[],
  excludedAssetIds: ReadonlySet<string>,
  excludedAssetShas: ReadonlySet<string>,
): { asset: AssetRow; testKind: "FORMAT" | "CREATIVE" } | null {
  if (!baseline?.brand_profile_id || !eligibleCandidateAsset(baseline)) return null;
  const baselineRoot = assetFamilyRoot(baseline);
  const baselineFormat = assetFormat(baseline);
  const candidates = assets
    .filter((asset) => eligibleCandidateAsset(asset))
    .filter((asset) => !excludedAssetIds.has(asset.id))
    .filter((asset) => !excludedAssetShas.has(asset.sha256))
    .filter((asset) => asset.brand_profile_id === baseline.brand_profile_id)
    .filter((asset) => asset.id !== baseline.id && asset.sha256 !== baseline.sha256)
    .filter((asset) => !asset.meta_image_hash
      || !baseline.meta_image_hash
      || asset.meta_image_hash.toLowerCase() !== baseline.meta_image_hash.toLowerCase())
    .sort((left, right) => left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id));

  const formatVariant = candidates.find((asset) => {
    const candidateFormat = assetFormat(asset);
    return assetFamilyRoot(asset) === baselineRoot
      && candidateFormat !== null
      && baselineFormat !== null
      && candidateFormat !== baselineFormat;
  });
  if (formatVariant) return { asset: formatVariant, testKind: "FORMAT" };
  return candidates[0] ? { asset: candidates[0], testKind: "CREATIVE" } : null;
}

function insightDailyRow(insight: MetaCreativeOptimizationInsight) {
  return {
    date: insight.dateStart,
    impressions: integerMetric(insight.impressions),
    inlineLinkClicks: integerMetric(insight.inlineLinkClicks),
    spendMinor: parseMetaCurrencyMinor(insight.spend),
  };
}

async function queryRows<T>(
  promise: PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
    count?: number | null;
  }>,
  label: string,
): Promise<T[]> {
  const { data, error, count } = await promise;
  if (
    error
    || !Array.isArray(data)
    || (typeof count === "number" && count !== data.length)
  ) {
    throw new Error(`Meta creative optimizer data read failed: ${label}`);
  }
  return data as T[];
}

function rpcOutcome(value: unknown): "CREATED" | "EXISTING" | "BLOCKED" {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return "BLOCKED";
  const outcome = row.outcome;
  return outcome === "CREATED" || outcome === "QUEUED"
    ? "CREATED"
    : outcome === "EXISTING"
      ? "EXISTING"
      : "BLOCKED";
}

export async function runMetaCreativeFormatOptimizerAfterSnapshot(input: {
  platformAccountId: string;
  userId: string;
  adAccountId: string;
  accessToken: string;
  appSecret: string;
  marketingSyncId: string;
  readLeaseToken: string;
  accountLocalToday: string;
  now?: Date;
}): Promise<MetaCreativeOptimizerResult> {
  const matureThrough = addUtcDays(input.accountLocalToday, -3);
  const admin = createAdminClient();
  const [accountRows, policyRows, killSwitchRows] = await Promise.all([
    queryRows<JsonRecord>(admin
      .from("platform_accounts")
      .select("id,user_id,marketing_meta_ad_account_id,marketing_currency,marketing_sync_id,marketing_sync_status", { count: "exact" })
      .eq("id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("platform", "meta")
      .limit(1), "account"),
    queryRows<OptimizerPolicyRow>(admin
      .from("automation_policies")
      .select("id,allow_new_launches", { count: "exact" })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("is_current", true)
      .eq("status", "ACTIVE")
      .eq("currency", "EUR")
      .eq("allow_status_changes", true)
      .limit(1), "policy"),
    queryRows<{ mode: string }>(admin.rpc("get_effective_meta_kill_switch", {
      p_user_id: input.userId,
      p_platform_account_id: input.platformAccountId,
      p_plan_id: null,
    }), "kill switch"),
  ]);
  const account = accountRows[0];
  const newLaunchesAllowed = policyRows[0]?.allow_new_launches === true;
  const currency = typeof account?.marketing_currency === "string"
    ? account.marketing_currency.toUpperCase()
    : null;
  const selectedAdAccount = typeof account?.marketing_meta_ad_account_id === "string"
    ? account.marketing_meta_ad_account_id.replace(/^act_/, "")
    : null;
  if (
    !account
    || policyRows.length !== 1
    || killSwitchRows[0]?.mode !== "ALLOW"
    || account.marketing_sync_id !== input.marketingSyncId
    || account.marketing_sync_status !== "success"
    || currency !== "EUR"
    || selectedAdAccount !== input.adAccountId.replace(/^act_/, "")
  ) {
    return {
      status: "NO_ELIGIBLE_DATA",
      groupsConsidered: 0,
      testsQueued: 0,
      pausesQueued: 0,
      testsCompletedWithoutWinner: 0,
      existingPlans: 0,
      skipped: 0,
      failed: 0,
      usage: EMPTY_USAGE,
    };
  }
  const [campaigns, adGroups, ads, targets, creatives, assets, cycles] = await Promise.all([
    queryRows<CampaignRow>(admin
      .from("campaigns")
      .select("id,platform_campaign_id,objective,effective_status,status,last_seen_sync_id", { count: "exact" })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("is_current", true)
      .eq("last_seen_sync_id", input.marketingSyncId), "campaigns"),
    queryRows<AdGroupRow>(admin
      .from("ad_groups")
      .select("id,platform_ad_group_id,campaign_id,optimization_goal,effective_status,status,last_seen_sync_id", { count: "exact" })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("is_current", true)
      .eq("last_seen_sync_id", input.marketingSyncId), "ad_groups"),
    queryRows<AdRow>(admin
      .from("ads")
      .select("id,platform_ad_id,ad_group_id,creative_id,effective_status,status,last_seen_sync_id", { count: "exact" })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("is_current", true)
      .eq("last_seen_sync_id", input.marketingSyncId), "ads"),
    queryRows<{ ad_id: string | null }>(admin
      .from("automation_targets")
      .select("ad_id", { count: "exact" })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("target_type", "AD")
      .eq("status", "MANAGED"), "automation targets"),
    queryRows<CreativeRow>(admin
      .from("creatives")
      .select("id,content", { count: "exact" })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("source", "meta")
      .eq("is_current", true), "creatives"),
    queryRows<AssetRow>(admin
      .from("brand_assets")
      .select("id,sha256,meta_image_hash,width,height,brand_profile_id,metadata,source_type,asset_role,library_scope,status,moderation_status,reviewed_at,mime_type,storage_bucket,storage_path,created_at", { count: "exact" })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("library_scope", "CUSTOMER")
      .eq("status", "READY")
      .eq("moderation_status", "APPROVED"), "brand assets"),
    queryRows<CycleRow>(admin
      .from("meta_creative_optimization_cycles")
      .select("id,ad_set_id,baseline_ad_id,candidate_ad_id,baseline_asset_id,candidate_asset_id,status,measurement_start_date,measurement_end_date", { count: "exact" })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId), "creative optimization cycles"),
  ]);

  const activeCycles = cycles.filter((cycle) => cycle.status === "ACTIVE_TEST");
  const oldestQueryableDate = addUtcDays(matureThrough, -89);
  const insightRanges = activeCycles.flatMap((cycle) => {
    const dates = fixedDates(cycle.measurement_start_date, cycle.measurement_end_date);
    return dates && dates[0] >= oldestQueryableDate && dates[0] <= matureThrough
      ? [{
          since: dates[0],
          until: dates.at(-1)! < matureThrough ? dates.at(-1)! : matureThrough,
        }]
      : [];
  });
  let insights: MetaCreativeOptimizationInsight[] = [];
  let insightUsage = EMPTY_USAGE;
  const insightSince = insightRanges.length > 0
    ? insightRanges.map((range) => range.since).sort()[0]
    : null;
  const insightUntil = insightRanges.length > 0
    ? insightRanges.map((range) => range.until).sort().at(-1)!
    : null;
  if (insightSince && insightUntil) {
    const insightResult = await getMetaCreativeOptimizationInsights({
      adAccountId: input.adAccountId,
      accessToken: input.accessToken,
      appSecret: input.appSecret,
      since: insightSince,
      until: insightUntil,
    });
    insights = insightResult.items;
    insightUsage = insightResult.usage;
  }

  const campaignById = new Map(campaigns.map((row) => [row.id, row]));
  const adGroupById = new Map(adGroups.map((row) => [row.id, row]));
  const creativeById = new Map(creatives.map((row) => [row.id, row]));
  const managedAdIds = new Set(targets.flatMap((row) => row.ad_id ? [row.ad_id] : []));
  const assetByMetaHash = new Map(assets.flatMap((asset) =>
    asset.meta_image_hash
      ? [[asset.meta_image_hash.toLowerCase(), asset] as const]
      : []));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const contextsByAdSet = new Map<string, ActiveAdContext[]>();
  const activeCycleByAdSet = new Map(
    activeCycles.map((cycle) => [cycle.ad_set_id, cycle] as const),
  );
  const testedAssetsByAdSet = new Map<string, Set<string>>();
  const testedAssetShasByAdSet = new Map<string, Set<string>>();
  for (const cycle of cycles) {
    const tested = testedAssetsByAdSet.get(cycle.ad_set_id) ?? new Set<string>();
    tested.add(cycle.candidate_asset_id);
    tested.add(cycle.baseline_asset_id);
    testedAssetsByAdSet.set(cycle.ad_set_id, tested);
    const testedSha = assetById.get(cycle.candidate_asset_id)?.sha256;
    const baselineSha = assetById.get(cycle.baseline_asset_id)?.sha256;
    if (testedSha || baselineSha) {
      const testedShas = testedAssetShasByAdSet.get(cycle.ad_set_id)
        ?? new Set<string>();
      if (testedSha) testedShas.add(testedSha);
      if (baselineSha) testedShas.add(baselineSha);
      testedAssetShasByAdSet.set(cycle.ad_set_id, testedShas);
    }
  }

  for (const ad of ads) {
    if (!managedAdIds.has(ad.id) || !active(ad.status, ad.effective_status)) continue;
    const adGroup = adGroupById.get(ad.ad_group_id);
    const campaign = adGroup ? campaignById.get(adGroup.campaign_id) : undefined;
    if (
      !adGroup
      || !campaign
      || !active(adGroup.status, adGroup.effective_status)
      || !active(campaign.status, campaign.effective_status)
      || !campaign.objective
    ) continue;
    const creative = ad.creative_id ? creativeById.get(ad.creative_id) ?? null : null;
    const imageHash = creative && typeof creative.content?.image_hash === "string"
      ? creative.content.image_hash.toLowerCase()
      : null;
    const context: ActiveAdContext = {
      ad,
      adGroup,
      campaign,
      creative,
      asset: imageHash ? assetByMetaHash.get(imageHash) ?? null : null,
    };
    const existing = contextsByAdSet.get(adGroup.id) ?? [];
    existing.push(context);
    contextsByAdSet.set(adGroup.id, existing);
  }

  const insightByAd = new Map<string, MetaCreativeOptimizationInsight[]>();
  const duplicateKeys = new Set<string>();
  const seenInsightKeys = new Set<string>();
  const expectedAccount = input.adAccountId.replace(/^act_/, "");
  const contextByPlatformAdId = new Map(
    [...contextsByAdSet.values()].flat().map((context) => [
      context.ad.platform_ad_id,
      context,
    ]),
  );
  for (const insight of insights) {
    if (
      insight.accountId !== expectedAccount
      || insight.dateStart !== insight.dateStop
      || insight.attributionContract !== META_CREATIVE_ATTRIBUTION_CONTRACT
      || (insightSince !== null && insight.dateStart < insightSince)
      || (insightUntil !== null && insight.dateStart > insightUntil)
    ) {
      throw new TypeError("Meta creative insight scope mismatch");
    }
    const context = contextByPlatformAdId.get(insight.adId);
    if (!context) continue;
    if (
      insight.adSetId !== context.adGroup.platform_ad_group_id
      || insight.campaignId !== context.campaign.platform_campaign_id
    ) {
      throw new TypeError("Meta creative insight parent mismatch");
    }
    const duplicateKey = `${insight.adId}:${insight.dateStart}`;
    if (seenInsightKeys.has(duplicateKey)) duplicateKeys.add(duplicateKey);
    seenInsightKeys.add(duplicateKey);
    const rows = insightByAd.get(insight.adId) ?? [];
    rows.push(insight);
    insightByAd.set(insight.adId, rows);
  }

  const result: MetaCreativeOptimizerResult = {
    status: contextsByAdSet.size > 0 ? "DONE" : "NO_ELIGIBLE_DATA",
    groupsConsidered: 0,
    testsQueued: 0,
    pausesQueued: 0,
    testsCompletedWithoutWinner: 0,
    existingPlans: 0,
    skipped: 0,
    failed: 0,
    usage: insightUsage,
  };

  for (const contexts of contextsByAdSet.values()) {
    result.groupsConsidered += 1;
    const [first] = contexts;
    const activeCycle = first ? activeCycleByAdSet.get(first.adGroup.id) : undefined;
    if (!first || contexts.length > 3) {
      result.skipped += 1;
      continue;
    }
    if (contexts.length === 2) {
      const contextIds = new Set(contexts.map((context) => context.ad.id));
      if (
        !activeCycle
        || !activeCycle.candidate_ad_id
        || !contextIds.has(activeCycle.baseline_ad_id)
        || !contextIds.has(activeCycle.candidate_ad_id)
      ) {
        result.skipped += 1;
        continue;
      }
    } else if (activeCycle) {
      result.skipped += 1;
      continue;
    }
    if (contexts.some((context) =>
      (insightByAd.get(context.ad.platform_ad_id) ?? [])
        .some((insight) => duplicateKeys.has(`${insight.adId}:${insight.dateStart}`)))) {
      result.skipped += 1;
      continue;
    }

    const candidates: MetaCreativeCandidateEvidence[] = contexts.map((context) => ({
      adId: context.ad.id,
      platformAdId: context.ad.platform_ad_id,
      adSetId: context.adGroup.id,
      platformAdSetId: context.adGroup.platform_ad_group_id,
      campaignId: context.campaign.id,
      platformCampaignId: context.campaign.platform_campaign_id,
      objective: context.campaign.objective!,
      optimizationGoal: context.adGroup.optimization_goal,
      currency,
      sourceSyncId: input.marketingSyncId,
      attributionContract: META_CREATIVE_ATTRIBUTION_CONTRACT,
      assetId: context.asset?.id ?? null,
      assetSha256: context.asset?.sha256 ?? null,
      formatKey: assetFormat(context.asset),
      rows: (insightByAd.get(context.ad.platform_ad_id) ?? []).map(insightDailyRow),
    }));
    const requiredDates = activeCycle
      ? fixedDates(
          activeCycle.measurement_start_date,
          activeCycle.measurement_end_date,
        ) ?? undefined
      : undefined;
    const decision = decideMetaCreativeOptimization({
      candidates,
      requiredDates,
      matureThrough,
    });

    try {
      if (decision.status === "PAUSE_LOSER") {
        const { data, error } = await admin.rpc(
          "queue_meta_creative_evidence_pause_internal",
          {
            p_user_id: input.userId,
            p_platform_account_id: input.platformAccountId,
            p_source_marketing_sync_id: input.marketingSyncId,
            p_read_lease_token: input.readLeaseToken,
            p_winner_ad_id: decision.winnerAdId,
            p_loser_ad_id: decision.loserAdId,
            p_evidence: decision.evidence,
            p_planned_at: (input.now ?? new Date()).toISOString(),
          },
        );
        if (error) throw error;
        const outcome = rpcOutcome(data);
        if (outcome === "CREATED") result.pausesQueued += 1;
        else if (outcome === "EXISTING") result.existingPlans += 1;
        else result.skipped += 1;
        continue;
      }

      if (decision.status === "COMPLETE_NO_WINNER" && activeCycle) {
        const { data, error } = await admin.rpc(
          "complete_meta_creative_optimization_cycle_no_winner",
          {
            p_user_id: input.userId,
            p_platform_account_id: input.platformAccountId,
            p_source_marketing_sync_id: input.marketingSyncId,
            p_read_lease_token: input.readLeaseToken,
            p_cycle_id: activeCycle.id,
            p_reason: decision.reason,
            p_evidence: decision.evidence,
            p_completed_at: (input.now ?? new Date()).toISOString(),
          },
        );
        if (error) throw error;
        const outcome = rpcOutcome(data);
        if (outcome === "CREATED") result.testsCompletedWithoutWinner += 1;
        else if (outcome === "EXISTING") result.existingPlans += 1;
        else result.skipped += 1;
        continue;
      }

      if (
        decision.status === "START_TEST"
        && contexts.length === 1
        && !activeCycle
        && newLaunchesAllowed
      ) {
        const selection = chooseCandidateAsset(
          first.asset,
          assets,
          testedAssetsByAdSet.get(first.adGroup.id) ?? new Set<string>(),
          testedAssetShasByAdSet.get(first.adGroup.id) ?? new Set<string>(),
        );
        if (!selection) {
          result.skipped += 1;
          continue;
        }
        const { data, error } = await admin.rpc(
          "materialize_meta_creative_format_optimizer_plan",
          {
            p_user_id: input.userId,
            p_platform_account_id: input.platformAccountId,
            p_source_marketing_sync_id: input.marketingSyncId,
            p_read_lease_token: input.readLeaseToken,
            p_baseline_ad_id: first.ad.id,
            p_candidate_asset_id: selection.asset.id,
            p_test_kind: selection.testKind,
            p_planned_at: (input.now ?? new Date()).toISOString(),
          },
        );
        if (error) throw error;
        const outcome = rpcOutcome(data);
        if (outcome === "CREATED") result.testsQueued += 1;
        else if (outcome === "EXISTING") result.existingPlans += 1;
        else result.skipped += 1;
        continue;
      }

      result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }

  return result;
}
