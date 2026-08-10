"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ImagePlus,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";

import { parseAssetUploadResponse } from "@/lib/media-library/parse-upload-response";

export type PickerAsset = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  label?: string | null;
};

type Props = {
  open: boolean;
  assets: PickerAsset[];
  selectedAssetId: string | null;
  brandProfileId?: string | null;
  onClose: () => void;
  onSelect: (assetId: string) => void;
  /** Called after a successful upload; assets include original + optional crops. */
  onUploaded: (payload: {
    preferredLaunchAssetId: string;
    assets: PickerAsset[];
  }) => void;
};

const META_SIZE_GUIDE = [
  {
    title: "Feed 1:1",
    size: "1080 × 1080 px",
    note: "Standard für Feed-Anzeigen",
  },
  {
    title: "Feed 4:5",
    size: "1080 × 1350 px",
    note: "Mehr Fläche im mobilen Feed",
  },
  {
    title: "Link 1,91:1",
    size: "1200 × 628 px",
    note: "Klassisches Link-Format",
  },
] as const;

export function CreativePickerModal({
  open,
  assets,
  selectedAssetId,
  brandProfileId = null,
  onClose,
  onSelect,
  onUploaded,
}: Props) {
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Keep Escape close without rebinding on every upload tick; never touch
  // browser reload shortcuts (Cmd/Ctrl+R).
  const uploadingRef = useRef(uploading);
  uploadingRef.current = uploading;

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (uploadingRef.current) return;
      // Do not preventDefault — browser shortcuts (reload etc.) must stay intact.
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  async function uploadFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("generateMetaCrops", "1");
      if (brandProfileId) {
        body.set("brandProfileId", brandProfileId);
      }
      const response = await fetch("/api/meta/automation/asset-upload", {
        method: "POST",
        credentials: "same-origin",
        body,
      });
      const json = await parseAssetUploadResponse(response);
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Upload fehlgeschlagen.");
      }

      const uploadedAssets: PickerAsset[] = [];
      for (const asset of json.assets ?? []) {
        if (typeof asset.brandAssetId !== "string") continue;
        uploadedAssets.push({
          id: asset.brandAssetId,
          originalFilename:
            typeof asset.originalFilename === "string"
              ? asset.originalFilename
              : "Creative",
          width: typeof asset.width === "number" ? asset.width : null,
          height: typeof asset.height === "number" ? asset.height : null,
          label: typeof asset.label === "string" ? asset.label : null,
        });
      }

      if (uploadedAssets.length < 1 && typeof json.brandAssetId === "string") {
        uploadedAssets.push({
          id: json.brandAssetId,
          originalFilename: file.name || "Creative",
          width: null,
          height: null,
          label: "Original",
        });
      }

      const preferred =
        typeof json.preferredLaunchAssetId === "string"
          ? json.preferredLaunchAssetId
          : (json.brandAssetId ?? uploadedAssets[0]?.id);
      if (!preferred) {
        throw new Error("Upload ohne Asset-ID.");
      }

      const cropCount = Math.max(0, uploadedAssets.length - 1);
      setMessage(
        cropCount > 0
          ? `Gespeichert: Original in voller Größe plus ${cropCount} Meta-Zuschnitt${cropCount === 1 ? "" : "e"} in der Library.`
          : "Original in voller Größe in der Library gespeichert.",
      );
      onUploaded({ preferredLaunchAssetId: preferred, assets: uploadedAssets });
      onSelect(preferred);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Upload fehlgeschlagen.",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  }

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 sm:items-center sm:p-6"
      role="dialog"
    >
      <button
        aria-label="Schließen"
        className="absolute inset-0 cursor-default"
        disabled={uploading}
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-extrabold text-slate-950" id={titleId}>
              Creative wählen oder hochladen
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Klick wählt aus. Neue Uploads landen immer in der Media Library —
              Original bleibt in voller Größe erhalten.
            </p>
          </div>
          <button
            aria-label="Schließen"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
            disabled={uploading}
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-extrabold text-slate-900">
              Empfohlene Meta-Größen
            </h3>
            <ul className="mt-3 grid gap-2 sm:grid-cols-3">
              {META_SIZE_GUIDE.map((item) => (
                <li
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                  key={item.title}
                >
                  <p className="text-xs font-extrabold text-slate-900">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-xs font-semibold text-blue-700">
                    {item.size}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-slate-500">
                    {item.note}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-5 text-slate-600">
              PNG/JPEG, Kantenlänge 256–4096 px. Beim Upload erzeugen wir
              automatisch Inhalts-Zuschnitte für die Formate oben; das Original
              wird unverändert mitgespeichert (auch für andere Netzwerke).
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-extrabold text-white hover:bg-blue-800 disabled:opacity-50"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                type="button"
              >
                {uploading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {uploading ? "Wird verarbeitet …" : "Datei hochladen"}
              </button>
              <input
                accept="image/png,image/jpeg"
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  void uploadFile(event.target.files?.[0]);
                }}
                ref={fileRef}
                type="file"
              />
            </div>
            {error ? (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                {message}
              </p>
            ) : null}
          </section>

          <section className="mt-5">
            <h3 className="text-sm font-extrabold text-slate-900">
              Zuletzt in der Library
            </h3>
            {assets.length ? (
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {assets.map((asset) => {
                  const selected = asset.id === selectedAssetId;
                  return (
                    <li key={asset.id}>
                      <button
                        className={`flex w-full items-stretch gap-3 rounded-xl border p-3 text-left transition ${
                          selected
                            ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
                            : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"
                        }`}
                        disabled={uploading}
                        onClick={() => onSelect(asset.id)}
                        type="button"
                      >
                        <span className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                            src={`/api/media-library/preview?assetId=${asset.id}`}
                          />
                          {selected ? (
                            <span className="absolute inset-0 grid place-items-center bg-emerald-700/30">
                              <Check className="size-6 text-white drop-shadow" />
                            </span>
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-slate-950">
                            {asset.originalFilename}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {asset.label ? `${asset.label} · ` : ""}
                            {asset.width && asset.height
                              ? `${asset.width}×${asset.height}`
                              : "Größe unbekannt"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600">
                <ImagePlus className="mt-0.5 size-4 shrink-0" />
                Noch keine Creatives. Lade oben die erste Datei hoch — sie
                erscheint sofort hier und in der Library.
              </p>
            )}
          </section>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            disabled={uploading}
            onClick={onClose}
            type="button"
          >
            Abbrechen
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50"
            disabled={uploading || !selectedAssetId}
            onClick={onClose}
            type="button"
          >
            Creative übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
