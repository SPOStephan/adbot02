import "server-only";

import {
  CONTENT_DETECTION_LOOKBACK_DAYS,
  summarizeDetectionWindows,
  type ContentDetectionSourceCounts,
} from "@/lib/meta/content-detection-history";
import { shouldListAsContentCandidate } from "@/lib/meta/content-candidate-lifecycle";
import { resolveCustomerNextSyncAt } from "@/lib/meta/schedule";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ContentSyncCandidate = {
  id: string;
  source: string;
  metaAssetId: string | null;
  contentType: string | null;
  captionExcerpt: string | null;
  permalinkUrl: string | null;
  previewUrl: string | null;
  publishedAt: string | null;
  firstSeenAt: string | null;
};

export type ContentDetectionHistoryItem = ContentSyncCandidate & {
  lastSeenAt: string | null;
  isNew: boolean;
};

export type ContentAssetSyncHint = {
  assetType: "facebook_page" | "instagram_account";
  label: string;
  lastSyncedAt: string | null;
};

export type ContentSyncSnapshot = {
  status: string | null;
  errorCode: string | null;
  lastSyncStartedAt: string | null;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  displayNextSyncAt: string;
  baselineCompleted: boolean;
  seenCount: number;
  newCount: number;
  storedCandidateCount: number;
  candidates: ContentSyncCandidate[];
  /** Recent detections for retrospective UI (not limited to is_new). */
  detectionHistory: ContentDetectionHistoryItem[];
  detectionSummary: {
    today: ContentDetectionSourceCounts;
    week: ContentDetectionSourceCounts;
  };
  assetSyncHints: ContentAssetSyncHint[];
};

export type { ContentDetectionSourceCounts };

const CANDIDATE_FETCH_LIMIT = 40;
const CANDIDATE_DISPLAY_LIMIT = 8;
const HISTORY_FETCH_LIMIT = 60;

function mapCandidate(candidate: Record<string, unknown>): ContentSyncCandidate {
  return {
    id: String(candidate.id),
    source: String(candidate.source ?? ""),
    metaAssetId:
      candidate.meta_asset_id === null || candidate.meta_asset_id === undefined
        ? null
        : String(candidate.meta_asset_id),
    contentType:
      candidate.content_type === null || candidate.content_type === undefined
        ? null
        : String(candidate.content_type),
    captionExcerpt:
      candidate.caption_excerpt === null ||
      candidate.caption_excerpt === undefined
        ? null
        : String(candidate.caption_excerpt),
    permalinkUrl:
      candidate.permalink_url === null || candidate.permalink_url === undefined
        ? null
        : String(candidate.permalink_url),
    previewUrl:
      candidate.preview_url === null || candidate.preview_url === undefined
        ? null
        : String(candidate.preview_url),
    publishedAt:
      candidate.published_at === null || candidate.published_at === undefined
        ? null
        : String(candidate.published_at),
    firstSeenAt:
      candidate.first_seen_at === null || candidate.first_seen_at === undefined
        ? null
        : String(candidate.first_seen_at),
  };
}

function mapHistoryItem(
  candidate: Record<string, unknown>,
): ContentDetectionHistoryItem {
  return {
    ...mapCandidate(candidate),
    lastSeenAt:
      candidate.last_seen_at === null || candidate.last_seen_at === undefined
        ? null
        : String(candidate.last_seen_at),
    isNew: candidate.is_new === true,
  };
}

