import "server-only";

import {
  getMetaAdsByCampaignId,
  getMetaAdsByIds,
  getMetaAdSetsByCampaignId,
  getMetaAdSetsByIds,
  type MetaAd,
  type MetaAdSet,
} from "@/lib/meta/client";
import { decryptAccessToken } from "@/lib/meta/crypto";
import {
  isConfiguredDeliveryPaused,
  isTerminalDeliveryOff,
} from "@/lib/meta/organic-boost-delivery";
import { getMetaSyncEnv } from "@/lib/meta/env";
import {
  updateMetaAdSetStatus,
  updateMetaAdStatus,
} from "@/lib/meta/write-client";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostDeliveryHealResult = {
  campaignsChecked: number;
  adSetsChecked: number;
  adsChecked: number;
  adSetsActivated: number;
  adsActivated: number;
  allowHealed: boolean;
  skippedKillSwitch: boolean;
  skippedPolicy: boolean;
  error: string | null;
};

async function ensureAllowForOrganicDeliveryHeal(input: {
  userId: string;
  platformAccountId: string;
}): Promise<{ mode: string; healed: boolean }> {
  const admin = createAdminClient();
  const [{ data: settings }, { data: killRow }, { data: account }] =
    await Promise.all([
      admin
        .from("meta_boost_settings")
        .select(
          "enabled,boost_mode,auto_boost_new_candidates,require_manual_approval",
        )
        .eq("user_id", input.userId)
        .eq("platform_account_id", input.platformAccountId)
        .eq("is_current", true)
        .maybeSingle(),
      admin
        .from("kill_switch_state")
        .select("mode,reason,created_at")
        .eq("user_id", input.userId)
        .eq("platform_account_id", input.platformAccountId)
        .eq("scope_type", "ACCOUNT")
        .order("sequence", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("platform_accounts")
        .select("meta_scopes")
        .eq("id", input.platformAccountId)
        .eq("user_id", input.userId)
        .eq("platform", "meta")
        .is("revoked_at", null)
        .maybeSingle(),
    ]);

  const mode =
    typeof killRow?.mode === "string" ? killRow.mode : "FREEZE_WRITES";
  if (mode === "ALLOW") {
    return { mode, healed: false };
  }

  const autoEnabled =
    settings?.enabled === true &&
    settings?.boost_mode === "AUTO" &&
    settings?.auto_boost_new_candidates === true &&
    settings?.require_manual_approval === false;
  if (!autoEnabled) {
    return { mode, healed: false };
  }

  const scopes = Array.isArray(account?.meta_scopes)
    ? account.meta_scopes
    : [];
  if (!scopes.includes("ads_management")) {
    return { mode, healed: false };
  }

  // Do not race Traffic/Lead prepare freeze windows.
  const reason = String(killRow?.reason ?? "");
  const createdAt = Date.parse(String(killRow?.created_at ?? ""));
  const isPrepareFreeze = /Freeze-Phase für Kampagnen-Vorbereitung/i.test(
    reason,
  );
  if (
    isPrepareFreeze &&
    Number.isFinite(createdAt) &&
    Date.now() - createdAt < 120_000
  ) {
    return { mode, healed: false };
  }

  if (mode === "PAUSE_MANAGED") {
    // Customer explicitly paused managed objects — do not override.
    return { mode, healed: false };
  }

  const { error } = await admin.rpc("set_meta_customer_kill_switch", {
    p_user_id: input.userId,
    p_platform_account_id: input.platformAccountId,
    p_mode: "ALLOW",
    p_reason:
      "Heal: Freigeben für Beitrag-Push Delivery-Tree (Ads/AdSets) — FREEZE darf AUTO-Delivery nicht dauerhaft blockieren",
  });
  if (error) {
    return { mode, healed: false };
  }
  return { mode: "ALLOW", healed: true };
}

async function resolveOrganicBoostCampaignIds(input: {
  userId: string;
  platformAccountId: string;
}): Promise<{ campaignIds: string[]; error: string | null }> {
  const admin = createAdminClient();

  const { data: linkRows, error: linkError } = await admin
    .from("meta_organic_boost_links")
    .select("plan_id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .limit(500);

  if (linkError) {
    return { campaignIds: [], error: linkError.message || "boost_link_lookup_failed" };
  }

  const planIds = [
    ...new Set(
      (linkRows ?? [])
        .map((row) => (typeof row.plan_id === "string" ? row.plan_id : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const campaignIds = new Set<string>();

  if (planIds.length > 0) {
    const { data: bindingRows, error: bindingError } = await admin
      .from("remote_object_bindings")
      .select("remote_object_id")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("object_type", "CAMPAIGN")
      .in("plan_id", planIds);

    if (bindingError) {
      return {
        campaignIds: [],
        error: bindingError.message || "boost_binding_lookup_failed",
      };
    }

    for (const row of bindingRows ?? []) {
      if (typeof row.remote_object_id === "string" && row.remote_object_id) {
        campaignIds.add(row.remote_object_id);
      }
    }
  }

  // Fallback: name-matched current campaigns (bindings may be missing).
  const { data: named } = await admin
    .from("campaigns")
    .select("platform_campaign_id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("is_current", true)
    .ilike("name", "Organic Boost%")
    .limit(200);

  for (const row of named ?? []) {
    if (typeof row.platform_campaign_id === "string" && row.platform_campaign_id) {
      campaignIds.add(row.platform_campaign_id);
    }
  }

  return { campaignIds: [...campaignIds], error: null };
}

async function activatePausedObjects(input: {
  adSets: MetaAdSet[];
  ads: MetaAd[];
  accessToken: string;
  appSecret: string;
}): Promise<{ adSetsActivated: number; adsActivated: number }> {
  const auth = {
    accessToken: input.accessToken,
    appSecret: input.appSecret,
  };
  let adSetsActivated = 0;
  let adsActivated = 0;

  for (const adSet of input.adSets) {
    if (isTerminalDeliveryOff(adSet.status, adSet.effectiveStatus)) {
      continue;
    }
    if (!isConfiguredDeliveryPaused(adSet.status)) {
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

  for (const ad of input.ads) {
    if (isTerminalDeliveryOff(ad.status, ad.effectiveStatus)) {
      continue;
    }
    if (!isConfiguredDeliveryPaused(ad.status)) {
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

  return { adSetsActivated, adsActivated };
}

/**
 * Durable delivery heal: activate PAUSED ads/ad sets for every Beitrag-Push
 * campaign. Uses remote bindings when present, otherwise Meta campaign edges.
 * Independent of marketing_sync_id. Auto-ALLOW for Vollautomatik FREEZE.
 */
export async function healOrganicBoostDeliveryTree(input: {
  userId: string;
  platformAccountId: string;
}): Promise<OrganicBoostDeliveryHealResult> {
  const empty: OrganicBoostDeliveryHealResult = {
    campaignsChecked: 0,
    adSetsChecked: 0,
    adsChecked: 0,
    adSetsActivated: 0,
    adsActivated: 0,
    allowHealed: false,
    skippedKillSwitch: false,
    skippedPolicy: false,
    error: null,
  };

  const admin = createAdminClient();
  const allow = await ensureAllowForOrganicDeliveryHeal(input);

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
    typeof killRow?.mode === "string" ? killRow.mode : allow.mode;
  if (killMode !== "ALLOW") {
    return {
      ...empty,
      allowHealed: allow.healed,
      skippedKillSwitch: true,
    };
  }
  if (policy?.allow_status_changes !== true) {
    return {
      ...empty,
      allowHealed: allow.healed,
      skippedPolicy: true,
    };
  }

  const resolved = await resolveOrganicBoostCampaignIds(input);
  if (resolved.error) {
    return { ...empty, allowHealed: allow.healed, error: resolved.error };
  }
  if (resolved.campaignIds.length < 1) {
    return { ...empty, allowHealed: allow.healed };
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
      allowHealed: allow.healed,
      campaignsChecked: resolved.campaignIds.length,
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
      allowHealed: allow.healed,
      campaignsChecked: resolved.campaignIds.length,
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

    // Prefer bindings when present (fewer Graph calls), else campaign edges.
    const { data: linkRows } = await admin
      .from("meta_organic_boost_links")
      .select("plan_id")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .limit(500);
    const planIds = [
      ...new Set(
        (linkRows ?? [])
          .map((row) => (typeof row.plan_id === "string" ? row.plan_id : null))
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    let bindingAdSetIds: string[] = [];
    let bindingAdIds: string[] = [];
    if (planIds.length > 0) {
      const { data: childBindings } = await admin
        .from("remote_object_bindings")
        .select("object_type,remote_object_id")
        .eq("user_id", input.userId)
        .eq("platform_account_id", input.platformAccountId)
        .in("plan_id", planIds)
        .in("object_type", ["AD_SET", "AD"]);
      bindingAdSetIds = [
        ...new Set(
          (childBindings ?? [])
            .filter((row) => row.object_type === "AD_SET")
            .map((row) =>
              typeof row.remote_object_id === "string"
                ? row.remote_object_id
                : null,
            )
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      bindingAdIds = [
        ...new Set(
          (childBindings ?? [])
            .filter((row) => row.object_type === "AD")
            .map((row) =>
              typeof row.remote_object_id === "string"
                ? row.remote_object_id
                : null,
            )
            .filter((id): id is string => Boolean(id)),
        ),
      ];
    }

    const adSets: MetaAdSet[] = [];
    const ads: MetaAd[] = [];

    if (bindingAdSetIds.length > 0) {
      const metaAdSets = await getMetaAdSetsByIds({
        adSetIds: bindingAdSetIds,
        accessToken,
        appSecret: env.appSecret,
      });
      adSets.push(...metaAdSets.items);
    }
    if (bindingAdIds.length > 0) {
      const metaAds = await getMetaAdsByIds({
        adIds: bindingAdIds,
        accessToken,
        appSecret: env.appSecret,
      });
      ads.push(...metaAds.items);
    }

    // Campaign-edge fallback only when bindings did not yield a full tree.
    // Always walking every campaign edge made "Manuell erneut prüfen" hang.
    if (adSets.length < 1 || ads.length < 1) {
      const missingCampaignIds = resolved.campaignIds.slice(0, 20);
      for (const campaignId of missingCampaignIds) {
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
          adSets.push(...edgeAdSets.items);
          ads.push(...edgeAds.items);
        } catch {
          // Continue other campaigns.
        }
      }
    }

    const uniqueAdSets = [
      ...new Map(adSets.map((item) => [item.id, item])).values(),
    ];
    const uniqueAds = [...new Map(ads.map((item) => [item.id, item])).values()];

    const activated = await activatePausedObjects({
      adSets: uniqueAdSets,
      ads: uniqueAds,
      accessToken,
      appSecret: env.appSecret,
    });

    return {
      campaignsChecked: resolved.campaignIds.length,
      adSetsChecked: uniqueAdSets.length,
      adsChecked: uniqueAds.length,
      adSetsActivated: activated.adSetsActivated,
      adsActivated: activated.adsActivated,
      allowHealed: allow.healed,
      skippedKillSwitch: false,
      skippedPolicy: false,
      error: null,
    };
  } catch (error) {
    return {
      ...empty,
      allowHealed: allow.healed,
      campaignsChecked: resolved.campaignIds.length,
      error:
        error instanceof Error
          ? error.message
          : "organic_boost_delivery_heal_failed",
    };
  }
}
