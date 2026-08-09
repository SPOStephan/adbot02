import "server-only";

import { getMetaCampaignsByIds, type MetaCampaign } from "@/lib/meta/client";
import { decryptAccessToken } from "@/lib/meta/crypto";
import { getMetaSyncEnv } from "@/lib/meta/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostStatusRefreshResult = {
  requested: number;
  refreshed: number;
  upserted: number;
  paused: number;
  active: number;
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

async function upsertCampaignRow(input: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  platformAccountId: string;
  campaign: MetaCampaign;
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
    .select("remote_object_id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("object_type", "CAMPAIGN")
    .in("plan_id", planIds);

  if (bindingError) {
    return {
      ...empty,
      error: bindingError.message || "boost_binding_lookup_failed",
    };
  }

  const campaignIds = [
    ...new Set(
      (bindingRows ?? [])
        .map((row) =>
          typeof row.remote_object_id === "string" ? row.remote_object_id : null,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (campaignIds.length < 1) {
    return empty;
  }

  const { data: account, error: accountError } = await admin
    .from("platform_accounts")
    .select(
      "access_token_encrypted, token_iv, token_auth_tag, expires_at, data_access_expires_at",
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

    let refreshed = 0;
    let upserted = 0;
    let paused = 0;
    let active = 0;
    let targetsRepaired = 0;
    const pausedPlatformIds: string[] = [];

    for (const campaign of meta.items) {
      const pausedAtMeta = isPausedCampaign(campaign);
      if (pausedAtMeta) {
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
      });

      if (wrote.wrote) {
        refreshed += 1;
        upserted += 1;
      }

      if (pausedAtMeta && wrote.localId) {
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

    return {
      requested: campaignIds.length,
      refreshed,
      upserted,
      paused,
      active,
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
