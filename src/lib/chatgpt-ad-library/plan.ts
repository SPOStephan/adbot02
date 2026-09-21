import { CHATGPT_AD_LIBRARY_SYSTEM_IDS } from "@/lib/chatgpt-ad-library/system-ids";
import {
  CHATGPT_AD_LIBRARY_PROBE_MAX_ID,
  CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
} from "@/lib/chatgpt-ad-library/scrape-constants";

export type ScrapePlanSource = "pending" | "catalog" | "probe" | "empty";

export type ScrapePlanPick = {
  ids: string[];
  remainingPending: string[];
  nextProbeId: number;
  source: ScrapePlanSource;
};

const SKIP_ERRORS = new Set([
  "parse_failed",
  "parse_copy_missing",
  "http_404",
  "unlocker_404",
  "http_410",
  "unlocker_410",
]);

/** ScrapingBee credit/auth/param errors must not burn the queue into skipped_ids. */
export function isUnlockerProviderBlockError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  return (
    normalized === "unlocker_credits" ||
    normalized === "unlocker_400" ||
    normalized === "unlocker_401" ||
    normalized === "unlocker_402" ||
    normalized === "unlocker_403" ||
    /credit|quota|payment required|api[_ ]key/i.test(normalized)
  );
}

export function normalizeLibraryIdList(value: unknown): string[] {
  if (typeof value === "string" && /^\d{1,12}$/.test(value.trim())) return [value.trim()];
  const list =
    Array.isArray(value)
      ? value
      : value instanceof Set
        ? [...value]
        : value && typeof value === "object" && Symbol.iterator in value
          ? [...(value as Iterable<unknown>)]
          : [];
  return [
    ...new Set(
      list
        .map((item) => String(item ?? "").trim())
        .filter((item) => /^\d{1,12}$/.test(item)),
    ),
  ];
}

export function shouldSkipScrapeError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  if (isUnlockerProviderBlockError(normalized)) return false;
  if (SKIP_ERRORS.has(normalized)) return true;
  return /^(http|unlocker)_4(04|10)$/.test(normalized);
}

export function compactPendingIds(input: {
  pending: unknown;
  skipped?: unknown;
  imported?: Iterable<string>;
}): string[] {
  const skipped = new Set(normalizeLibraryIdList(input.skipped));
  const imported = new Set(input.imported ?? []);
  return normalizeLibraryIdList(input.pending).filter(
    (id) => !skipped.has(id) && !imported.has(id),
  );
}

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  let next = 0;
  async function run(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => run()));
  return results;
}

export function selectScrapeBatch(input: {
  pending: unknown;
  skipped?: unknown;
  imported?: Iterable<string>;
  systemIds?: readonly string[];
  nextProbeId?: number;
  limit?: number;
  /** After the vault has real imports, do not keep re-planning the seed catalog. */
  skipCatalog?: boolean;
}): ScrapePlanPick {
  const limit = Math.min(
    Math.max(input.limit ?? CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX, 1),
    80,
  );
  const imported = new Set(input.imported ?? []);
  const skipped = new Set(normalizeLibraryIdList(input.skipped));
  const exclude = new Set([...imported, ...skipped]);
  const pending = compactPendingIds({
    pending: input.pending,
    skipped,
    imported,
  });
  let nextProbeId = Number(input.nextProbeId);
  if (!Number.isFinite(nextProbeId) || nextProbeId < 1) nextProbeId = 1;
  nextProbeId = Math.min(Math.floor(nextProbeId), CHATGPT_AD_LIBRARY_PROBE_MAX_ID + 1);

  if (pending.length > 0) {
    return {
      ids: pending.slice(0, limit),
      remainingPending: pending.slice(limit),
      nextProbeId,
      source: "pending",
    };
  }

  const catalog = input.skipCatalog
    ? []
    : (input.systemIds ?? CHATGPT_AD_LIBRARY_SYSTEM_IDS).filter((id) => !exclude.has(id));
  if (catalog.length > 0) {
    return {
      ids: catalog.slice(0, limit),
      remainingPending: [],
      nextProbeId,
      source: "catalog",
    };
  }

  const probeIds: string[] = [];
  let cursor = nextProbeId;
  while (cursor <= CHATGPT_AD_LIBRARY_PROBE_MAX_ID && probeIds.length < limit) {
    const id = String(cursor);
    cursor += 1;
    if (!exclude.has(id)) probeIds.push(id);
  }

  return {
    ids: probeIds,
    remainingPending: [],
    nextProbeId: cursor,
    source: probeIds.length > 0 ? "probe" : "empty",
  };
}
