import { NextRequest, NextResponse } from "next/server";

import {
  CustomerControlServiceError,
  authenticateMetaCustomer,
} from "@/lib/meta/customer-control-service";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Toggle LOCKED_PHOTO ↔ UPLOAD_EDITABLE via Phase 4 RPC.
 */
export async function POST(request: NextRequest) {
  try {
    await authenticateMetaCustomer();
    const body = (await request.json().catch(() => null)) as {
      assetId?: unknown;
      locked?: unknown;
    } | null;

    const assetId =
      typeof body?.assetId === "string" ? body.assetId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
      return NextResponse.json(
        { ok: false, error: "Ungültige Creative-ID.", code: "invalid_asset" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (typeof body?.locked !== "boolean") {
      return NextResponse.json(
        {
          ok: false,
          error: "locked muss true oder false sein.",
          code: "invalid_locked",
        },
        { status: 400, headers: NO_STORE },
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "set_brand_asset_locked_photo_role",
      {
        p_asset_id: assetId,
        p_locked: body.locked,
      },
    );

    if (error || data !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            error?.message?.includes("Only READY")
              ? "Nur freigegebene Creatives können als Locked Photo markiert werden."
              : error?.message?.includes("Only UPLOAD_EDITABLE")
                ? "KI-Ergebnisse und Style-Referenzen können nicht gelockt werden."
                : "Locked-Photo-Status konnte nicht gespeichert werden.",
          code: "rpc_failed",
        },
        { status: 400, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        assetId,
        assetRole: body.locked ? "LOCKED_PHOTO" : "UPLOAD_EDITABLE",
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof CustomerControlServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Locked-Photo-Status konnte nicht gespeichert werden.",
        code: "lock_failed",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
