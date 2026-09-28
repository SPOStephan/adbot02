"use client";

import { formatLabelForDimensions } from "@/lib/media-library/meta-formats";
import {
  MAX_DYNAMIC_CREATIVE_IMAGES,
  normalizeLaunchAssetIds,
  resolveDynamicCreativeAssetIds,
  type LaunchLibraryAsset,
} from "@/lib/meta/creative-image-variants";

type Props = {
  disabled?: boolean;
  enabled: boolean;
  includeFormatSiblings: boolean;
  primaryAssetId: string;
  extraAssetIds: string[];
  assets: LaunchLibraryAsset[];
  onEnabledChange: (value: boolean) => void;
  onIncludeFormatSiblingsChange: (value: boolean) => void;
  onExtraAssetIdsChange: (value: string[]) => void;
};

export function DynamicCreativeImagesField({
  disabled = false,
  enabled,
  includeFormatSiblings,
  primaryAssetId,
  extraAssetIds,
  assets,
  onEnabledChange,
  onIncludeFormatSiblingsChange,
  onExtraAssetIdsChange,
}: Props) {
  const resolved = resolveDynamicCreativeAssetIds({
    primaryId: primaryAssetId,
    extraIds: extraAssetIds,
    library: assets,
    includeFormatSiblings: enabled && includeFormatSiblings,
  });
  const competingChoices = assets.filter(
    (asset) => asset.id !== primaryAssetId,
  );

  return (
    <fieldset className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 lg:col-span-2">
      <legend className="px-1 text-sm font-bold text-slate-800">
        Mehrere Werbemittel für Meta-Optimierung
      </legend>
      <p className="mt-1 text-xs font-medium text-slate-500">
        Bis zu {MAX_DYNAMIC_CREATIVE_IMAGES} Bilder in einer Dynamic Creative.
        Meta kombiniert und priorisiert die Varianten anhand ihrer Leistung.
      </p>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-800">
        <input
          checked={enabled}
          className="mt-0.5 size-4 border-slate-300 text-blue-700 focus:ring-blue-500"
          disabled={disabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
          type="checkbox"
        />
        <span>Mehrere ausgewählte Motive an Meta übermitteln</span>
      </label>
      {enabled ? (
        <div className="mt-3 space-y-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm font-semibold text-slate-800">
            <input
              checked={includeFormatSiblings}
              className="mt-0.5 size-4 border-slate-300 text-blue-700 focus:ring-blue-500"
              disabled={disabled}
              onChange={(event) =>
                onIncludeFormatSiblingsChange(event.target.checked)
              }
              type="checkbox"
            />
            <span>
              Adbot ergänzt passende Formate (1:1, 4:5, 9:16) zum selben Motiv
            </span>
          </label>
          <p className="text-xs font-medium text-slate-500">
            Zusätzliche, andere Motive wählst du selbst. Adbot schaltet das
            nicht automatisch dazu.
          </p>
          {competingChoices.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {competingChoices.map((asset) => {
                const checked = extraAssetIds.includes(asset.id);
                const atLimit =
                  !checked && resolved.assetIds.length >= MAX_DYNAMIC_CREATIVE_IMAGES;
                return (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"
                    key={asset.id}
                  >
                    <input
                      checked={checked}
                      className="size-4 border-slate-300 text-blue-700 focus:ring-blue-500"
                      disabled={disabled || atLimit}
                      onChange={() => {
                        onExtraAssetIdsChange(
                          checked
                            ? extraAssetIds.filter((id) => id !== asset.id)
                            : normalizeLaunchAssetIds(
                                [...extraAssetIds, asset.id],
                                { max: MAX_DYNAMIC_CREATIVE_IMAGES - 1 },
                              ),
                        );
                      }}
                      type="checkbox"
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt=""
                      className="size-12 shrink-0 rounded-md bg-slate-100 object-cover ring-1 ring-slate-200"
                      loading="lazy"
                      src={`/api/media-library/preview?assetId=${asset.id}`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">
                        {asset.originalFilename?.trim() || "Motiv"}
                      </span>
                      <span className="block text-xs font-medium text-slate-500">
                        {formatLabelForDimensions(asset.width, asset.height) ??
                          (asset.width && asset.height
                            ? `${asset.width}×${asset.height}`
                            : "Format unbekannt")}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-xs font-medium text-slate-500">
              Weitere Motive erscheinen hier, sobald sie in der Library bereit
              sind.
            </p>
          )}
          {resolved.assetIds.length > 1 ? (
            <p className="text-xs font-semibold text-slate-600">
              {resolved.assetIds.length} Bilder in dieser Creative
              {resolved.siblingIds.length > 0
                ? ` · davon ${resolved.siblingIds.length} Format-Geschwister von Adbot`
                : ""}
              .
            </p>
          ) : (
            <p className="text-xs font-medium text-slate-500">
              Aktuell nur das Hauptmotiv. Wähle Extra-Motive oder lasse Adbot
              Formate ergänzen.
            </p>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}
