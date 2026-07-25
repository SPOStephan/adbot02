import { NextResponse } from "next/server";

import { parseMetaSignedRequest } from "@/lib/meta/crypto";
import { getMetaWebhookEnv } from "@/lib/meta/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  let signedRequest: FormDataEntryValue | null = null;

  try {
    const formData = await request.formData();
    signedRequest = formData.get("signed_request");
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  if (typeof signedRequest !== "string") {
    return json({ error: "missing_signed_request" }, 400);
  }

  try {
    const { appSecret } = getMetaWebhookEnv();
    const payload = parseMetaSignedRequest(signedRequest, appSecret);

    if (!payload) {
      return json({ error: "invalid_signature" }, 400);
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("platform_accounts")
      .delete()
      .eq("platform", "meta")
      .eq("meta_user_id", payload.user_id);

    if (error) {
      console.error("[meta-oauth] Deautorisierung konnte nicht gespeichert werden");
      return json({ error: "deauthorization_failed" }, 500);
    }

    return json({ success: true });
  } catch {
    console.error("[meta-oauth] Deautorisierung konnte nicht verarbeitet werden");
    return json({ error: "deauthorization_failed" }, 500);
  }
}
