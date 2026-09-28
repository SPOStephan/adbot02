import type { ReadyBrandAssetView } from "@/components/AutomationOnboardingControls";
import type { MetaCampaignDraftPayload } from "@/lib/meta/campaign-draft-types";

type ReadyBrandAssetRow = {
  id?: unknown;
  original_filename?: unknown;
  source_meta_asset_id?: unknown;
  width?: unknown;
  height?: unknown;
  meta_image_hash?: unknown;
  metadata?: unknown;
};

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function campaignDraftAssetIds(
  payload: Pick<MetaCampaignDraftPayload, "assetId" | "extraAssetIds">,
): string[] {
  return [...new Set([payload.assetId, ...payload.extraAssetIds].filter(Boolean))];
}

export function toReadyBrandAssetView(
  row: ReadyBrandAssetRow,
): ReadyBrandAssetView | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;

  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const parentRaw = metadata.parent_asset_id;
  const formatRaw =
    typeof metadata.meta_format_key === "string"
      ? metadata.meta_format_key
      : typeof metadata.role === "string"
        ? metadata.role
        : null;

  return {
    id,
    originalFilename:
      typeof row.original_filename === "string" && row.original_filename.trim()
        ? row.original_filename
        : "Werbemittel",
    sourceMetaAssetId:
      typeof row.source_meta_asset_id === "string" && row.source_meta_asset_id.trim()
        ? row.source_meta_asset_id
        : null,
    width: finiteNumber(row.width),
    height: finiteNumber(row.height),
    metaImageHashPresent:
      typeof row.meta_image_hash === "string" && row.meta_image_hash.length > 0,
    parentAssetId:
      typeof parentRaw === "string" && parentRaw.trim() ? parentRaw.trim() : null,
    metaFormatKey:
      typeof formatRaw === "string" && formatRaw.trim() ? formatRaw.trim() : null,
  };
}

export function mergeDraftAssetsIntoLibrary(
  library: ReadyBrandAssetView[],
  recovered: ReadyBrandAssetView[],
  preferredIds: string[],
): ReadyBrandAssetView[] {
  const byId = new Map(library.map((asset) => [asset.id, asset]));
  for (const asset of recovered) byId.set(asset.id, asset);

  const preferred = preferredIds
    .map((id) => byId.get(id))
    .filter((asset): asset is ReadyBrandAssetView => Boolean(asset));
  const preferredSet = new Set(preferred.map((asset) => asset.id));
  return [...preferred, ...library.filter((asset) => !preferredSet.has(asset.id))];
}
