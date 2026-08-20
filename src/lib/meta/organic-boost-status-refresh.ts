import "server-only";

import {
  getMetaAdsByIds,
  getMetaAdSetsByIds,
  getMetaCampaignsByIds,
  type MetaCampaign,
} from "@/lib/meta/client";
import { decryptAccessToken } from "@/lib/meta/crypto";
import { getMetaSyncEnv } from "@/lib/meta/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostStatusRefreshResult = {
  requested: number;
  refreshed: number;
  upserted: number;
  paused: number;
  active: number;
  completed: number;
  missingAtMeta: number;
  targetsRepaired: number;
  pausedPlatformIds: string[];
  error: string | null;
};

function isPausedCampaign(campaign: MetaCampaign): boolean {
  const status = (campaign.status ?? "").toUpperCase();
  const effective = (campaign.effectiveStatus ?? "").toUpperCase();
  return (
    status === "PAUSED" ||
    effective === "PAUSED" ||
    effective === "CAMPAIGN_PAUSED"
  );
}

function isCompletedCampaign(campaign: MetaCampaign): boolean {
  const status = (campaign.status ?? "").toUpperCase();
  const effective = (campaign.effectiveStatus ?? "").toUpperCase();
  if (
    status === "COMPLETED" ||
    effective === "COMPLETED" ||
    effective === "CAMPAIGN_COMPLETED" ||
    status === "ARCHIVED" ||
    effective === "ARCHIVED" ||
    status === "DELETED" ||
    effective === "DELETED"
  ) {
    return true;
  }
  if (!campaign.stopTime) {
    return false;
  }
  const stopMs = Date.parse(campaign.stopTime);
  return Number.isFinite(stopMs) && stopMs <= Date.now();
}

/** Meta often keeps configured status ACTIVE after stop_time; normalize locally. */
function normalizeCampaignForLocal(campaign: MetaCampaign): MetaCampaign {
  if (!isCompletedCampaign(campaign)) {
    return campaign;
  }
  const effective = (campaign.effectiveStatus ?? "").toUpperCase();
  if (
    effective === "COMPLETED" ||
    effective === "CAMPAIGN_COMPLETED" ||
    effective === "ARCHIVED" ||
    effective === "DELETED"
  ) {
    return campaign;
  }
  return {
    ...campaign,
    effectiveStatus: "COMPLETED",
  };
}

function isConfiguredObjectPaused(
  status: string | null | undefined,
  effectiveStatus: string | null | undefined,
): boolean {
  const configured = (status ?? "").toUpperCase();
  const effective = (effectiveStatus ?? "").toUpperCase();
  if (
    configured === "DELETED" ||
    configured === "ARCHIVED" ||
    effective === "DELETED" ||
    effective === "ARCHIVED"
  ) {
    return false;
  }
  return configured === "PAUSED" || effective === "PAUSED";
}

/**
 * Meta keeps campaign effective_status=ACTIVE when only ads/ad sets are
 * PAUSED. Overlay child pause so the dashboard cannot claim "Boost aktiv".
 */
function applyChildDeliveryOverlay(
  campaign: MetaCampaign,
  child: { adPaused: boolean; adSetPaused: boolean } | undefined,
): MetaCampaign {
  if (!child) {
    return campaign;
  }
  if (isPausedCampaign(campaign) || isCompletedCampaign(campaign)) {
    return campaign;
  }
  const effective = (campaign.effectiveStatus ?? "").toUpperCase();
  const status = (campaign.status ?? "").toUpperCase();
  const looksActive = status === "ACTIVE" || effective === "ACTIVE";
  if (!looksActive) {
    return campaign;
  }
  if (child.adPaused) {
    return { ...campaign, effectiveStatus: "AD_PAUSED" };
  }
  if (child.adSetPaused) {
    return { ...campaign, effectiveStatus: "ADSET_PAUSED" };
  }
  return campaign;
}

