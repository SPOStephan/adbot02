import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CHATGPT_AD_LIBRARY_PROBE_MAX_ID,
  CHATGPT_AD_LIBRARY_PROBE_WINDOW,
  CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
  CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT,
} from "@/lib/chatgpt-ad-library/scrape-constants";
import { CHATGPT_AD_LIBRARY_SYSTEM_IDS } from "@/lib/chatgpt-ad-library/system-ids";
import { CHATGPT_AD_LIBRARY_PROVIDER } from "@/lib/chatgpt-ad-library/types";
import { isChatGPTAdLibraryUnlockerConfigured } from "@/lib/chatgpt-ad-library/unlocker";

export type ChatGPTAdLibraryCrawlStatus = {
  enabled: boolean;
  pendingCount: number;
  nextDiscoverShard: number;
  nextProbeId: number;
  catalogSize: number;
  probeMaxId: number;
  lastPlanAt: string | null;
  lastIngestAt: string | null;
  lastDiscoverAt: string | null;
  lastRunSummary: Record<string, unknown>;
  totalPlanned: number;
  totalImported: number;
  totalSkippedDuplicate: number;
  totalFailed: number;
  scrapeBatchMax: number;
  sitemapShardCount: number;
  unlockerConfigured: boolean;
  unlockerProvider: "scrapingbee";
};

type CrawlRow = {
  id: string;
  enabled: boolean;
  pending_ids: unknown;
  next_discover_shard: number;
  last_plan_at: string | null;
  last_ingest_at: string | null;
  last_discover_at: string | null;
  last_run_summary: unknown;
  total_planned: number;
  total_imported: number;
  total_skipped_duplicate: number;
  total_failed: number;
};

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => String(item ?? "").trim())
        .filter((item) => /^\d{1,12}$/.test(item)),
    ),
  ];
}

function uniqueIds(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter((id) => /^\d{1,12}$/.test(id)))];
}

function summary(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function probeCursor(value: Record<string, unknown>): number {
  const raw = Number(value.next_probe_id);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(Math.floor(raw), CHATGPT_AD_LIBRARY_PROBE_MAX_ID + 1);
}

async function loadRow(): Promise<CrawlRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .select(
      "id,enabled,pending_ids,next_discover_shard,last_plan_at,last_ingest_at,last_discover_at,last_run_summary,total_planned,total_imported,total_skipped_duplicate,total_failed",
    )
    .eq("id", "default")
    .maybeSingle();
  if (error) {
    throw new Error(`crawl_state_load_failed: ${error.message}`);
  }
  if (!data) {
    const inserted = await admin
      .from("chatgpt_ad_library_crawl_state")
      .upsert({ id: "default" }, { onConflict: "id" })
      .select(
        "id,enabled,pending_ids,next_discover_shard,last_plan_at,last_ingest_at,last_discover_at,last_run_summary,total_planned,total_imported,total_skipped_duplicate,total_failed",
      )
      .maybeSingle();
    if (inserted.error || !inserted.data) {
      throw new Error("crawl_state_bootstrap_failed");
    }
    return inserted.data as CrawlRow;
  }
  return data as CrawlRow;
}

export async function getChatGPTAdLibraryCrawlStatus(): Promise<ChatGPTAdLibraryCrawlStatus> {
  const row = await loadRow();
  return {
    enabled: row.enabled === true,
    pendingCount: asIdList(row.pending_ids).length,
    nextDiscoverShard: Number(row.next_discover_shard) || 0,
    nextProbeId: probeCursor(summary(row.last_run_summary)),
    catalogSize: CHATGPT_AD_LIBRARY_SYSTEM_IDS.length,
    probeMaxId: CHATGPT_AD_LIBRARY_PROBE_MAX_ID,
    lastPlanAt: row.last_plan_at,
    lastIngestAt: row.last_ingest_at,
    lastDiscoverAt: row.last_discover_at,
    lastRunSummary: summary(row.last_run_summary),
    totalPlanned: Number(row.total_planned) || 0,
    totalImported: Number(row.total_imported) || 0,
    totalSkippedDuplicate: Number(row.total_skipped_duplicate) || 0,
    totalFailed: Number(row.total_failed) || 0,
    scrapeBatchMax: CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
    sitemapShardCount: CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT,
    unlockerConfigured: isChatGPTAdLibraryUnlockerConfigured(),
    unlockerProvider: "scrapingbee",
  };
}

export async function setChatGPTAdLibraryCrawlEnabled(enabled: boolean): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_enable_failed: ${error.message}`);
  if (enabled) {
    await enqueueChatGPTAdLibraryIds(CHATGPT_AD_LIBRARY_SYSTEM_IDS);
  }
}

export async function enqueueChatGPTAdLibraryIds(ids: Array<number | string>): Promise<{
  added: number;
  pendingCount: number;
}> {
  const incoming = asIdList(ids);
  const row = await loadRow();
  const pending = asIdList(row.pending_ids);
  const before = new Set(pending);
  for (const id of incoming) {
    if (!before.has(id)) pending.push(id);
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
      pending_ids: pending.slice(0, 50_000),
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_enqueue_failed: ${error.message}`);
  return {
    added: Math.max(0, pending.length - before.size),
    pendingCount: pending.length,
  };
}

function externalIdFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const external =
    "external_source" in metadata &&
    metadata.external_source &&
    typeof metadata.external_source === "object" &&
    !Array.isArray(metadata.external_source)
      ? (metadata.external_source as Record<string, unknown>)
      : {};
  if (external.provider !== CHATGPT_AD_LIBRARY_PROVIDER) return null;
  const externalId = String(external.external_id ?? "").trim();
  return /^\d{1,12}$/.test(externalId) ? externalId : null;
}

