import { NextRequest } from "next/server";

import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";
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

    const drain = await drainOrganicBoostExecutionsForAccount({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      maxRuns: 8,
    });

    // Kennzahlen (Ampel + Dashboard-Summe) brauchen Marketing-Abruf — auch wenn
    // der Executor idle ist (Kampagnen schon ACTIVE bei Meta).
    let marketingSync: {
      outcome: string;
      status: string;
      blockedReason: string | null;
      insightsCount: number;
      campaignsCount: number;
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
        retryAt: syncResult.retryAt,
      };
    } catch (error) {
      marketingSyncError =
        error instanceof Error ? error.message : "marketing_sync_failed";
    }

    const admin = createAdminClient();
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
