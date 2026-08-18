import { NextRequest, NextResponse } from "next/server";

import {
  CustomerControlServiceError,
  authenticateMetaCustomer,
} from "@/lib/meta/customer-control-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Soft-delete a customer library creative (status REVOKED).
 * Also revokes Meta crops that reference this asset as parent.
 */
export async function DELETE(request: NextRequest) {
  try {
    const customer = await authenticateMetaCustomer();
    const body = (await request.json().catch(() => null)) as {
      assetId?: unknown;
    } | null;
    const assetId =
      typeof body?.assetId === "string" ? body.assetId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
      return NextResponse.json(
        { ok: false, error: "Ungültige Creative-ID.", code: "invalid_asset" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: asset, error } = await admin
      .from("brand_assets")
      .select("id,status,library_scope,user_id,platform_account_id")
      .eq("id", assetId)
      .maybeSingle();

    if (error || !asset) {
      return NextResponse.json(
        { ok: false, error: "Creative nicht gefunden.", code: "not_found" },
        { status: 404 },
      );
    }

    if (
      asset.library_scope !== "CUSTOMER" ||
      asset.user_id !== customer.userId ||
      asset.platform_account_id !== customer.platformAccountId
    ) {
      return NextResponse.json(
        { ok: false, error: "Kein Zugriff auf dieses Creative.", code: "forbidden" },
        { status: 403 },
      );
    }

    if (asset.status === "REVOKED") {
      return NextResponse.json({ ok: true, assetId, alreadyDeleted: true });
    }

    const idsToRevoke = new Set<string>([assetId]);

    // Best-effort: also remove crops that were generated from this original.
    const { data: children } = await admin
      .from("brand_assets")
      .select("id,metadata,status")
      .eq("user_id", customer.userId)
      .eq("platform_account_id", customer.platformAccountId)
      .eq("library_scope", "CUSTOMER")
      .neq("status", "REVOKED")
      .limit(200);

    for (const child of children ?? []) {
      const meta =
        child.metadata && typeof child.metadata === "object"
          ? (child.metadata as Record<string, unknown>)
          : null;
      if (meta?.parent_asset_id === assetId && typeof child.id === "string") {
        idsToRevoke.add(child.id);
      }
    }

    const revoked: string[] = [];
    for (const id of idsToRevoke) {
      const { data, error: revokeError } = await admin.rpc("revoke_brand_asset", {
        p_user_id: customer.userId,
        p_platform_account_id: customer.platformAccountId,
        p_asset_id: id,
        p_reason: "Media Library: Creative gelöscht",
      });
      if (revokeError) {
        console.error("[media-library-delete]", id, revokeError);
        continue;
      }
      if (data === true) {
        revoked.push(id);
      }
    }

    if (!revoked.includes(assetId)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Creative konnte nicht gelöscht werden.",
          code: "delete_failed",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      assetId,
      revokedAssetIds: revoked,
    });
  } catch (error) {
    if (error instanceof CustomerControlServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[media-library-delete]", error);
    return NextResponse.json(
      { ok: false, error: "Löschen fehlgeschlagen.", code: "delete_failed" },
      { status: 500 },
    );
  }
}
