import "server-only";

import {
  getFacebookPublishedPosts,
  getInstagramMedia,
  getMetaPageAssets,
  mergeMetaUsage,
  MetaCollectionLimitError,
  MetaGraphError,
  type MetaContentItem,
  type MetaUsageSnapshot,
} from "./client";
import {
  MetaMarketingDataError,
  syncMetaMarketingSnapshot,
  type MetaMarketingSyncResult,
} from "./marketing-sync";
import { runOrganicBoostPlannerForAccount } from "./organic-boost-runner";
import {
  claimMetaReadOperation,
  MetaBudgetPlannerError,
  releaseMetaAccountOperation,
  runMetaBudgetPlannerAfterSnapshot,
  runMetaOrganicBoostPlannerAfterSnapshot,
  type MetaBudgetPlannerResult,
  type MetaOrganicBoostPlannerResult,
} from "./planner";
import { decryptAccessToken } from "./crypto";
import { getMetaSyncEnv } from "./env";
import { createAdminClient } from "../supabase/admin";
import { nextHourlyRun } from "./schedule";

const SYNC_LOCK_SECONDS = 5 * 60;
const MANUAL_SYNC_COOLDOWN_SECONDS = 60;
const DEFAULT_ERROR_BACKOFF_SECONDS = 5 * 60;
const DEFAULT_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;
const RATE_LIMIT_USAGE_THRESHOLD = 90;
export const META_CRON_BATCH_SIZE = 10;

const EMPTY_USAGE: MetaUsageSnapshot = {
  appPercent: null,
  pagePercent: null,
  businessPercent: null,
  adAccountPercent: null,
  insightsPercent: null,
  retryAfterSeconds: null,
};

type ConnectorRow = {
  id: string;
  user_id: string;
  access_token_encrypted: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  expires_at: string | null;
  data_access_expires_at: string | null;
  sync_lock_until: string | null;
  sync_backoff_until: string | null;
  last_sync_started_at: string | null;
  sync_consecutive_failures: number | null;
  instagram_account_ids: unknown;
  marketing_sync_id: string | null;
  marketing_sync_status: string | null;
};

type AssetRow = {
  id: string;
  asset_type: "facebook_page" | "instagram_account" | "ad_account";
  meta_asset_id: string;
  parent_meta_asset_id: string | null;
  baseline_completed_at: string | null;
};

export type MetaSyncBlockedReason =
  | "not_found"
  | "locked"
  | "cooldown"
  | "backoff";

export type MetaSyncResult = {
  outcome: "completed" | "blocked";
  status:
    | "success"
    | "partial"
    | "error"
    | "rate_limited"
    | "reconnect_required"
    | "blocked";
  blockedReason: MetaSyncBlockedReason | null;
  seenCount: number;
  newCount: number;
  syncedAssetCount: number;
  failedAssetCount: number;
  marketingStatus: "success" | "error" | "not_run";
  campaignsCount: number;
  adSetsCount: number;
  adsCount: number;
  creativesCount: number;
  insightsCount: number;
  recommendationsCount: number;
  insightsSince: string | null;
  insightsUntil: string | null;
  plannerStatus: MetaBudgetPlannerResult["status"] | "error" | "not_run";
  plannerSnapshotId: string | null;
  plannerAccountDay: string | null;
  plannerObservedBudgetOwnerCount: number;
  plannerReservedExposureMinor: number;
  plannerPlansCreated: number;
  plannerPlansExisting: number;
  plannerCandidatesBlocked: number;
  plannerHardCapBreach: boolean;
  organicBoostStatus: string | null;
  organicBoostPlansCreated: number;
  organicBoostPlansExisting: number;
  organicBoostCandidatesFailed: number;
  organicBoostCandidatesSkipped: number;
  organicBoostCandidatesConsidered: number;
  organicBoostLastError: string | null;
  nextSyncAt: string | null;
  retryAt: string | null;
};

type SyncInput = {
  platformAccountId: string;
  userId?: string;
  mode: "manual" | "cron";
};

type MetaSyncMarketingFields = Pick<
  MetaSyncResult,
  | "marketingStatus"
  | "campaignsCount"
  | "adSetsCount"
  | "adsCount"
  | "creativesCount"
  | "insightsCount"
  | "recommendationsCount"
  | "insightsSince"
  | "insightsUntil"
>;

