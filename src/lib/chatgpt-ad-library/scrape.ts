import "server-only";

import {
  claimChatGPTAdLibraryScrapeLease,
  enqueueChatGPTAdLibraryIds,
  getChatGPTAdLibraryCrawlStatus,
  markChatGPTAdLibraryDiscoverDone,
  markChatGPTAdLibraryIdsSkipped,
  planChatGPTAdLibraryScrapeBatch,
  recordChatGPTAdLibraryIngestSummary,
  releaseChatGPTAdLibraryScrapeLease,
} from "@/lib/chatgpt-ad-library/crawl-state";
import {
  isUnlockerProviderBlockError,
  mapPool,
  shouldSkipScrapeError,
} from "@/lib/chatgpt-ad-library/plan";
import { importChatGPTAdLibraryBatch } from "@/lib/chatgpt-ad-library/import";
import { CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX } from "@/lib/chatgpt-ad-library/import-constants";
import {
  extractAdIdsFromSitemapXml,
  hasUsableChatGPTAdLibraryCopy,
  resolveChatGPTAdLibraryCopy,
  parseChatGPTAdLibraryHtml,
  sanitizeChatGPTAdLibraryCopy,
} from "@/lib/chatgpt-ad-library/parse-html";
import {
  countChatGPTAdLibraryImports,
  loadChatGPTAdLibraryForInternalIntelligence,
} from "@/lib/chatgpt-ad-library/retrieval";
import {
  CHATGPT_AD_LIBRARY_DISCOVER_DEFER_PENDING,
  CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
  CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT,
  CHATGPT_AD_LIBRARY_UNLOCK_BATCH_MAX,
  CHATGPT_AD_LIBRARY_UNLOCK_CONCURRENCY,
  CHATGPT_AD_LIBRARY_UNLOCK_DRAIN_BUDGET_MS,
  CHATGPT_AD_LIBRARY_UNLOCK_ROUND_BUDGET_MS,
  CHATGPT_AD_LIBRARY_UNLOCK_ROUNDS_MAX,
  CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID,
} from "@/lib/chatgpt-ad-library/scrape-constants";
import {
  CHATGPT_AD_LIBRARY_SEED_RECORDS,
  chatGPTAdLibrarySeedRecordForId,
} from "@/lib/chatgpt-ad-library/seed-records";
import { CHATGPT_AD_LIBRARY_ORIGIN } from "@/lib/chatgpt-ad-library/types";
import {
  isChatGPTAdLibraryUnlockerConfigured,
  isScrapingBeeCreditOrAuthError,
  unlockChatGPTAdLibraryUrl,
} from "@/lib/chatgpt-ad-library/unlocker";
import { resolveChatGPTAdLibraryUploaderUserId } from "@/lib/chatgpt-ad-library/uploader";

const FETCH_TIMEOUT_MS = 25_000;

async function persistScrapeFailures(
  failures: Array<{ id: string; error: string }>,
): Promise<void> {
  const skip = failures.filter((item) => shouldSkipScrapeError(item.error)).map((item) => item.id);
  const retry = failures.filter((item) => !shouldSkipScrapeError(item.error)).map((item) => item.id);
  if (skip.length > 0) await markChatGPTAdLibraryIdsSkipped(skip);
  if (retry.length > 0) await enqueueChatGPTAdLibraryIds(retry);
}

async function importUnlockedRecords(records: unknown[]) {
  const uploaderUserId = await resolveChatGPTAdLibraryUploaderUserId();
  let imported = 0;
  let skippedDuplicate = 0;
  let failed = 0;
  let refreshed = 0;
  const results: Awaited<ReturnType<typeof importChatGPTAdLibraryBatch>>["results"] = [];
  for (let from = 0; from < records.length; from += CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX) {
    const summary = await importChatGPTAdLibraryBatch({
      uploaderUserId,
      records: records.slice(from, from + CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX),
    });
    imported += summary.imported;
    skippedDuplicate += summary.skippedDuplicate;
    failed += summary.failed;
    refreshed += summary.refreshed ?? 0;
    results.push(...summary.results);
  }
  return {
    attempted: records.length,
    imported,
    refreshed,
    skippedDuplicate,
    failed,
    results,
  };
}

