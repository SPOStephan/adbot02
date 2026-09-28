export const MAX_META_AD_PREVIEW_COMBINATIONS = 20;

export type MetaAdPreviewCombination = {
  assetId: string;
  primaryText: string;
  headline: string;
  description: string;
};

export type MetaAdPreviewCombinationResult = {
  combinations: MetaAdPreviewCombination[];
  totalCombinationCount: number;
  isTruncated: boolean;
};

type BuildMetaAdPreviewCombinationsInput = {
  assetIds: readonly string[];
  primaryTexts: readonly string[];
  headlines: readonly string[];
  descriptions?: readonly string[];
  maxCombinations?: number;
  defaultPrimaryText?: string;
  defaultHeadline?: string;
};

function uniqueTrimmed(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) unique.add(trimmed);
  }
  return [...unique];
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

/**
 * Pick a stable stride through the cartesian product. Keeping the stride
 * coprime to the total prevents duplicate cards before every combination has
 * been visited, while a stride close to total/sampleCount spreads the sample
 * across images, texts and headlines instead of exhausting one asset first.
 */
function representativeStride(total: number, sampleCount: number): number {
  if (total <= 1 || sampleCount >= total) return 1;
  let stride = Math.max(1, Math.round(total / sampleCount));
  while (stride < total && greatestCommonDivisor(stride, total) !== 1) {
    stride += 1;
  }
  return stride < total ? stride : 1;
}

/**
 * Builds concrete cards from one image, one primary text and one headline.
 * The total deliberately counts those three user-visible dimensions. Optional
 * descriptions are distributed over the cards but do not inflate that count.
 */
export function buildMetaAdPreviewCombinations(
  input: BuildMetaAdPreviewCombinationsInput,
): MetaAdPreviewCombinationResult {
  const assetIds = uniqueTrimmed(input.assetIds);
  if (assetIds.length === 0) {
    return {
      combinations: [],
      totalCombinationCount: 0,
      isTruncated: false,
    };
  }

  const primaryTexts = uniqueTrimmed(input.primaryTexts);
  if (primaryTexts.length === 0) {
    primaryTexts.push(input.defaultPrimaryText?.trim() || "Anzeigentext");
  }

  const headlines = uniqueTrimmed(input.headlines);
  if (headlines.length === 0) {
    headlines.push(input.defaultHeadline?.trim() || "Überschrift");
  }

  const descriptions = uniqueTrimmed(input.descriptions ?? []);
  const totalCombinationCount =
    assetIds.length * primaryTexts.length * headlines.length;
  const requestedMaximum = Number.isFinite(input.maxCombinations)
    ? Math.floor(input.maxCombinations ?? MAX_META_AD_PREVIEW_COMBINATIONS)
    : MAX_META_AD_PREVIEW_COMBINATIONS;
  const sampleCount = Math.min(
    totalCombinationCount,
    Math.max(0, requestedMaximum),
  );
  const stride = representativeStride(totalCombinationCount, sampleCount);
  const combinations: MetaAdPreviewCombination[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const flatIndex = (index * stride) % totalCombinationCount;
    const assetIndex = flatIndex % assetIds.length;
    const primaryTextIndex =
      Math.floor(flatIndex / assetIds.length) % primaryTexts.length;
    const headlineIndex =
      Math.floor(flatIndex / (assetIds.length * primaryTexts.length)) %
      headlines.length;

    combinations.push({
      assetId: assetIds[assetIndex],
      primaryText: primaryTexts[primaryTextIndex],
      headline: headlines[headlineIndex],
      description:
        descriptions.length > 0
          ? descriptions[(primaryTextIndex + headlineIndex) % descriptions.length]
          : "",
    });
  }

  return {
    combinations,
    totalCombinationCount,
    isTruncated: sampleCount < totalCombinationCount,
  };
}
