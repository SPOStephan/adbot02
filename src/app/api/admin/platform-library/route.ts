import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import { normalizeCreativeTags } from "@/lib/ad-examples/structure";
import { MediaLibraryError } from "@/lib/media-library/upload";
import {
  isDashboardSameOriginReadRequest,
  isDashboardSameOriginRequest,
} from "@/lib/meta/customer-control-route";
import {
  captionPlatformMotif,
  listPlatformMotifs,
  revokePlatformMotif,
  updatePlatformMotif,
  uploadPlatformMotif,
} from "@/lib/platform-library/service";
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

async function requireAdmin(
  request: NextRequest,
  mode: "read" | "write" = "write",
) {
  const sameOrigin =
    mode === "read"
      ? isDashboardSameOriginReadRequest(request)
      : isDashboardSameOriginRequest(request);
  if (!sameOrigin) {
    return { error: json({ ok: false, error: "Ungültige Herkunft." }, 403) };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: json({ ok: false, error: "Nicht angemeldet." }, 401) };
  }
  if (!(await isSiteAdmin(user.id))) {
    return { error: json({ ok: false, error: "Forbidden" }, 403) };
  }
  return { user };
}

function errorResponse(error: unknown) {
  if (error instanceof MediaLibraryError) {
    return json(
      { ok: false, error: error.message, code: error.code },
      error.status,
    );
  }
  console.error("[platform-library-admin]", error);
  return json({ ok: false, error: "Motivbibliothek fehlgeschlagen." }, 500);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request, "read");
    if ("error" in auth && auth.error) return auth.error;
    const url = request.nextUrl;
    const result = await listPlatformMotifs({
      tag: url.searchParams.get("tag"),
      search: url.searchParams.get("q"),
      limit: Number(url.searchParams.get("limit") ?? "80") || 80,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "Datei fehlt." }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadPlatformMotif({
      uploaderUserId: auth.user.id,
      fileName: file.name || "motiv.jpg",
      mimeType: file.type || null,
      bytes,
      tags: normalizeCreativeTags(String(form.get("tags") ?? "")),
    });
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as {
      assetId?: string;
      tags?: string[];
      contentSummary?: string | null;
      recaption?: boolean;
    };
    if (!body.assetId || !/^[0-9a-f-]{36}$/i.test(body.assetId)) {
      return json({ ok: false, error: "assetId fehlt." }, 400);
    }
    if (body.recaption) {
      const motif = await captionPlatformMotif({
        assetId: body.assetId,
        adminUserId: auth.user.id,
      });
      return json({ ok: true, motif });
    }
    const motif = await updatePlatformMotif({
      adminUserId: auth.user.id,
      assetId: body.assetId,
      tags: body.tags,
      contentSummary: body.contentSummary,
    });
    return json({ ok: true, motif });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as { assetId?: string };
    if (!body.assetId || !/^[0-9a-f-]{36}$/i.test(body.assetId)) {
      return json({ ok: false, error: "assetId fehlt." }, 400);
    }
    await revokePlatformMotif({
      adminUserId: auth.user.id,
      assetId: body.assetId,
    });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
