import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/meta/crypto";
import { getCronAuthEnv } from "@/lib/meta/env";
import { runOrganicBoostDeliveryWatchdog } from "@/lib/meta/organic-boost-delivery-watchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Keep short — watchdog must never become a heavy Abruf. */
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function authorized(request: Request, cronSecret: string): boolean {
  const supplied = request.headers.get("authorization") ?? "";
  return constantTimeEqual(supplied, `Bearer ${cronSecret}`);
}

/**
 * Conservative Beitrag-Push delivery watchdog.
 * Only heals locally incomplete live trees; respects FREEZE; rate-limit aborts.
 */
export async function GET(request: Request) {
  let cronSecret: string;
  try {
    ({ cronSecret } = getCronAuthEnv());
  } catch {
    return NextResponse.json(
      { ok: false, error: "cron_not_configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (!authorized(request, cronSecret)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await runOrganicBoostDeliveryWatchdog({
      maxAccounts: 2,
      maxCampaignsPerAccount: 2,
    });

    return NextResponse.json(
      {
        ok: true,
        enabled: result.enabled,
        accountsConsidered: result.accountsConsidered,
        accountsHealed: result.accountsHealed,
        accountsSkipped: result.accountsSkipped,
        rateLimited: result.results.some((row) => row.rateLimited),
        writes:
          result.results.reduce(
            (sum, row) =>
              sum +
              row.adSetsActivated +
              row.adsActivated +
              row.adsCreated +
              row.adSetsCreated,
            0,
          ),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "organic_boost_delivery_watchdog_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
