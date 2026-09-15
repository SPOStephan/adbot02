import "server-only";

import {
  enqueueChatGPTAdLibraryIds,
  markChatGPTAdLibraryDiscoverDone,
  planChatGPTAdLibraryScrapeBatch,
  recordChatGPTAdLibraryIngestSummary,
} from "@/lib/chatgpt-ad-library/crawl-state";
import { importChatGPTAdLibraryBatch } from "@/lib/chatgpt-ad-library/import";
import {
  extractAdIdsFromSitemapXml,
  parseChatGPTAdLibraryHtml,
} from "@/lib/chatgpt-ad-library/parse-html";
import { CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX } from "@/lib/chatgpt-ad-library/scrape-constants";
import { CHATGPT_AD_LIBRARY_ORIGIN } from "@/lib/chatgpt-ad-library/types";
import { resolveChatGPTAdLibraryUploaderUserId } from "@/lib/chatgpt-ad-library/uploader";

const FETCH_TIMEOUT_MS = 25_000;

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (compatible; AdbotInternalCorpus/1.0; +https://adbot.one)",
      },
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch {
    return { ok: false, status: 0, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

function isCheckpoint(status: number, text: string): boolean {
  return status === 429 || /vercel security checkpoint/i.test(text);
}

/**
 * Best-effort direct HTTP scrape. Usually blocked by Vercel bot checkpoint (429).
 * Primary path is the Playwright GitHub Action → ingest endpoint.
 * When blocked, do NOT consume the crawl queue — that would starve the worker.
 */
export async function scrapeChatGPTAdLibraryHttpBatch(input?: {
  ids?: string[];
}): Promise<{
  mode: "http";
  blocked: boolean;
  skippedPlan?: boolean;
  plannedIds: string[];
  summary: Awaited<ReturnType<typeof importChatGPTAdLibraryBatch>> | null;
  failures: Array<{ id: string; error: string }>;
}> {
  if (!input?.ids || input.ids.length < 1) {
    const probe = await fetchText(`${CHATGPT_AD_LIBRARY_ORIGIN}/ad/7341`);
    if (isCheckpoint(probe.status, probe.text)) {
      return {
        mode: "http",
        blocked: true,
        skippedPlan: true,
        plannedIds: [],
        summary: null,
        failures: [],
      };
    }
  }

  const plan =
    input?.ids && input.ids.length > 0
      ? {
          enabled: true,
          ids: input.ids.slice(0, CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX),
          pendingRemaining: 0,
          discoverShard: null as number | null,
        }
      : await planChatGPTAdLibraryScrapeBatch();

  if (!plan.enabled) {
    return {
      mode: "http",
      blocked: false,
      plannedIds: [],
      summary: null,
      failures: [],
    };
  }

  const records: unknown[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  let blocked = false;

  for (const id of plan.ids) {
    const url = `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/${id}`;
    const fetched = await fetchText(url);
    if (isCheckpoint(fetched.status, fetched.text)) {
      blocked = true;
      failures.push({ id, error: "bot_checkpoint_429" });
      // Re-queue remaining + current for the Playwright worker.
      await enqueueChatGPTAdLibraryIds(plan.ids);
      break;
    }
    if (!fetched.ok) {
      failures.push({ id, error: `http_${fetched.status || "fetch_failed"}` });
      continue;
    }
    const parsed = parseChatGPTAdLibraryHtml({ html: fetched.text, adId: id, pageUrl: url });
    if (!parsed) {
      failures.push({ id, error: "parse_failed" });
      continue;
    }
    records.push(parsed);
  }

  if (records.length < 1) {
    await recordChatGPTAdLibraryIngestSummary({
      imported: 0,
      skippedDuplicate: 0,
      failed: failures.length,
      details: { mode: "http", blocked, plannedIds: plan.ids },
    });
    return {
      mode: "http",
      blocked,
      plannedIds: plan.ids,
      summary: null,
      failures,
    };
  }

  const uploaderUserId = await resolveChatGPTAdLibraryUploaderUserId();
  const summary = await importChatGPTAdLibraryBatch({
    uploaderUserId,
    records,
  });
  await recordChatGPTAdLibraryIngestSummary({
    imported: summary.imported,
    skippedDuplicate: summary.skippedDuplicate,
    failed: summary.failed + failures.length,
    details: { mode: "http", blocked, plannedIds: plan.ids },
  });

  return {
    mode: "http",
    blocked,
    plannedIds: plan.ids,
    summary,
    failures,
  };
}

export async function ingestChatGPTAdLibraryScrapeRecords(input: {
  records: unknown[];
}): Promise<Awaited<ReturnType<typeof importChatGPTAdLibraryBatch>>> {
  const uploaderUserId = await resolveChatGPTAdLibraryUploaderUserId();
  const summary = await importChatGPTAdLibraryBatch({
    uploaderUserId,
    records: input.records,
  });
  await recordChatGPTAdLibraryIngestSummary({
    imported: summary.imported,
    skippedDuplicate: summary.skippedDuplicate,
    failed: summary.failed,
    details: { mode: "playwright_or_external" },
  });
  return summary;
}

export async function discoverChatGPTAdLibraryIds(input: {
  shard: number;
  xml?: string;
  ids?: Array<number | string>;
}): Promise<{ added: number; pendingCount: number; ids: string[] }> {
  const fromXml = extractAdIdsFromSitemapXml(input.xml ?? "");
  const fromIds = (input.ids ?? [])
    .map((id) => String(id ?? "").trim())
    .filter((id) => /^\d{1,12}$/.test(id));
  const ids = [...new Set([...fromXml, ...fromIds])];
  const enqueued = await enqueueChatGPTAdLibraryIds(ids);
  await markChatGPTAdLibraryDiscoverDone({
    shard: input.shard,
    enqueuedIds: ids,
  });
  return { ...enqueued, ids };
}

export async function discoverChatGPTAdLibraryIdsFromSitemapXml(input: {
  shard: number;
  xml: string;
}): Promise<{ added: number; pendingCount: number; ids: string[] }> {
  return discoverChatGPTAdLibraryIds(input);
}
