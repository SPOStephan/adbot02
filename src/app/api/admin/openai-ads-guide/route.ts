import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import { isDashboardSameOriginRequest } from "@/lib/meta/customer-control-route";
import {
  OpenAIAdsGuideError,
  removeOpenAIAdsGuideStep,
  saveOpenAIAdsGuideStep,
  setOpenAIAdsGuidePublished,
} from "@/lib/openai-ads/guide";
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

async function requireAdmin(request: NextRequest) {
  if (!isDashboardSameOriginRequest(request)) {
    return { error: json({ ok: false, message: "Ungültige Herkunft." }, 403) };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: json({ ok: false, message: "Nicht angemeldet." }, 401) };
  }
  if (!(await isSiteAdmin(user.id))) {
    return { error: json({ ok: false, message: "Nur Admins dürfen die Anleitung ändern." }, 403) };
  }
  return { user };
}

function errorResponse(error: unknown) {
  if (error instanceof OpenAIAdsGuideError) {
    return json(
      { ok: false, code: error.code, message: error.message },
      error.status,
    );
  }
  console.error("openai_ads_guide_admin_failed", {
    message: error instanceof Error ? error.message : "unknown",
  });
  return json(
    { ok: false, code: "internal_error", message: "Die Anleitung konnte nicht geändert werden." },
    500,
  );
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;

    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > 8.5 * 1024 * 1024) {
      return json({ ok: false, message: "Upload ist größer als 8 MB." }, 413);
    }

    const form = await request.formData();
    const fileEntry = form.get("file");
    const file =
      fileEntry instanceof File && fileEntry.size > 0
        ? {
            bytes: new Uint8Array(await fileEntry.arrayBuffer()),
            mimeType: fileEntry.type,
            originalFilename: fileEntry.name,
          }
        : null;
    const guide = await saveOpenAIAdsGuideStep({
      stepId: String(form.get("stepId") ?? "") || null,
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      sortOrder: Number(form.get("sortOrder") ?? 1),
      file,
    });
    return json({ ok: true, guide });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => null)) as {
      published?: unknown;
    } | null;
    if (typeof body?.published !== "boolean") {
      return json({ ok: false, message: "Ungültiger Veröffentlichungsstatus." }, 400);
    }
    const guide = await setOpenAIAdsGuidePublished(body.published);
    return json({ ok: true, guide });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => null)) as {
      stepId?: unknown;
    } | null;
    const stepId = typeof body?.stepId === "string" ? body.stepId.trim() : "";
    const guide = await removeOpenAIAdsGuideStep(stepId);
    return json({ ok: true, guide });
  } catch (error) {
    return errorResponse(error);
  }
}
