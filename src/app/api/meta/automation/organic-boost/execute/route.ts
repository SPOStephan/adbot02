import { NextRequest } from "next/server";

import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";
import {
  drainHardCapStatusExecutionsForAccount,
  forceReactivatePausedOrganicBoostCampaigns,
} from "@/lib/meta/hard-cap-status-execute";
import {
  formatOrganicBoostHealError,
  healOrganicBoostDeliveryTree,
} from "@/lib/meta/organic-boost-delivery-heal";
import { drainOrganicBoostExecutionsForAccount } from "@/lib/meta/organic-boost-execute";
import { refreshOrganicBoostCampaignStatusesFromMeta } from "@/lib/meta/organic-boost-status-refresh";
import { syncMetaConnector } from "@/lib/meta/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ExecuteBody = {
  /** Skip full marketing Abruf (plan already did it / cooldown). Default true. */
  skipMarketingSync?: boolean;
  /** Skip heavy diagnose RPCs on the hot path. Default true. */
  skipDiagnose?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await readControlJson(request)) as ExecuteBody;
    const customer = await authenticateMetaCustomer();
    const admin = createAdminClient();

    const skipMarketingSync = body.skipMarketingSync !== false;
    const skipDiagnose = body.skipDiagnose !== false;

    // 1) Delivery heal FIRST — Meta ad/adset ACTIVATE must not wait on Abruf.
    const earlyHeal = await healOrganicBoostDeliveryTree({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
    }).catch((error) => ({
      adSetsActivated: 0,
      adsActivated: 0,
      campaignsMissingAds: 0,
      error: formatOrganicBoostHealError(error),
    }));

    // 2) Optional marketing Abruf — expensive; button/plan usually already ran it.
    let marketingSync: {
      outcome: string;
      status: string;
      blockedReason: string | null;
      insightsCount: number;
      campaignsCount: number;
      spendTotal: number;
      insightsUntil: string | null;
      retryAt: string | null;
      marketingStatus: string;
    } | null = null;
    let marketingSyncError: string | null = null;
    if (!skipMarketingSync) {
      try {
        const syncResult = await syncMetaConnector({
          platformAccountId: customer.platformAccountId,
          userId: customer.userId,
          mode: "manual",
          ensureOrganicBoost: false,
        });
        marketingSync = {
          outcome: syncResult.outcome,
          status: syncResult.status,
          blockedReason: syncResult.blockedReason,
          insightsCount: syncResult.insightsCount,
          campaignsCount: syncResult.campaignsCount,
          spendTotal: syncResult.spendTotal,
          insightsUntil: syncResult.insightsUntil,
          retryAt: syncResult.retryAt,
          marketingStatus: syncResult.marketingStatus,
        };
      } catch (error) {
        marketingSyncError =
          error instanceof Error ? error.message : "marketing_sync_failed";
      }
    }

    // 3) Live Beitrag-Push status only — finished history must not burn Graph time.
    const statusRefresh = await refreshOrganicBoostCampaignStatusesFromMeta({
      platformAccountId: customer.platformAccountId,
      userId: customer.userId,
      liveOnly: true,
    });

    let hardCapForceResume: {
      outcome: string;
      reason: string | null;
      created: number;
      existing: number;
      blocked: number;
      revived: number;
      exposuresCleared: number;
      scheduleEnded: number;
      candidates: number;
      linked: number;
      activeLocal: number;
      adsetPausedOnly: number;
      targetsRepaired: number;
      remainingUnder24h: number;
      missingCurrent: number;
      adSetsActivated: number;
      adsActivated: number;
      campaignsMissingAds: number;
      error: string | null;
      statusRefresh: {
        requested: number;
        refreshed: number;
        upserted: number;
        paused: number;
        childDeliveryIncomplete: number;
        active: number;
        completed: number;
        missingAtMeta: number;
        targetsRepaired: number;
        error: string | null;
      };
    } | null = null;
    let hardCapStatus: {
      duePlans: number;
      runs: number;
      succeeded: number;
      failed: number;
      lastOutcome: string | null;
      lastError: string | null;
    } | null = null;

    const statusRefreshPayload = {
      requested: statusRefresh.requested,
      refreshed: statusRefresh.refreshed,
      upserted: statusRefresh.upserted,
      paused: statusRefresh.paused,
      childDeliveryIncomplete: statusRefresh.childDeliveryIncomplete,
      active: statusRefresh.active,
      completed: statusRefresh.completed,
      missingAtMeta: statusRefresh.missingAtMeta,
      targetsRepaired: statusRefresh.targetsRepaired,
      error: statusRefresh.error,
    };

    const mergeHealCounts = (later: {
      adSetsActivated?: number;
      adsActivated?: number;
      campaignsMissingAds?: number;
      error?: string | null;
    }) => ({
      adSetsActivated:
        (earlyHeal.adSetsActivated ?? 0) + (later.adSetsActivated ?? 0),
      adsActivated: (earlyHeal.adsActivated ?? 0) + (later.adsActivated ?? 0),
      campaignsMissingAds: Math.max(
        earlyHeal.campaignsMissingAds ?? 0,
        later.campaignsMissingAds ?? 0,
      ),
      error: later.error || earlyHeal.error || null,
    });

    try {
      const { data: accountRow } = await admin
        .from("platform_accounts")
        .select("marketing_sync_id,marketing_sync_status,marketing_sync_error_code")
        .eq("id", customer.platformAccountId)
        .eq("user_id", customer.userId)
        .maybeSingle();
      let marketingSyncId =
        typeof accountRow?.marketing_sync_id === "string"
          ? accountRow.marketing_sync_id
          : null;

      // Prefer last-good COMPLETE snapshot when Abruf wiped sync_id but history remains.
      if (!marketingSyncId) {
        const { data: snapshot } = await admin
          .from("daily_budget_exposure_snapshots")
          .select("source_marketing_sync_id")
          .eq("platform_account_id", customer.platformAccountId)
          .eq("user_id", customer.userId)
          .eq("status", "COMPLETE")
          .eq("currency", "EUR")
          .not("source_marketing_sync_id", "is", null)
          .order("completed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (typeof snapshot?.source_marketing_sync_id === "string") {
          marketingSyncId = snapshot.source_marketing_sync_id;
        }
      }

      if (marketingSyncId) {
        const forceResume = await forceReactivatePausedOrganicBoostCampaigns({
          platformAccountId: customer.platformAccountId,
          userId: customer.userId,
          marketingSyncId,
          pausedPlatformCampaignIds: statusRefresh.pausedPlatformIds,
        });
        const heal = mergeHealCounts(forceResume);
        hardCapForceResume = {
          outcome: forceResume.outcome,
          reason: forceResume.reason,
          created: forceResume.created,
          existing: forceResume.existing,
          blocked: forceResume.blocked,
          revived: forceResume.revived,
          exposuresCleared: forceResume.exposuresCleared,
          scheduleEnded: forceResume.scheduleEnded,
          candidates: forceResume.candidates,
          linked: forceResume.linked,
          activeLocal: forceResume.activeLocal,
          adsetPausedOnly: forceResume.adsetPausedOnly,
          targetsRepaired: forceResume.targetsRepaired,
          remainingUnder24h: forceResume.remainingUnder24h,
          missingCurrent: forceResume.missingCurrent,
          adSetsActivated: heal.adSetsActivated,
          adsActivated: heal.adsActivated,
          campaignsMissingAds: heal.campaignsMissingAds,
          error: forceResume.error || heal.error,
          statusRefresh: statusRefreshPayload,
        };
      } else if ((statusRefresh.paused ?? 0) === 0) {
        // No campaign-level ACTIVATE — early heal already ran.
        const heal = mergeHealCounts({});
        hardCapForceResume = {
          outcome: "SKIPPED",
          reason:
            (statusRefresh.childDeliveryIncomplete ?? 0) > 0
              ? "child_delivery_incomplete_heal_only"
              : "no_paused_organic_boost",
          created: 0,
          existing: 0,
          blocked: 0,
          revived: 0,
          exposuresCleared: 0,
          scheduleEnded: 0,
          candidates: 0,
          linked: 0,
          activeLocal: 0,
          adsetPausedOnly: statusRefresh.childDeliveryIncomplete ?? 0,
          targetsRepaired: 0,
          remainingUnder24h: 0,
          missingCurrent: 0,
          adSetsActivated: heal.adSetsActivated,
          adsActivated: heal.adsActivated,
          campaignsMissingAds: heal.campaignsMissingAds,
          error: heal.error,
          statusRefresh: statusRefreshPayload,
        };
      } else {
        const syncErr =
          typeof accountRow?.marketing_sync_error_code === "string"
            ? accountRow.marketing_sync_error_code
            : marketingSyncError ?? "marketing_sync_required";
        const heal = mergeHealCounts({});
        hardCapForceResume = {
          outcome: "ERROR",
          reason: "marketing_sync_required",
          created: 0,
          existing: 0,
          blocked: 0,
          revived: 0,
          exposuresCleared: 0,
          scheduleEnded: 0,
          candidates: 0,
          linked: 0,
          activeLocal: 0,
          adsetPausedOnly: 0,
          targetsRepaired: 0,
          remainingUnder24h: 0,
          missingCurrent: 0,
          adSetsActivated: heal.adSetsActivated,
          adsActivated: heal.adsActivated,
          campaignsMissingAds: heal.campaignsMissingAds,
          error: syncErr || heal.error,
          statusRefresh: statusRefreshPayload,
        };
      }
    } catch {
      const heal = mergeHealCounts({});
      hardCapForceResume = {
        outcome: "ERROR",
        reason: "force_resume_exception",
        created: 0,
        existing: 0,
        blocked: 0,
        revived: 0,
        exposuresCleared: 0,
        scheduleEnded: 0,
        candidates: 0,
        linked: 0,
        activeLocal: 0,
        adsetPausedOnly: 0,
        targetsRepaired: 0,
        remainingUnder24h: 0,
        missingCurrent: 0,
        adSetsActivated: heal.adSetsActivated,
        adsActivated: heal.adsActivated,
        campaignsMissingAds: heal.campaignsMissingAds,
        error: "force_resume_exception",
        statusRefresh: statusRefreshPayload,
      };
    }

    try {
      const statusDrain = await drainHardCapStatusExecutionsForAccount({
        platformAccountId: customer.platformAccountId,
        userId: customer.userId,
        maxRuns: 8,
      });
      hardCapStatus = {
        duePlans: statusDrain.duePlans,
        runs: statusDrain.runs,
        succeeded: statusDrain.succeeded,
        failed: statusDrain.failed,
        lastOutcome: statusDrain.lastOutcome,
        lastError: statusDrain.lastError,
      };
    } catch {
      hardCapStatus = {
        duePlans: 0,
        runs: 0,
        succeeded: 0,
        failed: 0,
        lastOutcome: null,
        lastError: "hard_cap_status_drain_exception",
      };
    }

    // 4) Neue LAUNCH_CHAIN-Pläne (falls der Plan-Schritt welche angelegt hat).
    const drain = await drainOrganicBoostExecutionsForAccount({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      maxRuns: 4,
    });

    let diagnose: unknown = null;
    let diagnoseError: string | null = null;
    let deliveryStops: unknown = null;
    let deliveryStopsError: string | null = null;
    if (!skipDiagnose) {
      const { data: diagnoseData, error: diagnoseRpcError } = await admin.rpc(
        "diagnose_meta_organic_boost_write_now",
        {
          p_user_id: customer.userId,
          p_platform_account_id: customer.platformAccountId,
        },
      );
      if (diagnoseRpcError) {
        diagnoseError = diagnoseRpcError.message;
      } else {
        diagnose = diagnoseData;
      }

      const { data: deliveryStopsData, error: deliveryStopsRpcError } =
        await admin.rpc("diagnose_meta_organic_boost_delivery_stops", {
          p_user_id: customer.userId,
          p_platform_account_id: customer.platformAccountId,
        });
      if (deliveryStopsRpcError) {
        deliveryStopsError = deliveryStopsRpcError.message;
      } else {
        deliveryStops = deliveryStopsData;
      }
    }

    // claim_idle is not a hard failure when Meta objects are already live and
    // we refreshed insights.
    const drainLastError =
      drain.lastError === "claim_idle_with_due_plans" &&
      marketingSync?.outcome === "completed" &&
      (marketingSync.status === "success" || marketingSync.status === "partial")
        ? null
        : drain.lastError;

    return controlJson({
      ok: true,
      diagnose,
      diagnoseError,
      deliveryStops,
      deliveryStopsError,
      marketingSync,
      marketingSyncError,
      hardCapForceResume,
      hardCapStatus,
      drain: {
        duePlans: drain.duePlans,
        runs: drain.runs,
        succeeded: drain.succeeded,
        failed: drain.failed,
        lastOutcome: drain.lastOutcome,
        lastError: drainLastError,
        divertedToOtherAccount: drain.divertedToOtherAccount,
        leaseHealed: drain.leaseHealed,
        prepareDetail: drain.prepareDetail,
        preflightOkCount: drain.preflightOkCount,
        killSwitchMode: drain.killSwitchMode,
      },
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
