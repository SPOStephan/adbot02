import { NextRequest, NextResponse } from "next/server";

import { processFunnelCreativeHandoff } from "@/lib/funnel-creative-handoff-service";
import { verifyFunnelCreativeHandoffToken } from "@/lib/funnel-creative-handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const payload = verifyFunnelCreativeHandoffToken(
    typeof body.token === "string" ? body.token : "",
  );
  if (!payload) {
    return json({ ok: false, message: "Funnel-Creative-Token ungültig." }, 401);
  }
  const result = await processFunnelCreativeHandoff(payload);
  return json({ ok: true, ...result });
}
