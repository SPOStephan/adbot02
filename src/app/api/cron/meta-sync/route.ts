import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/meta/crypto";
import { getMetaCronEnv } from "@/lib/meta/env";
import {
  getDueMetaConnectorIds,
  META_CRON_BATCH_SIZE,
  syncMetaConnector,
} from "@/lib/meta/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function authorized(request: Request, cronSecret: string): boolean {
  const supplied = request.headers.get("authorization") ?? "";
  return constantTimeEqual(supplied, `Bearer ${cronSecret}`);
}

export async function GET(request: Request) {
  let env: ReturnType<typeof getMetaCronEnv>;

  try {
    env = getMetaCronEnv();
  } catch {
    return NextResponse.json(
      { ok: false, error: "cron_not_configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  if (!authorized(request, env.cronSecret)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const connectorIds = await getDueMetaConnectorIds(META_CRON_BATCH_SIZE);
    const counters: Record<string, number> = {
      success: 0,
      partial: 0,
      error: 0,
      rate_limited: 0,
      reconnect_required: 0,
      blocked: 0,
    };

    for (const platformAccountId of connectorIds) {
      const result = await syncMetaConnector({
        platformAccountId,
        mode: "cron",
      });
      counters[result.status] = (counters[result.status] ?? 0) + 1;
    }

    return NextResponse.json(
      {
        ok: true,
        processed: connectorIds.length,
        results: counters,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "cron_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
