import { NextRequest, NextResponse } from "next/server";

import {
  ChatGPTAdLibraryImportError,
  CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX,
  importChatGPTAdLibraryBatch,
} from "@/lib/chatgpt-ad-library/import";
import { countChatGPTAdLibraryImports } from "@/lib/chatgpt-ad-library/retrieval";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import {
  isDashboardSameOriginReadRequest,
  isDashboardSameOriginRequest,
} from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    return {
      error: json(
        { ok: false, message: "Nur Admins dürfen die ChatGPT Ad Library importieren." },
        403,
      ),
    };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request, "read");
    if ("error" in auth && auth.error) return auth.error;
    const imported = await countChatGPTAdLibraryImports();
    return json({
      ok: true,
      provider: "chatgptadlibrary.com",
      customerVisible: false,
      useForInternalIntelligence: true,
      defaultUseForGeneration: false,
      batchMax: CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX,
      imported,
    });
  } catch (error) {
    console.error("chatgpt_ad_library_status_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json(
      { ok: false, message: "Status der ChatGPT Ad Library konnte nicht geladen werden." },
      500,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;

    const body = (await request.json().catch(() => null)) as
      | { records?: unknown; record?: unknown }
      | null;
    if (!body || typeof body !== "object") {
      return json({ ok: false, message: "JSON-Body erforderlich." }, 400);
    }

    const records = Array.isArray(body.records)
      ? body.records
      : body.record !== undefined
        ? [body.record]
        : null;
    if (!records) {
      return json(
        {
          ok: false,
          message: `Body braucht "records" (Array, max. ${CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX}) oder "record".`,
        },
        400,
      );
    }

    const summary = await importChatGPTAdLibraryBatch({
      uploaderUserId: auth.user.id,
      records,
    });

    return json({
      ok: true,
      customerVisible: false,
      summary,
    });
  } catch (error) {
    if (error instanceof ChatGPTAdLibraryImportError) {
      return json(
        { ok: false, code: error.code, message: error.message },
        error.status,
      );
    }
    console.error("chatgpt_ad_library_import_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json(
      {
        ok: false,
        code: "internal_error",
        message: "Import aus der ChatGPT Ad Library ist fehlgeschlagen.",
      },
      500,
    );
  }
}
