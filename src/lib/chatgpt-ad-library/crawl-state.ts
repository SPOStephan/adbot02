import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  CHATGPT_AD_LIBRARY_PROBE_MAX_ID,
  CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
  CHATGPT_AD_LIBRARY_UNLOCK_BATCH_MAX,
  CHATGPT_AD_LIBRARY_UNLOCK_LEASE_MAX,
  CHATGPT_AD_LIBRARY_UNLOCK_LEASE_TTL_MS,
  CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT,
} from "@/lib/chatgpt-ad-library/scrape-constants";
import {
  compactPendingIds,
  normalizeLibraryIdList,
  selectScrapeBatch,
  type ScrapePlanSource,
} from "@/lib/chatgpt-ad-library/plan";
import { countChatGPTAdLibraryImports } from "@/lib/chatgpt-ad-library/retrieval";
import { CHATGPT_AD_LIBRARY_SYSTEM_IDS } from "@/lib/chatgpt-ad-library/system-ids";
import { CHATGPT_AD_LIBRARY_PROVIDER } from "@/lib/chatgpt-ad-library/types";
import { isChatGPTAdLibraryUnlockerConfigured } from "@/lib/chatgpt-ad-library/unlocker";

export type ChatGPTAdLibraryCrawlStatus = {
  enabled: boolean;
  pendingCount: number;
  skippedCount: number;
  vaultCount: number;
  lastPlanSource: ScrapePlanSource | null;
  queueStarved: boolean;
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
  leaseBusy: boolean;
  activeLeases: number;
  leaseUntil: string | null;
};

type CrawlRow = {
  id: string;
  enabled: boolean;
  pending_ids: unknown;
  skipped_ids?: unknown;
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
  return normalizeLibraryIdList(value);
}

function skippedFromRow(row: CrawlRow): string[] {
  const fromColumn = asIdList(row.skipped_ids);
  if (fromColumn.length > 0) return fromColumn;
  return asIdList(summary(row.last_run_summary).skipped_ids);
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

const ROW_SELECT_WITH_SKIPPED =
  "id,enabled,pending_ids,skipped_ids,next_discover_shard,last_plan_at,last_ingest_at,last_discover_at,last_run_summary,total_planned,total_imported,total_skipped_duplicate,total_failed";
const ROW_SELECT =
  "id,enabled,pending_ids,next_discover_shard,last_plan_at,last_ingest_at,last_discover_at,last_run_summary,total_planned,total_imported,total_skipped_duplicate,total_failed";

function isMissingSkippedColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return /skipped_ids/i.test(error.message ?? "");
}