export async function loadContentSyncSnapshot(input: {
  supabase: SupabaseClient;
  userId: string;
  platformAccountId: string;
  connector: {
    sync_status: string | null;
    sync_error_code: string | null;
    last_sync_started_at: string | null;
    last_synced_at: string | null;
    next_sync_at: string | null;
    last_sync_seen_count: number | null;
    last_sync_new_count: number | null;
    baseline_completed_at: string | null;
  };
  now?: Date;
}): Promise<ContentSyncSnapshot> {
  const now = input.now ?? new Date();
  const historySince = new Date(
    now.getTime() - CONTENT_DETECTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    { data: rawCandidates },
    { count: storedCandidateCount },
    { data: rawHistory },
    { data: rawAssets },
  ] = await Promise.all([
    input.supabase
      .from("meta_content_candidates")
      .select(
        "id, source, meta_asset_id, content_type, caption_excerpt, permalink_url, preview_url, published_at, first_seen_at",
      )
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .eq("is_new", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(CANDIDATE_FETCH_LIMIT),
    input.supabase
      .from("meta_content_candidates")
      .select("id", { count: "exact", head: true })
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId),
    input.supabase
      .from("meta_content_candidates")
      .select(
        "id, source, meta_asset_id, content_type, caption_excerpt, permalink_url, preview_url, published_at, first_seen_at, last_seen_at, is_new",
      )
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      // Include posts published recently even if first_seen was earlier
      // (baseline / prior Abruf), so Heute/Woche match customer expectation.
      .or(
        `first_seen_at.gte.${historySince},published_at.gte.${historySince}`,
      )
      .order("first_seen_at", { ascending: false, nullsFirst: false })
      .limit(HISTORY_FETCH_LIMIT),
    input.supabase
      .from("meta_assets")
      .select("asset_type, name, username, last_synced_at")
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .in("asset_type", ["facebook_page", "instagram_account"])
      .order("asset_type", { ascending: true }),
  ]);

  const mapped = (rawCandidates ?? []).map((row) =>
    mapCandidate(row as Record<string, unknown>),
  );

  let candidates = mapped;
  if (mapped.length > 0) {
    const candidateIds = mapped.map((row) => row.id);
    const { data: linkRows } = await input.supabase
      .from("meta_organic_boost_links")
      .select("content_candidate_id, plan_id")
      .eq("platform_account_id", input.platformAccountId)
      .eq("user_id", input.userId)
      .in("content_candidate_id", candidateIds);

    const planIds = [
      ...new Set(
        (linkRows ?? [])
          .map((row) =>
            typeof row.plan_id === "string" ? row.plan_id : null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const planById = new Map<
      string,
      { status: string; notBefore: string | null }
    >();
    if (planIds.length > 0) {
      const { data: planRows } = await input.supabase
        .from("mutation_plans")
        .select("id, status, not_before")
        .eq("platform_account_id", input.platformAccountId)
        .eq("user_id", input.userId)
        .in("id", planIds);
      for (const plan of planRows ?? []) {
        planById.set(String(plan.id), {
          status: String(plan.status ?? ""),
          notBefore:
            typeof plan.not_before === "string" ? plan.not_before : null,
        });
      }
    }

    const heldByCandidate = new Map<
      string,
      { status: string; notBefore: string | null }
    >();
    for (const link of linkRows ?? []) {
      const candidateId =
        typeof link.content_candidate_id === "string"
          ? link.content_candidate_id
          : null;
      const planId = typeof link.plan_id === "string" ? link.plan_id : null;
      if (!candidateId || !planId) continue;
      const plan = planById.get(planId);
      if (!plan) {
        // Link without readable plan: treat as progressed (hide from list).
        heldByCandidate.set(candidateId, {
          status: "UNKNOWN",
          notBefore: null,
        });
        continue;
      }
      heldByCandidate.set(candidateId, plan);
    }

    candidates = mapped
      .filter((candidate) =>
        shouldListAsContentCandidate({
          heldPlan: heldByCandidate.get(candidate.id) ?? null,
        }),
      )
      .slice(0, CANDIDATE_DISPLAY_LIMIT);
  }

  const detectionHistory = (rawHistory ?? []).map((row) =>
    mapHistoryItem(row as Record<string, unknown>),
  );

  const assetSyncHints: ContentAssetSyncHint[] = (rawAssets ?? [])
    .map((row) => {
      const assetType = row.asset_type;
      if (assetType !== "facebook_page" && assetType !== "instagram_account") {
        return null;
      }
      const label =
        (typeof row.name === "string" && row.name.trim()) ||
        (typeof row.username === "string" && row.username.trim()) ||
        (assetType === "facebook_page" ? "Facebook-Seite" : "Instagram");
      return {
        assetType,
        label,
        lastSyncedAt:
          typeof row.last_synced_at === "string" ? row.last_synced_at : null,
      } satisfies ContentAssetSyncHint;
    })
    .filter((row): row is ContentAssetSyncHint => row !== null);

  return {
    status: input.connector.sync_status,
    errorCode: input.connector.sync_error_code,
    lastSyncStartedAt: input.connector.last_sync_started_at,
    lastSyncedAt: input.connector.last_synced_at,
    nextSyncAt: input.connector.next_sync_at,
    displayNextSyncAt: resolveCustomerNextSyncAt(
      input.connector.next_sync_at,
      now,
    ),
    baselineCompleted: Boolean(input.connector.baseline_completed_at),
    seenCount: input.connector.last_sync_seen_count ?? 0,
    newCount: input.connector.last_sync_new_count ?? 0,
    storedCandidateCount: storedCandidateCount ?? 0,
    candidates,
    detectionHistory,
    detectionSummary: summarizeDetectionWindows(detectionHistory, now),
    assetSyncHints,
  };
}
