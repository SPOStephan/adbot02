import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { resetStoredMetaAuthorization } from "@/lib/meta/authorization-reset";
import { MetaGraphError } from "@/lib/meta/client";
import { getMetaCallbackEnv } from "@/lib/meta/env";
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

  try {
    const {
      appId,
      appSecret,
      tokenEncryptionKey,
    } = getMetaCallbackEnv();
    const reset = await resetStoredMetaAuthorization({
      userId: user.id,
      appId,
      appSecret,
      tokenEncryptionKey,
    });

    revalidatePath("/dashboard", "page");
    return json({
      ok: true,
      status: reset.hadStoredAuthorization
        ? "disconnected"
        : "already_disconnected",
    });
  } catch (error) {
    console.error("[meta-oauth] Meta konnte nicht vollständig getrennt werden", {
      kind: error instanceof MetaGraphError ? "meta_graph" : "internal",
      code: error instanceof MetaGraphError ? error.code : null,
    });
    return json({ error: "disconnect_failed" }, 500);
  }
}
