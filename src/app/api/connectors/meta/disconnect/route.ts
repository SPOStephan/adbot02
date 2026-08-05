import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type DisconnectRequest = {
  confirmation?: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  let body: DisconnectRequest;
  try {
    body = (await request.json()) as DisconnectRequest;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  if (body.confirmation !== "disconnect_meta") {
    return json({ error: "confirmation_required" }, 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createAdminClient();
  const { data: activeAccount, error: readError } = await admin
    .from("platform_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .maybeSingle();

  if (readError) {
    console.error("[meta-oauth] Aktive Verbindung konnte vor dem Trennen nicht gelesen werden");
    return json({ error: "disconnect_failed" }, 500);
  }

  if (!activeAccount) {
    revalidatePath("/dashboard", "page");
    return json({ ok: true, status: "already_disconnected" });
  }

  const disconnectedAt = new Date().toISOString();
  const { data: disconnectedAccount, error: updateError } = await admin
    .from("platform_accounts")
    .update({
      revoked_at: disconnectedAt,
      access_token: null,
      refresh_token: null,
      access_token_encrypted: null,
      token_iv: null,
      token_auth_tag: null,
      expires_at: null,
      refresh_at: null,
      data_access_expires_at: null,
      sync_lock_until: null,
      sync_backoff_until: null,
      sync_status: "reconnect_required",
      sync_error_code: "customer_disconnected",
      updated_at: disconnectedAt,
    })
    .eq("id", activeAccount.id)
    .eq("user_id", user.id)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (updateError || !disconnectedAccount) {
    console.error("[meta-oauth] Meta-Verbindung konnte nicht sicher getrennt werden");
    return json({ error: "disconnect_failed" }, 500);
  }

  revalidatePath("/dashboard", "page");
  return json({ ok: true, status: "disconnected" });
}
