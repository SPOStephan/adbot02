import { NextRequest, NextResponse } from "next/server";

import {
  MediaLibraryError,
  uploadCustomerLibraryImage,
} from "@/lib/media-library/upload";
import {
  CustomerControlServiceError,
  authenticateMetaCustomer,
} from "@/lib/meta/customer-control-service";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const customer = await authenticateMetaCustomer();
    const form = await request.formData();
    const file = form.get("file");
    const brandProfileRaw = String(form.get("brandProfileId") ?? "").trim();
    const brandProfileId = /^[0-9a-f-]{36}$/i.test(brandProfileRaw)
      ? brandProfileRaw
      : null;

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Datei fehlt." },
        { status: 400 },
      );
    }

    // Brand profile is optional for Media Library storage. If the customer
    // picks one, verify it belongs to this Meta account; otherwise store unbound.
    if (brandProfileId) {
      const admin = createAdminClient();
      const { data: profile } = await admin
        .from("brand_profiles")
        .select("id")
        .eq("id", brandProfileId)
        .eq("user_id", customer.userId)
        .eq("platform_account_id", customer.platformAccountId)
        .eq("status", "ACTIVE")
        .maybeSingle();
      if (!profile) {
        return NextResponse.json(
          { ok: false, error: "Gewähltes Brand-Profil nicht gefunden." },
          { status: 404 },
        );
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadCustomerLibraryImage({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      brandProfileId,
      fileName: file.name || "upload.jpg",
      mimeType: file.type || null,
      bytes,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof MediaLibraryError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof CustomerControlServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[asset-upload]", error);
    return NextResponse.json(
      { ok: false, error: "Upload fehlgeschlagen." },
      { status: 500 },
    );
  }
}