async function markMissingBoostCampaign(input: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  platformAccountId: string;
  platformCampaignId: string;
  marketingSyncId?: string | null;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const { data: existing } = await input.admin
    .from("campaigns")
    .select("id,stop_time,effective_status,status")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("platform_campaign_id", input.platformCampaignId)
    .maybeSingle();

  if (!existing?.id) {
    return false;
  }

  const stopMs = existing.stop_time ? Date.parse(String(existing.stop_time)) : Number.NaN;
  const scheduleEnded = Number.isFinite(stopMs) && stopMs <= Date.now();
  const nextEffective = scheduleEnded ? "COMPLETED" : "DELETED";

  const { error } = await input.admin
    .from("campaigns")
    .update({
      is_current: true,
      effective_status: nextEffective,
      updated_at: now,
      ...(input.marketingSyncId
        ? { last_seen_sync_id: input.marketingSyncId }
        : {}),
    })
    .eq("id", existing.id)
    .eq("user_id", input.userId);

  return !error;
}

async function upsertCampaignRow(input: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  platformAccountId: string;
  campaign: MetaCampaign;
  marketingSyncId?: string | null;
}): Promise<{ localId: string | null; wrote: boolean }> {
  const now = new Date().toISOString();
  const toMinor = (value: string | null): number | null => {
    if (value == null || value === "") {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const patch = {
    user_id: input.userId,
    platform_account_id: input.platformAccountId,
    platform_campaign_id: input.campaign.id,
    name: input.campaign.name,
    status: input.campaign.status,
    effective_status: input.campaign.effectiveStatus,
    objective: input.campaign.objective,
    daily_budget_minor: toMinor(input.campaign.dailyBudgetMinor),
    lifetime_budget_minor: toMinor(input.campaign.lifetimeBudgetMinor),
    budget_remaining_minor: toMinor(input.campaign.budgetRemainingMinor),
    start_time: input.campaign.startTime,
    stop_time: input.campaign.stopTime,
    is_current: true,
    updated_at: now,
    ...(input.marketingSyncId
      ? { last_seen_sync_id: input.marketingSyncId }
      : {}),
  };

  const { data: updated, error: updateError } = await input.admin
    .from("campaigns")
    .update({
      status: patch.status,
      effective_status: patch.effective_status,
      objective: patch.objective,
      daily_budget_minor: patch.daily_budget_minor,
      lifetime_budget_minor: patch.lifetime_budget_minor,
      budget_remaining_minor: patch.budget_remaining_minor,
      start_time: patch.start_time,
      stop_time: patch.stop_time,
      name: patch.name,
      is_current: true,
      updated_at: now,
      ...(input.marketingSyncId
        ? { last_seen_sync_id: input.marketingSyncId }
        : {}),
    })
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("platform_campaign_id", input.campaign.id)
    .select("id");

  if (!updateError && updated && updated.length > 0) {
    return { localId: updated[0]?.id ?? null, wrote: true };
  }

  const { data: inserted, error: insertError } = await input.admin
    .from("campaigns")
    .upsert(patch, {
      onConflict: "platform_account_id,platform_campaign_id",
    })
    .select("id");

  if (insertError) {
    return { localId: null, wrote: false };
  }

  return {
    localId: inserted?.[0]?.id ?? null,
    wrote: Boolean(inserted && inserted.length > 0),
  };
}

async function repairManagedTarget(input: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  platformAccountId: string;
  platformCampaignId: string;
  localCampaignId: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const scopeKey = `campaign:${input.platformCampaignId}`;

  const { data: existing } = await input.admin
    .from("automation_targets")
    .select("id, status, campaign_id")
    .eq("platform_account_id", input.platformAccountId)
    .eq("user_id", input.userId)
    .eq("target_type", "CAMPAIGN")
    .eq("platform_object_id", input.platformCampaignId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await input.admin
      .from("automation_targets")
      .update({
        status: "MANAGED",
        campaign_id: input.localCampaignId,
        target_key: scopeKey,
        campaign_scope_key: scopeKey,
        updated_at: now,
      })
      .eq("id", existing.id);
    return !error;
  }

  const { error } = await input.admin.from("automation_targets").insert({
    user_id: input.userId,
    platform_account_id: input.platformAccountId,
    target_type: "CAMPAIGN",
    target_key: scopeKey,
    platform_object_id: input.platformCampaignId,
    campaign_scope_key: scopeKey,
    budget_owner_type: "CAMPAIGN",
    budget_owner_key: scopeKey,
    campaign_id: input.localCampaignId,
    status: "MANAGED",
    last_successful_mutation_at: now,
    last_reconciled_at: now,
    updated_at: now,
  });

  return !error;
}

/**
 * Re-fetch Beitrag-Push campaign rows by Meta id, upsert local status, and
 * repair MANAGED automation targets for Meta-PAUSED campaigns.
 */
export async function refreshOrganicBoostCampaignStatusesFromMeta(input: {
  platformAccountId: string;
  userId: string;
}): Promise<OrganicBoostStatusRefreshResult> {
  const admin = createAdminClient();
  const empty = {
    requested: 0,
    refreshed: 0,
    upserted: 0,
    paused: 0,
    active: 0,
    completed: 0,
    missingAtMeta: 0,
    targetsRepaired: 0,
    pausedPlatformIds: [] as string[],
    error: null as string | null,
  };

  const { data: linkRows, error: linkError } = await admin
    .from("meta_organic_boost_links")
    .select("plan_id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .limit(100);

  if (linkError) {
    return { ...empty, error: linkError.message || "boost_link_lookup_failed" };
  }

  const planIds = [
    ...new Set(
      (linkRows ?? [])
        .map((row) => (typeof row.plan_id === "string" ? row.plan_id : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (planIds.length < 1) {
    return empty;
  }

  const { data: bindingRows, error: bindingError } = await admin
    .from("remote_object_bindings")
    .select("plan_id,object_type,remote_object_id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .in("plan_id", planIds)
    .in("object_type", ["CAMPAIGN", "AD_SET", "AD"]);

  if (bindingError) {
    return {
      ...empty,
      error: bindingError.message || "boost_binding_lookup_failed",
    };
  }

  const campaignIds = [
    ...new Set(
      (bindingRows ?? [])
        .filter((row) => row.object_type === "CAMPAIGN")
        .map((row) =>
          typeof row.remote_object_id === "string" ? row.remote_object_id : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const adSetIds = [
    ...new Set(
      (bindingRows ?? [])
        .filter((row) => row.object_type === "AD_SET")
        .map((row) =>
          typeof row.remote_object_id === "string" ? row.remote_object_id : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const adIds = [
    ...new Set(
      (bindingRows ?? [])
        .filter((row) => row.object_type === "AD")
        .map((row) =>
          typeof row.remote_object_id === "string" ? row.remote_object_id : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const campaignIdByPlanId = new Map<string, string>();
  for (const row of bindingRows ?? []) {
    if (
      row.object_type === "CAMPAIGN" &&
      typeof row.plan_id === "string" &&
      typeof row.remote_object_id === "string"
    ) {
      campaignIdByPlanId.set(row.plan_id, row.remote_object_id);
    }
  }

  const adSetIdsByCampaignId = new Map<string, string[]>();
  const adIdsByCampaignId = new Map<string, string[]>();
  for (const row of bindingRows ?? []) {
    if (typeof row.plan_id !== "string" || typeof row.remote_object_id !== "string") {
      continue;
    }
    const campaignId = campaignIdByPlanId.get(row.plan_id);
    if (!campaignId) {
      continue;
    }
    if (row.object_type === "AD_SET") {
      const list = adSetIdsByCampaignId.get(campaignId) ?? [];
      list.push(row.remote_object_id);
      adSetIdsByCampaignId.set(campaignId, list);
    }
    if (row.object_type === "AD") {
      const list = adIdsByCampaignId.get(campaignId) ?? [];
      list.push(row.remote_object_id);
      adIdsByCampaignId.set(campaignId, list);
    }
  }

  if (campaignIds.length < 1) {
    return empty;
  }

  const { data: account, error: accountError } = await admin
    .from("platform_accounts")
    .select(
      "access_token_encrypted, token_iv, token_auth_tag, expires_at, data_access_expires_at, marketing_sync_id",
    )
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (accountError || !account) {
    return {
      ...empty,
      requested: campaignIds.length,
      error: accountError?.message || "account_unavailable",
    };
  }

  if (
    !account.access_token_encrypted ||
    !account.token_iv ||
    !account.token_auth_tag
  ) {
    return {
      ...empty,
      requested: campaignIds.length,
      error: "token_unavailable",
    };
  }

  try {
    const env = getMetaSyncEnv();
    const accessToken = decryptAccessToken(
      {
        ciphertext: account.access_token_encrypted,
        iv: account.token_iv,
        authTag: account.token_auth_tag,
      },
      env.tokenEncryptionKey,
    );

    const meta = await getMetaCampaignsByIds({
      campaignIds,
      accessToken,
      appSecret: env.appSecret,
    });

    const pausedAdSetIds = new Set<string>();
    const pausedAdIds = new Set<string>();
    try {
      if (adSetIds.length > 0) {
        const metaAdSets = await getMetaAdSetsByIds({
          adSetIds,
          accessToken,
          appSecret: env.appSecret,
        });
        for (const adSet of metaAdSets.items) {
          if (isConfiguredObjectPaused(adSet.status, adSet.effectiveStatus)) {
            pausedAdSetIds.add(adSet.id);
          }
        }
      }
      if (adIds.length > 0) {
        const metaAds = await getMetaAdsByIds({
          adIds,
          accessToken,
          appSecret: env.appSecret,
        });
        for (const ad of metaAds.items) {
          if (isConfiguredObjectPaused(ad.status, ad.effectiveStatus)) {
            pausedAdIds.add(ad.id);
          }
        }
      }
    } catch {
      // Child status is best-effort; campaign refresh must still proceed.
    }

    const childPauseByCampaignId = new Map<
      string,
      { adPaused: boolean; adSetPaused: boolean }
    >();
    for (const campaignId of campaignIds) {
      const childAdSets = adSetIdsByCampaignId.get(campaignId) ?? [];
      const childAds = adIdsByCampaignId.get(campaignId) ?? [];
      childPauseByCampaignId.set(campaignId, {
        adSetPaused: childAdSets.some((id) => pausedAdSetIds.has(id)),
        adPaused: childAds.some((id) => pausedAdIds.has(id)),
      });
    }

    let refreshed = 0;
    let upserted = 0;
    let paused = 0;
    let active = 0;
    let completed = 0;
    let missingAtMeta = 0;
    let targetsRepaired = 0;
    const pausedPlatformIds: string[] = [];
    const seen = new Set<string>();
    const marketingSyncId =
      typeof account.marketing_sync_id === "string"
        ? account.marketing_sync_id
        : null;

    for (const raw of meta.items) {
      const normalized = normalizeCampaignForLocal(raw);
      const campaign = applyChildDeliveryOverlay(
        normalized,
        childPauseByCampaignId.get(normalized.id),
      );
      seen.add(campaign.id);
      const pausedAtMeta = isPausedCampaign(campaign);
      const childPaused =
        (campaign.effectiveStatus ?? "").toUpperCase() === "AD_PAUSED" ||
        (campaign.effectiveStatus ?? "").toUpperCase() === "ADSET_PAUSED";
      const completedAtMeta = isCompletedCampaign(campaign);
      if (completedAtMeta) {
        completed += 1;
      } else if (pausedAtMeta || childPaused) {
        paused += 1;
        pausedPlatformIds.push(campaign.id);
      } else if (
        (campaign.status ?? "").toUpperCase() === "ACTIVE" ||
        (campaign.effectiveStatus ?? "").toUpperCase() === "ACTIVE"
      ) {
        active += 1;
      }

      const wrote = await upsertCampaignRow({
        admin,
        userId: input.userId,
        platformAccountId: input.platformAccountId,
        campaign,
        marketingSyncId,
      });

      if (wrote.wrote) {
        refreshed += 1;
        upserted += 1;
      }

      // Never auto-reactivate schedule-ended campaigns.
      if (pausedAtMeta && !completedAtMeta && wrote.localId) {
        const repaired = await repairManagedTarget({
          admin,
          userId: input.userId,
          platformAccountId: input.platformAccountId,
          platformCampaignId: campaign.id,
          localCampaignId: wrote.localId,
        });
        if (repaired) {
          targetsRepaired += 1;
        }
      }
    }

    for (const platformCampaignId of campaignIds) {
      if (seen.has(platformCampaignId)) {
        continue;
      }
      const marked = await markMissingBoostCampaign({
        admin,
        userId: input.userId,
        platformAccountId: input.platformAccountId,
        platformCampaignId,
        marketingSyncId,
      });
      if (marked) {
        missingAtMeta += 1;
        completed += 1;
        refreshed += 1;
      }
    }

    await admin.rpc("retain_meta_organic_boost_campaigns", {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
    });

    return {
      requested: campaignIds.length,
      refreshed,
      upserted,
      paused,
      active,
      completed,
      missingAtMeta,
      targetsRepaired,
      pausedPlatformIds,
      error: null,
    };
  } catch (error) {
    return {
      ...empty,
      requested: campaignIds.length,
      error:
        error instanceof Error
          ? error.message
          : "boost_campaign_status_refresh_failed",
    };
  }
}
