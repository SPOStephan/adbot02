import { NextResponse } from "next/server";

import {
  enqueueChatGPTAdLibraryIds,
  getChatGPTAdLibraryCrawlStatus,
  markChatGPTAdLibraryIdsSkipped,
  planChatGPTAdLibraryScrapeBatch,
} from "@/lib/chatgpt-ad-library/crawl-state";
import {
  discoverChatGPTAdLibraryIds,
  ingestChatGPTAdLibraryScrapeRecords,
  ingestChatGPTAdLibrarySeedFallback,
  scrapeChatGPTAdLibraryUnlockDiscover,
  scrapeChatGPTAdLibraryUnlockDrain,
} from "@/lib/chatgpt-ad-library/scrape";
import { CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX } from "@/lib/chatgpt-ad-library/scrape-constants";
import {
  allowInlineChatGPTAdLibraryUnlock,
  isChatGPTAdLibraryWorkerConfigured,
} from "@/lib/chatgpt-ad-library/worker-target";
import { ChatGPTAdLibraryImportError } from "@/lib/chatgpt-ad-library/import";
import { constantTimeEqual } from "@/lib/meta/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
};

function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401, headers: NO_STORE },
  );
}

function requireCron(request: Request) {
  const secret = cronSecret();
  if (!secret) {
    return {
      error: NextResponse.json(
        { ok: false, error: "cron_not_configured" },
        { status: 503, headers: NO_STORE },
      ),
    };
  }
  const supplied = request.headers.get("authorization") ?? "";
  if (!constantTimeEqual(supplied, `Bearer ${secret}`)) {
    return { error: unauthorized() };
  }
  return { secret };
}

function planLimitFromQuery(url: URL): number {
  const raw = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(raw)) return CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX;
  return Math.min(Math.max(Math.floor(raw), 1), 80);
}

function useWorkerResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: "use_worker",
      message:
        "Unlock läuft im eigenen Vercel-Projekt, nicht auf app.adbot.one. Sonst teilt der Scrape den Function-Pool mit Login.",
      workerConfigured: isChatGPTAdLibraryWorkerConfigured(),
    },
    { status: 409, headers: NO_STORE },
  );
}

/**
 * GET: fast control-plane for the dedicated scrape worker.
 * Query: ?mode=status | ?mode=plan&limit= | ?mode=http (heartbeat)
 * Unlock stays off this deployment unless ALLOW_INLINE_UNLOCK=1.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if ("error" in auth && auth.error) return auth.error;

  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") ?? "http").toLowerCase();

  try {
    if (mode === "status" || mode === "http") {
      const status = await getChatGPTAdLibraryCrawlStatus();
      return NextResponse.json(
        {
          ok: true,
          heartbeat: mode === "http",
          unlockOn: "dedicated_vercel_worker",
          status,
        },
        { headers: NO_STORE },
      );
    }

    if (mode === "unlock_discover") {
      if (!allowInlineChatGPTAdLibraryUnlock()) return useWorkerResponse();
      const result = await scrapeChatGPTAdLibraryUnlockDiscover();
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }

    if (mode === "unlock") {
      if (!allowInlineChatGPTAdLibraryUnlock()) return useWorkerResponse();
      const result = await scrapeChatGPTAdLibraryUnlockDrain();
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }

    const limit = planLimitFromQuery(url);
    const plan = await planChatGPTAdLibraryScrapeBatch({ limit });
    const status = await getChatGPTAdLibraryCrawlStatus();
    return NextResponse.json(
      {
        ok: true,
        mode: "plan",
        batchMax: limit,
        origin: "https://www.chatgptadlibrary.com",
        plan,
        status,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("chatgpt_ad_library_scrape_cron_get_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { ok: false, error: "cron_failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}

/**
 * POST actions:
 * - { action: "ingest", records: [...] }
 * - { action: "enqueue", ids: [...] }
 * - { action: "discover", shard, xml?, ids? }
 * - { action: "requeue", ids: [...] }
 * - { action: "skip", ids: [...] }
 */
export async function POST(request: Request) {
  const auth = requireCron(request);
  if ("error" in auth && auth.error) return auth.error;

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          action?: string;
          records?: unknown[];
          ids?: Array<number | string>;
          shard?: number;
          xml?: string;
        }
      | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "invalid_body" },
        { status: 400, headers: NO_STORE },
      );
    }

    const action = String(body.action ?? "ingest");

    if (action === "ingest") {
      if (!Array.isArray(body.records) || body.records.length < 1) {
        return NextResponse.json(
          { ok: false, error: "records_required" },
          { status: 400, headers: NO_STORE },
        );
      }
      const summary = await ingestChatGPTAdLibraryScrapeRecords({
        records: body.records,
      });
      return NextResponse.json(
        { ok: true, customerVisible: false, summary },
        { headers: NO_STORE },
      );
    }

    if (action === "ingest_seed") {
      const summary = await ingestChatGPTAdLibrarySeedFallback({
        reason: "worker_or_admin",
      });
      return NextResponse.json(
        { ok: true, customerVisible: false, fallback: "seed", summary },
        { headers: NO_STORE },
      );
    }

    if (action === "enqueue" || action === "requeue") {
      if (!Array.isArray(body.ids) || body.ids.length < 1) {
        return NextResponse.json(
          { ok: false, error: "ids_required" },
          { status: 400, headers: NO_STORE },
        );
      }
      const result = await enqueueChatGPTAdLibraryIds(body.ids);
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }

    if (action === "skip") {
      if (!Array.isArray(body.ids) || body.ids.length < 1) {
        return NextResponse.json(
          { ok: false, error: "ids_required" },
          { status: 400, headers: NO_STORE },
        );
      }
      const result = await markChatGPTAdLibraryIdsSkipped(body.ids);
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }

    if (action === "discover") {
      const shard = Number(body.shard ?? 0);
      const result = await discoverChatGPTAdLibraryIds({
        shard: Number.isFinite(shard) ? shard : 0,
        xml: typeof body.xml === "string" ? body.xml : "",
        ids: Array.isArray(body.ids) ? body.ids : [],
      });
      return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
    }

    return NextResponse.json(
      { ok: false, error: "unknown_action" },
      { status: 400, headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof ChatGPTAdLibraryImportError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status, headers: NO_STORE },
      );
    }
    console.error("chatgpt_ad_library_scrape_cron_post_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { ok: false, error: "cron_failed" },
      { status: 500, headers: NO_STORE },
    );
  }
}
