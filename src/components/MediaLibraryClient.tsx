"use client";

import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { formatLabelForDimensions } from "@/lib/media-library/meta-formats";
import { parseAssetUploadResponse } from "@/lib/media-library/parse-upload-response";

export type MediaLibraryAssetView = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  sourceType: string;
  status: string;
  metaImageHashPresent: boolean;
  createdAt: string;
  label?: string | null;
};

type BrandProfileOption = {
  id: string;
  brandName: string;
};

export function MediaLibraryClient({
  assets: initialAssets,
  brandProfiles,
  metaConnected,
}: {
  assets: MediaLibraryAssetView[];
  brandProfiles: BrandProfileOption[];
  metaConnected: boolean;
}) {
  const router = useRouter();
  const [assets, setAssets] = useState(initialAssets);
  const [brandProfileId, setBrandProfileId] = useState(
    brandProfiles[0]?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Keep local list in sync when the server re-renders after upload/refresh.
  useEffect(() => {
    setAssets(initialAssets);
  }, [initialAssets]);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setPending(true);
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
      setMessage(
        "Creative in deine Media Library übernommen. Du kannst es später für Meta-Launches nutzen.",
      );
      router.refresh();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Upload fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  }

  async function onDelete(assetId: string) {
    if (deletingId) return;
    const confirmed = window.confirm(
      "Dieses Creative wirklich löschen? Zugehörige Auto-Zuschnitte werden mit entfernt.",
    );
    if (!confirmed) return;

    setDeletingId(assetId);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/media-library/asset", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        revokedAssetIds?: string[];
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Löschen fehlgeschlagen.");
      }
      const revoked = new Set(result.revokedAssetIds ?? [assetId]);
      setAssets((previous) => previous.filter((asset) => !revoked.has(asset.id)));
      setMessage("Creative gelöscht.");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Löschen fehlgeschlagen.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
            <Upload className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold tracking-tight">
              Creative hochladen
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              PNG/JPEG (256–4096px). Ein Bild: Adbot schneidet nur fehlende
              Meta-Formate zu (1:1, 4:5, 9:16). Fertige Formate kannst du im
              Creative-Dialog beim Launch einzeln hochladen. Brand-Profil ist
              optional — für Active Launch reicht die Zuordnung zum Launch.
            </p>
            {!metaConnected ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Bitte zuerst ein Meta-Werbekonto verbinden.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                {brandProfiles.length ? (
                  <label className="grid flex-1 gap-1 text-sm font-medium">
                    Brand-Profil (optional)
                    <select
                      className="h-10 rounded-lg border border-slate-200 px-3"
                      onChange={(event) => setBrandProfileId(event.target.value)}
                      value={brandProfileId}
                    >
                      <option value="">Ohne Profil speichern</option>
                      {brandProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.brandName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
                  {pending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ImagePlus className="size-4" />
                  )}
                  Datei wählen
                  <input
                    accept="image/png,image/jpeg"
                    className="hidden"
                    disabled={pending || Boolean(deletingId)}
                    onChange={(event) => {
                      void onUpload(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
              </div>
            )}
            {error ? (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {message}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-extrabold tracking-tight">Deine Creatives</h2>
        <p className="mt-1 text-sm text-slate-600">
          Vorschau direkt in der Karte — bereit für Meta-Launch, sobald Autonomie
          und Brand-Profil im Control Center stehen.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => {
            const formatLabel =
              asset.label?.trim() ||
              formatLabelForDimensions(asset.width, asset.height) ||
              "Eigenes Format";
            const sizeLabel =
              asset.width && asset.height
                ? `${asset.width}×${asset.height}`
                : "Größe unbekannt";
            const deleting = deletingId === asset.id;

            return (
              <article
                key={asset.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <div className="relative aspect-[4/5] bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    src={`/api/media-library/preview?assetId=${asset.id}`}
                  />
                  <button
                    aria-label="Creative löschen"
                    className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-lg bg-white/95 text-rose-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-rose-50 disabled:opacity-50"
                    disabled={pending || Boolean(deletingId)}
                    onClick={() => void onDelete(asset.id)}
                    type="button"
                  >
                    {deleting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </button>
                </div>
                <div className="space-y-1 p-3">
                  <p className="truncate text-sm font-extrabold text-slate-950">
                    {asset.originalFilename}
                  </p>
                  <p className="text-xs font-semibold text-blue-700">
                    {formatLabel}
                  </p>
                  <p className="text-xs text-slate-500">
                    {sizeLabel}
                    {asset.metaImageHashPresent ? " · Meta-Hash" : ""}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {new Date(asset.createdAt).toLocaleString("de-DE")}
                  </p>
                  {asset.status === "READY" ? (
                    <a
                      className="mt-2 inline-flex text-xs font-bold text-emerald-700 hover:underline"
                      href={`/dashboard?assetId=${asset.id}#traffic-launch`}
                    >
                      Für Traffic-Kampagne nutzen
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!assets.length ? (
            <p className="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">
              Noch keine Uploads.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
