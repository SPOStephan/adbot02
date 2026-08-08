"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";

import type { LegalPage, LegalSlug } from "@/lib/legal/types";
import { MARKETING_SITE_URL } from "@/lib/site-urls";

type Props = {
  pages: LegalPage[];
};

export function LegalPagesEditor({ pages }: Props) {
  const router = useRouter();
  const [activeSlug, setActiveSlug] = useState<LegalSlug>(
    pages[0]?.slug ?? "impressum",
  );
  const active = pages.find((page) => page.slug === activeSlug) ?? pages[0];
  const [title, setTitle] = useState(active?.title ?? "");
  const [body, setBody] = useState(active?.body ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function selectSlug(slug: LegalSlug) {
    const next = pages.find((page) => page.slug === slug);
    setActiveSlug(slug);
    setTitle(next?.title ?? "");
    setBody(next?.body ?? "");
    setNotice(null);
  }

  async function onSave() {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/legal/pages", {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: activeSlug,
          title,
          body,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? "Speichern fehlgeschlagen.");
      }
      setNotice("Gespeichert. Öffentliche Seite ist aktualisiert.");
      router.refresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Speichern fehlgeschlagen.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-slate-950">
            Rechtliche Texte
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Inhalte hier einfügen und speichern. Die öffentlichen Seiten unter{" "}
            <a
              className="font-bold text-blue-700 underline underline-offset-2"
              href={`${MARKETING_SITE_URL}/impressum`}
              rel="noreferrer"
              target="_blank"
            >
              /impressum
            </a>
            ,{" "}
            <a
              className="font-bold text-blue-700 underline underline-offset-2"
              href={`${MARKETING_SITE_URL}/datenschutz`}
              rel="noreferrer"
              target="_blank"
            >
              /datenschutz
            </a>{" "}
            und{" "}
            <a
              className="font-bold text-blue-700 underline underline-offset-2"
              href={`${MARKETING_SITE_URL}/agb`}
              rel="noreferrer"
              target="_blank"
            >
              /agb
            </a>{" "}
            lesen denselben Text.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {pages.map((page) => (
          <button
            className={`rounded-lg px-3 py-2 text-xs font-extrabold ${
              page.slug === activeSlug
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            key={page.slug}
            onClick={() => selectSlug(page.slug)}
            type="button"
          >
            {page.title}
          </button>
        ))}
      </div>

      <label className="mt-5 block text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
        Titel
        <input
          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-900"
          onChange={(event) => setTitle(event.target.value)}
          value={title}
        />
      </label>

      <label className="mt-4 block text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
        Inhalt (Klartext, ohne # / Markdown)
        <textarea
          className="mt-2 min-h-[28rem] w-full rounded-xl border border-slate-200 px-3 py-3 font-mono text-sm leading-6 text-slate-900"
          onChange={(event) => setBody(event.target.value)}
          placeholder="Einfach Text einfügen. Abschnitte mit Leerzeilen trennen — keine # oder ## nötig."
          spellCheck
          value={body}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-extrabold text-white disabled:opacity-50"
          disabled={pending}
          onClick={() => void onSave()}
          type="button"
        >
          <Save className="size-3.5" />
          {pending ? "Speichert …" : "Speichern"}
        </button>
        <p className="text-xs font-semibold text-slate-500">
          Quelle: {active?.source === "database" ? "Datenbank" : "Datei-Vorlage"}
        </p>
      </div>

      {notice ? (
        <p className="mt-3 text-sm font-semibold text-slate-700" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
