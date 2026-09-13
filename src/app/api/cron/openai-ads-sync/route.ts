import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/meta/crypto";
import { hasOpenAIAdsEnv } from "@/lib/openai-ads/env";
import { recoverStaleOpenAIAdsLaunchOperations } from "@/lib/openai-ads/launch";
import {
  getDueOpenAIAdsAccountIds,
  OPENAI_ADS_CRON_BATCH_SIZE,
  syncOpenAIAdsAccount,
} from "@/lib/openai-ads/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

export async function GET(request: Request) {
  const secret = cronSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "cron_not_configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const supplied = request.headers.get("authorization") ?? "";
  if (!constantTimeEqual(supplied, `Bearer ${secret}`)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  if (!hasOpenAIAdsEnv()) {
    return NextResponse.json(
      { ok: true, processed: 0, skipped: "connector_not_configured" },
      { headers: NO_STORE_HEADERS },
    );
  }

  try {
    const deadlineAtMs = Date.now() + 110_000;
    const recovery = await recoverStaleOpenAIAdsLaunchOperations(2);
    const ids = await getDueOpenAIAdsAccountIds(OPENAI_ADS_CRON_BATCH_SIZE);
    const counters = { success: 0, error: 0, reconnect_required: 0, blocked: 0 };
    for (const platformAccountId of ids) {
      const result = await syncOpenAIAdsAccount({
        platformAccountId,
        deadlineAtMs,
      });
      counters[result.status] += 1;
    }

    return NextResponse.json(
      { ok: true, processed: ids.length, recovery, results: counters },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "cron_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
