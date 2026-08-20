import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SelectRequest = {
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

function normalizeAdAccountId(value: string): string {
  return value.trim().replace(/^act_/i, "");
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  let body: SelectRequest;
  try {
    body = (await request.json()) as SelectRequest;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  if (body.confirmation !== "select_meta_ad_account") {
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
    const { data: asset, error: assetError } = await admin
      .from("meta_assets")
      .select("id, platform_account_id, asset_type, meta_asset_id, name")
      .eq("id", body.assetId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (assetError) {
      console.error("[meta-assets] select-ad-account lookup failed", {
        code: assetError.code,
      });
      return json({ error: "select_failed" }, 500);
    }

    if (!asset || asset.asset_type !== "ad_account") {
      return json({ error: "not_found" }, 404);
    }

    const metaAssetId =
      typeof asset.meta_asset_id === "string" ? asset.meta_asset_id.trim() : "";
    if (!metaAssetId) {
      return json({ error: "invalid_asset" }, 400);
    }

    const { data: account, error: accountError } = await admin
      .from("platform_accounts")
      .select("id, marketing_sync_error_code")
      .eq("id", asset.platform_account_id)
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .is("revoked_at", null)
      .maybeSingle();

    if (accountError || !account) {
      return json({ error: "not_found" }, 404);
    }

    const clearSelectionError =
      account.marketing_sync_error_code === "ad_account_selection_required";

    const { error: updateError } = await admin
      .from("platform_accounts")
      .update({
        marketing_meta_ad_account_id: normalizeAdAccountId(metaAssetId),
        ...(clearSelectionError
          ? { marketing_sync_error_code: null }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id)
      .eq("user_id", user.id);

    if (updateError) {
      console.error("[meta-assets] select-ad-account update failed", {
        code: updateError.code,
      });
      return json({ error: "select_failed" }, 500);
    }

    revalidatePath("/dashboard", "page");
    return json({
      ok: true,
      metaAssetId,
      label: asset.name?.trim() || metaAssetId,
    });
  } catch (error) {
    console.error("[meta-assets] select-ad-account crashed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "select_failed" }, 500);
  }
}
