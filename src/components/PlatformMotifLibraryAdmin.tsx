"use client";

import {
  ImagePlus,
  Loader2,
  RefreshCw,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { PlatformMotifView } from "@/lib/platform-library/types";

type Props = {
  initialMotifs: PlatformMotifView[];
  initialTotal: number;
};

export function PlatformMotifLibraryAdmin({
  initialMotifs,
  initialTotal,
}: Props) {
  const [motifs, setMotifs] = useState(initialMotifs);
  const [total, setTotal] = useState(initialTotal);
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { tags: string; contentSummary: string }>
  >({});

  const busy = pending || Boolean(actionId);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return motifs;
    return motifs.filter(
      (motif) =>
        motif.originalFilename.toLowerCase().includes(needle) ||
        motif.tags.some((tag) => tag.includes(needle)) ||
        (motif.contentSummary ?? "").toLowerCase().includes(needle),
    );
  }, [motifs, query]);

  function draftFor(motif: PlatformMotifView) {
    return (
      drafts[motif.id] ?? {
        tags: motif.tags.join(", "),
        contentSummary: motif.contentSummary ?? "",
      }
    );
  }

  async function refresh() {
    const response = await fetch("/api/admin/platform-library?limit=120", {
      credentials: "same-origin",
    });
    const json = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      motifs?: PlatformMotifView[];
      total?: number;
    };
    if (response.ok && json.ok && Array.isArray(json.motifs)) {
      setMotifs(json.motifs);
      setTotal(typeof json.total === "number" ? json.total : json.motifs.length);
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setPending(true);
    setError(null);
    setMessage(null);
    let uploaded = 0;
    let reused = 0;
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.set("file", file);
        body.set("tags", tags);
        const response = await fetch("/api/admin/platform-library", {
          method: "POST",
          credentials: "same-origin",
          body,
        });
        const json = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          reusedExisting?: boolean;
        };
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "Upload fehlgeschlagen.");
        }
        if (json.reusedExisting) reused += 1;
        else uploaded += 1;
      }
      setMessage(
        `${uploaded} Motiv${uploaded === 1 ? "" : "e"} übernommen${
          reused ? `, ${reused} bereits vorhanden` : ""
        }. Kurzinfo wird im Hintergrund ergänzt.`,
      );
      await refresh();
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

  async function onSave(motif: PlatformMotifView) {
    if (actionId) return;
    const draft = draftFor(motif);
    setActionId(motif.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/platform-library", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: motif.id,
          tags: draft.tags.split(",").map((item) => item.trim()),
          contentSummary: draft.contentSummary,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        motif?: PlatformMotifView;
      };
      if (!response.ok || !json.ok || !json.motif) {
        throw new Error(json.error || "Speichern fehlgeschlagen.");
      }
      setMotifs((previous) =>
        previous.map((row) => (row.id === motif.id ? json.motif! : row)),
      );
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[motif.id];
        return next;
      });
      setMessage("Motiv aktualisiert.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Speichern fehlgeschlagen.",
      );
    } finally {
      setActionId(null);
    }
  }

  async function onRecaption(motif: PlatformMotifView) {
    if (actionId) return;
    setActionId(motif.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/platform-library", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: motif.id, recaption: true }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        motif?: PlatformMotifView;
      };
      if (!response.ok || !json.ok || !json.motif) {
        throw new Error(json.error || "Kurzinfo fehlgeschlagen.");
      }
      setMotifs((previous) =>
        previous.map((row) => (row.id === motif.id ? json.motif! : row)),
      );
      setDrafts((previous) => ({
        ...previous,
        [motif.id]: {
          tags: json.motif!.tags.join(", "),
          contentSummary: json.motif!.contentSummary ?? "",
        },
      }));
      setMessage(
        json.motif.contentSummary
          ? "KI-Kurzinfo aktualisiert."
          : "Keine Kurzinfo erzeugt — bitte manuell ergänzen.",
      );
    } catch (captionError) {
      setError(
        captionError instanceof Error
          ? captionError.message
          : "Kurzinfo fehlgeschlagen.",
      );
    } finally {
      setActionId(null);
    }
  }

  async function onRevoke(motif: PlatformMotifView) {
    if (actionId) return;
    if (!window.confirm("Dieses Motiv aus der Adbot-Bibliothek entfernen?")) {
      return;
    }
    setActionId(motif.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/platform-library", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: motif.id }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || "Löschen fehlgeschlagen.");
      }
      setMotifs((previous) => previous.filter((row) => row.id !== motif.id));
      setTotal((value) => Math.max(0, value - 1));
      setMessage("Motiv entfernt.");
    } catch (revokeError) {
      setError(
        revokeError instanceof Error
          ? revokeError.message
          : "Löschen fehlgeschlagen.",
      );
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
            <ImagePlus className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold tracking-tight">
              Motive hochladen
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              PNG/JPEG, handkuratiert. Adbot darf sie für alle Kunden 1:1
              übernehmen oder als Vorlage neu gestalten — anders als die
              Werbebeispiele, die nur anregen.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <label className="grid gap-1 text-sm font-medium">
                Tags (kommagetrennt)
                <input
                  className="h-10 rounded-lg border border-slate-200 px-3"
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="hotel, abendstimmung, outdoor"
                  value={tags}
                />
              </label>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 self-end rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                Dateien wählen
                <input
                  accept="image/png,image/jpeg"
                  className="hidden"
                  disabled={busy}
                  multiple
                  onChange={(event) => {
                    void onUpload(event.target.files);
                    event.target.value = "";
                  }}
                  type="file"
                />
              </label>
            </div>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">
              Adbot-Motivbibliothek
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {total} Motive · Kunden sehen diese Dateien nicht. Launch läuft
              immer über eine Kopie in der jeweiligen Kundenbibliothek.
            </p>
          </div>
          <label className="grid min-w-[240px] gap-1 text-sm font-medium">
            Suchen
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tag, Dateiname, Kurzinfo"
                value={query}
              />
            </span>
          </label>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((motif) => {
            const draft = draftFor(motif);
            const acting = actionId === motif.id;
            return (
              <article
                key={motif.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white"
              >
                <div className="aspect-[4/5] bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    src={`/api/media-library/preview?assetId=${motif.id}`}
                  />
                </div>
                <div className="grid gap-3 p-4">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {motif.originalFilename}
                  </p>
                  <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Tags
                    <input
                      className="h-9 rounded-lg border border-slate-200 px-3 text-sm font-medium normal-case text-slate-900"
                      disabled={busy}
                      onChange={(event) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [motif.id]: {
                            ...draft,
                            tags: event.target.value,
                          },
                        }))
                      }
                      value={draft.tags}
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    KI-Kurzinfo
                    <textarea
                      className="min-h-[72px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium normal-case text-slate-900"
                      disabled={busy}
                      maxLength={400}
                      onChange={(event) =>
                        setDrafts((previous) => ({
                          ...previous,
                          [motif.id]: {
                            ...draft,
                            contentSummary: event.target.value,
                          },
                        }))
                      }
                      value={draft.contentSummary}
                    />
                  </label>
                  <p className="text-xs text-slate-500">
                    {motif.captionStatus === "pending"
                      ? "Kurzinfo wird erzeugt…"
                      : motif.captionStatus === "failed"
                        ? "Automatische Kurzinfo fehlgeschlagen."
                        : motif.captionStatus === "skipped"
                          ? "Keine KI-Kurzinfo — manuell pflegen."
                          : "Kurzinfo bereit."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void onSave(motif)}
                      type="button"
                    >
                      {acting ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Tags className="size-3.5" />
                      )}
                      Speichern
                    </button>
                    <button
                      className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-100 px-3 text-sm font-semibold text-slate-800 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void onRecaption(motif)}
                      type="button"
                    >
                      <RefreshCw className="size-3.5" />
                      Neu analysieren
                    </button>
                    <button
                      className="inline-flex h-9 items-center gap-1 rounded-lg bg-rose-50 px-3 text-sm font-semibold text-rose-800 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => void onRevoke(motif)}
                      type="button"
                    >
                      <Trash2 className="size-3.5" />
                      Entfernen
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {visible.length === 0 ? (
          <p className="mt-6 text-sm text-slate-500">
            Noch keine Motive. Lade die ersten handkuratierten Bilder hoch.
          </p>
        ) : null}
      </section>
    </div>
  );
}
