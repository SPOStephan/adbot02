import "server-only";

import {
  enqueueChatGPTAdLibraryIds,
  getChatGPTAdLibraryCrawlStatus,
  markChatGPTAdLibraryDiscoverDone,
  planChatGPTAdLibraryScrapeBatch,
  recordChatGPTAdLibraryIngestSummary,
} from "@/lib/chatgpt-ad-library/crawl-state";
import { importChatGPTAdLibraryBatch } from "@/lib/chatgpt-ad-library/import";
import {
  extractAdIdsFromSitemapXml,
  parseChatGPTAdLibraryHtml,
} from "@/lib/chatgpt-ad-library/parse-html";
import {
  CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
  CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT,
  CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID,
} from "@/lib/chatgpt-ad-library/scrape-constants";
import { CHATGPT_AD_LIBRARY_SEED_RECORDS } from "@/lib/chatgpt-ad-library/seed-records";
import { CHATGPT_AD_LIBRARY_ORIGIN } from "@/lib/chatgpt-ad-library/types";
import {
  isChatGPTAdLibraryUnlockerConfigured,
  unlockChatGPTAdLibraryUrl,
} from "@/lib/chatgpt-ad-library/unlocker";
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
  mode: "http" | "unlock";
  blocked: boolean;
  skippedPlan?: boolean;
  plannedIds: string[];
  summary: Awaited<ReturnType<typeof importChatGPTAdLibraryBatch>> | null;
  failures: Array<{ id: string; error: string }>;
}> {
  if (isChatGPTAdLibraryUnlockerConfigured()) {
    return scrapeChatGPTAdLibraryUnlockBatch(input);
  }

  if (!input?.ids || input.ids.length < 1) {
    const probe = await fetchText(`${CHATGPT_AD_LIBRARY_ORIGIN}/ad/7341`);
    if (isCheckpoint(probe.status, probe.text)) {
      const seed = await ingestChatGPTAdLibrarySeedFallback({
        reason: "http_checkpoint",
      });
      return {
        mode: "http",
        blocked: true,
        skippedPlan: true,
        plannedIds: [],
        summary: seed,
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

export async function ingestChatGPTAdLibrarySeedFallback(input?: {
  reason?: string;
}): Promise<Awaited<ReturnType<typeof importChatGPTAdLibraryBatch>>> {
  const records = [...CHATGPT_AD_LIBRARY_SEED_RECORDS];
  const uploaderUserId = await resolveChatGPTAdLibraryUploaderUserId();
  const summary = await importChatGPTAdLibraryBatch({
    uploaderUserId,
    records,
  });
  await recordChatGPTAdLibraryIngestSummary({
    imported: summary.imported,
    skippedDuplicate: summary.skippedDuplicate,
    failed: summary.failed,
    details: {
      mode: "seed_fallback",
      reason: input?.reason ?? "seed_fallback",
      seedIds: records.map((row) => String(row.id)),
    },
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

export async function scrapeChatGPTAdLibraryUnlockDiscover(): Promise<{
  mode: "unlock_discover";
  configured: boolean;
  shard: number;
  added: number;
  pendingCount: number;
  ids: string[];
  blocked: boolean;
}> {
  if (!isChatGPTAdLibraryUnlockerConfigured()) {
    return {
      mode: "unlock_discover",
      configured: false,
      shard: 0,
      added: 0,
      pendingCount: 0,
      ids: [],
      blocked: false,
    };
  }

  const status = await getChatGPTAdLibraryCrawlStatus();
  const shard = status.nextDiscoverShard % CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT;
  const url = `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/sitemaps/${String(shard).padStart(3, "0")}.xml`;
  const unlocked = await unlockChatGPTAdLibraryUrl(url);
  const result = await discoverChatGPTAdLibraryIds({
    shard,
    xml: unlocked.text,
  });
  return {
    mode: "unlock_discover",
    configured: true,
    shard,
    ...result,
    blocked: !unlocked.ok,
  };
}

export async function scrapeChatGPTAdLibraryUnlockBatch(input?: {
  ids?: string[];
}): Promise<{
  mode: "unlock";
  blocked: boolean;
  plannedIds: string[];
  summary: Awaited<ReturnType<typeof importChatGPTAdLibraryBatch>> | null;
  failures: Array<{ id: string; error: string }>;
}> {
  if (!isChatGPTAdLibraryUnlockerConfigured()) {
    return {
      mode: "unlock",
      blocked: true,
      plannedIds: [],
      summary: null,
      failures: [{ id: "-", error: "unlocker_not_configured" }],
    };
  }

  const plan =
    input?.ids && input.ids.length > 0
      ? {
          enabled: true,
          ids: input.ids.slice(0, CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX),
        }
      : await planChatGPTAdLibraryScrapeBatch();

  if (!plan.enabled) {
    return {
      mode: "unlock",
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
    const pageUrl = `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/${id}`;
    const unlocked = await unlockChatGPTAdLibraryUrl(pageUrl);
    if (!unlocked.ok) {
      if (unlocked.status === 429 || /vercel security checkpoint/i.test(unlocked.text)) {
        blocked = true;
        failures.push({ id, error: "unlocker_checkpoint" });
        await enqueueChatGPTAdLibraryIds([id]);
        continue;
      }
      failures.push({ id, error: `unlocker_${unlocked.status || "failed"}` });
      await enqueueChatGPTAdLibraryIds([id]);
      continue;
    }
    const parsed = parseChatGPTAdLibraryHtml({
      html: unlocked.text,
      adId: id,
      pageUrl,
    });
    if (!parsed) {
      failures.push({ id, error: "parse_failed" });
      continue;
    }
    records.push(parsed);
  }

  if (records.length < 1) {
    const seed = await ingestChatGPTAdLibrarySeedFallback({
      reason: blocked ? "unlocker_checkpoint" : "unlocker_empty",
    });
    return {
      mode: "unlock",
      blocked,
      plannedIds: plan.ids,
      summary: seed,
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
    details: { mode: "unlock", blocked, plannedIds: plan.ids },
  });

  return {
    mode: "unlock",
    blocked,
    plannedIds: plan.ids,
    summary,
    failures,
  };
}

export type ChatGPTAdLibraryUnlockerProbe = {
  ok: boolean;
  configured: boolean;
  ingested: false;
  adId: string;
  pageUrl: string;
  checkpoint: boolean;
  httpStatus: number;
  hasImage: boolean;
  parseOk: boolean;
  title: string | null;
  imageUrl: string | null;
  credits: string | null;
  providerError: string | null;
  attempt: "none" | "auto" | "stealth_fallback";
  message: string;
};

/**
 * One-page unlocker smoke test. Never imports. Use the ScrapingBee trial
 * before buying Freelance — a red probe means more credits will not help.
 */
export async function probeChatGPTAdLibraryUnlocker(input?: {
  adId?: string | number;
}): Promise<ChatGPTAdLibraryUnlockerProbe> {
  const rawId = String(input?.adId ?? CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID).trim();
  const adId = /^\d{1,12}$/.test(rawId) ? rawId : CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID;
  const pageUrl = `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/${adId}`;

  if (!isChatGPTAdLibraryUnlockerConfigured()) {
    return {
      ok: false,
      configured: false,
      ingested: false,
      adId,
      pageUrl,
      checkpoint: false,
      httpStatus: 0,
      hasImage: false,
      parseOk: false,
      title: null,
      imageUrl: null,
      credits: null,
      providerError: "SCRAPINGBEE_API_KEY fehlt",
      attempt: "none",
      message:
        "SCRAPINGBEE_API_KEY fehlt. Trial-Key (1000 Credits, keine Karte) in Vercel Production setzen, neu deployen, dann erneut prüfen. Freelance noch nicht kaufen.",
    };
  }

  const unlocked = await unlockChatGPTAdLibraryUrl(pageUrl);
  const checkpoint =
    unlocked.status === 429 || /vercel security checkpoint/i.test(unlocked.text);
  const parsed =
    unlocked.ok && !checkpoint
      ? parseChatGPTAdLibraryHtml({ html: unlocked.text, adId, pageUrl })
      : null;
  const imageUrl =
    parsed && typeof parsed.imageUrl === "string" && parsed.imageUrl.length > 8
      ? parsed.imageUrl
      : null;
  const title =
    parsed && typeof parsed.title === "string" && parsed.title.length > 0
      ? parsed.title
      : null;
  const parseOk = parsed != null;
  const ok = Boolean(unlocked.ok && !checkpoint && parseOk && imageUrl);

  let message: string;
  if (ok) {
    message =
      "Probe grün: Unlocker hat die Ad-Seite gelesen und eine CDN-Bild-URL gefunden. Kein Import. Freelance ist erst jetzt sinnvoll.";
  } else if (checkpoint) {
    message =
      "Probe rot: ScrapingBee sieht denselben Vercel-Checkpoint. Freelance kaufen ändert das nicht — nur mehr Credits.";
  } else if (unlocked.status === 400) {
    message = unlocked.providerError
      ? `Probe rot: ScrapingBee hat die Anfrage abgelehnt (400): ${unlocked.providerError}. Das ist kein Checkpoint — Parameter/Key, nicht der 50-Dollar-Plan.`
      : "Probe rot: ScrapingBee hat die Anfrage abgelehnt (400). Das ist kein Checkpoint — Parameter/Key, nicht der 50-Dollar-Plan.";
  } else if (!unlocked.ok) {
    message = unlocked.providerError
      ? `Probe rot: Unlocker-HTTP ${unlocked.status || "failed"}: ${unlocked.providerError}. Freelance noch nicht kaufen.`
      : `Probe rot: Unlocker-HTTP ${unlocked.status || "failed"}. Freelance noch nicht kaufen.`;
  } else {
    message =
      "Probe rot: HTML ohne CDN-Bild-URL. Parser findet nichts. Freelance noch nicht kaufen.";
  }

  return {
    ok,
    configured: true,
    ingested: false,
    adId,
    pageUrl,
    checkpoint,
    httpStatus: unlocked.status,
    hasImage: Boolean(imageUrl),
    parseOk,
    title,
    imageUrl,
    credits: unlocked.cost,
    providerError: unlocked.providerError,
    attempt: unlocked.attempt,
    message,
  };
}
