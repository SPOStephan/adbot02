import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { hasCreativeAssetProviderConfig } from "@/lib/creative-assets/env";
import { processNextCreativeAssetJob } from "@/lib/creative-assets/worker";
import { constantTimeEqual } from "@/lib/meta/crypto";
import { getCronAuthEnv } from "@/lib/meta/env";

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

  if (!hasCreativeAssetProviderConfig()) {
    return NextResponse.json(
      { ok: false, error: "creative_provider_not_configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const result = await processNextCreativeAssetJob({
      ownerId: `creative-cron:${randomUUID()}`,
      signal: AbortSignal.timeout(150_000),
    });

    return NextResponse.json(
      {
        ok: true,
        processed: result.outcome === "idle" ? 0 : 1,
        result: result.status,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "creative_worker_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