const EMPTY_MARKETING_RESULT: MetaSyncMarketingFields = {
  marketingStatus: "not_run",
  campaignsCount: 0,
  adSetsCount: 0,
  adsCount: 0,
  creativesCount: 0,
  insightsCount: 0,
  recommendationsCount: 0,
  insightsSince: null,
  insightsUntil: null,
};

type MetaSyncPlannerFields = Pick<
  MetaSyncResult,
  | "plannerStatus"
  | "plannerSnapshotId"
  | "plannerAccountDay"
  | "plannerObservedBudgetOwnerCount"
  | "plannerReservedExposureMinor"
  | "plannerPlansCreated"
  | "plannerPlansExisting"
  | "plannerCandidatesBlocked"
  | "plannerHardCapBreach"
>;

const EMPTY_PLANNER_RESULT: MetaSyncPlannerFields = {
  plannerStatus: "not_run",
  plannerSnapshotId: null,
  plannerAccountDay: null,
  plannerObservedBudgetOwnerCount: 0,
  plannerReservedExposureMinor: 0,
  plannerPlansCreated: 0,
  plannerPlansExisting: 0,
  plannerCandidatesBlocked: 0,
  plannerHardCapBreach: false,
};

type MetaSyncOrganicBoostFields = Pick<
  MetaSyncResult,
  | "organicBoostStatus"
  | "organicBoostPlansCreated"
  | "organicBoostPlansExisting"
  | "organicBoostCandidatesFailed"
  | "organicBoostCandidatesSkipped"
  | "organicBoostCandidatesConsidered"
  | "organicBoostLastError"
>;

const EMPTY_ORGANIC_BOOST_RESULT: MetaSyncOrganicBoostFields = {
  organicBoostStatus: null,
  organicBoostPlansCreated: 0,
  organicBoostPlansExisting: 0,
  organicBoostCandidatesFailed: 0,
  organicBoostCandidatesSkipped: 0,
  organicBoostCandidatesConsidered: 0,
  organicBoostLastError: null,
};

function organicBoostFields(
  result: MetaOrganicBoostPlannerResult | null,
): MetaSyncOrganicBoostFields {
  return result
    ? {
        organicBoostStatus: result.status,
        organicBoostPlansCreated: result.plansCreated,
        organicBoostPlansExisting: result.plansExisting,
        organicBoostCandidatesFailed: result.candidatesFailed,
        organicBoostCandidatesSkipped: result.candidatesSkipped,
        organicBoostCandidatesConsidered: result.candidatesConsidered,
        organicBoostLastError: result.lastError,
      }
    : EMPTY_ORGANIC_BOOST_RESULT;
}

function marketingFields(
  result: MetaMarketingSyncResult | null,
  failed = false,
): MetaSyncMarketingFields {
  return result
    ? {
        marketingStatus: "success",
        campaignsCount: result.campaignsCount,
        adSetsCount: result.adSetsCount,
        adsCount: result.adsCount,
        creativesCount: result.creativesCount,
        insightsCount: result.insightsCount,
        recommendationsCount: result.recommendationsCount,
        insightsSince: result.insightsSince,
        insightsUntil: result.insightsUntil,
      }
    : {
        ...EMPTY_MARKETING_RESULT,
        marketingStatus: failed ? "error" : "not_run",
      };
}

function plannerFields(
  result: MetaBudgetPlannerResult | null,
  failed = false,
): MetaSyncPlannerFields {
  return result
    ? {
        plannerStatus: failed ? "error" : result.status,
        plannerSnapshotId: result.snapshotId,
        plannerAccountDay: result.accountDay,
        plannerObservedBudgetOwnerCount: result.observedBudgetOwnerCount,
        plannerReservedExposureMinor: result.reservedExposureMinor,
        plannerPlansCreated: result.plansCreated,
        plannerPlansExisting: result.plansExisting,
        plannerCandidatesBlocked: result.candidatesBlocked,
        plannerHardCapBreach: result.hardCapBreach,
      }
    : {
        ...EMPTY_PLANNER_RESULT,
        plannerStatus: failed ? "error" : "not_run",
      };
}

function classifyPlannerError(error: unknown): string {
  if (!(error instanceof MetaBudgetPlannerError)) {
    return "planner_failed";
  }

  return error.code.startsWith("planner_")
    ? error.code
    : `planner_${error.code}`;
}

