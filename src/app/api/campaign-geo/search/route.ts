import { NextRequest, NextResponse } from "next/server";

import { searchCampaignGeoPlaces } from "@/lib/campaign-geo/nominatim";
import { isDashboardSameOriginReadRequest } from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
};

export async function GET(request: NextRequest) {
  if (!isDashboardSameOriginReadRequest(request)) {
    return NextResponse.json({ ok: false, message: "Die Anfrage konnte nicht bestätigt werden." }, { status: 403, headers: NO_STORE });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Bitte zuerst anmelden." }, { status: 401, headers: NO_STORE });
  }
  const query = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const hits = await searchCampaignGeoPlaces(query);
    return NextResponse.json({ ok: true, hits }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Ortssuche fehlgeschlagen." },
      { status: 502, headers: NO_STORE },
    );
  }
}
