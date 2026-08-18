"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  ImagePlus,
  LoaderCircle,
  Upload,
  X,
} from "lucide-react";

import {
  META_FORMAT_SLOTS,
  describeMetaFormatCheck,
  readImageDimensions,
  type MetaFormatKey,
} from "@/lib/media-library/meta-formats";
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

type UploadMode = "auto_crop" | "three_formats";

type SlotState = {
  status: "idle" | "checking" | "ok" | "error" | "uploading";
  message: string | null;
  assetId: string | null;
  width: number | null;
  height: number | null;
  filename: string | null;
};

function emptySlots(): Record<MetaFormatKey, SlotState> {
  return {
    meta_feed_1x1: {
      status: "idle",
      message: null,
      assetId: null,
      width: null,
      height: null,
      filename: null,
    },
    meta_feed_4x5: {
      status: "idle",
      message: null,
      assetId: null,
      width: null,
      height: null,
      filename: null,
    },
    meta_link_191x1: {
      status: "idle",
      message: null,
      assetId: null,
      width: null,
      height: null,
      filename: null,
    },
  };
}

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
  const autoFileRef = useRef<HTMLInputElement>(null);
  const slotFileRefs = useRef<Partial<Record<MetaFormatKey, HTMLInputElement | null>>>(
    {},
  );
  const [mode, setMode] = useState<UploadMode>("auto_crop");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [slots, setSlots] = useState(emptySlots);

  const uploadingRef = useRef(uploading);
  uploadingRef.current = uploading;

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (uploadingRef.current) return;
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

  function mergeUploadedAssets(
    uploaded: PickerAsset[],
    preferred: string,
  ) {
    onUploaded({ preferredLaunchAssetId: preferred, assets: uploaded });
    onSelect(preferred);
  }

  async function uploadAutoCrop(file: File | undefined) {
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

      const generated =
        typeof json.cropsGenerated === "number" ? json.cropsGenerated : null;
      const skipped =
        typeof json.cropsSkipped === "number" ? json.cropsSkipped : null;
      if (generated !== null && skipped !== null) {
        setMessage(
          generated > 0
            ? `Gespeichert. ${generated} Format${generated === 1 ? "" : "e"} zugeschnitten` +
                (skipped > 0
                  ? `, ${skipped} bereits passend — ohne Zuschnitt.`
                  : ".")
            : skipped > 0
              ? "Gespeichert. Alle gängigen Formate passten bereits — kein Zuschnitt nötig."
              : "Original in der Library gespeichert.",
        );
      } else {
        const cropCount = Math.max(0, uploadedAssets.length - 1);
        setMessage(
          cropCount > 0
            ? `Gespeichert: Original plus ${cropCount} Meta-Zuschnitt${cropCount === 1 ? "" : "e"}.`
            : "Original in der Library gespeichert.",
        );
      }
      mergeUploadedAssets(uploadedAssets, preferred);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Upload fehlgeschlagen.",
      );
    } finally {
      setUploading(false);
      if (autoFileRef.current) {
        autoFileRef.current.value = "";
      }
    }
  }

  async function uploadFormatSlot(key: MetaFormatKey, file: File | undefined) {
    if (!file) return;
    const slot = META_FORMAT_SLOTS.find((entry) => entry.key === key);
    if (!slot) return;

    setSlots((previous) => ({
      ...previous,
      [key]: {
        ...previous[key],
        status: "checking",
        message: "Format wird geprüft …",
      },
    }));
    setError(null);
    setMessage(null);

    try {
      const size = await readImageDimensions(file);
      const check = describeMetaFormatCheck(size.width, size.height, slot);
      if (!check.ok) {
        setSlots((previous) => ({
          ...previous,
          [key]: {
            status: "error",
            message: check.message,
            assetId: null,
            width: size.width,
            height: size.height,
            filename: file.name,
          },
        }));
        return;
      }

      setSlots((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          status: "uploading",
          message: "Wird hochgeladen …",
          width: size.width,
          height: size.height,
          filename: file.name,
        },
      }));
      setUploading(true);

      const body = new FormData();
      body.set("file", file);
      body.set("metaFormatKey", key);
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

      const assetId =
        typeof json.brandAssetId === "string"
          ? json.brandAssetId
          : json.assets?.[0]?.brandAssetId;
      if (typeof assetId !== "string") {
        throw new Error("Upload ohne Asset-ID.");
      }

      const uploadedAsset: PickerAsset = {
        id: assetId,
        originalFilename: file.name || slot.label,
        width: size.width,
        height: size.height,
        label: slot.label,
      };

      setSlots((previous) => ({
        ...previous,
        [key]: {
          status: "ok",
          message: `Passt (${size.width}×${size.height}).`,
          assetId,
          width: size.width,
          height: size.height,
          filename: file.name,
        },
      }));

      const preferred =
        typeof json.preferredLaunchAssetId === "string"
          ? json.preferredLaunchAssetId
          : assetId;
      onUploaded({
        preferredLaunchAssetId: slot.preferredForLaunch
          ? preferred
          : (selectedAssetId ?? preferred),
        assets: [uploadedAsset],
      });
      if (slot.preferredForLaunch || !selectedAssetId) {
        onSelect(assetId);
      }
      setMessage(`${slot.label} gespeichert.`);
    } catch (uploadError) {
      const text =
        uploadError instanceof Error
          ? uploadError.message
          : "Upload fehlgeschlagen.";
      setSlots((previous) => ({
        ...previous,
        [key]: {
          status: "error",
          message: text,
          assetId: null,
          width: previous[key].width,
          height: previous[key].height,
          filename: file.name,
        },
      }));
      setError(text);
    } finally {
      setUploading(false);
      const input = slotFileRefs.current[key];
      if (input) input.value = "";
    }
  }

  const slotBusy = Object.values(slots).some(
    (slot) => slot.status === "checking" || slot.status === "uploading",
  );
  const busy = uploading || slotBusy;

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
        disabled={busy}
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
              Ein Bild mit Auto-Zuschnitt — oder deine drei Meta-Formate fertig
              hochladen. Alles landet in der Media Library.
            </p>
          </div>
          <button
            aria-label="Schließen"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="flex flex-wrap gap-2">
            <button
              className={`rounded-xl px-3 py-2 text-sm font-extrabold transition ${
                mode === "auto_crop"
                  ? "bg-blue-700 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
              disabled={busy}
              onClick={() => {
                setMode("auto_crop");
                setError(null);
              }}
              type="button"
            >
              Ein Bild · Auto-Zuschnitt
            </button>
            <button
              className={`rounded-xl px-3 py-2 text-sm font-extrabold transition ${
                mode === "three_formats"
                  ? "bg-blue-700 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
              disabled={busy}
              onClick={() => {
                setMode("three_formats");
                setError(null);
              }}
              type="button"
            >
              Drei Meta-Formate
            </button>
          </div>

          {mode === "auto_crop" ? (
            <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-extrabold text-slate-900">
                Ein Bild hochladen
              </h3>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                PNG/JPEG, Kantenlänge 256–4096 px. Adbot schneidet nur Formate zu,
                die noch nicht passen (1:1, 4:5, 1,91:1). Das Original bleibt
                unverändert erhalten.
              </p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-3">
                {META_FORMAT_SLOTS.map((item) => (
                  <li
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                    key={item.key}
                  >
                    <p className="text-xs font-extrabold text-slate-900">
                      {item.label}
                    </p>
                    <p className="mt-0.5 text-xs font-semibold text-blue-700">
                      {item.width} × {item.height} px
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-extrabold text-white hover:bg-blue-800 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => autoFileRef.current?.click()}
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
                  disabled={busy}
                  onChange={(event) => {
                    void uploadAutoCrop(event.target.files?.[0]);
                  }}
                  ref={autoFileRef}
                  type="file"
                />
              </div>
            </section>
          ) : (
            <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-extrabold text-slate-900">
                Eigene Formate hochladen
              </h3>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Lade fertige Creatives in den drei gängigen Meta-Formaten hoch.
                Vor dem Speichern prüft Adbot Seitenverhältnis und Auflösung —
                ohne zusätzlichen Zuschnitt.
              </p>
              <ul className="mt-4 grid gap-3 sm:grid-cols-3">
                {META_FORMAT_SLOTS.map((item) => {
                  const state = slots[item.key];
                  return (
                    <li
                      className="flex flex-col rounded-xl border border-slate-200 bg-white p-3"
                      key={item.key}
                    >
                      <p className="text-xs font-extrabold text-slate-900">
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-blue-700">
                        {item.width} × {item.height} px
                      </p>
                      <p className="mt-1 text-[11px] leading-4 text-slate-500">
                        {item.note}
                      </p>
                      <button
                        className="mt-3 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                        disabled={busy}
                        onClick={() =>
                          slotFileRefs.current[item.key]?.click()
                        }
                        type="button"
                      >
                        {state.status === "uploading" ||
                        state.status === "checking" ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Upload className="size-3.5" />
                        )}
                        {state.status === "ok" ? "Ersetzen" : "Hochladen"}
                      </button>
                      <input
                        accept="image/png,image/jpeg"
                        className="hidden"
                        disabled={busy}
                        onChange={(event) => {
                          void uploadFormatSlot(
                            item.key,
                            event.target.files?.[0],
                          );
                        }}
                        ref={(node) => {
                          slotFileRefs.current[item.key] = node;
                        }}
                        type="file"
                      />
                      {state.message ? (
                        <p
                          className={`mt-2 text-[11px] font-semibold leading-4 ${
                            state.status === "ok"
                              ? "text-emerald-700"
                              : state.status === "error"
                                ? "text-rose-700"
                                : "text-slate-600"
                          }`}
                        >
                          {state.message}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

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
                        disabled={busy}
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
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Abbrechen
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-700 px-4 text-sm font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50"
            disabled={busy || !selectedAssetId}
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
