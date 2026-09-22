import { getPlan, getStatus, postAction } from "./adbot";
import { isUnlockerProviderBlockError, mapPool, shouldSkipScrapeError } from "./pool";
import {
  extractAdIdsFromSitemapXml,
  hasUsableChatGPTAdLibraryCopy,
  parseChatGPTAdLibraryHtml,
} from "./shared/parse-html";
import {
  isChatGPTAdLibraryUnlockerConfigured,
  isScrapingBeeCreditOrAuthError,
  unlockChatGPTAdLibraryUrl,
} from "./shared/unlocker-core";

const ORIGIN = "https://www.chatgptadlibrary.com";
const BATCH_MAX = 40;
const CONCURRENCY = 12;
const DISCOVER_DEFER_PENDING = 250;
const DISCOVER_COOLDOWN_MS = 10 * 60_000;
const SITEMAP_SHARD_COUNT = 4;

export type WorkerRunResult = {
  ok: true;
  isolated: true;
  mode: string;
  configured: boolean;
  rounds: number;
  plannedIds: string[];
  ingested: number;
  skipped: number;
  failed: number;
  discovered: number;
  blocked: boolean;
  providerBlocked: boolean;
  failures: Array<{ id: string; error: string }>;
};

async function unlockOne(id: string): Promise<{
  id: string;
  error: string | null;
  blocked: boolean;
  record: unknown | null;
}> {
  const pageUrl = `${ORIGIN}/ad/${id}`;
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
}

async function persistFailures(failures: Array<{ id: string; error: string }>): Promise<void> {
  const skip = failures.filter((item) => shouldSkipScrapeError(item.error)).map((item) => item.id);
  const retry = failures.filter((item) => !shouldSkipScrapeError(item.error)).map((item) => item.id);
  if (skip.length > 0) await postAction("skip", { ids: skip });
  if (retry.length > 0) await postAction("requeue", { ids: retry });
}

async function maybeDiscover(status: Awaited<ReturnType<typeof getStatus>>): Promise<number> {
  const pending = Number(status.pendingCount) || 0;
  if (pending >= DISCOVER_DEFER_PENDING) return 0;
  const lastDiscoverMs = status.lastDiscoverAt ? Date.parse(status.lastDiscoverAt) : Number.NaN;
  if (Number.isFinite(lastDiscoverMs) && Date.now() - lastDiscoverMs < DISCOVER_COOLDOWN_MS) {
    return 0;
  }
  const shard = Number(status.nextDiscoverShard) % SITEMAP_SHARD_COUNT;
  const url = `${ORIGIN}/ad/sitemaps/${String(shard).padStart(3, "0")}.xml`;
  const unlocked = await unlockChatGPTAdLibraryUrl(url);
  if (!unlocked.ok) return 0;
  const ids = extractAdIdsFromSitemapXml(unlocked.text);
  if (ids.length < 1) return 0;
  const result = await postAction("discover", { shard, xml: unlocked.text, ids });
  return Number(result.added) || 0;
}

export async function runDedicatedUnlock(input?: {
  mode?: string;
  rounds?: number;
  budgetMs?: number;
}): Promise<WorkerRunResult> {
  const mode = input?.mode ?? "run";
  const configured = isChatGPTAdLibraryUnlockerConfigured();
  const plannedIds: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];
  let ingested = 0;
  let skipped = 0;
  let failed = 0;
  let discovered = 0;
  let blocked = false;
  let providerBlocked = false;
  let rounds = 0;

  if (!configured) {
    return {
      ok: true,
      isolated: true,
      mode,
      configured: false,
      rounds: 0,
      plannedIds,
      ingested,
      skipped,
      failed,
      discovered,
      blocked: false,
      providerBlocked: false,
      failures: [{ id: "-", error: "unlocker_not_configured" }],
    };
  }

  const status = await getStatus();
  if (status.enabled === false) {
    return {
      ok: true,
      isolated: true,
      mode,
      configured,
      rounds: 0,
      plannedIds,
      ingested,
      skipped,
      failed,
      discovered,
      blocked: false,
      providerBlocked: false,
      failures: [],
    };
  }

  if (mode !== "unlock") {
    discovered = await maybeDiscover(status);
  }

  const maxRounds = Math.min(Math.max(input?.rounds ?? 8, 1), 16);
  const budgetMs = Math.min(Math.max(input?.budgetMs ?? 270_000, 30_000), 290_000);
  const deadline = Date.now() + budgetMs;

  for (let i = 0; i < maxRounds; i += 1) {
    if (Date.now() >= deadline - 20_000) break;
    const plan = await getPlan(BATCH_MAX);
    if (!plan.enabled || plan.ids.length < 1) break;
    rounds += 1;
    plannedIds.push(...plan.ids);
    const leftover: string[] = [];
    const queue = [...plan.ids];
    const records: unknown[] = [];
    const roundFailures: Array<{ id: string; error: string }> = [];
    let roundProviderBlocked = false;

    while (queue.length > 0) {
      if (Date.now() >= deadline) {
        leftover.push(...queue);
        break;
      }
      const wave = queue.splice(0, CONCURRENCY);
      const waveResults = await mapPool(wave, CONCURRENCY, unlockOne);
      for (const item of waveResults) {
        if (item.record) {
          records.push(item.record);
          continue;
        }
        if (item.blocked) blocked = true;
        if (isUnlockerProviderBlockError(item.error ?? "")) {
          roundProviderBlocked = true;
          providerBlocked = true;
        }
        roundFailures.push({ id: item.id, error: item.error ?? "unlocker_failed" });
      }
      if (roundProviderBlocked) {
        leftover.push(...queue);
        break;
      }
    }

    if (leftover.length > 0) {
      await postAction("requeue", { ids: leftover });
    }
    const skippable = roundProviderBlocked
      ? roundFailures.filter((item) => !isUnlockerProviderBlockError(item.error))
      : roundFailures;
    const blockedIds = roundProviderBlocked
      ? roundFailures.filter((item) => isUnlockerProviderBlockError(item.error)).map((item) => item.id)
      : [];
    if (blockedIds.length > 0) await postAction("requeue", { ids: blockedIds });
    await persistFailures(skippable);
    failures.push(...roundFailures);

    if (records.length > 0) {
      const ingest = await postAction("ingest", { records });
      const summary = (ingest.summary ?? {}) as {
        imported?: number;
        skippedDuplicate?: number;
        failed?: number;
      };
      ingested += Number(summary.imported) || 0;
      skipped += Number(summary.skippedDuplicate) || 0;
      failed += Number(summary.failed) || 0;
    }

    if (roundProviderBlocked) break;
  }

  return {
    ok: true,
    isolated: true,
    mode,
    configured,
    rounds,
    plannedIds,
    ingested,
    skipped,
    failed: failed + failures.length,
    discovered,
    blocked,
    providerBlocked,
    failures: failures.slice(0, 24),
  };
}

export function parseWorkerMode(raw: string | null): "run" | "run_now" | "discover" | "unlock" {
  const mode = (raw ?? "run").toLowerCase();
  if (mode === "run_now" || mode === "discover" || mode === "unlock") return mode;
  return "run";
}

export function roundsForMode(mode: string): number {
  return mode === "run_now" ? 6 : 8;
}
