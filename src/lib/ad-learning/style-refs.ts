import "server-only";

import { PHASE5_MAX_STYLE_REFERENCES } from "@/lib/creative-assets/style-reference-constants";
import { loadCustomerWinnerAssetIds } from "@/lib/ad-learning/retrieve";
import { mergeStyleReferenceIds } from "@/lib/ad-learning/context";
import { attachPlatformMotifStyleRefs } from "@/lib/platform-library/select";

export async function attachCustomerWinnerStyleRefs(input: {
  userId: string;
  platformAccountId?: string | null;
  referenceAssetIds: readonly string[];
  prompt?: string | null;
  queryTags?: readonly string[];
}): Promise<string[]> {
  let ids = [...input.referenceAssetIds].slice(0, PHASE5_MAX_STYLE_REFERENCES);
  if (ids.length >= PHASE5_MAX_STYLE_REFERENCES) {
    return ids;
  }
  if (input.platformAccountId) {
    try {
      const winners = await loadCustomerWinnerAssetIds({
        userId: input.userId,
        platformAccountId: input.platformAccountId,
        limit: PHASE5_MAX_STYLE_REFERENCES,
      });
      ids = mergeStyleReferenceIds(
        ids,
        winners,
        PHASE5_MAX_STYLE_REFERENCES,
      );
    } catch (error) {
      console.error("ad_learning_style_refs_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return attachPlatformMotifStyleRefs({
    referenceAssetIds: ids,
    queryTags: input.queryTags,
    prompt: input.prompt,
  });
}
