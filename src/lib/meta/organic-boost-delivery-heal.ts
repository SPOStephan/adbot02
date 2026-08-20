import "server-only";

import {
  getMetaAdsByIds,
  getMetaAdSetsByIds,
  type MetaAd,
  type MetaAdSet,
} from "@/lib/meta/client";
import { decryptAccessToken } from "@/lib/meta/crypto";
import { getMetaSyncEnv } from "@/lib/meta/env";
import {
  updateMetaAdSetStatus,
  updateMetaAdStatus,
} from "@/lib/meta/write-client";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostDeliveryHealResult = {
  adSetsChecked: number;
  adsChecked: number;
  adSetsActivated: number;
  adsActivated: number;
  skippedKillSwitch: boolean;
  skippedPolicy: boolean;
  error: string | null;
};

function isConfiguredPaused(
  status: string | null | undefined,
  effectiveStatus: string | null | undefined,
): boolean {
  const configured = (status ?? "").toUpperCase();
  const effective = (effectiveStatus ?? "").toUpperCase();
  if (
    effective === "DELETED" ||
    effective === "ARCHIVED" ||
    configured === "DELETED" ||
    configured === "ARCHIVED"
  ) {
    return false;
  }
  return (
    configured === "PAUSED" ||
    effective === "PAUSED" ||
    effective === "AD_PAUSED" ||
    effective === "ADSET_PAUSED"
  );
}

function isTerminalOff(
  status: string | null | undefined,
  effectiveStatus: string | null | undefined,
): boolean {
  const configured = (status ?? "").toUpperCase();
  const effective = (effectiveStatus ?? "").toUpperCase();
  return (
    configured === "DELETED" ||
    configured === "ARCHIVED" ||
    effective === "DELETED" ||
    effective === "ARCHIVED" ||
    effective === "COMPLETED" ||
    effective === "CAMPAIGN_COMPLETED"
  );
}

/**
 * Beitrag-Push creates campaign/ad set/ad as PAUSED, then activates bottom-up.
 * Campaign-only recover left ads/ad sets PAUSED while the dashboard still
 * showed "Boost aktiv" from campaign.effective_status=ACTIVE.
 *
 * This heals configured-PAUSED AD_SET / AD bindings for organic boost plans
 * when kill-switch ALLOW and status changes are permitted.
 */
export async function healOrganicBoostDeliveryTree(input: {
  userId: string;
  platformAccountId: string;
}): Promise<OrganicBoostDeliveryHealResult> {
  const empty: OrganicBoostDeliveryHealResult = {
    adSetsChecked: 0,
    adsChecked: 0,
    adSetsActivated: 0,
    adsActivated: 0,
    skippedKillSwitch: false,
    skippedPolicy: false,
    error: null,
  };

  const admin = createAdminClient();

  const [{ data: killRow }, { data: policy }] = await Promise.all([
    admin
      .from("kill_switch_state")
      .select("mode")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("scope_type", "ACCOUNT")
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("automation_policies")
      .select("allow_status_changes")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("is_current", true)
      .eq("status", "ACTIVE")
      .maybeSingle(),
  ]);

  const killMode =
    typeof killRow?.mode === "string" ? killRow.mode : "FREEZE_WRITES";
  if (killMode !== "ALLOW") {
    return { ...empty, skippedKillSwitch: true };
  }
  if (policy?.allow_status_changes !== true) {
    return { ...empty, skippedPolicy: true };
  }

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
    .select("object_type,remote_object_id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .in("plan_id", planIds)
    .in("object_type", ["AD_SET", "AD"]);

  if (bindingError) {
    return {
      ...empty,
      error: bindingError.message || "boost_binding_lookup_failed",
    };
  }

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

  if (adSetIds.length < 1 && adIds.length < 1) {
    return empty;
  }

  const { data: account, error: accountError } = await admin
    .from("platform_accounts")
    .select("access_token_encrypted, token_iv, token_auth_tag")
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (accountError || !account) {
    return {
      ...empty,
      adSetsChecked: adSetIds.length,
      adsChecked: adIds.length,
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
      adSetsChecked: adSetIds.length,
      adsChecked: adIds.length,
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
    const auth = { accessToken, appSecret: env.appSecret };

    let adSetsActivated = 0;
    let adsActivated = 0;

    if (adSetIds.length > 0) {
      const metaAdSets = await getMetaAdSetsByIds({
        adSetIds,
        accessToken,
        appSecret: env.appSecret,
      });
      for (const adSet of metaAdSets.items as MetaAdSet[]) {
        if (isTerminalOff(adSet.status, adSet.effectiveStatus)) {
          continue;
        }
        // Only flip configured status — parent-paused effective states are
        // fixed by activating the parent (campaign recover / this tree).
        if ((adSet.status ?? "").toUpperCase() !== "PAUSED") {
          continue;
        }
        if (!isConfiguredPaused(adSet.status, adSet.effectiveStatus)) {
          continue;
        }
        await updateMetaAdSetStatus({
          ...auth,
          objectId: adSet.id,
          status: "ACTIVE",
          mode: "execute",
        });
        adSetsActivated += 1;
      }
    }

    if (adIds.length > 0) {
      const metaAds = await getMetaAdsByIds({
        adIds,
        accessToken,
        appSecret: env.appSecret,
      });
      for (const ad of metaAds.items as MetaAd[]) {
        if (isTerminalOff(ad.status, ad.effectiveStatus)) {
          continue;
        }
        if ((ad.status ?? "").toUpperCase() !== "PAUSED") {
          continue;
        }
        if (!isConfiguredPaused(ad.status, ad.effectiveStatus)) {
          continue;
        }
        await updateMetaAdStatus({
          ...auth,
          objectId: ad.id,
          status: "ACTIVE",
          mode: "execute",
        });
        adsActivated += 1;
      }
    }

    return {
      adSetsChecked: adSetIds.length,
      adsChecked: adIds.length,
      adSetsActivated,
      adsActivated,
      skippedKillSwitch: false,
      skippedPolicy: false,
      error: null,
    };
  } catch (error) {
    return {
      ...empty,
      adSetsChecked: adSetIds.length,
      adsChecked: adIds.length,
      error:
        error instanceof Error
          ? error.message
          : "organic_boost_delivery_heal_failed",
    };
  }
}
