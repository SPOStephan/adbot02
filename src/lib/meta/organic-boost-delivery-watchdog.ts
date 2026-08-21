import "server-only";

import { healOrganicBoostDeliveryTree } from "@/lib/meta/organic-boost-delivery-heal";
import { createAdminClient } from "@/lib/supabase/admin";

const INCOMPLETE_EFFECTIVE = new Set([
  "AD_PAUSED",
  "ADSET_PAUSED",
  "DELIVERY_UNVERIFIED",
]);

/** Hard caps — never turn this into a marketing Abruf. */
const DEFAULT_MAX_ACCOUNTS = 2;
const DEFAULT_MAX_CAMPAIGNS_PER_ACCOUNT = 2;

export type OrganicBoostDeliveryWatchdogAccountResult = {
  platformAccountId: string;
  userId: string;
  suspectCampaignIds: string[];
  skippedKillSwitch: boolean;
  skippedPolicy: boolean;
  rateLimited: boolean;
  adSetsActivated: number;
  adsActivated: number;
  adsCreated: number;
  adSetsCreated: number;
  error: string | null;
};

export type OrganicBoostDeliveryWatchdogResult = {
  enabled: boolean;
  accountsConsidered: number;
  accountsHealed: number;
  accountsSkipped: number;
  results: OrganicBoostDeliveryWatchdogAccountResult[];
};

function watchdogEnabled(): boolean {
  const raw = (process.env.ORGANIC_BOOST_DELIVERY_WATCHDOG ?? "1").trim();
  return raw !== "0" && raw.toLowerCase() !== "false" && raw.toLowerCase() !== "off";
}

function isScheduleOpen(stopTime: string | null | undefined): boolean {
  if (!stopTime) return true;
  const stopMs = Date.parse(String(stopTime));
  return !Number.isFinite(stopMs) || stopMs > Date.now();
}

/**
 * Conservative background heal for Beitrag-Push delivery gaps.
 *
 * Safety rules (must not impair normal Meta ops):
 * - Off via ORGANIC_BOOST_DELIVERY_WATCHDOG=0
 * - Only local suspects (AD_PAUSED / ADSET_PAUSED / DELIVERY_UNVERIFIED)
 * - Never flips FREEZE→ALLOW
 * - No marketing sync, no force-reactivate, no diagnose RPCs
 * - Tiny account/campaign caps per tick
 */
export async function runOrganicBoostDeliveryWatchdog(input?: {
  maxAccounts?: number;
  maxCampaignsPerAccount?: number;
}): Promise<OrganicBoostDeliveryWatchdogResult> {
  if (!watchdogEnabled()) {
    return {
      enabled: false,
      accountsConsidered: 0,
      accountsHealed: 0,
      accountsSkipped: 0,
      results: [],
    };
  }

  const maxAccounts = Math.max(
    1,
    Math.min(5, input?.maxAccounts ?? DEFAULT_MAX_ACCOUNTS),
  );
  const maxCampaigns = Math.max(
    1,
    Math.min(3, input?.maxCampaignsPerAccount ?? DEFAULT_MAX_CAMPAIGNS_PER_ACCOUNT),
  );

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("campaigns")
    .select(
      "user_id,platform_account_id,platform_campaign_id,effective_status,status,stop_time",
    )
    .eq("is_current", true)
    .ilike("name", "Organic Boost%")
    .in("effective_status", [...INCOMPLETE_EFFECTIVE])
    .limit(80);

  if (error) {
    console.error("organic_boost_delivery_watchdog_lookup_failed", {
      error: error.message,
    });
    return {
      enabled: true,
      accountsConsidered: 0,
      accountsHealed: 0,
      accountsSkipped: 0,
      results: [],
    };
  }

  type Suspect = {
    userId: string;
    platformAccountId: string;
    campaignIds: string[];
  };
  const byAccount = new Map<string, Suspect>();

  for (const row of rows ?? []) {
    const userId = typeof row.user_id === "string" ? row.user_id : null;
    const platformAccountId =
      typeof row.platform_account_id === "string"
        ? row.platform_account_id
        : null;
    const campaignId =
      typeof row.platform_campaign_id === "string"
        ? row.platform_campaign_id
        : null;
    if (!userId || !platformAccountId || !campaignId) continue;

    const effective = String(row.effective_status ?? "").toUpperCase();
    const status = String(row.status ?? "").toUpperCase();
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
    if (!isScheduleOpen(row.stop_time)) continue;
    if (!INCOMPLETE_EFFECTIVE.has(effective)) continue;

    const key = `${userId}:${platformAccountId}`;
    const existing = byAccount.get(key);
    if (existing) {
      if (existing.campaignIds.length < maxCampaigns) {
        existing.campaignIds.push(campaignId);
      }
    } else {
      byAccount.set(key, {
        userId,
        platformAccountId,
        campaignIds: [campaignId],
      });
    }
  }

  const suspects = [...byAccount.values()].slice(0, maxAccounts);
  const results: OrganicBoostDeliveryWatchdogAccountResult[] = [];
  let accountsHealed = 0;
  let accountsSkipped = 0;

  for (const suspect of suspects) {
    const heal = await healOrganicBoostDeliveryTree({
      userId: suspect.userId,
      platformAccountId: suspect.platformAccountId,
      allowAutoUnfreeze: false,
      onlyCampaignIds: suspect.campaignIds,
    }).catch((error) => ({
      adSetsActivated: 0,
      adsActivated: 0,
      adsCreated: 0,
      adSetsCreated: 0,
      campaignsMissingAds: 0,
      skippedKillSwitch: false,
      skippedPolicy: false,
      rateLimited: false,
      error:
        error instanceof Error
          ? error.message
          : "organic_boost_delivery_watchdog_heal_failed",
    }));

    const skipped =
      Boolean(heal.skippedKillSwitch) || Boolean(heal.skippedPolicy);
    if (skipped) {
      accountsSkipped += 1;
    } else {
      accountsHealed += 1;
    }

    const row: OrganicBoostDeliveryWatchdogAccountResult = {
      platformAccountId: suspect.platformAccountId,
      userId: suspect.userId,
      suspectCampaignIds: suspect.campaignIds,
      skippedKillSwitch: Boolean(heal.skippedKillSwitch),
      skippedPolicy: Boolean(heal.skippedPolicy),
      rateLimited: Boolean(heal.rateLimited),
      adSetsActivated: heal.adSetsActivated ?? 0,
      adsActivated: heal.adsActivated ?? 0,
      adsCreated: heal.adsCreated ?? 0,
      adSetsCreated: heal.adSetsCreated ?? 0,
      error: "error" in heal ? heal.error : null,
    };
    results.push(row);

    console.error("organic_boost_delivery_watchdog_account", row);

    // Stop the tick early on Meta rate limit — do not fan out to more accounts.
    if (heal.rateLimited) {
      break;
    }
  }

  return {
    enabled: true,
    accountsConsidered: suspects.length,
    accountsHealed,
    accountsSkipped,
    results,
  };
}