function classifyMarketingError(error: unknown): string {
  if (error instanceof MetaCollectionLimitError) {
    return `marketing_collection_${error.reason}`;
  }

  if (error instanceof MetaMarketingDataError) {
    return `marketing_${error.code}`;
  }

  if (error instanceof MetaGraphError) {
    return error.code ? `marketing_meta_${error.code}` : "marketing_meta_failed";
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return "marketing_timeout";
  }

  return "marketing_sync_failed";
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasExpired(value: string | null, now = Date.now()): boolean {
  const date = parseDate(value);
  return date ? date.getTime() <= now : false;
}

export function calculateSyncBackoffSeconds(
  consecutiveFailures: number,
  requestedSeconds: number | null = null,
): number {
  if (requestedSeconds && requestedSeconds > 0) {
    return Math.min(MAX_BACKOFF_SECONDS, Math.max(60, requestedSeconds));
  }

  const exponent = Math.max(0, Math.min(6, consecutiveFailures));
  return Math.min(
    MAX_BACKOFF_SECONDS,
    DEFAULT_ERROR_BACKOFF_SECONDS * 2 ** exponent,
  );
}

function highestUsage(usage: MetaUsageSnapshot): number {
  return Math.max(
    usage.appPercent ?? 0,
    usage.pagePercent ?? 0,
    usage.businessPercent ?? 0,
    usage.adAccountPercent ?? 0,
    usage.insightsPercent ?? 0,
  );
}

function isHighUsage(usage: MetaUsageSnapshot): boolean {
  return highestUsage(usage) >= RATE_LIMIT_USAGE_THRESHOLD;
}

function usageForStorage(
  usage: MetaUsageSnapshot,
  organicBoost: MetaOrganicBoostPlannerResult | null = null,
) {
  return {
    app_percent: usage.appPercent,
    page_percent: usage.pagePercent,
    business_percent: usage.businessPercent,
    ad_account_percent: usage.adAccountPercent ?? null,
    insights_percent: usage.insightsPercent ?? null,
    retry_after_seconds: usage.retryAfterSeconds,
    observed_at: new Date().toISOString(),
    organic_boost: organicBoost
      ? {
          status: organicBoost.status,
          plans_created: organicBoost.plansCreated,
          plans_existing: organicBoost.plansExisting,
          candidates_skipped: organicBoost.candidatesSkipped,
          candidates_failed: organicBoost.candidatesFailed,
          candidates_considered: organicBoost.candidatesConsidered,
          last_error: organicBoost.lastError,
        }
      : null,
  };
}

function serializeItems(items: MetaContentItem[]) {
  return items.map((item) => ({
    source: item.source,
    content_type: item.contentType,
    meta_content_id: item.id,
    caption_excerpt: item.captionExcerpt,
    permalink_url: item.permalinkUrl,
    preview_url: item.previewUrl,
    published_at: item.publishedAt,
  }));
}

async function fetchConnector(
  platformAccountId: string,
  userId?: string,
): Promise<ConnectorRow | null> {
  const admin = createAdminClient();
  let query = admin
    .from("platform_accounts")
    .select(
      "id,user_id,access_token_encrypted,token_iv,token_auth_tag,expires_at,data_access_expires_at,sync_lock_until,sync_backoff_until,last_sync_started_at,sync_consecutive_failures,instagram_account_ids,marketing_sync_id,marketing_sync_status",
    )
    .eq("id", platformAccountId)
    .eq("platform", "meta")
    .is("revoked_at", null);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error("Meta connector lookup failed");
  }

  return data as ConnectorRow | null;
}

function blockedReason(
  connector: ConnectorRow,
  mode: SyncInput["mode"],
): MetaSyncBlockedReason {
  const now = Date.now();
  const lockUntil = parseDate(connector.sync_lock_until)?.getTime() ?? 0;
  const backoffUntil = parseDate(connector.sync_backoff_until)?.getTime() ?? 0;
  const lastStartedAt = parseDate(connector.last_sync_started_at)?.getTime() ?? 0;

  if (lockUntil > now) {
    return "locked";
  }

  if (backoffUntil > now) {
    return "backoff";
  }

  if (
    mode === "manual" &&
    lastStartedAt > now - MANUAL_SYNC_COOLDOWN_SECONDS * 1000
  ) {
    return "cooldown";
  }

  return "locked";
}

