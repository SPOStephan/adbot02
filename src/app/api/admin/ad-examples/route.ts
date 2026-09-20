import { NextRequest, NextResponse } from "next/server";

import { AdExampleInputError, adExampleMetadata } from "@/lib/ad-examples/input";
import {
  AdExampleServiceError,
  loadAdExamplesPage,
  parseAdExampleInput,
  removeAdExample,
  updateAdExample,
} from "@/lib/ad-examples/service";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { MediaLibraryError, uploadInspirationVaultImage } from "@/lib/media-library/upload";
import {
  isDashboardSameOriginReadRequest,
  isDashboardSameOriginRequest,
} from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function requireAdmin(request: NextRequest, mode: "read" | "write" = "write") {
  const sameOrigin =
    mode === "read"
      ? isDashboardSameOriginReadRequest(request)
      : isDashboardSameOriginRequest(request);
  if (!sameOrigin) {
    return { error: json({ ok: false, message: "Ungültige Herkunft." }, 403) };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: json({ ok: false, message: "Nicht angemeldet." }, 401) };
  if (!(await isSiteAdmin(user.id))) {
    return { error: json({ ok: false, message: "Nur Admins dürfen Werbebeispiele verwalten." }, 403) };
  }
  return { user };
}

function errorResponse(error: unknown) {
  if (error instanceof AdExampleInputError) {
    return json({ ok: false, code: "invalid_input", message: error.message }, 400);
  }
  if (error instanceof AdExampleServiceError || error instanceof MediaLibraryError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  console.error("ad_example_admin_failed", {
    message: error instanceof Error ? error.message : "unknown",
  });
  return json(
    { ok: false, code: "internal_error", message: "Das Werbebeispiel konnte nicht gespeichert werden." },
    500,
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request, "read");
    if ("error" in auth && auth.error) return auth.error;
    const url = new URL(request.url);
    const pageRaw = Number(url.searchParams.get("page") ?? "1");
    const pageSizeRaw = Number(url.searchParams.get("pageSize") ?? "24");
    const result = await loadAdExamplesPage({
      page: Number.isFinite(pageRaw) ? pageRaw : 1,
      pageSize: Number.isFinite(pageSizeRaw) ? pageSizeRaw : 24,
      query: url.searchParams.get("q") ?? "",
      platform: url.searchParams.get("platform") ?? "all",
      objective: url.searchParams.get("objective") ?? "all",
      industry: url.searchParams.get("industry") ?? "all",
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

function formValues(form: FormData): Record<string, unknown> {
  return {
    title: form.get("title"),
    advertiserName: form.get("advertiserName"),
    platform: form.get("platform"),
    industry: form.get("industry"),
    objective: form.get("objective"),
    objectiveDetail: form.get("objectiveDetail"),
    funnelStage: form.get("funnelStage"),
    sourceKind: form.get("sourceKind"),
    sourceUrl: form.get("sourceUrl"),
    evidenceLevel: form.get("evidenceLevel"),
    rightsBasis: form.get("rightsBasis"),
    rightsConfirmed: form.get("rightsConfirmed"),
    format: form.get("format"),
    country: form.get("country"),
    language: form.get("language"),
    hookText: form.get("hookText"),
    bodyText: form.get("bodyText"),
    ctaText: form.get("ctaText"),
    landingPageUrl: form.get("landingPageUrl"),
    performanceNote: form.get("performanceNote"),
    whyItWorks: form.get("whyItWorks"),
    tags: form.get("tags"),
    qualityRating: form.get("qualityRating"),
    useForGeneration: form.get("useForGeneration"),
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 10.5 * 1024 * 1024) {
      return json({ ok: false, message: "Upload ist größer als 10 MB." }, 413);
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return json({ ok: false, message: "Bitte einen Screenshot hochladen." }, 400);
    }
    const values = parseAdExampleInput(formValues(form));
    const result = await uploadInspirationVaultImage({
      uploaderUserId: auth.user.id,
      fileName: file.name || "werbebeispiel.jpg",
      mimeType: file.type || null,
      bytes: new Uint8Array(await file.arrayBuffer()),
      metadata: adExampleMetadata(values),
    });
    const example = await updateAdExample({
      assetId: result.brandAssetId,
      values: formValues(form),
    });
    return json({ ok: true, example });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ ok: false, message: "Ungültige Anfrage." }, 400);
    const assetId = typeof body.assetId === "string" ? body.assetId.trim() : "";
    const example = await updateAdExample({ assetId, values: body });
    return json({ ok: true, example });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => null)) as { assetId?: unknown } | null;
    const assetId = typeof body?.assetId === "string" ? body.assetId.trim() : "";
    await removeAdExample(assetId);
    return json({ ok: true, assetId });
  } catch (error) {
    return errorResponse(error);
  }
}
