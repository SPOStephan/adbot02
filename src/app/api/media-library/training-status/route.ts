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
 * Mark / clear training_status (marked_good | none) via Phase 1 RPC.
 */
export async function POST(request: NextRequest) {
  try {
    await authenticateMetaCustomer();
    const body = (await request.json().catch(() => null)) as {
      assetId?: unknown;
      trainingStatus?: unknown;
    } | null;

    const assetId =
      typeof body?.assetId === "string" ? body.assetId.trim() : "";
    const trainingStatus =
      typeof body?.trainingStatus === "string"
        ? body.trainingStatus.trim().toLowerCase()
        : "";

    if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
      return NextResponse.json(
        { ok: false, error: "Ungültige Creative-ID.", code: "invalid_asset" },
        { status: 400, headers: NO_STORE },
      );
    }
    if (trainingStatus !== "marked_good" && trainingStatus !== "none") {
      return NextResponse.json(
        {
          ok: false,
          error: "trainingStatus muss marked_good oder none sein.",
          code: "invalid_status",
        },
        { status: 400, headers: NO_STORE },
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "mark_brand_asset_training_status",
      {
        p_asset_id: assetId,
        p_training_status: trainingStatus,
      },
    );

    if (error || data !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "Training-Status konnte nicht gespeichert werden.",
          code: "rpc_failed",
        },
        { status: 400, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { ok: true, assetId, trainingStatus },
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
        error: "Training-Status konnte nicht gespeichert werden.",
        code: "mark_failed",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
