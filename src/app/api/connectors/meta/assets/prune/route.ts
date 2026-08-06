import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type PruneRequest = {
  confirmation?: string;
  assetId?: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function isAssetRowId(value: unknown): value is string {
  return (
    typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  let body: PruneRequest;
  try {
    body = (await request.json()) as PruneRequest;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  if (body.confirmation !== "prune_meta_asset") {
    return json({ error: "confirmation_required" }, 400);
  }

  if (!isAssetRowId(body.assetId)) {
    return json({ error: "invalid_asset" }, 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("prune_meta_connection_asset", {
      p_user_id: user.id,
      p_asset_row_id: body.assetId,
    });

    if (error) {
      const message = error.message ?? "";
      if (message.includes("prune_meta_asset_not_found")) {
        return json({ error: "not_found" }, 404);
      }
      if (message.includes("prune_meta_asset_last_of_type")) {
        return json({ error: "last_of_type" }, 409);
      }
      console.error("[meta-assets] prune failed", {
        code: error.code,
      });
      return json({ error: "prune_failed" }, 500);
    }

    revalidatePath("/dashboard", "page");
    return json({
      ok: true,
      result: data,
    });
  } catch (error) {
    console.error("[meta-assets] prune crashed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "prune_failed" }, 500);
  }
}
