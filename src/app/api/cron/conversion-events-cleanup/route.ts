import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/meta/crypto";
import { getCronAuthEnv } from "@/lib/meta/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Conversions API (erweitert): Protokoll nach 90 Tagen löschen (täglich). */

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

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

  const supplied = request.headers.get("authorization") ?? "";
  if (!constantTimeEqual(supplied, `Bearer ${cronSecret}`)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const { data, error } = await createAdminClient().rpc("meta_conversion_events_cleanup");
  if (error) {
    return NextResponse.json(
      { ok: false, error: "conversion_events_cleanup_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json({ ok: true, result: data }, { headers: NO_STORE_HEADERS });
}
