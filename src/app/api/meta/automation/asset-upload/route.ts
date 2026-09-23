import { NextRequest, NextResponse } from "next/server";

import { isMetaFormatKey } from "@/lib/media-library/meta-formats";
import {
  MediaLibraryError,
  uploadCustomerLibraryImage,
} from "@/lib/media-library/upload";
import { authenticateLibraryCustomer } from "@/lib/creative-assets/library-customer";
import { CustomerControlServiceError } from "@/lib/meta/customer-control-service";
import { registerCustomerLibraryImage } from "@/lib/creative-assets/library-generate";
import { isDashboardSameOriginRequest } from "@/lib/meta/customer-control-route";
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
    if (!isDashboardSameOriginRequest(request)) {
      return NextResponse.json(
        { ok: false, error: "Ungültige Herkunft.", code: "invalid_origin" },
        { status: 403 },
      );
    }

    const customer = await authenticateLibraryCustomer();

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
    if (brandProfileId && customer.platformAccountId) {
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

    if (!customer.platformAccountId) {
      const brandAssetId = await registerCustomerLibraryImage({
        userId: customer.userId,
        platformAccountId: null,
        fileName,
        bytes,
        sourceType: "UPLOADED",
        metadata: { contract_version: 1, library: "customer", source_kind: "customer_upload" },
      });
      return NextResponse.json({
        ok: true,
        brandAssetId,
        originalFilename: fileName,
        preferredLaunchAssetId: brandAssetId,
        assets: [{ brandAssetId, originalFilename: fileName, role: "original" }],
        cropsGenerated: 0,
        cropsSkipped: 0,
      });
    }

    const result = await uploadCustomerLibraryImage({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      brandProfileId,
      fileName,
      mimeType,
      bytes,
      generateMetaCrops:
        metaFormatKey || !customer.metaConnected ? false : generateMetaCrops,
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