async function maybeSeedFallback(reason: string) {
  const vaultCount = await countChatGPTAdLibraryImports().catch(() => 0);
  if (vaultCount > 0) return null;
  return ingestChatGPTAdLibrarySeedFallback({ reason });
}

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
    if (input?.ids && input.ids.length > 0) {
      return scrapeChatGPTAdLibraryUnlockBatch(input);
    }
    return scrapeChatGPTAdLibraryUnlockDrain();
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
      await enqueueChatGPTAdLibraryIds(plan.ids.slice(plan.ids.indexOf(id)));
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
    if (!hasUsableChatGPTAdLibraryCopy(parsed)) {
      failures.push({ id, error: "parse_copy_missing" });
      continue;
    }
    records.push(parsed);
  }

  await persistScrapeFailures(failures.filter((item) => item.error !== "bot_checkpoint_429"));

  if (records.length < 1) {
    const seed = await maybeSeedFallback(blocked ? "http_checkpoint" : "http_empty");
    await recordChatGPTAdLibraryIngestSummary({
      imported: seed?.imported ?? 0,
      skippedDuplicate: seed?.skippedDuplicate ?? 0,
      failed: failures.length,
      details: { mode: "http", blocked, plannedIds: plan.ids },
    });
    return {
      mode: "http",
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
  if (status.pendingCount >= CHATGPT_AD_LIBRARY_DISCOVER_DEFER_PENDING) {
    return {
      mode: "unlock_discover",
      configured: true,
      shard,
      added: 0,
      pendingCount: status.pendingCount,
      ids: [],
      blocked: false,
    };
  }
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
  budgetMs?: number;
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
          ids: input.ids.slice(0, CHATGPT_AD_LIBRARY_UNLOCK_BATCH_MAX),
        }
      : await planChatGPTAdLibraryScrapeBatch({
          limit: CHATGPT_AD_LIBRARY_UNLOCK_BATCH_MAX,
        });

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
  let providerBlocked = false;
  const leftover: string[] = [];
  const budgetMs = Math.max(
    20_000,
    Math.min(
      input?.budgetMs ?? CHATGPT_AD_LIBRARY_UNLOCK_ROUND_BUDGET_MS,
      CHATGPT_AD_LIBRARY_UNLOCK_DRAIN_BUDGET_MS,
    ),
  );
  const deadline = Date.now() + budgetMs;
  const queue = [...plan.ids];

  while (queue.length > 0) {
    if (Date.now() >= deadline) {
      leftover.push(...queue);
      break;
    }
    const wave = queue.splice(0, CHATGPT_AD_LIBRARY_UNLOCK_CONCURRENCY);
    const waveResults = await mapPool(wave, CHATGPT_AD_LIBRARY_UNLOCK_CONCURRENCY, async (id) => {
      const pageUrl = `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/${id}`;
      const unlocked = await unlockChatGPTAdLibraryUrl(pageUrl);
      if (!unlocked.ok) {
        if (unlocked.status === 429 || /vercel security checkpoint/i.test(unlocked.text)) {
          return { id, error: "unlocker_checkpoint", blocked: true, record: null };
        }
        if (isScrapingBeeCreditOrAuthError(unlocked)) {
          return { id, error: "unlocker_credits", blocked: false, record: null };
        }
        return {
          id,
          error: `unlocker_${unlocked.status || "failed"}`,
          blocked: false,
          record: null,
        };
      }
      const parsed = parseChatGPTAdLibraryHtml({
        html: unlocked.text,
        adId: id,
        pageUrl,
      });
      if (!parsed) {
        if (!unlocked.text || unlocked.text.length < 200) {
          return { id, error: "unlocker_empty_html", blocked: false, record: null };
        }
        return { id, error: "parse_failed", blocked: false, record: null };
      }
      if (!hasUsableChatGPTAdLibraryCopy(parsed)) {
        return { id, error: "parse_copy_missing", blocked: false, record: null };
      }
      return { id, error: null, blocked: false, record: parsed };
    });
    for (const item of waveResults) {
      if (item.record) {
        records.push(item.record);
        continue;
      }
      if (item.blocked) blocked = true;
      if (isUnlockerProviderBlockError(item.error ?? "")) providerBlocked = true;
      failures.push({ id: item.id, error: item.error ?? "unlocker_failed" });
    }
    if (providerBlocked) {
      leftover.push(...queue);
      break;
    }
  }

  if (leftover.length > 0) {
    await enqueueChatGPTAdLibraryIds(leftover);
  }

  const skippable = providerBlocked
    ? failures.filter((item) => !isUnlockerProviderBlockError(item.error))
    : failures;
  const blockedIds = providerBlocked
    ? failures.filter((item) => isUnlockerProviderBlockError(item.error)).map((item) => item.id)
    : [];
  if (blockedIds.length > 0) {
    await enqueueChatGPTAdLibraryIds(blockedIds);
  }
  await persistScrapeFailures(skippable);

  if (records.length < 1) {
    const seed = await maybeSeedFallback(blocked ? "unlocker_checkpoint" : "unlocker_empty");
    await recordChatGPTAdLibraryIngestSummary({
      imported: seed?.imported ?? 0,
      skippedDuplicate: seed?.skippedDuplicate ?? 0,
      failed: failures.length,
      details: {
        mode: "unlock",
        blocked,
        plannedIds: plan.ids,
        last_unlocker_block: providerBlocked ? "credits" : blocked ? "checkpoint" : null,
        last_failure_errors: failures.slice(0, 8).map((item) => `${item.id}:${item.error}`),
      },
    });
    return {
      mode: "unlock",
      blocked,
      plannedIds: plan.ids,
      summary: seed,
      failures,
    };
  }

  const summary = await importUnlockedRecords(records);
  await recordChatGPTAdLibraryIngestSummary({
    imported: summary.imported,
    skippedDuplicate: summary.skippedDuplicate,
    failed: summary.failed + failures.length,
    details: {
      mode: "unlock",
      blocked,
      plannedIds: plan.ids,
      last_unlocker_block: providerBlocked ? "credits" : blocked ? "checkpoint" : null,
      last_failure_errors: failures.slice(0, 8).map((item) => `${item.id}:${item.error}`),
    },
  });

  return {
    mode: "unlock",
    blocked,
    plannedIds: plan.ids,
    summary,
    failures,
  };
}

