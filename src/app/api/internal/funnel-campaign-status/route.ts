import { NextRequest, NextResponse } from "next/server";

import { verifyFunnelCampaignStatusToken } from "@/lib/funnel-campaign-status-token";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

type FunnelCampaignStatus = {
  leadActive: boolean;
  trafficActive: boolean;
  updatedAt: string | null;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function normalizeDestinationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: unknown;
    destinationUrls?: unknown;
  };
  const token = typeof body.token === "string" ? body.token : "";
  let payload;
  try {
    payload = verifyFunnelCampaignStatusToken(token);
  } catch {
    payload = null;
  }
  if (!payload) return json({ ok: false, message: "Status-Token ungültig oder abgelaufen." }, 401);

  const requestedUrls = Array.isArray(body.destinationUrls)
    ? body.destinationUrls
        .filter((value): value is string => typeof value === "string")
        .slice(0, 100)
        .map((value) => ({ original: value, normalized: normalizeDestinationUrl(value) }))
        .filter((value): value is { original: string; normalized: string } => Boolean(value.normalized))
    : [];
  if (requestedUrls.length === 0) return json({ ok: true, statuses: {} });

  const admin = createAdminClient();
  const { data: planRows, error: planError } = await admin
    .from("mutation_plans")
    .select("id,planned_payload,updated_at")
    .eq("user_id", payload.sub)
    .eq("source_rule_key", "active-launch-chain")
    .eq("status", "SUCCEEDED")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (planError) return json({ ok: false, message: "Kampagnenstatus konnte nicht geladen werden." }, 500);

  const relevantPlans = (planRows ?? []).flatMap((row) => {
    const planned = row.planned_payload;
    if (!planned || typeof planned !== "object" || Array.isArray(planned)) return [];
    const value = planned as Record<string, unknown>;
    const destinationUrl = typeof value.destination_url === "string"
      ? normalizeDestinationUrl(value.destination_url)
      : null;
    const objective = typeof value.objective === "string" ? value.objective : "";
    if (!destinationUrl || (objective !== "OUTCOME_LEADS" && objective !== "OUTCOME_TRAFFIC")) return [];
    return [{ id: String(row.id), destinationUrl, objective, updatedAt: String(row.updated_at ?? "") }];
  });

  const planIds = relevantPlans.map((plan) => plan.id);
  const activePlanIds = new Set<string>();
  if (planIds.length > 0) {
    const { data: bindings, error: bindingsError } = await admin
      .from("remote_object_bindings")
      .select("plan_id,local_campaign_id")
      .eq("user_id", payload.sub)
      .eq("object_type", "CAMPAIGN")
      .in("plan_id", planIds)
      .not("local_campaign_id", "is", null)
      .limit(500);
    if (bindingsError) return json({ ok: false, message: "Kampagnenstatus konnte nicht geladen werden." }, 500);
    const campaignIds = Array.from(
      new Set((bindings ?? []).map((row) => String(row.local_campaign_id ?? "")).filter(Boolean)),
    );
    const activeCampaignIds = new Set<string>();
    if (campaignIds.length > 0) {
      const { data: campaigns, error: campaignsError } = await admin
        .from("campaigns")
        .select("id,status,effective_status")
        .eq("user_id", payload.sub)
        .in("id", campaignIds)
        .eq("is_current", true)
        .limit(500);
      if (campaignsError) return json({ ok: false, message: "Kampagnenstatus konnte nicht geladen werden." }, 500);
      for (const campaign of campaigns ?? []) {
        if (campaign.status === "ACTIVE" && campaign.effective_status === "ACTIVE") {
          activeCampaignIds.add(String(campaign.id));
        }
      }
    }
    for (const binding of bindings ?? []) {
      if (activeCampaignIds.has(String(binding.local_campaign_id ?? ""))) {
        activePlanIds.add(String(binding.plan_id));
      }
    }
  }

  const statuses: Record<string, FunnelCampaignStatus> = {};
  for (const requested of requestedUrls) {
    const status: FunnelCampaignStatus = {
      leadActive: false,
      trafficActive: false,
      updatedAt: null,
    };
    for (const plan of relevantPlans) {
      if (plan.destinationUrl !== requested.normalized || !activePlanIds.has(plan.id)) continue;
      if (plan.objective === "OUTCOME_LEADS") status.leadActive = true;
      if (plan.objective === "OUTCOME_TRAFFIC") status.trafficActive = true;
      if (!status.updatedAt || plan.updatedAt > status.updatedAt) status.updatedAt = plan.updatedAt;
    }
    statuses[requested.original] = status;
  }
  return json({ ok: true, statuses });
}