async function alreadyImportedExternalIds(ids: string[]): Promise<Set<string>> {
  const wanted = new Set(ids.filter((id) => /^\d{1,12}$/.test(id)));
  const found = new Set<string>();
  if (wanted.size < 1) return found;

  const admin = createAdminClient();
  const page = 200;
  for (let from = 0; from < 10_000; from += page) {
    const { data, error } = await admin
      .from("brand_assets")
      .select("metadata")
      .eq("library_scope", "INSPIRATION")
      .neq("status", "REVOKED")
      .filter("metadata->external_source->>provider", "eq", CHATGPT_AD_LIBRARY_PROVIDER)
      .range(from, from + page - 1);
    if (error || !Array.isArray(data) || data.length < 1) break;
    for (const row of data) {
      const externalId = externalIdFromMetadata(row.metadata);
      if (externalId && wanted.has(externalId)) found.add(externalId);
    }
    if (data.length < page || found.size >= wanted.size) break;
  }
  return found;
}

function nextProbeWindow(
  start: number,
  exclude: Set<string>,
): { ids: string[]; nextProbeId: number } {
  const ids: string[] = [];
  let cursor = start;
  while (cursor <= CHATGPT_AD_LIBRARY_PROBE_MAX_ID && ids.length < CHATGPT_AD_LIBRARY_PROBE_WINDOW) {
    const id = String(cursor);
    cursor += 1;
    if (!exclude.has(id)) ids.push(id);
  }
  return { ids, nextProbeId: cursor };
}

export async function planChatGPTAdLibraryScrapeBatch(input?: {
  limit?: number;
}): Promise<{
  enabled: boolean;
  ids: string[];
  pendingRemaining: number;
  discoverShard: number | null;
}> {
  const row = await loadRow();
  if (!row.enabled) {
    return {
      enabled: false,
      ids: [],
      pendingRemaining: asIdList(row.pending_ids).length,
      discoverShard: null,
    };
  }

  const limit = Math.min(
    Math.max(input?.limit ?? CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX, 1),
    CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
  );
  const runSummary = summary(row.last_run_summary);
  let nextProbeId = probeCursor(runSummary);

  const pending = asIdList(row.pending_ids);
  let merged = uniqueIds([...CHATGPT_AD_LIBRARY_SYSTEM_IDS], pending);
  let imported = await alreadyImportedExternalIds(merged);
  let fresh = merged.filter((id) => !imported.has(id));

  if (fresh.length < limit && nextProbeId <= CHATGPT_AD_LIBRARY_PROBE_MAX_ID) {
    const exclude = new Set([...merged, ...fresh]);
    const window = nextProbeWindow(nextProbeId, exclude);
    nextProbeId = window.nextProbeId;
    if (window.ids.length > 0) {
      const windowImported = await alreadyImportedExternalIds(window.ids);
      imported = new Set([...imported, ...windowImported]);
      fresh = uniqueIds(
        fresh,
        window.ids.filter((id) => !imported.has(id)),
      );
    }
  }

  const ids = fresh.slice(0, limit);
  const remaining = fresh.slice(ids.length);
  const discoverShard = Number(row.next_discover_shard) % CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT;

  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
      pending_ids: remaining.slice(0, 50_000),
      last_plan_at: new Date().toISOString(),
      total_planned: Number(row.total_planned || 0) + ids.length,
      last_run_summary: {
        ...runSummary,
        last_plan_ids: ids,
        last_plan_at: new Date().toISOString(),
        next_probe_id: nextProbeId,
        catalog_size: CHATGPT_AD_LIBRARY_SYSTEM_IDS.length,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_plan_failed: ${error.message}`);

  return {
    enabled: true,
    ids,
    pendingRemaining: remaining.length,
    discoverShard,
  };
}

export async function markChatGPTAdLibraryDiscoverDone(input: {
  shard: number;
  enqueuedIds: string[];
}): Promise<void> {
  const row = await loadRow();
  const pending = asIdList(row.pending_ids);
  const before = new Set(pending);
  for (const id of asIdList(input.enqueuedIds)) {
    if (!before.has(id)) pending.push(id);
  }
  const nextShard =
    (Number(row.next_discover_shard) + 1) % CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT;
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
      pending_ids: pending.slice(0, 50_000),
      next_discover_shard: nextShard,
      last_discover_at: new Date().toISOString(),
      last_run_summary: {
        ...summary(row.last_run_summary),
        last_discover_shard: input.shard,
        last_discover_count: asIdList(input.enqueuedIds).length,
        last_discover_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_discover_failed: ${error.message}`);
}

export async function recordChatGPTAdLibraryIngestSummary(input: {
  imported: number;
  skippedDuplicate: number;
  failed: number;
  details?: Record<string, unknown>;
}): Promise<void> {
  const row = await loadRow();
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
      last_ingest_at: new Date().toISOString(),
      total_imported: Number(row.total_imported || 0) + input.imported,
      total_skipped_duplicate:
        Number(row.total_skipped_duplicate || 0) + input.skippedDuplicate,
      total_failed: Number(row.total_failed || 0) + input.failed,
      last_run_summary: {
        ...summary(row.last_run_summary),
        ...input.details,
        last_ingest_at: new Date().toISOString(),
        last_imported: input.imported,
        last_skipped_duplicate: input.skippedDuplicate,
        last_failed: input.failed,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_ingest_failed: ${error.message}`);
}