export async function scrapeChatGPTAdLibraryUnlockDrain(input?: {
  rounds?: number;
}): Promise<{
  mode: "unlock";
  blocked: boolean;
  plannedIds: string[];
  summary: Awaited<ReturnType<typeof importChatGPTAdLibraryBatch>> | null;
  failures: Array<{ id: string; error: string }>;
  rounds: number;
  skippedLease?: boolean;
}> {
  const maxRounds = Math.min(
    Math.max(input?.rounds ?? CHATGPT_AD_LIBRARY_UNLOCK_ROUNDS_MAX, 1),
    20,
  );
  const lease = await claimChatGPTAdLibraryScrapeLease();
  if (!lease.claimed) {
    return {
      mode: "unlock",
      blocked: false,
      plannedIds: [],
      summary: null,
      failures: [],
      rounds: 0,
      skippedLease: true,
    };
  }

  const started = Date.now();
  const totalBudget = CHATGPT_AD_LIBRARY_UNLOCK_DRAIN_BUDGET_MS;
  const plannedIds: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  let blocked = false;
  let imported = 0;
  let skippedDuplicate = 0;
  let failed = 0;
  let lastSummary: Awaited<ReturnType<typeof importChatGPTAdLibraryBatch>> | null = null;
  let rounds = 0;

  try {
    for (let i = 0; i < maxRounds; i += 1) {
      const remaining = totalBudget - (Date.now() - started);
      if (remaining < 30_000) break;
      const result = await scrapeChatGPTAdLibraryUnlockBatch({ budgetMs: remaining });
      rounds += 1;
      plannedIds.push(...result.plannedIds);
      failures.push(...result.failures);
      blocked = blocked || result.blocked;
      if (result.summary) {
        imported += result.summary.imported;
        skippedDuplicate += result.summary.skippedDuplicate;
        failed += result.summary.failed;
        lastSummary = {
          ...result.summary,
          imported,
          skippedDuplicate,
          failed,
        };
      }
      if (result.plannedIds.length < 1) break;
      if (result.failures.some((item) => isUnlockerProviderBlockError(item.error))) break;
    }
  } finally {
    await releaseChatGPTAdLibraryScrapeLease(lease.owner).catch(() => undefined);
  }

  return {
    mode: "unlock",
    blocked,
    plannedIds,
    summary: lastSummary,
    failures,
    rounds,
  };
}

