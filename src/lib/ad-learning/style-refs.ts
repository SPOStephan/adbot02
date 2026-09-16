import "server-only";

import { PHASE5_MAX_STYLE_REFERENCES } from "@/lib/creative-assets/style-reference-constants";
import { loadCustomerWinnerAssetIds } from "@/lib/ad-learning/retrieve";
import { mergeStyleReferenceIds } from "@/lib/ad-learning/context";

export async function attachCustomerWinnerStyleRefs(input: {
  userId: string;
  platformAccountId: string;
  referenceAssetIds: readonly string[];
}): Promise<string[]> {
  if (input.referenceAssetIds.length >= PHASE5_MAX_STYLE_REFERENCES) {
    return [...input.referenceAssetIds].slice(0, PHASE5_MAX_STYLE_REFERENCES);
  }
  try {
    const winners = await loadCustomerWinnerAssetIds({
      userId: input.userId,
      platformAccountId: input.platformAccountId,
      limit: PHASE5_MAX_STYLE_REFERENCES,
    });
    return mergeStyleReferenceIds(
      input.referenceAssetIds,
      winners,
      PHASE5_MAX_STYLE_REFERENCES,
    );
  } catch (error) {
    console.error("ad_learning_style_refs_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return [...input.referenceAssetIds].slice(0, PHASE5_MAX_STYLE_REFERENCES);
  }
}
