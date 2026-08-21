import "server-only";

import {
  getMetaAdsByCampaignId,
  getMetaAdsByIds,
  getMetaAdSetsByCampaignId,
  getMetaAdSetsByIds,
  getMetaCampaignsByIds,
  type MetaCampaign,
} from "@/lib/meta/client";
import { decryptAccessToken } from "@/lib/meta/crypto";
import { overlayCampaignEffectiveForDelivery } from "@/lib/meta/organic-boost-delivery";
import { getMetaSyncEnv } from "@/lib/meta/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostStatusRefreshResult = {
  requested: number;
  refreshed: number;
  upserted: number;
  paused: number;
  /** Campaign ACTIVE but ads/ad sets still paused or unverified. */
  childDeliveryIncomplete: number;
  active: number;
  completed: number;
  missingAtMeta: number;
  targetsRepaired: number;
  /** Campaign-level PAUSED only — safe for force ACTIVATE queue. */
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

function applyDeliveryOverlay(
  campaign: MetaCampaign,
  child: {
    adSetStatuses: Array<{ status: string | null; effectiveStatus: string | null }>;
    adStatuses: Array<{ status: string | null; effectiveStatus: string | null }>;
    childrenFetched: boolean;
  },
): MetaCampaign {
  if (isCompletedCampaign(campaign)) {
    return campaign;
  }
  const nextEffective = overlayCampaignEffectiveForDelivery({
    campaignStatus: campaign.status,
    campaignEffectiveStatus: campaign.effectiveStatus,
    adSetStatuses: child.adSetStatuses,
    adStatuses: child.adStatuses,
    childrenFetched: child.childrenFetched,
  });
  if (nextEffective === (campaign.effectiveStatus ?? "").toUpperCase()) {
    return campaign;
  }
  return { ...campaign, effectiveStatus: nextEffective };
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
    childDeliveryIncomplete: 0,
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
    .limit(500);

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

    type ChildTree = {
      adSetStatuses: Array<{ status: string | null; effectiveStatus: string | null }>;
      adStatuses: Array<{ status: string | null; effectiveStatus: string | null }>;
      childrenFetched: boolean;
    };
    const childTreeByCampaignId = new Map<string, ChildTree>();

    const adSetById = new Map<
      string,
      { status: string | null; effectiveStatus: string | null }
    >();
    const adById = new Map<
      string,
      { status: string | null; effectiveStatus: string | null }
    >();

    try {
      if (adSetIds.length > 0) {
        const metaAdSets = await getMetaAdSetsByIds({
          adSetIds,
          accessToken,
          appSecret: env.appSecret,
        });
        for (const adSet of metaAdSets.items) {
          adSetById.set(adSet.id, {
            status: adSet.status,
            effectiveStatus: adSet.effectiveStatus,
          });
        }
      }
      if (adIds.length > 0) {
        const metaAds = await getMetaAdsByIds({
          adIds,
          accessToken,
          appSecret: env.appSecret,
        });
        for (const ad of metaAds.items) {
          adById.set(ad.id, {
            status: ad.status,
            effectiveStatus: ad.effectiveStatus,
          });
        }
      }
    } catch {
      // Fall through to per-campaign edges.
    }

    const metaById = new Map(meta.items.map((campaign) => [campaign.id, campaign]));

    // Live campaigns first — finished history must not consume the edge budget
    // (that left live Beitrag-Push stuck on DELIVERY_UNVERIFIED).
    const orderedCampaignIds = [...campaignIds].sort((a, b) => {
      const aMeta = metaById.get(a);
      const bMeta = metaById.get(b);
      const aCompleted = aMeta ? isCompletedCampaign(aMeta) : false;
      const bCompleted = bMeta ? isCompletedCampaign(bMeta) : false;
      if (aCompleted === bCompleted) {
        return 0;
      }
      return aCompleted ? 1 : -1;
    });

    let edgeLookups = 0;
    const MAX_EDGE_LOOKUPS = 20;

    for (const campaignId of orderedCampaignIds) {
      const fromBindingsAdSets = (adSetIdsByCampaignId.get(campaignId) ?? [])
        .map((id) => adSetById.get(id))
        .filter(
          (row): row is { status: string | null; effectiveStatus: string | null } =>
            Boolean(row),
        );
      const fromBindingsAds = (adIdsByCampaignId.get(campaignId) ?? [])
        .map((id) => adById.get(id))
        .filter(
          (row): row is { status: string | null; effectiveStatus: string | null } =>
            Boolean(row),
        );

      if (fromBindingsAdSets.length > 0 && fromBindingsAds.length > 0) {
        childTreeByCampaignId.set(campaignId, {
          adSetStatuses: fromBindingsAdSets,
          adStatuses: fromBindingsAds,
          childrenFetched: true,
        });
        continue;
      }

      const metaCampaign = metaById.get(campaignId);
      // Ended campaigns do not need delivery-tree accuracy for the overlay.
      if (metaCampaign && isCompletedCampaign(metaCampaign)) {
        childTreeByCampaignId.set(campaignId, {
          adSetStatuses: fromBindingsAdSets,
          adStatuses: fromBindingsAds,
          childrenFetched: true,
        });
        continue;
      }

      // Cap edge lookups — full walks made Abruf / Manuell prüfen hang.
      if (edgeLookups >= MAX_EDGE_LOOKUPS) {
        childTreeByCampaignId.set(campaignId, {
          adSetStatuses: fromBindingsAdSets,
          adStatuses: fromBindingsAds,
          childrenFetched: false,
        });
        continue;
      }

      edgeLookups += 1;
      try {
        const [edgeAdSets, edgeAds] = await Promise.all([
          getMetaAdSetsByCampaignId({
            campaignId,
            accessToken,
            appSecret: env.appSecret,
          }),
          getMetaAdsByCampaignId({
            campaignId,
            accessToken,
            appSecret: env.appSecret,
          }),
        ]);
        childTreeByCampaignId.set(campaignId, {
          adSetStatuses: edgeAdSets.items.map((row) => ({
            status: row.status,
            effectiveStatus: row.effectiveStatus,
          })),
          adStatuses: edgeAds.items.map((row) => ({
            status: row.status,
            effectiveStatus: row.effectiveStatus,
          })),
          childrenFetched: true,
        });
      } catch {
        childTreeByCampaignId.set(campaignId, {
          adSetStatuses: fromBindingsAdSets,
          adStatuses: fromBindingsAds,
          childrenFetched: false,
        });
      }
    }

    let refreshed = 0;
    let upserted = 0;
    let paused = 0;
    let childDeliveryIncomplete = 0;
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
      const tree = childTreeByCampaignId.get(normalized.id) ?? {
        adSetStatuses: [],
        adStatuses: [],
        childrenFetched: false,
      };
      const campaign = applyDeliveryOverlay(normalized, tree);
      seen.add(campaign.id);
      const pausedAtMeta = isPausedCampaign(campaign);
      const deliveryBlocked = ["AD_PAUSED", "ADSET_PAUSED", "DELIVERY_UNVERIFIED"].includes(
        (campaign.effectiveStatus ?? "").toUpperCase(),
      );
      const completedAtMeta = isCompletedCampaign(campaign);
      if (completedAtMeta) {
        completed += 1;
      } else if (pausedAtMeta) {
        paused += 1;
        // Only campaign-level PAUSED belongs in ACTIVATE-by-id queue.
        pausedPlatformIds.push(campaign.id);
      } else if (deliveryBlocked) {
        childDeliveryIncomplete += 1;
      } else if ((campaign.effectiveStatus ?? "").toUpperCase() === "ACTIVE") {
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
      childDeliveryIncomplete,
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
