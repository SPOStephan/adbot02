import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { refreshMarketingSnapshotForAccount } from "@/lib/meta/launch-marketing-ensure";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

    const selectedNorm = normalizeAdAccountId(metaAssetId);

    const { data: account, error: accountError } = await admin
      .from("platform_accounts")
      .select("id, marketing_meta_ad_account_id, marketing_sync_error_code")
      .eq("id", asset.platform_account_id)
      .eq("user_id", user.id)
      .eq("platform", "meta")
      .is("revoked_at", null)
      .maybeSingle();

    if (accountError || !account) {
      return json({ error: "not_found" }, 404);
    }

    const previousNorm = normalizeAdAccountId(
      typeof account.marketing_meta_ad_account_id === "string"
        ? account.marketing_meta_ad_account_id
        : "",
    );
    const switchedAccount =
      previousNorm.length > 0 && previousNorm !== selectedNorm;

    if (switchedAccount) {
      const now = new Date().toISOString();
      await Promise.all([
        admin
          .from("campaigns")
          .update({ is_current: false, updated_at: now })
          .eq("platform_account_id", account.id),
        admin
          .from("ad_groups")
          .update({ is_current: false, updated_at: now })
          .eq("platform_account_id", account.id),
        admin
          .from("ads")
          .update({ is_current: false, updated_at: now })
          .eq("platform_account_id", account.id),
        admin
          .from("creatives")
          .update({ is_current: false, updated_at: now })
          .eq("platform_account_id", account.id)
          .eq("source", "meta"),
      ]);
    }

    const { error: updateError } = await admin
      .from("platform_accounts")
      .update({
        marketing_meta_ad_account_id: selectedNorm,
        marketing_sync_status: "syncing",
        marketing_sync_error_code: null,
        marketing_last_sync_started_at: new Date().toISOString(),
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

    const marketingSync = await refreshMarketingSnapshotForAccount({
      userId: user.id,
      platformAccountId: account.id,
      ownerPrefix: "ad-account-select",
    });

    if (!marketingSync.ok) {
      await admin
        .from("platform_accounts")
        .update({
          marketing_sync_status: "error",
          marketing_sync_error_code: marketingSync.error,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id)
        .eq("user_id", user.id);
    }

    revalidatePath("/dashboard", "page");
    return json({
      ok: true,
      metaAssetId,
      label: asset.name?.trim() || metaAssetId,
      marketingSync: marketingSync.ok
        ? { status: "success", syncId: marketingSync.syncId }
        : { status: "error", error: marketingSync.error },
    });
  } catch (error) {
    console.error("[meta-assets] select-ad-account crashed", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "select_failed" }, 500);
  }
}
