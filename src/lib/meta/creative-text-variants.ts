/** Up to 5 Meta Dynamic Creative text assets per type. */
export const MAX_CREATIVE_TEXT_VARIANTS = 5;

export function normalizeCreativeTextVariants(
  values: readonly string[],
  options?: { fallback?: string; max?: number },
): string[] {
  const max = options?.max ?? MAX_CREATIVE_TEXT_VARIANTS;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const text = raw.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= max) break;
  }
  if (out.length === 0 && options?.fallback?.trim()) {
    out.push(options.fallback.trim());
  }
  return out;
}

export function usesDynamicCreativeText(input: {
  bodies: readonly string[];
  titles: readonly string[];
  descriptions?: readonly string[];
}): boolean {
  return (
    input.bodies.length > 1 ||
    input.titles.length > 1 ||
    (input.descriptions?.length ?? 0) > 1
  );
}

export type LinkCreativeBlueprintParts = {
  useDynamicCreative: boolean;
  objectStorySpec: {
    link_data?: {
      message: string;
      name: string;
      description: string;
      call_to_action: { type: string };
    };
  };
  assetFeedSpec: Record<string, unknown> | null;
};

/**
 * Build creative blueprint fragments for single-link creatives.
 * Multiple text variants → Dynamic Creative asset_feed_spec (one ad, many texts).
 */
export function buildLinkCreativeBlueprintParts(input: {
  primaryTexts: readonly string[];
  headlines: readonly string[];
  descriptions?: readonly string[];
  callToActionType: string;
  defaultPrimary: string;
  defaultHeadline: string;
}): LinkCreativeBlueprintParts {
  const bodies = normalizeCreativeTextVariants(input.primaryTexts, {
    fallback: input.defaultPrimary,
  });
  const titles = normalizeCreativeTextVariants(input.headlines, {
    fallback: input.defaultHeadline,
  });
  const descriptions = normalizeCreativeTextVariants(input.descriptions ?? []);
  const useDynamicCreative = usesDynamicCreativeText({
    bodies,
    titles,
    descriptions,
  });

  if (!useDynamicCreative) {
    return {
      useDynamicCreative: false,
      objectStorySpec: {
        link_data: {
          message: bodies[0] ?? input.defaultPrimary,
          name: titles[0] ?? input.defaultHeadline,
          description: descriptions[0] ?? "",
          call_to_action: { type: input.callToActionType },
        },
      },
      assetFeedSpec: null,
    };
  }

  const assetFeedSpec: Record<string, unknown> = {
    ad_formats: ["SINGLE_IMAGE"],
    bodies: bodies.map((text) => ({ text })),
    titles: titles.map((text) => ({ text })),
    call_to_action_types: [input.callToActionType],
    // images + link_urls are filled by launch materialize / bindings.
  };
  if (descriptions.length > 0) {
    assetFeedSpec.descriptions = descriptions.map((text) => ({ text }));
  }

  return {
    useDynamicCreative: true,
    // page_id / instagram_user_id filled at materialize; no link_data for DCA.
    objectStorySpec: {},
    assetFeedSpec,
  };
}
