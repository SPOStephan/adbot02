import "server-only";

import {
  getMetaAdsByCampaignId,
  getMetaAdSetsByCampaignId,
  MetaGraphError,
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
import { repairMissingOrganicBoostAd } from "@/lib/meta/organic-boost-missing-ad-repair";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostDeliveryHealResult = {
  campaignsChecked: number;
  adSetsChecked: number;
  adsChecked: number;
  adSetsActivated: number;
  adsActivated: number;
  campaignsMissingAds: number;
  adsCreated: number;
  adSetsCreated: number;
  allowHealed: boolean;
  skippedKillSwitch: boolean;
  skippedPolicy: boolean;
  rateLimited: boolean;
  error: string | null;
};

/** Prefer Meta's diagnosticDetail — Error.message is always the generic Graph string. */
export function formatOrganicBoostHealError(error: unknown): string {
  if (error instanceof MetaGraphError) {
    if (error.diagnosticDetail) {
      return error.diagnosticDetail;
    }
    const bits = [
      `HTTP ${error.status}`,
      error.code != null ? `code ${error.code}` : null,
      error.subcode != null ? `sub ${error.subcode}` : null,
    ].filter(Boolean);
    return `Meta Graph API request failed (${bits.join(", ")})`;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "organic_boost_delivery_heal_failed";
}

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

/**
 * Only live Beitrag-Push campaigns — never batch-heal finished history.
 * Batching deleted/archived ad ids from old plans caused Meta Graph failures.
 */
async function resolveLiveOrganicBoostCampaignIds(input: {
  userId: string;
  platformAccountId: string;
}): Promise<{ campaignIds: string[]; error: string | null }> {
  const admin = createAdminClient();

  const { data: named, error: namedError } = await admin
    .from("campaigns")
    .select("platform_campaign_id,status,effective_status,stop_time")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("is_current", true)
    .ilike("name", "Organic Boost%")
    .limit(100);

  if (namedError) {
    return {
      campaignIds: [],
      error: namedError.message || "campaign_lookup_failed",
    };
  }

  const campaignIds: string[] = [];
  for (const row of named ?? []) {
    const id =
      typeof row.platform_campaign_id === "string"
        ? row.platform_campaign_id
        : null;
    if (!id) continue;

    const status = String(row.status ?? "").toUpperCase();
    const effective = String(row.effective_status ?? "").toUpperCase();
    if (
      status === "DELETED" ||
      status === "ARCHIVED" ||
      effective === "DELETED" ||
      effective === "ARCHIVED" ||
      effective === "COMPLETED" ||
      effective === "CAMPAIGN_COMPLETED"
    ) {
      continue;
    }

    const stopMs = row.stop_time ? Date.parse(String(row.stop_time)) : Number.NaN;
    if (Number.isFinite(stopMs) && stopMs <= Date.now()) {
      continue;
    }

    campaignIds.push(id);
  }

  return { campaignIds, error: null };
}

async function activatePausedObjects(input: {
  adSets: MetaAdSet[];
  ads: MetaAd[];
  accessToken: string;
  appSecret: string;
}): Promise<{
  adSetsActivated: number;
  adsActivated: number;
  lastError: string | null;
}> {
  const auth = {
    accessToken: input.accessToken,
    appSecret: input.appSecret,
  };
  let adSetsActivated = 0;
  let adsActivated = 0;
  let lastError: string | null = null;

  for (const adSet of input.adSets) {
    if (isTerminalDeliveryOff(adSet.status, adSet.effectiveStatus)) {
      continue;
    }
    if (!isConfiguredDeliveryPaused(adSet.status, adSet.effectiveStatus)) {
      continue;
    }
    try {
      await updateMetaAdSetStatus({
        ...auth,
        objectId: adSet.id,
        status: "ACTIVE",
        mode: "execute",
      });
      adSetsActivated += 1;
    } catch (error) {
      lastError = formatOrganicBoostHealError(error);
      console.error("organic_boost_heal_adset_activate_failed", {
        adSetId: adSet.id,
        error: lastError,
      });
    }
  }

  for (const ad of input.ads) {
    if (isTerminalDeliveryOff(ad.status, ad.effectiveStatus)) {
      continue;
    }
    if (!isConfiguredDeliveryPaused(ad.status, ad.effectiveStatus)) {
      continue;
    }
    try {
      await updateMetaAdStatus({
        ...auth,
        objectId: ad.id,
        status: "ACTIVE",
        mode: "execute",
      });
      adsActivated += 1;
    } catch (error) {
      lastError = formatOrganicBoostHealError(error);
      console.error("organic_boost_heal_ad_activate_failed", {
        adId: ad.id,
        error: lastError,
      });
    }
  }

  return { adSetsActivated, adsActivated, lastError };
}

/**
 * Activate PAUSED ads/ad sets for live Beitrag-Push campaigns only.
 * Uses per-campaign Meta edges (not a global binding id dump) so finished
 * history cannot poison Graph batch reads.
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
    campaignsMissingAds: 0,
    adsCreated: 0,
    adSetsCreated: 0,
    allowHealed: false,
    skippedKillSwitch: false,
    skippedPolicy: false,
    rateLimited: false,
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

  const resolved = await resolveLiveOrganicBoostCampaignIds(input);
  if (resolved.error) {
    return { ...empty, allowHealed: allow.healed, error: resolved.error };
  }
  if (resolved.campaignIds.length < 1) {
    return { ...empty, allowHealed: allow.healed };
  }

  // Cap work per Abruf — only a few live incomplete trees should remain.
  const campaignIds = resolved.campaignIds.slice(0, 8);

  const { data: account, error: accountError } = await admin
    .from("platform_accounts")
    .select(
      "access_token_encrypted, token_iv, token_auth_tag, marketing_meta_ad_account_id",
    )
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (accountError || !account) {
    return {
      ...empty,
      allowHealed: allow.healed,
      campaignsChecked: campaignIds.length,
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
      campaignsChecked: campaignIds.length,
      error: "token_unavailable",
    };
  }

  const adAccountId =
    typeof account.marketing_meta_ad_account_id === "string"
      ? account.marketing_meta_ad_account_id
      : null;

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

    const adSets: MetaAdSet[] = [];
    const ads: MetaAd[] = [];
    let campaignsMissingAds = 0;
    let adsCreated = 0;
    let adSetsCreated = 0;
    let fetchError: string | null = null;
    let rateLimited = false;
    let repairsAttempted = 0;

    for (const campaignId of campaignIds) {
      if (rateLimited) {
        break;
      }
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
        const liveAds = edgeAds.items.filter(
          (row) => !isTerminalDeliveryOff(row.status, row.effectiveStatus),
        );
        const liveAdSets = edgeAdSets.items.filter(
          (row) => !isTerminalDeliveryOff(row.status, row.effectiveStatus),
        );
        // Ads already in Meta review/process count as present — do not recreate.
        if (liveAds.length < 1) {
          campaignsMissingAds += 1;
          // Confirm once more before CREATE — avoids duplicate trees on flaky reads.
          let confirmedEmpty = true;
          try {
            const confirm = await getMetaAdsByCampaignId({
              campaignId,
              accessToken,
              appSecret: env.appSecret,
            });
            confirmedEmpty =
              confirm.items.filter(
                (row) =>
                  !isTerminalDeliveryOff(row.status, row.effectiveStatus),
              ).length < 1;
          } catch {
            confirmedEmpty = true;
          }
          if (
            confirmedEmpty &&
            adAccountId &&
            repairsAttempted < 1
          ) {
            repairsAttempted += 1;
            const repair = await repairMissingOrganicBoostAd({
              userId: input.userId,
              platformAccountId: input.platformAccountId,
              campaignId,
              accessToken,
              appSecret: env.appSecret,
              adAccountId,
              existingAdSetIds: liveAdSets.map((row) => row.id),
              campaignStopTime: stopTimeByCampaignId.get(campaignId) ?? null,
            });
            adsCreated += repair.adsCreated;
            adSetsCreated += repair.adSetsCreated;
            if (repair.error) {
              fetchError = repair.error;
            }
            if (repair.rateLimited) {
              rateLimited = true;
            }
          }
        }
      } catch (error) {
        fetchError = formatOrganicBoostHealError(error);
        if (error instanceof MetaGraphError && error.rateLimited) {
          rateLimited = true;
        }
        console.error("organic_boost_heal_campaign_edge_failed", {
          campaignId,
          error: fetchError,
        });
      }
    }

    const uniqueAdSets = [
      ...new Map(adSets.map((item) => [item.id, item])).values(),
    ];
    const uniqueAds = [...new Map(ads.map((item) => [item.id, item])).values()];

    const activated = rateLimited
      ? { adSetsActivated: 0, adsActivated: 0, lastError: fetchError }
      : await activatePausedObjects({
          adSets: uniqueAdSets,
          ads: uniqueAds,
          accessToken,
          appSecret: env.appSecret,
        });

    if (
      activated.lastError &&
      /zu viele API-Aufrufe|too many api|rate limit/i.test(activated.lastError)
    ) {
      rateLimited = true;
    }

    const error =
      activated.lastError ||
      fetchError ||
      (activated.adSetsActivated + activated.adsActivated + adsCreated < 1 &&
      campaignsMissingAds > 0
        ? `keine_werbeanzeige:${campaignsMissingAds}_kampagne(n)_ohne_ad`
        : null);

    return {
      campaignsChecked: campaignIds.length,
      adSetsChecked: uniqueAdSets.length,
      adsChecked: uniqueAds.length,
      adSetsActivated: activated.adSetsActivated,
      adsActivated: activated.adsActivated,
      campaignsMissingAds,
      adsCreated,
      adSetsCreated,
      allowHealed: allow.healed,
      skippedKillSwitch: false,
      skippedPolicy: false,
      rateLimited,
      error,
    };
  } catch (error) {
    const rateLimited =
      error instanceof MetaGraphError && error.rateLimited;
    return {
      ...empty,
      allowHealed: allow.healed,
      campaignsChecked: campaignIds.length,
      rateLimited,
      error: formatOrganicBoostHealError(error),
    };
  }
}
