import { NextRequest, NextResponse } from "next/server";

import {
  loadConnectionCapiCredentials,
  sendConnectionCapiEvent,
} from "@/lib/meta/connection-capi";
import { connectionCapiCustomerMessage } from "@/lib/meta/conversions-api";
import { verifyFunnelCapiRelayToken } from "@/lib/funnel-capi-relay";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function optionalTestEventCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(text)) return undefined;
  return text;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: string;
    event?: Record<string, unknown>;
    testEventCode?: string;
  };
  const token = typeof body.token === "string" ? body.token : "";
  const payload = verifyFunnelCapiRelayToken(token);
  if (!payload) {
    return json(
      { ok: false, message: "CAPI-Relay-Token ungültig oder abgelaufen." },
      401,
    );
  }

  const event =
    body.event && typeof body.event === "object" && !Array.isArray(body.event)
      ? body.event
      : null;
  if (!event) {
    return json({ ok: false, message: "CAPI-Ereignis fehlt." }, 400);
  }

  const eventName =
    typeof event.event_name === "string" ? event.event_name : "";
  const eventId = typeof event.event_id === "string" ? event.event_id : "";
  if (eventName !== payload.eventName || eventId !== payload.eventId) {
    return json(
      { ok: false, message: "CAPI-Ereignis passt nicht zum Relay-Token." },
      400,
    );
  }

  const admin = createAdminClient();
  const { data: pixels, error } = await admin
    .from("meta_confirmed_pixels")
    .select("pixel_id,platform_account_id,capi_via_connection,capi_probe_status")
    .eq("user_id", payload.sub)
    .eq("status", "CONFIRMED")
    .is("revoked_at", null);

  if (error) {
    console.error("[funnel-capi] confirmed pixels lookup failed");
    return json({ ok: false, message: "Pixel-Bindung nicht lesbar." }, 500);
  }

  const confirmed = (pixels ?? []).filter((row) =>
    /^\d{5,25}$/.test(String(row.pixel_id ?? "")),
  );
  const matching = confirmed.find((row) => row.pixel_id === payload.pixelId);
  if (!matching) {
    return json(
      {
        ok: false,
        reason: "pixel_not_confirmed",
        message:
          "Für dieses Konto ist kein passendes Pixel über die Meta-Verbindung bestätigt.",
      },
      409,
    );
  }

  const { data: account } = await admin
    .from("platform_accounts")
    .select("id")
    .eq("id", matching.platform_account_id)
    .eq("user_id", payload.sub)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .maybeSingle();

  if (!account) {
    return json(
      {
        ok: false,
        reason: "meta_not_connected",
        message: "Die Meta-Verbindung fehlt. Bitte Meta erneut verbinden.",
      },
      409,
    );
  }

  const credentials = await loadConnectionCapiCredentials({
    userId: payload.sub,
    platformAccountId: account.id,
  });
  if ("ok" in credentials && credentials.ok === false) {
    return json(
      { ok: false, reason: credentials.error, message: credentials.message },
      409,
    );
  }

  const sent = await sendConnectionCapiEvent({
    credentials,
    pixelId: payload.pixelId,
    event,
    testEventCode: optionalTestEventCode(body.testEventCode),
  });

  if (sent.status !== "sent") {
    return json(
      {
        ok: false,
        reason: "capi_denied",
        message: connectionCapiCustomerMessage("denied"),
        eventsReceived: sent.eventsReceived,
        attempts: sent.attempts,
      },
      409,
    );
  }

  return json({
    ok: true,
    source: "meta_connection",
    eventsReceived: sent.eventsReceived,
    attempts: sent.attempts,
  });
}