export type ChatGPTAdLibraryUnlockerProbe = {
  ok: boolean;
  configured: boolean;
  ingested: boolean;
  importStatus: "imported" | "refreshed" | "skipped_duplicate" | "failed" | "skipped_no_copy" | null;
  adId: string;
  pageUrl: string;
  checkpoint: boolean;
  httpStatus: number;
  hasImage: boolean;
  hasCopy: boolean;
  parseOk: boolean;
  title: string | null;
  body: string | null;
  promptCount: number;
  triggeringPrompts: string[];
  imageUrl: string | null;
  credits: string | null;
  providerError: string | null;
  attempt: "none" | "auto" | "stealth_fallback";
  message: string;
};

function emptyUnlockerProbe(
  adId: string,
  pageUrl: string,
  extras: Partial<ChatGPTAdLibraryUnlockerProbe> & Pick<ChatGPTAdLibraryUnlockerProbe, "ok" | "message">,
): ChatGPTAdLibraryUnlockerProbe {
  return {
    configured: true,
    ingested: false,
    importStatus: null,
    adId,
    pageUrl,
    checkpoint: false,
    httpStatus: 0,
    hasImage: false,
    hasCopy: false,
    parseOk: false,
    title: null,
    body: null,
    promptCount: 0,
    triggeringPrompts: [],
    imageUrl: null,
    credits: null,
    providerError: null,
    attempt: "none",
    ...extras,
  };
}

/**
 * Unlock one ad page, require image + copy, then import (or refresh thin metadata).
 */
