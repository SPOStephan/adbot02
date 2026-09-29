"use client";

import { X } from "lucide-react";

import { META_FORMAT_SLOTS } from "@/lib/media-library/meta-formats";
import {
  inferMetaFormatKey,
  type LaunchLibraryAsset,
} from "@/lib/meta/creative-image-variants";

type Props = {
  assets: LaunchLibraryAsset[];
  selectedIds: string[];
  disabled?: boolean;
  onOpenPicker: () => void;
  onRemove: (assetId: string) => void;
};

/** Selected launch creatives grouped by Meta format, each with a preview. */
export function SelectedCreativesByFormat({
  assets,
  selectedIds,
  disabled = false,
  onOpenPicker,
  onRemove,
}: Props) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const selected = selectedIds
    .map((id) => byId.get(id))
    .filter((asset): asset is LaunchLibraryAsset => Boolean(asset));
  const groups = [
    ...META_FORMAT_SLOTS.map((slot) => ({
      key: slot.key as string,
      label: slot.label,
      note: slot.note as string,
      items: selected.filter((asset) => inferMetaFormatKey(asset) === slot.key),
    })),
    {
      key: "other",
      label: "Anderes Format",
      note: "Meta schneidet diese Motive selbst passend zu.",
      items: selected.filter((asset) => inferMetaFormatKey(asset) === null),
    },
  ].filter((group) => group.key !== "other" || group.items.length > 0);

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {groups.map((group) => (
        <section
          className={`rounded-xl border bg-white p-3 ${
            group.key === "other" ? "sm:col-span-3" : ""
          } ${group.items.length > 0 ? "border-slate-200" : "border-dashed border-slate-300"}`}
          key={group.key}
        >
          <p className="text-xs font-extrabold text-slate-900">
            {group.label}
            <span className="ml-1 font-semibold text-slate-500">
              · {group.items.length}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] font-medium leading-4 text-slate-500">
            {group.note}
          </p>
          {group.items.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {group.items.map((asset) => (
                <li className="relative" key={asset.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={asset.originalFilename ?? ""}
                    className="size-16 rounded-lg bg-slate-100 object-cover ring-1 ring-slate-200"
                    loading="lazy"
                    src={`/api/media-library/preview?assetId=${asset.id}`}
                    title={asset.originalFilename ?? undefined}
                  />
                  <button
                    aria-label={`${asset.originalFilename ?? "Motiv"} entfernen`}
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-slate-900 text-white shadow disabled:opacity-40"
                    disabled={disabled}
                    onClick={() => onRemove(asset.id)}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <button
              className="mt-2 text-xs font-bold text-blue-700 hover:underline disabled:opacity-50"
              disabled={disabled}
              onClick={onOpenPicker}
              type="button"
            >
              Motiv wählen oder hochladen
            </button>
          )}
        </section>
      ))}
    </div>
  );
}
