import { NextRequest, NextResponse } from "next/server";

import {
  enqueueChatGPTAdLibraryIds,
  getChatGPTAdLibraryCrawlStatus,
  setChatGPTAdLibraryCrawlEnabled,
  unstickChatGPTAdLibraryQueue,
  clearChatGPTAdLibraryScrapeLeases,
} from "@/lib/chatgpt-ad-library/crawl-state";
import {
  ingestChatGPTAdLibrarySeedFallback,
  probeChatGPTAdLibraryUnlocker,
  scrapeChatGPTAdLibraryUnlockDrain,
} from "@/lib/chatgpt-ad-library/scrape";
import {
  CHATGPT_AD_LIBRARY_RUN_NOW_BUDGET_MS,
  CHATGPT_AD_LIBRARY_RUN_NOW_ROUNDS,
} from "@/lib/chatgpt-ad-library/scrape-constants";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import {
  isDashboardSameOriginReadRequest,
  isDashboardSameOriginRequest,
} from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
      error: json({ ok: false, message: "Nur Admins dürfen den Crawl steuern." }, 403),
    };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request, "read");
    if ("error" in auth && auth.error) return auth.error;
    const status = await getChatGPTAdLibraryCrawlStatus();
    return json({
      ok: true,
      customerVisible: false,
      status,
      workerHint:
        "Unlocker-Probe #7341 importiert Bild + Copy. Image-only gilt nicht als Erfolg. Freelance erst wenn Copy mitkommt.",
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
      | {
          action?: string;
          enabled?: boolean;
          ids?: Array<number | string>;
          adId?: string | number;
        }
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

    if (action === "import_seed") {
      const summary = await ingestChatGPTAdLibrarySeedFallback({
        reason: "admin_import_seed",
      });
      const status = await getChatGPTAdLibraryCrawlStatus();
      return json({ ok: true, fallback: "seed", summary, status });
    }

    if (action === "probe_unlocker") {
      const probe = await probeChatGPTAdLibraryUnlocker({
        adId: body.adId,
      });
      return json({
        ok: true,
        ingested: probe.ingested,
        buyFreelance: probe.ok && probe.hasCopy,
        probe,
      });
    }

    if (action === "unstick") {
      const unstick = await unstickChatGPTAdLibraryQueue();
      const status = await getChatGPTAdLibraryCrawlStatus();
      return json({ ok: true, action, unstick, status });
    }

    if (action === "release_leases") {
      const leases = await clearChatGPTAdLibraryScrapeLeases();
      const status = await getChatGPTAdLibraryCrawlStatus();
      return json({ ok: true, action, leases, status });
    }

    if (action === "run_now") {
      const result = await scrapeChatGPTAdLibraryUnlockDrain({
        rounds: CHATGPT_AD_LIBRARY_RUN_NOW_ROUNDS,
        budgetMs: CHATGPT_AD_LIBRARY_RUN_NOW_BUDGET_MS,
        requireLease: false,
      });
      const status = await getChatGPTAdLibraryCrawlStatus();
      return json({
        ok: true,
        action,
        result,
        status,
      });
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
    return json(
      {
        ok: false,
        message:
          error instanceof Error
            ? `Crawl-Aktion fehlgeschlagen: ${error.message}`
            : "Crawl-Aktion fehlgeschlagen.",
      },
      500,
    );
  }
}
