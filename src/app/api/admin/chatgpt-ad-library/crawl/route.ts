import { NextRequest, NextResponse } from "next/server";

import {
  enqueueChatGPTAdLibraryIds,
  getChatGPTAdLibraryCrawlStatus,
  setChatGPTAdLibraryCrawlEnabled,
} from "@/lib/chatgpt-ad-library/crawl-state";
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

async function requireAdmin(request: NextRequest) {
  if (!isDashboardSameOriginRequest(request)) {
    return { error: json({ ok: false, message: "Ungültige Herkunft." }, 403) };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: json({ ok: false, message: "Nicht angemeldet." }, 401) };
  if (!(await isSiteAdmin(user.id))) {
    return {
      error: json({ ok: false, message: "Nur Admins dürfen den Crawl steuern." }, 403),
    };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const status = await getChatGPTAdLibraryCrawlStatus();
    return json({
      ok: true,
      customerVisible: false,
      status,
      workerHint:
        "Alle ~2 Stunden holt die GitHub Action max. 5 Ads (Browser). HTML-Fetch von Vercel ist oft 429.",
    });
  } catch (error) {
    console.error("chatgpt_ad_library_crawl_admin_get_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ ok: false, message: "Crawl-Status konnte nicht geladen werden." }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;

    const body = (await request.json().catch(() => null)) as
      | { action?: string; enabled?: boolean; ids?: Array<number | string> }
      | null;
    if (!body || typeof body !== "object") {
      return json({ ok: false, message: "JSON-Body erforderlich." }, 400);
    }

    const action = String(body.action ?? "");
    if (action === "set_enabled") {
      await setChatGPTAdLibraryCrawlEnabled(body.enabled === true);
      const status = await getChatGPTAdLibraryCrawlStatus();
      return json({ ok: true, status });
    }

    if (action === "enqueue") {
      if (!Array.isArray(body.ids) || body.ids.length < 1) {
        return json({ ok: false, message: "ids[] erforderlich." }, 400);
      }
      const result = await enqueueChatGPTAdLibraryIds(body.ids);
      const status = await getChatGPTAdLibraryCrawlStatus();
      return json({ ok: true, ...result, status });
    }

    return json({ ok: false, message: "Unbekannte action." }, 400);
  } catch (error) {
    console.error("chatgpt_ad_library_crawl_admin_post_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json({ ok: false, message: "Crawl-Aktion fehlgeschlagen." }, 500);
  }
}
