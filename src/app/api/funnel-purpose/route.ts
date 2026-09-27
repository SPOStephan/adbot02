import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticatedUserId } from "@/lib/custom-domains/service";
import { resolvePublicFunnelPurposeHint } from "@/lib/funnel-purpose-hints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: NextRequest) {
  try {
    await requireAuthenticatedUserId();
  } catch {
    return NextResponse.json({ ok: false, hint: null }, { status: 401, headers: HEADERS });
  }
  const destinationUrl = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  if (!destinationUrl || destinationUrl.length > 2_000) {
    return NextResponse.json({ ok: false, hint: null }, { status: 400, headers: HEADERS });
  }

  const hint = await resolvePublicFunnelPurposeHint(destinationUrl).catch(() => null);
  return NextResponse.json({ ok: true, hint }, { headers: HEADERS });
}
