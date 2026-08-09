import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Short-lived signed preview URL. Customers only for CUSTOMER scope; admins also for vault. */
export async function GET(request: NextRequest) {
  const assetId = request.nextUrl.searchParams.get("assetId")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
    return NextResponse.json({ ok: false, error: "Invalid asset" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: asset, error } = await admin
    .from("brand_assets")
    .select("id,user_id,library_scope,storage_bucket,storage_path")
    .eq("id", assetId)
    .maybeSingle();

  if (error || !asset?.storage_bucket || !asset.storage_path) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const siteAdmin = await isSiteAdmin(user.id);
  const isCustomerOwn =
    asset.library_scope === "CUSTOMER" && asset.user_id === user.id;
  const isVaultAdmin =
    asset.library_scope === "INSPIRATION" && siteAdmin;

  if (!isCustomerOwn && !isVaultAdmin) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const signed = await admin.storage
    .from(String(asset.storage_bucket))
    .createSignedUrl(String(asset.storage_path), 120);

  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json(
      { ok: false, error: "Preview unavailable" },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.data.signedUrl, 302);
}
