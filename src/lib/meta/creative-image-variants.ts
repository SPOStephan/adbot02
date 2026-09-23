import {
  isMetaFormatKey,
  matchesMetaFormat,
  META_FORMAT_SLOTS,
  type MetaFormatKey,
} from "@/lib/media-library/meta-formats";

/** Meta Advantage+ / Dynamic Creative image cap. */
export const MAX_DYNAMIC_CREATIVE_IMAGES = 10;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LaunchLibraryAsset = {
  id: string;
  parentAssetId?: string | null;
  metaFormatKey?: string | null;
  width?: number | null;
  height?: number | null;
  originalFilename?: string | null;
};

export function normalizeLaunchAssetIds(
  values: readonly string[],
  options?: { max?: number },
): string[] {
  const max = options?.max ?? MAX_DYNAMIC_CREATIVE_IMAGES;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const id = raw.trim().toLowerCase();
    if (!UUID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

export function assetFamilyRoot(asset: LaunchLibraryAsset): string {
  const parent = asset.parentAssetId?.trim().toLowerCase() ?? "";
  if (parent && UUID_PATTERN.test(parent)) return parent;
  return asset.id.trim().toLowerCase();
}

export function inferMetaFormatKey(
  asset: LaunchLibraryAsset,
): MetaFormatKey | null {
  const raw = asset.metaFormatKey?.trim() ?? "";
  if (raw && isMetaFormatKey(raw)) return raw;
  if (
    typeof asset.width === "number" &&
    typeof asset.height === "number" &&
    asset.width > 0 &&
    asset.height > 0
  ) {
    for (const slot of META_FORMAT_SLOTS) {
      if (matchesMetaFormat(asset.width, asset.height, slot)) {
        return slot.key;
      }
    }
  }
  return null;
}

export function suggestFormatSiblingIds(
  selectedIds: readonly string[],
  library: readonly LaunchLibraryAsset[],
): string[] {
  const selected = normalizeLaunchAssetIds(selectedIds);
  const selectedSet = new Set(selected);
  const byId = new Map(
    library
      .filter((asset) => UUID_PATTERN.test(asset.id))
      .map((asset) => [asset.id.toLowerCase(), asset]),
  );
  const suggested: string[] = [];
  const suggestedSet = new Set<string>();

  for (const id of selected) {
    const selectedAsset = byId.get(id);
    if (!selectedAsset) continue;
    const root = assetFamilyRoot(selectedAsset);
    const selectedFormat = inferMetaFormatKey(selectedAsset);
    for (const candidate of library) {
      const candidateId = candidate.id.trim().toLowerCase();
      if (!UUID_PATTERN.test(candidateId)) continue;
      if (selectedSet.has(candidateId) || suggestedSet.has(candidateId)) continue;
      if (assetFamilyRoot(candidate) !== root) continue;
      const candidateFormat = inferMetaFormatKey(candidate);
      if (
        selectedFormat &&
        candidateFormat &&
        candidateFormat === selectedFormat
      ) {
        continue;
      }
      if (!selectedFormat && !candidateFormat && candidateId === id) {
        continue;
      }
      suggestedSet.add(candidateId);
      suggested.push(candidateId);
    }
  }

  return suggested;
}

export function resolveDynamicCreativeAssetIds(input: {
  primaryId: string;
  extraIds?: readonly string[];
  library?: readonly LaunchLibraryAsset[];
  includeFormatSiblings?: boolean;
  max?: number;
}): {
  assetIds: string[];
  extraIds: string[];
  siblingIds: string[];
} {
  const max = input.max ?? MAX_DYNAMIC_CREATIVE_IMAGES;
  const primary = normalizeLaunchAssetIds([input.primaryId], { max: 1 })[0];
  if (!primary) {
    return { assetIds: [], extraIds: [], siblingIds: [] };
  }

  const customerExtras = normalizeLaunchAssetIds(input.extraIds ?? [], {
    max,
  }).filter((id) => id !== primary);

  const siblingIds =
    input.includeFormatSiblings === false
      ? []
      : suggestFormatSiblingIds(
          [primary, ...customerExtras],
          input.library ?? [],
        ).filter((id) => id !== primary && !customerExtras.includes(id));

  const assetIds = normalizeLaunchAssetIds(
    [primary, ...customerExtras, ...siblingIds],
    { max },
  );

  return {
    assetIds,
    extraIds: assetIds.slice(1),
    siblingIds: assetIds.filter((id) => siblingIds.includes(id)),
  };
}

export function usesDynamicCreativeImages(assetIds: readonly string[]): boolean {
  return normalizeLaunchAssetIds(assetIds).length > 1;
}
