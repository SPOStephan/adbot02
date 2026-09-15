import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
  CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT,
} from "@/lib/chatgpt-ad-library/scrape-constants";
import { CHATGPT_AD_LIBRARY_PROVIDER } from "@/lib/chatgpt-ad-library/types";

export type ChatGPTAdLibraryCrawlStatus = {
  enabled: boolean;
  pendingCount: number;
  nextDiscoverShard: number;
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

function summary(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
  };
}

export async function setChatGPTAdLibraryCrawlEnabled(enabled: boolean): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_enable_failed: ${error.message}`);
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

async function alreadyImportedExternalIds(ids: string[]): Promise<Set<string>> {
  if (ids.length < 1) return new Set();
  const admin = createAdminClient();
  const found = new Set<string>();
  // Bounded scan — inspiration library stays admin-scale for now.
  const { data, error } = await admin
    .from("brand_assets")
    .select("metadata")
    .eq("library_scope", "INSPIRATION")
    .neq("status", "REVOKED")
    .filter("metadata->>library", "eq", "ad_example_library")
    .limit(500);
  if (error || !Array.isArray(data)) return found;
  const wanted = new Set(ids);
  for (const row of data) {
    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    const external =
      metadata.external_source &&
      typeof metadata.external_source === "object" &&
      !Array.isArray(metadata.external_source)
        ? (metadata.external_source as Record<string, unknown>)
        : {};
    if (external.provider !== CHATGPT_AD_LIBRARY_PROVIDER) continue;
    const externalId = String(external.external_id ?? "");
    if (wanted.has(externalId)) found.add(externalId);
  }
  return found;
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
  const pending = asIdList(row.pending_ids);
  const imported = await alreadyImportedExternalIds(pending.slice(0, 200));
  const fresh = pending.filter((id) => !imported.has(id));
  const ids = fresh.slice(0, limit);
  const remaining = fresh.slice(ids.length);

  const shouldDiscover = ids.length < limit || remaining.length < 20;
  const discoverShard = shouldDiscover
    ? Number(row.next_discover_shard) % CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT
    : null;

  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
      pending_ids: remaining,
      last_plan_at: new Date().toISOString(),
      total_planned: Number(row.total_planned || 0) + ids.length,
      last_run_summary: {
        ...summary(row.last_run_summary),
        last_plan_ids: ids,
        last_plan_at: new Date().toISOString(),
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
