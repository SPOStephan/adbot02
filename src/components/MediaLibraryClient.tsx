"use client";

import { ExternalLink, ImagePlus, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type MediaLibraryAssetView = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  sourceType: string;
  status: string;
  metaImageHashPresent: boolean;
  createdAt: string;
};

type BrandProfileOption = {
  id: string;
  brandName: string;
};

export function MediaLibraryClient({
  assets,
  brandProfiles,
  metaConnected,
}: {
  assets: MediaLibraryAssetView[];
  brandProfiles: BrandProfileOption[];
  metaConnected: boolean;
}) {
  const router = useRouter();
  const [brandProfileId, setBrandProfileId] = useState(
    brandProfiles[0]?.id ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.set("file", file);
      if (brandProfileId) {
        body.set("brandProfileId", brandProfileId);
      }
      const response = await fetch("/api/meta/automation/asset-upload", {
        method: "POST",
        body,
      });
      const json = (await response.json()) as {
        ok?: boolean;
        error?: string;
        brandAssetId?: string;
      };
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
              PNG/JPEG (256–4096px). Einfach hochladen — ein Brand-Profil ist dafür
              nicht nötig. Später kann Adbot aus deinen Creatives z.&nbsp;B.
              Farbvorschläge ableiten; für Active Launch reicht die Zuordnung zum
              Profil zum Launch-Zeitpunkt.
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
                      onChange={event => setBrandProfileId(event.target.value)}
                      value={brandProfileId}
                    >
                      <option value="">Ohne Profil speichern</option>
                      {brandProfiles.map(profile => (
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
                    disabled={pending}
                    onChange={event => {
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
          In der Library gespeichert — bereit für Meta-Launch, sobald Autonomie und
          Brand-Profil im Control Center stehen.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {assets.map(asset => (
            <article
              key={asset.id}
              className="rounded-xl border border-slate-200 p-4"
            >
              <p className="truncate text-sm font-bold text-slate-950">
                {asset.originalFilename}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {asset.width && asset.height
                  ? `${asset.width}×${asset.height} · `
                  : null}
                {asset.sourceType} · {asset.status}
                {asset.metaImageHashPresent ? " · Meta-Hash vorhanden" : ""}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(asset.createdAt).toLocaleString("de-DE")}
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <a
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                  href={`/api/media-library/preview?assetId=${asset.id}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Vorschau
                  <ExternalLink className="size-3" />
                </a>
                {asset.status === "READY" ? (
                  <a
                    className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline"
                    href={`/dashboard?assetId=${asset.id}#traffic-launch`}
                  >
                    Für Traffic-Kampagne nutzen
                  </a>
                ) : null}
              </div>
            </article>
          ))}
          {!assets.length ? (
            <p className="text-sm text-slate-500">Noch keine Uploads.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
