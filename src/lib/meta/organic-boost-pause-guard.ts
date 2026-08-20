import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const ORGANIC_BOOST_NAME_PREFIX = "Organic Boost";

/**
 * True when a Meta object id belongs to a Beitrag-Push tree.
 * Used to forbid automated PAUSE writes after delivery was live.
 */
export async function isOrganicBoostRemoteObject(input: {
  userId: string;
  platformAccountId: string;
  remoteObjectId: string;
  objectType: "CAMPAIGN" | "AD_SET" | "AD";
}): Promise<boolean> {
  const admin = createAdminClient();

  const { data: binding } = await admin
    .from("remote_object_bindings")
    .select("plan_id,object_type")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("remote_object_id", input.remoteObjectId)
    .maybeSingle();

  if (binding?.plan_id) {
    const { data: plan } = await admin
      .from("mutation_plans")
      .select("source_rule_key,action_type")
      .eq("id", binding.plan_id)
      .maybeSingle();
    if (
      plan?.source_rule_key === "organic-boost" &&
      plan?.action_type === "LAUNCH_CHAIN"
    ) {
      return true;
    }

    const { data: link } = await admin
      .from("meta_organic_boost_links")
      .select("plan_id")
      .eq("plan_id", binding.plan_id)
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .maybeSingle();
    if (link?.plan_id) {
      return true;
    }
  }

  if (input.objectType === "CAMPAIGN") {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("name")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("platform_campaign_id", input.remoteObjectId)
      .eq("is_current", true)
      .maybeSingle();
    if (
      typeof campaign?.name === "string" &&
      campaign.name.startsWith(ORGANIC_BOOST_NAME_PREFIX)
    ) {
      return true;
    }
  }

  // AD / AD_SET: resolve via local ads/ad_groups → campaign name.
  if (input.objectType === "AD") {
    const { data: ad } = await admin
      .from("ads")
      .select("id,ad_group_id")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("platform_ad_id", input.remoteObjectId)
      .eq("is_current", true)
      .maybeSingle();
    if (ad?.ad_group_id) {
      const { data: ag } = await admin
        .from("ad_groups")
        .select("campaign_id")
        .eq("id", ad.ad_group_id)
        .maybeSingle();
      if (ag?.campaign_id) {
        const { data: campaign } = await admin
          .from("campaigns")
          .select("name")
          .eq("id", ag.campaign_id)
          .maybeSingle();
        if (
          typeof campaign?.name === "string" &&
          campaign.name.startsWith(ORGANIC_BOOST_NAME_PREFIX)
        ) {
          return true;
        }
      }
    }
  }

  if (input.objectType === "AD_SET") {
    const { data: ag } = await admin
      .from("ad_groups")
      .select("campaign_id")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("platform_ad_group_id", input.remoteObjectId)
      .eq("is_current", true)
      .maybeSingle();
    if (ag?.campaign_id) {
      const { data: campaign } = await admin
        .from("campaigns")
        .select("name")
        .eq("id", ag.campaign_id)
        .maybeSingle();
      if (
        typeof campaign?.name === "string" &&
        campaign.name.startsWith(ORGANIC_BOOST_NAME_PREFIX)
      ) {
        return true;
      }
    }
  }

  return false;
}

/** Automated rules that must never pause Beitrag-Push mid-flight. */
export function isAutomatedPauseAction(input: {
  actionType: string;
  sourceRuleKey: string | null | undefined;
}): boolean {
  const action = input.actionType.toUpperCase();
  const rule = (input.sourceRuleKey ?? "").toLowerCase();
  if (action === "SAFETY_PAUSE") {
    return true;
  }
  if (action === "PAUSE") {
    return (
      rule === "hard_cap_exposure_breach" ||
      rule === "ad_sibling_success_pause_7d" ||
      rule.startsWith("hard_cap") ||
      rule.includes("sibling_success_pause")
    );
  }
  return false;
}
