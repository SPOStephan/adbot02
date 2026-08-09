import "server-only";

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
};

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
  const [{ data: candidates }, { count: storedCandidateCount }] =
    await Promise.all([
      input.supabase
        .from("meta_content_candidates")
        .select(
          "id, source, meta_asset_id, content_type, caption_excerpt, permalink_url, preview_url, published_at, first_seen_at",
        )
        .eq("platform_account_id", input.platformAccountId)
        .eq("user_id", input.userId)
        .eq("is_new", true)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(8),
      input.supabase
        .from("meta_content_candidates")
        .select("id", { count: "exact", head: true })
        .eq("platform_account_id", input.platformAccountId)
        .eq("user_id", input.userId),
    ]);

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
    candidates: (candidates ?? []).map((candidate) => ({
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
    })),
  };
}
