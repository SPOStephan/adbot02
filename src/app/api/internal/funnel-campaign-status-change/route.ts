import { NextRequest, NextResponse } from "next/server";

import { parseCampaignStatusChangeRequest } from "@/lib/meta/campaign-status-change";
import { changeMetaCampaignStatus } from "@/lib/meta/campaign-status-service";
import { CustomerControlServiceError } from "@/lib/meta/customer-control-service";
import {
  FUNNEL_CAMPAIGN_STATUS_CHANGE_PURPOSE,
  verifyFunnelCampaignStatusToken,
} from "@/lib/funnel-campaign-status-token";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Pause/Fortsetzen from the Adbot Funnel "Kampagnen" page. The Funnel signs a
 * short-lived token for its tenant owner; the change then runs through the
 * same queue and executor gates as the button in the Adbot dashboard.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const token = typeof body.token === "string" ? body.token : "";
  let payload;
  try {
    payload = verifyFunnelCampaignStatusToken(
      token,
      Date.now(),
      FUNNEL_CAMPAIGN_STATUS_CHANGE_PURPOSE,
    );
  } catch {
    payload = null;
  }
  if (!payload) {
    return json({ ok: false, message: "Token ungültig oder abgelaufen." }, 401);
  }

  const input = parseCampaignStatusChangeRequest({
    platformCampaignId: body.platformCampaignId,
    status: body.status,
  });
  if (!input) {
    return json({ ok: false, message: "Kampagne oder Status sind ungültig." }, 400);
  }

  const admin = createAdminClient();
  const { data: campaign } = await admin
    .from("campaigns")
    .select("platform_account_id")
    .eq("user_id", payload.sub)
    .eq("platform_campaign_id", input.platformCampaignId)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  const platformAccountId =
    typeof campaign?.platform_account_id === "string" ? campaign.platform_account_id : null;
  if (!platformAccountId) {
    return json({ ok: false, message: "Die Kampagne wurde nicht gefunden." }, 404);
  }
  const { data: account } = await admin
    .from("platform_accounts")
    .select("meta_scopes")
    .eq("id", platformAccountId)
    .eq("user_id", payload.sub)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .maybeSingle();
  if (!account) {
    return json({ ok: false, message: "Das Meta-Konto ist nicht mehr verbunden." }, 409);
  }

  try {
    const result = await changeMetaCampaignStatus(
      {
        userId: payload.sub,
        platformAccountId,
        accountName: null,
        currency: null,
        marketingSyncId: null,
        writeScopeGranted:
          Array.isArray(account.meta_scopes) && account.meta_scopes.includes("ads_management"),
      },
      input,
    );
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CustomerControlServiceError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    console.error("[funnel-campaign-status-change] failed", error);
    return json({ ok: false, message: "Die Statusänderung ist fehlgeschlagen." }, 500);
  }
}
