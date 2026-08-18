import { NextRequest, NextResponse } from "next/server";

import { isMetaFormatKey } from "@/lib/media-library/meta-formats";
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
export const maxDuration = 60;

function asUploadFile(value: FormDataEntryValue | null): File | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  if (typeof File !== "undefined" && value instanceof File) {
    return value.size > 0 ? value : null;
  }
  // Some runtimes expose Blob-like upload parts without a File prototype.
  const candidate = value as Partial<File>;
  if (
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.size === "number" &&
    candidate.size > 0
  ) {
    return candidate as File;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const customer = await authenticateMetaCustomer();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Upload-Body konnte nicht gelesen werden. Datei ggf. zu groß oder Anfrage abgebrochen.",
          code: "invalid_form_data",
        },
        { status: 400 },
      );
    }

    const file = asUploadFile(form.get("file"));
    const brandProfileRaw = String(form.get("brandProfileId") ?? "").trim();
    const brandProfileId = /^[0-9a-f-]{36}$/i.test(brandProfileRaw)
      ? brandProfileRaw
      : null;

    if (!file) {
      return NextResponse.json(
        { ok: false, error: "Datei fehlt.", code: "missing_file" },
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

    const generateMetaCropsRaw = String(
      form.get("generateMetaCrops") ?? "",
    ).toLowerCase();
    const generateMetaCrops =
      generateMetaCropsRaw === "1" ||
      generateMetaCropsRaw === "true" ||
      generateMetaCropsRaw === "yes";

    const metaFormatRaw = String(form.get("metaFormatKey") ?? "").trim();
    const metaFormatKey = isMetaFormatKey(metaFormatRaw)
      ? metaFormatRaw
      : null;
    if (metaFormatRaw && !metaFormatKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unbekanntes Meta-Format.",
          code: "invalid_meta_format",
        },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileName =
      typeof file.name === "string" && file.name.trim()
        ? file.name
        : "upload.jpg";
    const mimeType =
      typeof file.type === "string" && file.type.trim() ? file.type : null;

    const result = await uploadCustomerLibraryImage({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      brandProfileId,
      fileName,
      mimeType,
      bytes,
      // Dedicated format slots skip auto-crop; free upload uses smart crops.
      generateMetaCrops: metaFormatKey ? false : generateMetaCrops,
      metaFormatKey,
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
      {
        ok: false,
        error: "Upload fehlgeschlagen.",
        code: "upload_failed",
      },
      { status: 500 },
    );
  }
}
