import { NextRequest, NextResponse } from "next/server";

import { loadCampaignAdOverview } from "@/lib/dashboard/load-campaign-ad-overview";
import { filterFunnelCampaigns } from "@/lib/meta/campaign-ad-overview";
import {
  FUNNEL_CAMPAIGN_OVERVIEW_PURPOSE,
  verifyFunnelCampaignStatusToken,
} from "@/lib/funnel-campaign-status-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Read-only campaign and ad overview for the Adbot Funnel customer area.
 * Returns only Lead/Funnel and Traffic campaigns whose Adbot launch plan
 * promotes one of the funnel URLs the caller sent; everything else stays
 * invisible there.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: unknown;
    funnelUrls?: unknown;
  };
  const token = typeof body.token === "string" ? body.token : "";
  let payload;
  try {
    payload = verifyFunnelCampaignStatusToken(
      token,
      Date.now(),
      FUNNEL_CAMPAIGN_OVERVIEW_PURPOSE,
    );
  } catch {
    payload = null;
  }
  if (!payload) {
    return json({ ok: false, message: "Token ungültig oder abgelaufen." }, 401);
  }

  const funnelUrls = Array.isArray(body.funnelUrls)
    ? body.funnelUrls
        .filter((value): value is string => typeof value === "string")
        .slice(0, 100)
    : [];
  if (funnelUrls.length === 0) {
    return json({ ok: true, advertiserName: null, campaigns: [] });
  }

  const overview = await loadCampaignAdOverview({
    userId: payload.sub,
    imageMode: "signed",
  });
  if (overview.error) {
    return json({ ok: false, message: "Kampagnen konnten nicht geladen werden." }, 500);
  }

  return json({
    ok: true,
    advertiserName: overview.advertiserName,
    campaigns: filterFunnelCampaigns(overview.items, funnelUrls),
  });
}
