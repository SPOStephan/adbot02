import "server-only";

import { mergeStyleReferenceIds } from "@/lib/ad-learning/context";
import { PHASE5_MAX_STYLE_REFERENCES } from "@/lib/creative-assets/style-reference-constants";
import { createAdminClient } from "@/lib/supabase/admin";

import { readPlatformMotifMetadata } from "./metadata";
import {
  scorePlatformMotifMatch,
  shouldAdoptPlatformMotifOneToOne,
} from "./score";

export type RankedPlatformMotif = {
  id: string;
  score: number;
  tags: string[];
  contentSummary: string | null;
  recommendAdopt: boolean;
};

export async function pickRelevantPlatformMotifs(input?: {
  queryTags?: readonly string[];
  queryText?: string | null;
  limit?: number;
}): Promise<RankedPlatformMotif[]> {
  const limit = Math.min(Math.max(input?.limit ?? 4, 1), 8);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select("id,original_filename,metadata")
    .eq("library_scope", "PLATFORM")
    .eq("status", "READY")
    .eq("moderation_status", "APPROVED")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[platform-library] pick failed", error);
    return [];
  }

  const ranked = (data ?? [])
    .map((row) => {
      const meta = readPlatformMotifMetadata(row.metadata);
      const score = scorePlatformMotifMatch({
        tags: meta.tags,
        contentSummary: meta.content_summary,
        filename: String(row.original_filename ?? ""),
        queryTags: input?.queryTags,
        queryText: input?.queryText,
      });
      return {
        id: String(row.id),
        score,
        tags: meta.tags,
        contentSummary: meta.content_summary,
        recommendAdopt: shouldAdoptPlatformMotifOneToOne(score),
      } satisfies RankedPlatformMotif;
    })
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

  return ranked.slice(0, limit);
}

export async function attachPlatformMotifStyleRefs(input: {
  referenceAssetIds: readonly string[];
  queryTags?: readonly string[];
  prompt?: string | null;
}): Promise<string[]> {
  if (input.referenceAssetIds.length >= PHASE5_MAX_STYLE_REFERENCES) {
    return [...input.referenceAssetIds].slice(0, PHASE5_MAX_STYLE_REFERENCES);
  }
  try {
    const picked = await pickRelevantPlatformMotifs({
      queryTags: input.queryTags,
      queryText: input.prompt,
      limit: PHASE5_MAX_STYLE_REFERENCES,
    });
    return mergeStyleReferenceIds(
      input.referenceAssetIds,
      picked.map((item) => item.id),
      PHASE5_MAX_STYLE_REFERENCES,
    );
  } catch (error) {
    console.error("[platform-library] style-ref attach failed", error);
    return [...input.referenceAssetIds].slice(0, PHASE5_MAX_STYLE_REFERENCES);
  }
}