async function loadRow(): Promise<CrawlRow> {
  const admin = createAdminClient();
  const withSkipped = await admin
    .from("chatgpt_ad_library_crawl_state")
    .select(ROW_SELECT_WITH_SKIPPED)
    .eq("id", "default")
    .maybeSingle();
  const { data, error } = isMissingSkippedColumn(withSkipped.error)
    ? await admin
        .from("chatgpt_ad_library_crawl_state")
        .select(ROW_SELECT)
        .eq("id", "default")
        .maybeSingle()
    : withSkipped;
  if (error) {
    throw new Error(`crawl_state_load_failed: ${error.message}`);
  }
  if (!data) {
    const inserted = await admin
      .from("chatgpt_ad_library_crawl_state")
      .upsert({ id: "default" }, { onConflict: "id" })
      .select(ROW_SELECT)
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
  const runSummary = summary(row.last_run_summary);
  const pending = asIdList(row.pending_ids);
  const skipped = skippedFromRow(row);
  const lastPlanIds = asIdList(runSummary.last_plan_ids);
  const lastPlanSource = (["pending", "catalog", "probe", "empty"] as const).includes(
    runSummary.last_plan_source as ScrapePlanSource,
  )
    ? (runSummary.last_plan_source as ScrapePlanSource)
    : null;
  const catalogSet = new Set(CHATGPT_AD_LIBRARY_SYSTEM_IDS);
  const queueStarved =
    pending.length > 20 &&
    lastPlanIds.length > 0 &&
    lastPlanIds.every((id) => catalogSet.has(id));
  const vaultCount = await countChatGPTAdLibraryImports().catch(() => 0);
  const leases = activeLeases(runSummary);
  return {
    enabled: row.enabled === true,
    pendingCount: pending.length,
    skippedCount: skipped.length,
    vaultCount,
    lastPlanSource,
    queueStarved,
    nextDiscoverShard: Number(row.next_discover_shard) || 0,
    nextProbeId: probeCursor(runSummary),
    catalogSize: CHATGPT_AD_LIBRARY_SYSTEM_IDS.length,
    probeMaxId: CHATGPT_AD_LIBRARY_PROBE_MAX_ID,
    lastPlanAt: row.last_plan_at,
    lastIngestAt: row.last_ingest_at,
    lastDiscoverAt: row.last_discover_at,
    lastRunSummary: publicRunSummary(runSummary),
    totalPlanned: Number(row.total_planned) || 0,
    totalImported: Number(row.total_imported) || 0,
    totalSkippedDuplicate: Number(row.total_skipped_duplicate) || 0,
    totalFailed: Number(row.total_failed) || 0,
    scrapeBatchMax: isChatGPTAdLibraryUnlockerConfigured()
      ? CHATGPT_AD_LIBRARY_UNLOCK_BATCH_MAX
      : CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX,
    sitemapShardCount: CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT,
    unlockerConfigured: isChatGPTAdLibraryUnlockerConfigured(),
    unlockerProvider: "scrapingbee",
    leaseBusy: leases.length >= CHATGPT_AD_LIBRARY_UNLOCK_LEASE_MAX,
    activeLeases: leases.length,
    leaseUntil: leases.reduce<string | null>((latest, item) => {
      if (!latest || item.until > latest) return item.until;
      return latest;
    }, null),
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
  const skipped = skippedFromRow(row);
  const imported = await alreadyImportedExternalIds(incoming).catch(() => new Set<string>());
  const pending = compactPendingIds({
    pending: row.pending_ids,
    skipped,
    imported,
  });
  const before = new Set(pending);
  for (const id of incoming) {
    if (!before.has(id) && !skipped.includes(id) && !imported.has(id)) pending.push(id);
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

const IMPORTED_LOOKUP_CHUNK = 80;

export function chatgptExternalIdOrFilter(ids: string[]): string {
  return normalizeLibraryIdList(ids)
    .map((id) => `metadata->external_source->>external_id.eq.${id}`)
    .join(",");
}

async function alreadyImportedExternalIds(ids: string[]): Promise<Set<string>> {
  const wanted = normalizeLibraryIdList(ids);
  const found = new Set<string>();
  if (wanted.length < 1) return found;

  const admin = createAdminClient();
  for (let i = 0; i < wanted.length; i += IMPORTED_LOOKUP_CHUNK) {
    const slice = wanted.slice(i, i + IMPORTED_LOOKUP_CHUNK);
    const orFilter = chatgptExternalIdOrFilter(slice);
    const { data, error } = await admin
      .from("brand_assets")
      .select("metadata")
      .eq("library_scope", "INSPIRATION")
      .neq("status", "REVOKED")
      .filter("metadata->external_source->>provider", "eq", CHATGPT_AD_LIBRARY_PROVIDER)
      .or(orFilter);
    if (error || !Array.isArray(data)) {
      for (const id of slice) {
        const one = await admin
          .from("brand_assets")
          .select("id")
          .eq("library_scope", "INSPIRATION")
          .neq("status", "REVOKED")
          .filter("metadata->external_source->>external_id", "eq", id)
          .limit(1)
          .maybeSingle();
        if (one.data?.id) found.add(id);
      }
      continue;
    }
    for (const row of data) {
      const externalId = externalIdFromMetadata(row.metadata);
      if (externalId) found.add(externalId);
    }
    const missing = slice.filter((id) => !found.has(id));
    for (const id of missing) {
      const one = await admin
        .from("brand_assets")
        .select("id")
        .eq("library_scope", "INSPIRATION")
        .neq("status", "REVOKED")
        .filter("metadata->external_source->>provider", "eq", CHATGPT_AD_LIBRARY_PROVIDER)
        .filter("metadata->external_source->>external_id", "eq", id)
        .limit(1)
        .maybeSingle();
      if (one.data?.id) found.add(id);
    }
  }
  return found;
}

function publicRunSummary(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value };
  delete next.skipped_ids;
  if (Array.isArray(next.last_plan_ids)) {
    next.last_plan_ids = next.last_plan_ids.slice(0, 40);
  }
  return next;
}

export async function planChatGPTAdLibraryScrapeBatch(input?: {
  limit?: number;
}): Promise<{
  enabled: boolean;
  ids: string[];
  pendingRemaining: number;
  source: ScrapePlanSource;
  discoverShard: number | null;
}> {
  const row = await loadRow();
  if (!row.enabled) {
    return {
      enabled: false,
      ids: [],
      pendingRemaining: asIdList(row.pending_ids).length,
      source: "empty",
      discoverShard: null,
    };
  }

  const limit = Math.min(
    Math.max(input?.limit ?? CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX, 1),
    80,
  );
  const runSummary = summary(row.last_run_summary);
  const skipped = skippedFromRow(row);
  const pending = asIdList(row.pending_ids);
  const lookahead = pending.slice(0, Math.max(limit * 10, 400));
  const imported = await alreadyImportedExternalIds([
    ...lookahead,
    ...CHATGPT_AD_LIBRARY_SYSTEM_IDS,
  ]);
  const vaultCount = await countChatGPTAdLibraryImports().catch(() => 0);
  const pick = selectScrapeBatch({
    pending,
    skipped,
    imported,
    nextProbeId: probeCursor(runSummary),
    limit,
    skipCatalog: vaultCount > 0,
  });
  const discoverShard = Number(row.next_discover_shard) % CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT;
  const nextSummary = {
    ...runSummary,
    last_plan_ids: pick.ids,
    last_plan_at: new Date().toISOString(),
    last_plan_source: pick.source,
    next_probe_id: pick.nextProbeId,
    catalog_size: CHATGPT_AD_LIBRARY_SYSTEM_IDS.length,
    skipped_ids: skipped.slice(0, 20_000),
  };

  const admin = createAdminClient();
  const update: Record<string, unknown> = {
    pending_ids: pick.remainingPending.slice(0, 50_000),
    last_plan_at: new Date().toISOString(),
    total_planned: Number(row.total_planned || 0) + pick.ids.length,
    last_run_summary: nextSummary,
    updated_at: new Date().toISOString(),
  };
  let { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({ ...update, skipped_ids: skipped.slice(0, 20_000) })
    .eq("id", "default");
  if (error && isMissingSkippedColumn(error)) {
    const fallback = await admin
      .from("chatgpt_ad_library_crawl_state")
      .update(update)
      .eq("id", "default");
    error = fallback.error;
  }
  if (error) throw new Error(`crawl_state_plan_failed: ${error.message}`);

  return {
    enabled: true,
    ids: pick.ids,
    pendingRemaining: pick.remainingPending.length,
    source: pick.source,
    discoverShard,
  };
}

export async function markChatGPTAdLibraryIdsSkipped(ids: Array<number | string>): Promise<{
  skippedCount: number;
  pendingCount: number;
}> {
  const incoming = asIdList(ids);
  const row = await loadRow();
  const skipped = [...new Set([...skippedFromRow(row), ...incoming])].slice(0, 20_000);
  const pending = compactPendingIds({
    pending: row.pending_ids,
    skipped,
  });
  const admin = createAdminClient();
  const payload = {
    pending_ids: pending,
    last_run_summary: {
      ...summary(row.last_run_summary),
      skipped_ids: skipped,
    },
    updated_at: new Date().toISOString(),
  };
  let { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({ ...payload, skipped_ids: skipped })
    .eq("id", "default");
  if (error && isMissingSkippedColumn(error)) {
    const fallback = await admin
      .from("chatgpt_ad_library_crawl_state")
      .update(payload)
      .eq("id", "default");
    error = fallback.error;
  }
  if (error) throw new Error(`crawl_state_skip_failed: ${error.message}`);
  return { skippedCount: skipped.length, pendingCount: pending.length };
}

export async function unstickChatGPTAdLibraryQueue(): Promise<{
  pendingBefore: number;
  pendingAfter: number;
  droppedImported: number;
  droppedSkipped: number;
  requeuedSkipped: number;
  vaultCount: number;
}> {
  const row = await loadRow();
  const pendingBefore = asIdList(row.pending_ids);
  const skipped = skippedFromRow(row);
  const imported = await alreadyImportedExternalIds([...pendingBefore, ...skipped]);
  const recovered = skipped.filter((id) => !imported.has(id));
  const pendingAfter = compactPendingIds({
    pending: [...pendingBefore, ...recovered],
    imported,
  });
  const admin = createAdminClient();
  const runSummary = {
    ...summary(row.last_run_summary),
    skipped_ids: [],
    last_unstick_at: new Date().toISOString(),
    last_unstick_dropped: pendingBefore.length + recovered.length - pendingAfter.length,
    last_unstick_requeued_skipped: recovered.length,
    last_unlocker_block: null,
  };
  const payload = {
    pending_ids: pendingAfter.slice(0, 50_000),
    last_run_summary: runSummary,
    updated_at: new Date().toISOString(),
  };
  let { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({ ...payload, skipped_ids: [] })
    .eq("id", "default");
  if (error && isMissingSkippedColumn(error)) {
    const fallback = await admin
      .from("chatgpt_ad_library_crawl_state")
      .update(payload)
      .eq("id", "default");
    error = fallback.error;
  }
  if (error) throw new Error(`crawl_state_unstick_failed: ${error.message}`);
  return {
    pendingBefore: pendingBefore.length,
    pendingAfter: pendingAfter.length,
    droppedImported: pendingBefore.filter((id) => imported.has(id)).length,
    droppedSkipped: pendingBefore.filter((id) => skipped.includes(id)).length,
    requeuedSkipped: recovered.length,
    vaultCount: await countChatGPTAdLibraryImports().catch(() => 0),
  };
}

export async function markChatGPTAdLibraryDiscoverDone(input: {
  shard: number;
  enqueuedIds: string[];
}): Promise<void> {
  const row = await loadRow();
  const nextShard =
    (Number(row.next_discover_shard) + 1) % CHATGPT_AD_LIBRARY_SITEMAP_SHARD_COUNT;
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
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

type ScrapeLease = { owner: string; until: string };

function activeLeases(value: Record<string, unknown>, now = Date.now()): ScrapeLease[] {
  const raw = value.active_leases;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const owner = String((item as { owner?: unknown }).owner ?? "").trim();
    const until = String((item as { until?: unknown }).until ?? "").trim();
    const expires = Date.parse(until);
    if (!owner || !Number.isFinite(expires) || expires <= now) return [];
    return [{ owner, until }];
  });
}

export async function claimChatGPTAdLibraryScrapeLease(input?: {
  owner?: string;
  maxConcurrent?: number;
  ttlMs?: number;
}): Promise<{ claimed: boolean; owner: string; active: number }> {
  const owner =
    input?.owner?.trim() ||
    `scrape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const maxConcurrent = Math.max(
    1,
    input?.maxConcurrent ?? CHATGPT_AD_LIBRARY_UNLOCK_LEASE_MAX,
  );
  const ttlMs = Math.max(30_000, input?.ttlMs ?? CHATGPT_AD_LIBRARY_UNLOCK_LEASE_TTL_MS);
  const row = await loadRow();
  const runSummary = summary(row.last_run_summary);
  const leases = activeLeases(runSummary);
  if (leases.length >= maxConcurrent) {
    return { claimed: false, owner, active: leases.length };
  }
  const next = [
    ...leases,
    { owner, until: new Date(Date.now() + ttlMs).toISOString() },
  ];
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
      last_run_summary: {
        ...runSummary,
        active_leases: next,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_lease_claim_failed: ${error.message}`);
  return { claimed: true, owner, active: next.length };
}

export async function releaseChatGPTAdLibraryScrapeLease(owner: string): Promise<void> {
  const row = await loadRow();
  const runSummary = summary(row.last_run_summary);
  const next = activeLeases(runSummary).filter((item) => item.owner !== owner);
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
      last_run_summary: {
        ...runSummary,
        active_leases: next,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_lease_release_failed: ${error.message}`);
}

export async function clearChatGPTAdLibraryScrapeLeases(): Promise<{
  released: number;
}> {
  const row = await loadRow();
  const runSummary = summary(row.last_run_summary);
  const released = activeLeases(runSummary).length;
  const admin = createAdminClient();
  const { error } = await admin
    .from("chatgpt_ad_library_crawl_state")
    .update({
      last_run_summary: {
        ...runSummary,
        active_leases: [],
        last_lease_cleared_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", "default");
  if (error) throw new Error(`crawl_state_lease_clear_failed: ${error.message}`);
  return { released };
}
