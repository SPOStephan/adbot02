import { NextRequest } from "next/server";

import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  planCustomerOrganicBoost,
} from "@/lib/meta/customer-control-service";
import { syncMetaConnector } from "@/lib/meta/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    // Origin/CSRF gate; body may be empty object.
    await readControlJson(request);
    const customer = await authenticateMetaCustomer();

    // Marketing readiness (EUR / sync_id / last_success) is required before
    // planning. Asset reconnect can clear those fields — heal first, then plan.
    let marketingSync: {
      outcome: string;
      status: string;
      blockedReason: string | null;
      insightsCount: number;
      spendTotal: number;
      insightsUntil: string | null;
      marketingStatus: string;
    } | null = null;
    let marketingSyncError: string | null = null;
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
        spendTotal: syncResult.spendTotal,
        insightsUntil: syncResult.insightsUntil,
        marketingStatus: syncResult.marketingStatus,
      };
    } catch (error) {
      marketingSyncError =
        error instanceof Error ? error.message : "marketing_sync_failed";
    }

    const organicBoost = await planCustomerOrganicBoost(customer);

    return controlJson({
      ok: true,
      marketingSync,
      marketingSyncError,
      organicBoost: {
        status: organicBoost.status,
        plansCreated: organicBoost.plansCreated,
        plansExisting: organicBoost.plansExisting,
        candidatesFailed: organicBoost.candidatesFailed,
        candidatesSkipped: organicBoost.candidatesSkipped,
        candidatesConsidered: organicBoost.candidatesConsidered,
        lastError: organicBoost.lastError,
        executorRuns: organicBoost.executorRuns,
        executorSucceeded: organicBoost.executorSucceeded,
        executorFailed: organicBoost.executorFailed,
        executorLastOutcome: organicBoost.executorLastOutcome,
        executorLastError: organicBoost.executorLastError,
        prepareDetail: organicBoost.prepareDetail,
        duePlans: organicBoost.duePlans,
        candidateDiagnosis: organicBoost.candidateDiagnosis,
      },
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
