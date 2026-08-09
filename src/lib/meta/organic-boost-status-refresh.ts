import "server-only";

import { getMetaCampaignsByIds } from "@/lib/meta/client";
import { decryptAccessToken } from "@/lib/meta/crypto";
import { getMetaSyncEnv } from "@/lib/meta/env";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostStatusRefreshResult = {
  requested: number;
  refreshed: number;
  paused: number;
  active: number;
  error: string | null;
};

/**
 * Re-fetch Beitrag-Push campaign rows by Meta id and patch local status.
 * Account-wide marketing sync can leave boost campaigns looking ACTIVE while
 * Meta Ads Manager still shows PAUSED; this closes that gap before reactivate.
 */
export async function refreshOrganicBoostCampaignStatusesFromMeta(input: {
  platformAccountId: string;
  userId: string;
}): Promise<OrganicBoostStatusRefreshResult> {
  const admin = createAdminClient();

  const { data: linkRows, error: linkError } = await admin
    .from("meta_organic_boost_links")
    .select("plan_id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .limit(100);

  if (linkError) {
    return {
      requested: 0,
      refreshed: 0,
      paused: 0,
      active: 0,
      error: linkError.message || "boost_link_lookup_failed",
    };
  }

  const planIds = [
    ...new Set(
      (linkRows ?? [])
        .map((row) => (typeof row.plan_id === "string" ? row.plan_id : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (planIds.length < 1) {
    return {
      requested: 0,
      refreshed: 0,
      paused: 0,
      active: 0,
      error: null,
    };
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
      requested: 0,
      refreshed: 0,
      paused: 0,
      active: 0,
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
    return {
      requested: 0,
      refreshed: 0,
      paused: 0,
      active: 0,
      error: null,
    };
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
      requested: campaignIds.length,
      refreshed: 0,
      paused: 0,
      active: 0,
      error: accountError?.message || "account_unavailable",
    };
  }

  if (
    !account.access_token_encrypted ||
    !account.token_iv ||
    !account.token_auth_tag
  ) {
    return {
      requested: campaignIds.length,
      refreshed: 0,
      paused: 0,
      active: 0,
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
    let paused = 0;
    let active = 0;

    for (const campaign of meta.items) {
      const status = (campaign.status ?? "").toUpperCase();
      const effective = (campaign.effectiveStatus ?? "").toUpperCase();
      if (
        status === "PAUSED" ||
        effective === "PAUSED" ||
        effective === "CAMPAIGN_PAUSED"
      ) {
        paused += 1;
      } else if (status === "ACTIVE" || effective === "ACTIVE") {
        active += 1;
      }

      const { error: updateError } = await admin
        .from("campaigns")
        .update({
          status: campaign.status,
          effective_status: campaign.effectiveStatus,
          stop_time: campaign.stopTime,
          start_time: campaign.startTime,
          name: campaign.name,
          updated_at: new Date().toISOString(),
          is_current: true,
        })
        .eq("user_id", input.userId)
        .eq("platform_account_id", input.platformAccountId)
        .eq("platform_campaign_id", campaign.id);

      if (!updateError) {
        refreshed += 1;
      }
    }

    return {
      requested: campaignIds.length,
      refreshed,
      paused,
      active,
      error: null,
    };
  } catch (error) {
    return {
      requested: campaignIds.length,
      refreshed: 0,
      paused: 0,
      active: 0,
      error:
        error instanceof Error
          ? error.message
          : "boost_campaign_status_refresh_failed",
    };
  }
}