function blockedResult(
  reason: MetaSyncBlockedReason,
  retryAt: string | null = null,
): MetaSyncResult {
  return {
    outcome: "blocked",
    status: "blocked",
    blockedReason: reason,
    seenCount: 0,
    newCount: 0,
    syncedAssetCount: 0,
    failedAssetCount: 0,
    ...EMPTY_MARKETING_RESULT,
    ...EMPTY_PLANNER_RESULT,
    ...EMPTY_ORGANIC_BOOST_RESULT,
    nextSyncAt: null,
    retryAt,
  };
}

async function updateConnector(
  platformAccountId: string,
  values: Record<string, unknown>,
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_accounts")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", platformAccountId)
    .eq("platform", "meta");

  if (error) {
    throw new Error("Meta connector state update failed");
  }
}

async function recordContent(input: {
  connector: ConnectorRow;
  asset: AssetRow;
  items: MetaContentItem[];
}) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_meta_content_candidates", {
    p_platform_account_id: input.connector.id,
    p_meta_asset_id: input.asset.id,
    p_user_id: input.connector.user_id,
    p_is_baseline: input.asset.baseline_completed_at === null,
    p_items: serializeItems(input.items),
  });

  if (error) {
    throw new Error("Meta content persistence failed");
  }

  const result = Array.isArray(data) ? data[0] : data;

  return {
    seenCount:
      result && typeof result.seen_count === "number"
        ? result.seen_count
        : input.items.length,
    newCount:
      result && typeof result.new_count === "number" ? result.new_count : 0,
  };
}

async function markReconnectRequired(
  connector: ConnectorRow,
  errorCode: string,
  usage: MetaUsageSnapshot = EMPTY_USAGE,
): Promise<MetaSyncResult> {
  await updateConnector(connector.id, {
    sync_status: "reconnect_required",
    sync_error_code: errorCode,
    sync_lock_until: null,
    sync_backoff_until: null,
    next_sync_at: null,
    sync_usage: usageForStorage(usage),
  });

  return {
    outcome: "completed",
    status: "reconnect_required",
    blockedReason: null,
    seenCount: 0,
    newCount: 0,
    syncedAssetCount: 0,
    failedAssetCount: 0,
    ...EMPTY_MARKETING_RESULT,
    ...EMPTY_PLANNER_RESULT,
    ...EMPTY_ORGANIC_BOOST_RESULT,
    nextSyncAt: null,
    retryAt: null,
  };
}

async function markFailed(input: {
  connector: ConnectorRow;
  status: "error" | "rate_limited";
  errorCode: string;
  usage: MetaUsageSnapshot;
  requestedBackoffSeconds?: number | null;
  organicBoost?: MetaOrganicBoostPlannerResult | null;
}): Promise<MetaSyncResult> {
  const failures = Math.max(0, input.connector.sync_consecutive_failures ?? 0);
  const backoffSeconds =
    input.status === "rate_limited"
      ? Math.min(
          MAX_BACKOFF_SECONDS,
          Math.max(
            60,
            input.requestedBackoffSeconds ??
              DEFAULT_RATE_LIMIT_BACKOFF_SECONDS,
          ),
        )
      : calculateSyncBackoffSeconds(
          failures,
          input.requestedBackoffSeconds ?? null,
        );
  const retryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

  await updateConnector(input.connector.id, {
    sync_status: input.status,
    sync_error_code: input.errorCode,
    sync_lock_until: null,
    sync_backoff_until: retryAt,
    next_sync_at: retryAt,
    sync_consecutive_failures: failures + 1,
    sync_usage: usageForStorage(input.usage, input.organicBoost ?? null),
  });

  return {
    outcome: "completed",
    status: input.status,
    blockedReason: null,
    seenCount: 0,
    newCount: 0,
    syncedAssetCount: 0,
    failedAssetCount: 0,
    ...EMPTY_MARKETING_RESULT,
    ...EMPTY_PLANNER_RESULT,
    ...organicBoostFields(input.organicBoost ?? null),
    nextSyncAt: retryAt,
    retryAt,
  };
}

