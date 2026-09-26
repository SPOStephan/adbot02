import { NextRequest, NextResponse } from "next/server";

import { parseCampaignGeoTarget } from "@/lib/campaign-geo/adapters";
import {
  clearCustomerCampaignGeo,
  loadCustomerCampaignGeo,
  saveCustomerCampaignGeo,
} from "@/lib/campaign-geo/service";
import {
  isDashboardSameOriginReadRequest,
  isDashboardSameOriginRequest,
} from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
};

async function requireUser(request: NextRequest, write: boolean) {
  if (write ? !isDashboardSameOriginRequest(request) : !isDashboardSameOriginReadRequest(request)) {
    return { error: NextResponse.json({ ok: false, message: "Die Anfrage konnte nicht bestätigt werden." }, { status: 403, headers: NO_STORE }) };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ ok: false, message: "Bitte zuerst anmelden." }, { status: 401, headers: NO_STORE }) };
  }
  return { supabase, user };
}

export async function GET(request: NextRequest) {
  const loaded = await requireUser(request, false);
  if ("error" in loaded && loaded.error) return loaded.error;
  const geo = await loadCustomerCampaignGeo(loaded.supabase!, loaded.user!.id);
  return NextResponse.json({ ok: true, geo }, { headers: NO_STORE });
}

export async function PUT(request: NextRequest) {
  const loaded = await requireUser(request, true);
  if ("error" in loaded && loaded.error) return loaded.error;
  const body = (await request.json().catch(() => null)) as { geo?: unknown; clear?: boolean } | null;
  if (body?.clear) {
    await clearCustomerCampaignGeo(loaded.supabase!, loaded.user!.id);
    return NextResponse.json({ ok: true, geo: null }, { headers: NO_STORE });
  }
  const geo = parseCampaignGeoTarget(body?.geo);
  if (!geo) {
    return NextResponse.json(
      { ok: false, message: "Bitte einen gültigen Ort wählen. Radius 1–80 km ist optional." },
      { status: 400, headers: NO_STORE },
    );
  }
  const saved = await saveCustomerCampaignGeo(loaded.supabase!, loaded.user!.id, geo);
  return NextResponse.json({ ok: true, geo: saved }, { headers: NO_STORE });
}
