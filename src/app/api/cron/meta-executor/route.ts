import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/meta/crypto";
import { getCronAuthEnv } from "@/lib/meta/env";
import { processNextMetaMutation } from "@/lib/meta/executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  try {
    const result = await processNextMetaMutation(
      `meta-executor-cron:${randomUUID()}`,
    );

    return NextResponse.json(
      {
        ok: true,
        processed: result.processed ? 1 : 0,
        outcome: result.outcome,
        steps: result.stepsProcessed,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "meta_executor_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
