import { NextRequest } from "next/server";

import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";
import { drainOrganicBoostExecutionsForAccount } from "@/lib/meta/organic-boost-execute";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    await readControlJson(request);
    const customer = await authenticateMetaCustomer();

    // Drain first: diagnose used to claim a WRITE lease before drain and could
    // leave lease_idle=false → claim_idle despite preflight_ok.
    const drain = await drainOrganicBoostExecutionsForAccount({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      maxRuns: 8,
    });

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

    return controlJson({
      ok: true,
      diagnose,
      diagnoseError,
      drain: {
        duePlans: drain.duePlans,
        runs: drain.runs,
        succeeded: drain.succeeded,
        failed: drain.failed,
        lastOutcome: drain.lastOutcome,
        lastError: drain.lastError,
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
