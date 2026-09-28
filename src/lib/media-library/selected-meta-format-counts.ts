import {
  META_FORMAT_SLOTS,
  matchesMetaFormat,
  type MetaFormatKey,
} from "@/lib/media-library/meta-formats";

export type SelectedMetaFormatAsset = {
  width: number | null;
  height: number | null;
};

export function countSelectedAssetsByMetaFormat(
  selectedAssets: SelectedMetaFormatAsset[],
): Record<MetaFormatKey, number> {
  const counts: Record<MetaFormatKey, number> = {
    meta_feed_1x1: 0,
    meta_feed_4x5: 0,
    meta_story_9x16: 0,
  };

  for (const asset of selectedAssets) {
    const { width, height } = asset;
    if (width == null || height == null) continue;
    const format = META_FORMAT_SLOTS.find((slot) =>
      matchesMetaFormat(width, height, slot),
    );
    if (format) counts[format.key] += 1;
  }

  return counts;
}