export async function probeChatGPTAdLibraryUnlocker(input?: {
  adId?: string | number;
}): Promise<ChatGPTAdLibraryUnlockerProbe> {
  const rawId = String(input?.adId ?? CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID).trim();
  const adId = /^\d{1,12}$/.test(rawId) ? rawId : CHATGPT_AD_LIBRARY_UNLOCKER_PROBE_AD_ID;
  const pageUrl = `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/${adId}`;

  if (!isChatGPTAdLibraryUnlockerConfigured()) {
    return emptyUnlockerProbe(adId, pageUrl, {
      ok: false,
      configured: false,
      providerError: "SCRAPINGBEE_API_KEY fehlt",
      message:
        "SCRAPINGBEE_API_KEY fehlt. Trial-Key (1000 Credits, keine Karte) in Vercel Production setzen, neu deployen, dann erneut prüfen. Freelance noch nicht kaufen.",
    });
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
  const body =
    parsed && typeof parsed.body === "string" && parsed.body.trim().length > 0
      ? parsed.body.trim()
      : null;
  const triggeringPrompts = Array.isArray(parsed?.triggeringPrompts)
    ? parsed.triggeringPrompts.filter((item): item is string => typeof item === "string")
    : [];
  const hasCopy = parsed ? hasUsableChatGPTAdLibraryCopy(parsed) : false;
  const parseOk = parsed != null;

  const base = {
    adId,
    pageUrl,
    checkpoint,
    httpStatus: unlocked.status,
    hasImage: Boolean(imageUrl),
    hasCopy,
    parseOk,
    title,
    body,
    promptCount: triggeringPrompts.length,
    triggeringPrompts: triggeringPrompts.slice(0, 8),
    imageUrl,
    credits: unlocked.cost,
    providerError: unlocked.providerError,
    attempt: unlocked.attempt,
  };

  if (checkpoint) {
    return emptyUnlockerProbe(adId, pageUrl, {
      ...base,
      ok: false,
      message:
        "Probe rot: ScrapingBee sieht denselben Vercel-Checkpoint. Freelance kaufen ändert das nicht — nur mehr Credits.",
    });
  }
  if (unlocked.status === 400) {
    return emptyUnlockerProbe(adId, pageUrl, {
      ...base,
      ok: false,
      message: unlocked.providerError
        ? `Probe rot: ScrapingBee hat die Anfrage abgelehnt (400): ${unlocked.providerError}. Das ist kein Checkpoint — Parameter/Key, nicht der 50-Dollar-Plan.`
        : "Probe rot: ScrapingBee hat die Anfrage abgelehnt (400). Das ist kein Checkpoint — Parameter/Key, nicht der 50-Dollar-Plan.",
    });
  }
  if (!unlocked.ok) {
    return emptyUnlockerProbe(adId, pageUrl, {
      ...base,
      ok: false,
      message: unlocked.providerError
        ? `Probe rot: Unlocker-HTTP ${unlocked.status || "failed"}: ${unlocked.providerError}. Freelance noch nicht kaufen.`
        : `Probe rot: Unlocker-HTTP ${unlocked.status || "failed"}. Freelance noch nicht kaufen.`,
    });
  }
  if (!parseOk || !imageUrl) {
    return emptyUnlockerProbe(adId, pageUrl, {
      ...base,
      ok: false,
      message:
        "Probe rot: HTML ohne CDN-Bild-URL. Parser findet nichts. Freelance noch nicht kaufen.",
    });
  }
  const seed = chatGPTAdLibrarySeedRecordForId(adId);
  const parsedCopy =
    parsed && hasCopy
      ? sanitizeChatGPTAdLibraryCopy({
          title: typeof parsed.title === "string" ? parsed.title : "",
          advertiserName:
            typeof parsed.advertiserName === "string" ? parsed.advertiserName : "",
          body: typeof parsed.body === "string" ? parsed.body : "",
          triggeringPrompts: Array.isArray(parsed.triggeringPrompts)
            ? parsed.triggeringPrompts.filter((item): item is string => typeof item === "string")
            : [],
        })
      : null;
  const seedCopy = seed
    ? sanitizeChatGPTAdLibraryCopy({
        title: seed.title,
        advertiserName: seed.advertiserName,
        body: seed.body,
        triggeringPrompts: [...seed.triggeringPrompts],
      })
    : null;
  const mergedCopy = resolveChatGPTAdLibraryCopy({
    current: parsedCopy ?? {
      title: "",
      advertiserName: "",
      body: "",
      triggeringPrompts: [],
    },
    incoming: parsedCopy ?? seedCopy ?? {
      title: "",
      advertiserName: "",
      body: "",
      triggeringPrompts: [],
    },
    seed: seedCopy,
  });
  const importRecord = parsed
    ? { ...parsed, ...mergedCopy }
    : seed
      ? { ...seed, ...mergedCopy }
      : null;
  if (!importRecord) {
    return emptyUnlockerProbe(adId, pageUrl, {
      ...base,
      ok: false,
      importStatus: "skipped_no_copy",
      message:
        "Bild ist da, aber Anzeigentext und Trigger-Prompts fehlen. Ohne Copy importieren wir nicht — Bild allein nützt dem Korpus nichts.",
    });
  }

  const uploaderUserId = await resolveChatGPTAdLibraryUploaderUserId();
  const summary = await importChatGPTAdLibraryBatch({
    uploaderUserId,
    records: [importRecord],
  });
  await recordChatGPTAdLibraryIngestSummary({
    imported: summary.imported,
    skippedDuplicate: summary.skippedDuplicate + summary.refreshed,
    failed: summary.failed,
    details: { mode: "unlocker_probe", adId, plannedIds: [adId] },
  });
  const storedHits = await loadChatGPTAdLibraryForInternalIntelligence({
    limit: 48,
  }).catch(() => []);
  const stored = storedHits.find((hit) => hit.externalId === adId);
  const displayTitle = stored?.title || mergedCopy.title || title;
  const displayBody = stored?.bodyText || mergedCopy.body || null;
  const displayPrompts =
    stored?.triggeringPrompts?.length
      ? stored.triggeringPrompts
      : mergedCopy.triggeringPrompts;
  const displayed = {
    ...base,
    hasCopy: Boolean(displayBody || displayPrompts.length),
    title: displayTitle,
    body: displayBody,
    promptCount: displayPrompts.length,
    triggeringPrompts: displayPrompts.slice(0, 8),
  };

  const result = summary.results[0];
  const importStatus = result?.status ?? "failed";
  const ingested = importStatus === "imported" || importStatus === "refreshed";
  let message: string;
  if (importStatus === "imported") {
    message = `Bild + Text importiert: ${displayTitle ?? `#${adId}`} · ${displayPrompts.length} Trigger-Prompts.`;
  } else if (importStatus === "refreshed") {
    message = `Vault repariert: SEO-Anhang entfernt, ${displayPrompts.length} Trigger-Prompts gespeichert.`;
  } else if (importStatus === "skipped_duplicate") {
    message = `Schon im Vault. Gespeichert: ${displayBody ? "Anzeigentext" : "kein Body"} · ${displayPrompts.length} Prompts.`;
  } else {
    message = `Parser hatte Bild + Text, Import fehlgeschlagen: ${result?.error ?? "unbekannt"}.`;
  }

  return {
    ok: importStatus !== "failed",
    configured: true,
    ingested,
    importStatus,
    ...displayed,
    message,
  };
}