async function claimConnector(
  connector: ConnectorRow,
  mode: SyncInput["mode"],
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_meta_sync", {
    p_platform_account_id: connector.id,
    p_lock_seconds: SYNC_LOCK_SECONDS,
    p_min_interval_seconds:
      mode === "manual" ? MANUAL_SYNC_COOLDOWN_SECONDS : 0,
  });

  if (error) {
    throw new Error("Meta sync lock failed");
  }

  return data === true;
}

async function loadAssets(connector: ConnectorRow): Promise<AssetRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meta_assets")
    .select(
      "id,asset_type,meta_asset_id,parent_meta_asset_id,baseline_completed_at",
    )
    .eq("platform_account_id", connector.id)
    .eq("user_id", connector.user_id)
    .order("asset_type", { ascending: true });

  if (error) {
    throw new Error("Meta assets lookup failed");
  }

  return (data ?? []) as AssetRow[];
}

export async function syncMetaConnector(
  input: SyncInput,
): Promise<MetaSyncResult> {
  const connectorBeforeClaim = await fetchConnector(
    input.platformAccountId,
    input.userId,
  );

  if (!connectorBeforeClaim) {
    return blockedResult("not_found");
  }

  if (!(await claimConnector(connectorBeforeClaim, input.mode))) {
    const current =
      (await fetchConnector(input.platformAccountId, input.userId)) ??
      connectorBeforeClaim;
    const reason = blockedReason(current, input.mode);
    const retryAt =
      reason === "backoff"
        ? current.sync_backoff_until
        : reason === "locked"
          ? current.sync_lock_until
          : current.last_sync_started_at
            ? new Date(
                new Date(current.last_sync_started_at).getTime() +
                  MANUAL_SYNC_COOLDOWN_SECONDS * 1000,
              ).toISOString()
            : null;
    return blockedResult(reason, retryAt);
  }

  const connector =
    (await fetchConnector(input.platformAccountId, input.userId)) ??
    connectorBeforeClaim;

  if (
    !connector.access_token_encrypted ||
    !connector.token_iv ||
    !connector.token_auth_tag ||
    hasExpired(connector.expires_at) ||
    hasExpired(connector.data_access_expires_at)
  ) {
    return markReconnectRequired(connector, "token_expired");
  }

  let usage = EMPTY_USAGE;

  try {
    const env = getMetaSyncEnv();
    const accessToken = decryptAccessToken(
      {
        ciphertext: connector.access_token_encrypted,
        iv: connector.token_iv,
        authTag: connector.token_auth_tag,
      },
      env.tokenEncryptionKey,
    );
    const assets = await loadAssets(connector);
    const pageAssets = assets.filter(
      (asset) => asset.asset_type === "facebook_page",
    );
    const selectedInstagramIds = new Set(
      Array.isArray(connector.instagram_account_ids)
        ? connector.instagram_account_ids.filter(
            (id): id is string =>
              typeof id === "string" && /^[0-9]{1,64}$/.test(id),
          )
        : [],
    );
    const instagramAssets = assets.filter(
      (asset) =>
        asset.asset_type === "instagram_account" &&
        selectedInstagramIds.has(asset.meta_asset_id),
    );
    const adAccountAssets = assets.filter(
      (asset) => asset.asset_type === "ad_account",
    );

    if (
      !pageAssets.length ||
      !instagramAssets.length ||
      adAccountAssets.length !== 1
    ) {
      return markReconnectRequired(connector, "assets_missing");
    }

    const adAccountAsset = adAccountAssets[0];

    const refreshedPages = await getMetaPageAssets({
      accessToken,
      appSecret: env.appSecret,
      allowedPageIds: new Set(pageAssets.map((asset) => asset.meta_asset_id)),
    });
    usage = mergeMetaUsage(usage, refreshedPages.usage);
    const pagesById = new Map(
      refreshedPages.pages.map((page) => [page.id, page]),
    );
    let seenCount = 0;
    let newCount = 0;
    let syncedAssetCount = 0;
    let failedAssetCount = 0;

    for (const pageAsset of pageAssets) {
      const page = pagesById.get(pageAsset.meta_asset_id);

      if (!page) {
        failedAssetCount += 1;
        continue;
      }

      try {
        const posts = await getFacebookPublishedPosts({
          pageId: page.id,
          pageAccessToken: page.accessToken,
          appSecret: env.appSecret,
        });
        usage = mergeMetaUsage(usage, posts.usage);
        const persistedPosts = await recordContent({
          connector,
          asset: pageAsset,
          items: posts.items,
        });
        seenCount += persistedPosts.seenCount;
        newCount += persistedPosts.newCount;
        syncedAssetCount += 1;
      } catch (error) {
        if (
          error instanceof MetaGraphError &&
          (error.rateLimited || error.reconnectRequired)
        ) {
          throw error;
        }

        failedAssetCount += 1;
      }
    }

    for (const instagramAsset of instagramAssets) {
      try {
        const media = await getInstagramMedia({
          instagramAccountId: instagramAsset.meta_asset_id,
          accessToken,
          appSecret: env.appSecret,
        });
        usage = mergeMetaUsage(usage, media.usage);
        const persistedMedia = await recordContent({
          connector,
          asset: instagramAsset,
          items: media.items,
        });
        seenCount += persistedMedia.seenCount;
        newCount += persistedMedia.newCount;
        syncedAssetCount += 1;
      } catch (error) {
        if (
          error instanceof MetaGraphError &&
          (error.rateLimited || error.reconnectRequired)
        ) {
          throw error;
        }

        failedAssetCount += 1;
      }
    }

    if (!syncedAssetCount) {
      return markFailed({
        connector,
        status: "error",
        errorCode: "assets_unavailable",
        usage,
      });
    }

    let marketingResult: MetaMarketingSyncResult | null = null;
    let marketingErrorCode: string | null = null;
    let plannerResult: MetaBudgetPlannerResult | null = null;
    let plannerErrorCode: string | null = null;
    let plannerAttemptedAt: string | null = null;
    let organicBoostResult: MetaOrganicBoostPlannerResult | null = null;
    const marketingStartedAt = new Date().toISOString();
    let readLeaseToken: string | null = null;

    try {
      try {
        readLeaseToken = await claimMetaReadOperation({
          platformAccountId: connector.id,
          userId: connector.user_id,
          ownerId: `meta-sync:${connector.id}:${marketingStartedAt}`,
          retries: 5,
          retryDelayMs: 2_000,
        });
      } catch {
        marketingErrorCode = "marketing_operation_lease_failed";
      }

      if (!readLeaseToken && !marketingErrorCode) {
        marketingErrorCode = "marketing_operation_locked";
      }

      if (readLeaseToken) {
        // Beitrag-Push planning is DB-only: run even near Meta usage limits.
        // Meta writes (executor) stay gated on usage below.
        // Last-known marketing_sync_id is enough — do not wait for status=success.
        if (
          typeof connector.marketing_sync_id === "string" &&
          connector.marketing_sync_id.length > 0
        ) {
          plannerAttemptedAt = new Date().toISOString();
          try {
            organicBoostResult = await runMetaOrganicBoostPlannerAfterSnapshot({
              platformAccountId: connector.id,
              userId: connector.user_id,
              marketingSyncId: connector.marketing_sync_id,
              readLeaseToken,
              plannedAt: plannerAttemptedAt,
            });
          } catch {
            organicBoostResult = {
              status: "PLANNER_RPC_FAILED",
              plansCreated: 0,
              plansExisting: 0,
              candidatesSkipped: 0,
              candidatesFailed: 0,
              candidatesConsidered: 0,
              lastError: "run_meta_organic_boost_planner failed",
            };
          }
        } else {
          try {
            organicBoostResult = await runOrganicBoostPlannerForAccount({
              platformAccountId: connector.id,
              userId: connector.user_id,
              ownerPrefix: "organic-boost-during-sync",
            });
          } catch {
            organicBoostResult = {
              status: "ACCOUNT_UNAVAILABLE",
              plansCreated: 0,
              plansExisting: 0,
              candidatesSkipped: 0,
              candidatesFailed: 0,
              candidatesConsidered: 0,
              lastError: "marketing_sync_required",
            };
          }
        }

        try {
          marketingResult = await syncMetaMarketingSnapshot({
            platformAccountId: connector.id,
            userId: connector.user_id,
            adAccountId: adAccountAsset.meta_asset_id,
            accessToken,
            appSecret: env.appSecret,
          });
          usage = mergeMetaUsage(usage, marketingResult.usage);

          if (!isHighUsage(usage)) {
            plannerAttemptedAt = new Date().toISOString();
            try {
              plannerResult = await runMetaBudgetPlannerAfterSnapshot({
                platformAccountId: connector.id,
                userId: connector.user_id,
                marketingSyncId: marketingResult.syncId,
                readLeaseToken,
                campaignBudgetSharingSnapshot:
                  marketingResult.campaignBudgetSharingSnapshot,
                plannedAt: plannerAttemptedAt,
              });
            } catch (error) {
              plannerErrorCode = classifyPlannerError(error);
            }
          }

          plannerAttemptedAt = plannerAttemptedAt ?? new Date().toISOString();
          try {
            organicBoostResult = await runMetaOrganicBoostPlannerAfterSnapshot({
              platformAccountId: connector.id,
              userId: connector.user_id,
              marketingSyncId: marketingResult.syncId,
              readLeaseToken,
              plannedAt: plannerAttemptedAt,
            });
          } catch {
            organicBoostResult = {
              status: "PLANNER_RPC_FAILED",
              plansCreated: 0,
              plansExisting: 0,
              candidatesSkipped: 0,
              candidatesFailed: 0,
              candidatesConsidered: 0,
              lastError: "run_meta_organic_boost_planner failed",
            };
          }
        } catch (error) {
          if (error instanceof MetaGraphError) {
            usage = mergeMetaUsage(usage, error.usage);

            if (error.rateLimited || error.reconnectRequired) {
              throw error;
            }
          } else if (error instanceof MetaCollectionLimitError) {
            usage = mergeMetaUsage(usage, error.usage);
          }

          marketingErrorCode = classifyMarketingError(error);
        }
      } else {
        // Lease held by another job (often Beitrag-Push). Do not skip boost —
        // wait briefly via the independent runner after the other lease releases.
        try {
          organicBoostResult = await runOrganicBoostPlannerForAccount({
            platformAccountId: connector.id,
            userId: connector.user_id,
            ownerPrefix: "organic-boost-after-locked-sync",
          });
        } catch {
          organicBoostResult = {
            status: "LEASE_REQUIRED",
            plansCreated: 0,
            plansExisting: 0,
            candidatesSkipped: 0,
            candidatesFailed: 0,
            candidatesConsidered: 0,
            lastError: "read_lease_locked",
          };
        }
      }
    } finally {
      if (readLeaseToken) {
        try {
          await releaseMetaAccountOperation({
            platformAccountId: connector.id,
            userId: connector.user_id,
            leaseToken: readLeaseToken,
          });
        } catch (error) {
          plannerErrorCode ??= classifyPlannerError(error);
        }
      }
    }

    // Meta writes stay off the Abruf request path (timeout risk). Plans stay
    // PENDING here; dashboard load + LiveRefresh + minutely cron drain them.

    if (isHighUsage(usage)) {
      const rateLimitedResult = await markFailed({
        connector,
        status: "rate_limited",
        errorCode: "usage_threshold",
        usage,
        requestedBackoffSeconds:
          usage.retryAfterSeconds ?? DEFAULT_RATE_LIMIT_BACKOFF_SECONDS,
        organicBoost: organicBoostResult,
      });
      return {
        ...rateLimitedResult,
        seenCount,
        newCount,
        syncedAssetCount,
        failedAssetCount,
        ...marketingFields(marketingResult, marketingErrorCode !== null),
        ...organicBoostFields(organicBoostResult),
      };
    }

    const marketingLeaseBlocked =
      marketingErrorCode === "marketing_operation_locked" ||
      marketingErrorCode === "marketing_operation_lease_failed";
    const status =
      failedAssetCount ||
      (marketingErrorCode && !marketingLeaseBlocked) ||
      plannerErrorCode
        ? "partial"
        : "success";
    const syncErrorCode = plannerErrorCode
      ? failedAssetCount || (marketingErrorCode && !marketingLeaseBlocked)
        ? "content_marketing_or_planner_partial"
        : plannerErrorCode
      : failedAssetCount && marketingErrorCode && !marketingLeaseBlocked
        ? "content_and_marketing_partial"
        : failedAssetCount
          ? "asset_partial"
          : marketingLeaseBlocked
            ? null
            : marketingErrorCode;
    const nextSyncAt = nextHourlyRun().toISOString();
    const organicBoostForStorage: MetaOrganicBoostPlannerResult =
      organicBoostResult ?? {
        status: "NOT_RUN",
        plansCreated: 0,
        plansExisting: 0,
        candidatesSkipped: 0,
        candidatesFailed: 0,
        candidatesConsidered: 0,
        lastError: readLeaseToken
          ? marketingErrorCode
            ? `marketing_${marketingErrorCode}`
            : "organic_planner_not_invoked"
          : marketingErrorCode ?? "read_lease_unavailable",
      };
    // Keep the last good marketing snapshot usable for Beitrag-Push Autonomie
    // even when this Abruf's marketing pass fails (lease, rate limit, partial).
    const preserveMarketingSuccess =
      !marketingResult &&
      connector.marketing_sync_status === "success" &&
      typeof connector.marketing_sync_id === "string" &&
      connector.marketing_sync_id.length > 0;
    await updateConnector(connector.id, {
      baseline_completed_at:
        failedAssetCount === 0 ? new Date().toISOString() : undefined,
      last_synced_at: new Date().toISOString(),
      next_sync_at: nextSyncAt,
      sync_lock_until: null,
      sync_backoff_until: null,
      sync_status: status,
      sync_error_code: syncErrorCode,
      sync_consecutive_failures: 0,
      last_sync_seen_count: seenCount,
      last_sync_new_count: newCount,
      sync_usage: usageForStorage(usage, organicBoostForStorage),
      marketing_sync_status: marketingResult
        ? "success"
        : preserveMarketingSuccess
          ? "success"
          : marketingLeaseBlocked
            ? (connector.marketing_sync_status ?? "error")
            : "error",
      marketing_sync_error_code: marketingResult
        ? null
        : marketingErrorCode,
      marketing_last_sync_started_at: marketingStartedAt,
      marketing_next_sync_at: nextSyncAt,
      automation_planner_status: plannerErrorCode
        ? "error"
        : plannerResult
          ? "success"
          : "not_run",
      automation_planner_error_code: plannerErrorCode,
      automation_planner_last_run_at: plannerAttemptedAt ?? undefined,
      automation_planner_last_success_at: plannerResult
        ? plannerAttemptedAt
        : undefined,
      automation_planner_last_marketing_sync_id: plannerResult
        ? marketingResult?.syncId
        : undefined,
    });

    return {
      outcome: "completed",
      status,
      blockedReason: null,
      seenCount,
      newCount,
      syncedAssetCount,
      failedAssetCount,
      ...marketingFields(
        marketingResult,
        Boolean(marketingErrorCode && !marketingLeaseBlocked),
      ),
      ...plannerFields(plannerResult, plannerErrorCode !== null),
      ...organicBoostFields(organicBoostForStorage),
      nextSyncAt,
      retryAt: null,
    };
  } catch (error) {
    if (error instanceof MetaGraphError) {
      usage = mergeMetaUsage(usage, error.usage);

      if (error.reconnectRequired) {
        return markReconnectRequired(connector, "meta_token_invalid", usage);
      }

      if (error.rateLimited) {
        return markFailed({
          connector,
          status: "rate_limited",
          errorCode: "meta_rate_limited",
          usage,
          requestedBackoffSeconds:
            error.usage.retryAfterSeconds ??
            DEFAULT_RATE_LIMIT_BACKOFF_SECONDS,
        });
      }
    }

    return markFailed({
      connector,
      status: "error",
      errorCode: "sync_failed",
      usage,
    });
  }
}

export async function getDueMetaConnectorIds(
  limit = META_CRON_BATCH_SIZE,
): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_accounts")
    .select(
      "id,next_sync_at,sync_lock_until,sync_backoff_until,sync_status",
    )
    .eq("platform", "meta")
    .is("revoked_at", null)
    .neq("sync_status", "reconnect_required")
    .order("next_sync_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(1, Math.min(50, limit * 3)));

  if (error) {
    throw new Error("Due Meta connectors lookup failed");
  }

  const now = Date.now();

  return (data ?? [])
    .filter((connector) => {
      const nextSyncAt = parseDate(connector.next_sync_at)?.getTime() ?? 0;
      const lockUntil = parseDate(connector.sync_lock_until)?.getTime() ?? 0;
      const backoffUntil =
        parseDate(connector.sync_backoff_until)?.getTime() ?? 0;
      return nextSyncAt <= now && lockUntil <= now && backoffUntil <= now;
    })
    .slice(0, Math.max(1, Math.min(META_CRON_BATCH_SIZE, limit)))
    .map((connector) => connector.id as string);
}
