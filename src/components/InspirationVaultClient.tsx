"use client";

import { EyeOff, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type InspirationAssetView = {
  id: string;
  originalFilename: string;
  width: number | null;
  height: number | null;
  note: string | null;
  createdAt: string;
};

export function InspirationVaultClient({
  assets,
}: {
  assets: InspirationAssetView[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
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
      body.set("note", note);
      const response = await fetch("/api/admin/inspiration-vault/upload", {
        method: "POST",
        body,
      });
      const json = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Upload fehlgeschlagen.");
      }
      setMessage("Im Inspiration Vault abgelegt — für Kunden unsichtbar, nie Meta-Launch.");
      setNote("");
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
          <span className="grid size-10 place-items-center rounded-xl bg-slate-900 text-white">
            <EyeOff className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold tracking-tight">
              Versteckte Inspiration
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Referenz-Werbemittel und Screenshots nur für Adbot. Kunden sehen diese Ablage
              nie; sie wird niemals direkt bei Meta ausgespielt.
            </p>
            <label className="mt-4 grid gap-1 text-sm font-medium">
              Notiz (optional)
              <input
                className="h-10 rounded-lg border border-slate-200 px-3"
                onChange={event => setNote(event.target.value)}
                placeholder="z. B. starker Hook, Social Proof, Branchenbeispiel"
                value={note}
              />
            </label>
            <label className="mt-3 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Inspiration hochladen
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
        <h2 className="text-lg font-extrabold tracking-tight">Vault-Inhalt</h2>
        <ul className="mt-4 divide-y">
          {assets.map(asset => (
            <li key={asset.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="text-sm font-semibold">{asset.originalFilename}</p>
                <p className="text-xs text-slate-500">
                  {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : null}
                  {new Date(asset.createdAt).toLocaleString("de-DE")}
                  {asset.note ? ` · ${asset.note}` : ""}
                </p>
              </div>
              <a
                className="text-xs font-semibold text-blue-700 hover:underline"
                href={`/api/media-library/preview?assetId=${asset.id}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                Vorschau
              </a>
            </li>
          ))}
          {!assets.length ? (
            <li className="py-4 text-sm text-slate-500">Noch keine Inspirationen.</li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
