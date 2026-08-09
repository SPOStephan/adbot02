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
import { drainOrganicBoostExecutionsForAccount } from "@/lib/meta/organic-boost-execute";
import { syncMetaConnector } from "@/lib/meta/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    await readControlJson(request);
    const customer = await authenticateMetaCustomer();
    const admin = createAdminClient();

    // 1) Marketing-Abruf zuerst: lokaler Kampagnenstatus muss Meta (PAUSED) spiegeln,
    // bevor Force-Reaktivierung läuft.
    let marketingSync: {
      outcome: string;
      status: string;
      blockedReason: string | null;
      insightsCount: number;
      campaignsCount: number;
      spendTotal: number;
      insightsUntil: string | null;
      retryAt: string | null;
    } | null = null;
    let marketingSyncError: string | null = null;
    try {
      const syncResult = await syncMetaConnector({
        platformAccountId: customer.platformAccountId,
        userId: customer.userId,
        mode: "manual",
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
      };
    } catch (error) {
      marketingSyncError =
        error instanceof Error ? error.message : "marketing_sync_failed";
    }

    // 2) Alle aktuellen PAUSED Beitrag-Push-Kampagnen mit Restlaufzeit reaktivieren.
    let hardCapForceResume: {
      outcome: string;
      created: number;
      existing: number;
      blocked: number;
      revived: number;
      exposuresCleared: number;
      scheduleEnded: number;
      candidates: number;
      error: string | null;
    } | null = null;
    let hardCapStatus: {
      duePlans: number;
      runs: number;
      succeeded: number;
      failed: number;
      lastOutcome: string | null;
      lastError: string | null;
    } | null = null;

    try {
      const { data: accountRow } = await admin
        .from("platform_accounts")
        .select("marketing_sync_id")
        .eq("id", customer.platformAccountId)
        .eq("user_id", customer.userId)
        .maybeSingle();
      const marketingSyncId =
        typeof accountRow?.marketing_sync_id === "string"
          ? accountRow.marketing_sync_id
          : null;

      if (marketingSyncId) {
        const forceResume = await forceReactivatePausedOrganicBoostCampaigns({
          platformAccountId: customer.platformAccountId,
          userId: customer.userId,
          marketingSyncId,
        });
        hardCapForceResume = {
          outcome: forceResume.outcome,
          created: forceResume.created,
          existing: forceResume.existing,
          blocked: forceResume.blocked,
          revived: forceResume.revived,
          exposuresCleared: forceResume.exposuresCleared,
          scheduleEnded: forceResume.scheduleEnded,
          candidates: forceResume.candidates,
          error: forceResume.error,
        };
      } else {
        hardCapForceResume = {
          outcome: "ERROR",
          created: 0,
          existing: 0,
          blocked: 0,
          revived: 0,
          exposuresCleared: 0,
          scheduleEnded: 0,
          candidates: 0,
          error: "marketing_sync_required",
        };
      }
    } catch {
      hardCapForceResume = {
        outcome: "ERROR",
        created: 0,
        existing: 0,
        blocked: 0,
        revived: 0,
        exposuresCleared: 0,
        scheduleEnded: 0,
        candidates: 0,
        error: "force_resume_exception",
      };
    }

    try {
      const statusDrain = await drainHardCapStatusExecutionsForAccount({
        platformAccountId: customer.platformAccountId,
        userId: customer.userId,
        maxRuns: 20,
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

    // 3) Neue LAUNCH_CHAIN-Pläne (falls der Plan-Schritt welche angelegt hat).
    const drain = await drainOrganicBoostExecutionsForAccount({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      maxRuns: 8,
    });

    let diagnose: unknown = null;
    let diagnoseError: string | null = null;
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
