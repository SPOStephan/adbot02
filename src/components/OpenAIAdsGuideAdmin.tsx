"use client";

import {
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";

import type {
  OpenAIAdsGuide,
  OpenAIAdsGuideStep,
} from "@/lib/openai-ads/guide-types";

type GuideResponse = {
  ok?: boolean;
  message?: string;
  guide?: OpenAIAdsGuide;
};

function StepEditor({
  step,
  nextOrder,
  onSaved,
  onRemoved,
}: {
  step?: OpenAIAdsGuideStep;
  nextOrder: number;
  onSaved: (guide: OpenAIAdsGuide, message: string) => void;
  onRemoved: (guide: OpenAIAdsGuide) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(step?.title ?? "");
  const [description, setDescription] = useState(step?.description ?? "");
  const [sortOrder, setSortOrder] = useState(step?.sortOrder ?? nextOrder);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      if (step) form.set("stepId", step.id);
      form.set("title", title);
      form.set("description", description);
      form.set("sortOrder", String(sortOrder));
      if (file) form.set("file", file);
      const response = await fetch("/api/admin/openai-ads-guide", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as GuideResponse;
      if (!response.ok || payload.ok !== true || !payload.guide) {
        throw new Error(payload.message ?? "Speichern fehlgeschlagen.");
      }
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      onSaved(
        payload.guide,
        step ? "Anleitungsschritt gespeichert." : "Anleitungsschritt hinzugefügt.",
      );
      if (!step) {
        setTitle("");
        setDescription("");
        setSortOrder(nextOrder + 1);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Speichern fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!step || pending) return;
    if (!window.confirm(`„${step.title}“ wirklich aus der Anleitung entfernen?`)) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/openai-ads-guide", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: step.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as GuideResponse;
      if (!response.ok || payload.ok !== true || !payload.guide) {
        throw new Error(payload.message ?? "Entfernen fehlgeschlagen.");
      }
      onRemoved(payload.guide);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Entfernen fehlgeschlagen.");
      setPending(false);
    }
  }

  return (
    <form
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      onSubmit={save}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-200 bg-slate-50">
            {step?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`Vorschau ${step.title}`}
                className="max-h-72 w-full object-contain"
                src={step.imageUrl}
              />
            ) : (
              <div className="px-5 text-center text-slate-400">
                <ImagePlus className="mx-auto size-8" />
                <p className="mt-2 text-sm font-bold">Neuen Screenshot auswählen</p>
              </div>
            )}
          </div>
          {step ? (
            <p className="mt-2 text-xs text-slate-500">
              {step.width}×{step.height} · {step.originalFilename}
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <label className="grid gap-1 text-sm font-bold text-slate-800">
              Schritttitel
              <input
                className="h-11 rounded-xl border border-slate-300 px-3 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                maxLength={100}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="z. B. API Keys öffnen"
                required
                value={title}
              />
            </label>
            <label className="grid gap-1 text-sm font-bold text-slate-800">
              Reihenfolge
              <input
                className="h-11 rounded-xl border border-slate-300 px-3 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
                max={100}
                min={1}
                onChange={(event) => setSortOrder(Number(event.target.value))}
                required
                type="number"
                value={sortOrder}
              />
            </label>
          </div>

          <label className="grid gap-1 text-sm font-bold text-slate-800">
            Kurze Erklärung
            <textarea
              className="min-h-24 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-100"
              maxLength={600}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Beschreibe exakt, was der Nutzer auf diesem Screenshot anklicken muss."
              value={description}
            />
          </label>

          <label className="grid gap-1 text-sm font-bold text-slate-800">
            {step ? "Screenshot ersetzen (optional)" : "Screenshot"}
            <input
              accept="image/png,image/jpeg,image/webp"
              className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-blue-700"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              ref={fileRef}
              required={!step}
              type="file"
            />
          </label>

          <p className="text-xs leading-5 text-slate-500">
            PNG, JPEG oder WebP, maximal 8 MB. Die Anleitung ist für eingeloggte
            Kunden bestimmt; Screenshots dürfen keine API-Keys, Passwörter oder
            personenbezogenen Daten zeigen.
          </p>

          {error ? (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:opacity-50"
              disabled={pending}
              type="submit"
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {step ? "Änderungen speichern" : "Schritt hinzufügen"}
            </button>
            {step ? (
              <button
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-200 px-4 py-3 text-sm font-extrabold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                disabled={pending}
                onClick={() => void remove()}
                type="button"
              >
                <Trash2 className="size-4" />
                Entfernen
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}

export function OpenAIAdsGuideAdmin({ initialGuide }: { initialGuide: OpenAIAdsGuide }) {
  const [guide, setGuide] = useState(initialGuide);
  const [publishPending, setPublishPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setPublished(published: boolean) {
    setPublishPending(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/admin/openai-ads-guide", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published }),
      });
      const payload = (await response.json().catch(() => ({}))) as GuideResponse;
      if (!response.ok || payload.ok !== true || !payload.guide) {
        throw new Error(payload.message ?? "Status konnte nicht geändert werden.");
      }
      setGuide(payload.guide);
      setNotice(
        published
          ? "Anleitung veröffentlicht. Der Link ist für Kunden sofort sichtbar."
          : "Anleitung ausgeblendet. Gespeicherte Screenshots bleiben erhalten.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Status konnte nicht geändert werden.",
      );
    } finally {
      setPublishPending(false);
    }
  }

  function updateGuide(next: OpenAIAdsGuide, message: string) {
    setGuide(next);
    setNotice(message);
    setError(null);
  }

  const nextOrder =
    guide.steps.reduce((maximum, step) => Math.max(maximum, step.sortOrder), 0) + 1;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-extrabold">Kundenansicht</p>
            <p className="mt-1 max-w-3xl text-sm leading-6">
              Die Anleitung öffnet sich optional in einem neuen Tab. Änderungen an
              Bildern und Texten werden nach dem Speichern sofort übernommen.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {guide.published ? (
              <a
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-extrabold text-blue-700 hover:bg-blue-100"
                href="/dashboard/chatgpt-ads/anleitung"
                rel="noreferrer"
                target="_blank"
              >
                Vorschau öffnen
                <ExternalLink className="size-3.5" />
              </a>
            ) : null}
            <button
              className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-xs font-extrabold text-white disabled:opacity-50 ${
                guide.published
                  ? "bg-slate-700 hover:bg-slate-800"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
              disabled={publishPending}
              onClick={() => void setPublished(!guide.published)}
              type="button"
            >
              {publishPending ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : guide.published ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {guide.published ? "Anleitung ausblenden" : "Anleitung veröffentlichen"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs font-bold uppercase tracking-wide">
          Status: {guide.published ? "Veröffentlicht" : "Nicht veröffentlicht"} · {guide.steps.length}{" "}
          {guide.steps.length === 1 ? "Schritt" : "Schritte"}
        </p>
      </section>

      {notice ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-950">Vorhandene Schritte</h2>
          <p className="mt-1 text-sm text-slate-500">
            Reihenfolge, Text und Screenshot lassen sich jederzeit unabhängig ändern.
          </p>
        </div>
        {guide.steps.map((step) => (
          <StepEditor
            key={`${step.id}:${step.updatedAt}`}
            nextOrder={nextOrder}
            onRemoved={(next) => updateGuide(next, "Anleitungsschritt entfernt.")}
            onSaved={updateGuide}
            step={step}
          />
        ))}
        {guide.steps.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-500">
            Noch keine Screenshots hinterlegt. Die Kundenansicht bleibt deshalb verborgen.
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-extrabold text-slate-950">Neuen Schritt hinzufügen</h2>
          <p className="mt-1 text-sm text-slate-500">
            Lade einen Screenshot hoch und beschreibe exakt den nächsten Klick.
          </p>
        </div>
        <StepEditor
          nextOrder={nextOrder}
          onRemoved={() => undefined}
          onSaved={updateGuide}
        />
      </section>
    </div>
  );
}
