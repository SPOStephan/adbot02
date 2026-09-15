import { NextRequest, NextResponse } from "next/server";

import { loadChatGPTAdLibraryForInternalIntelligence } from "@/lib/chatgpt-ad-library/retrieval";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { isDashboardSameOriginRequest } from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  try {
    if (!isDashboardSameOriginRequest(request)) {
      return json({ ok: false, message: "Ungültige Herkunft." }, 403);
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json({ ok: false, message: "Nicht angemeldet." }, 401);
    if (!(await isSiteAdmin(user.id))) {
      return json(
        { ok: false, message: "Nur Admins dürfen den internen ChatGPT-Korpus abrufen." },
        403,
      );
    }

    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const limitRaw = Number(url.searchParams.get("limit") ?? "40");
    const hits = await loadChatGPTAdLibraryForInternalIntelligence({
      query,
      limit: Number.isFinite(limitRaw) ? limitRaw : 40,
    });

    return json({
      ok: true,
      customerVisible: false,
      count: hits.length,
      hits,
    });
  } catch (error) {
    console.error("chatgpt_ad_library_intelligence_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json(
      { ok: false, message: "Interner ChatGPT-Korpus konnte nicht geladen werden." },
      500,
    );
  }
}
