"use client";

import { LoaderCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";

import type { TrainingInbox, TrainingRunView } from "@/lib/ad-training/types";

type Props = { initialInbox: TrainingInbox };

type ApiResponse = {
  ok?: boolean;
  message?: string;
  run?: TrainingRunView;
};

export function AdbotTrainingGround({ initialInbox }: Props) {
  const [inbox, setInbox] = useState(initialInbox);
  const [landingUrl, setLandingUrl] = useState("");
  const [platform, setPlatform] = useState("meta");
  const [objective, setObjective] = useState("traffic");
  const [industry, setIndustry] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const current = inbox.runs[0] ?? null;

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending("generate");
    setError(null);
    try {
      const response = await fetch("/api/admin/training", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", landingUrl, platform, objective, industry }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse & TrainingInbox;
      if (!response.ok || !payload.ok || !payload.run) {
        throw new Error(payload.message ?? "Ad konnte nicht erzeugt werden.");
      }
      setInbox((prev) => ({
        ...prev,
        runs: [payload.run as TrainingRunView, ...prev.runs.filter((item) => item.id !== payload.run?.id)],
      }));
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Erzeugung fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  async function rate(verdict: "keep" | "reject") {
    if (!current || pending) return;
    setPending(verdict);
    setError(null);
    try {
      const response = await fetch("/api/admin/training", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rate", id: current.id, verdict, note }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok || !payload.run) {
        throw new Error(payload.message ?? "Bewertung fehlgeschlagen.");
      }
      setInbox((prev) => {
        const runs = prev.runs.map((item) => (item.id === payload.run?.id ? (payload.run as TrainingRunView) : item));
        return {
          ...prev,
          runs,
          ratedCount: runs.filter((item) => item.verdict).length,
          keepCount: runs.filter((item) => item.verdict === "keep").length,
          rejectCount: runs.filter((item) => item.verdict === "reject").length,
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bewertung fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-6">
      <p className="max-w-3xl text-sm leading-6 text-slate-600">
        Du spielst den fiktiven Kunden. URL eingeben, Adbot gestaltet Text und Bild.
        Gut oder schlecht — die nächste Erzeugung sieht diese Bewertung sofort.
        Das ist das tägliche Lernen. Ein Fine-Tune der Gewichte kommt später aus
        genau diesen Paaren, nicht stündlich.
      </p>

      {inbox.migrationNeeded ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Tabelle `adbot_training_runs` fehlt. Migration
          `20260916140000_adbot_training_runs.sql` im produktiven Supabase ausführen.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Bewertet" value={inbox.ratedCount} />
        <Stat label="Gut" value={inbox.keepCount} />
        <Stat label="Schlecht" value={inbox.rejectCount} />
      </div>

      <form className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2" onSubmit={generate}>
        <label className="grid gap-1 md:col-span-2">
          <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Landingpage-URL</span>
          <input
            className="h-12 rounded-xl border border-slate-300 px-3"
            onChange={(event) => setLandingUrl(event.target.value)}
            placeholder="https://www.beispiel-hotel.de/angebot"
            required
            type="url"
            value={landingUrl}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Plattform</span>
          <select className="h-11 rounded-xl border border-slate-300 px-3" onChange={(event) => setPlatform(event.target.value)} value={platform}>
            <option value="meta">Meta</option>
            <option value="openai_ads">ChatGPT Ads</option>
            <option value="google">Google</option>
            <option value="tiktok">TikTok</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Ziel</span>
          <select className="h-11 rounded-xl border border-slate-300 px-3" onChange={(event) => setObjective(event.target.value)} value={objective}>
            <option value="traffic">Traffic</option>
            <option value="leads">Leads</option>
            <option value="sales">Verkäufe</option>
            <option value="awareness">Bekanntheit</option>
          </select>
        </label>
        <label className="grid gap-1 md:col-span-2">
          <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Branche (optional, steuert das Matching)</span>
          <input
            className="h-11 rounded-xl border border-slate-300 px-3"
            onChange={(event) => setIndustry(event.target.value)}
            placeholder="Hotels & Reisen"
            value={industry}
          />
        </label>
        <div className="md:col-span-2">
          <button
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-60"
            disabled={Boolean(pending)}
            type="submit"
          >
            {pending === "generate" ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Ad gestalten
          </button>
          {!inbox.imageGenerationConfigured ? (
            <p className="mt-2 text-xs text-slate-500">
              Bildgenerierung ist in dieser Umgebung nicht konfiguriert — Text kommt trotzdem, Bild sobald OpenRouter steht.
            </p>
          ) : null}
        </div>
      </form>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {current ? (
        <article className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            {current.landingHostname} · {current.platform}/{current.objective}
          </p>
          <div className="mt-4 grid gap-5 lg:grid-cols-[240px_1fr]">
            {current.imagePreviewUrl ? (
              <img alt="" className="aspect-square w-full rounded-xl border border-slate-200 object-cover" src={current.imagePreviewUrl} />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
                {current.imageError || "Kein Bild"}
              </div>
            )}
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-950">{current.headline}</h2>
              <p className="mt-3 text-base leading-7 text-slate-800">{current.primaryText}</p>
              {current.description ? (
                <p className="mt-2 text-sm text-slate-500">{current.description}</p>
              ) : null}
              <p className="mt-3 text-xs text-slate-400">
                Quelle: {current.landingTitle || current.landingUrl}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <textarea
              className="min-h-20 rounded-xl border border-slate-300 px-3 py-2 text-sm"
              onChange={(event) => setNote(event.target.value)}
              placeholder="Warum gut oder schlecht? (optional, fließt in den nächsten Prompt)"
              value={note}
            />
            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                disabled={Boolean(pending)}
                onClick={() => rate("keep")}
                type="button"
              >
                {pending === "keep" ? <LoaderCircle className="size-4 animate-spin" /> : <ThumbsUp className="size-4" />}
                Gut — so mehr
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                disabled={Boolean(pending)}
                onClick={() => rate("reject")}
                type="button"
              >
                {pending === "reject" ? <LoaderCircle className="size-4 animate-spin" /> : <ThumbsDown className="size-4" />}
                Schlecht — so nicht
              </button>
              {current.verdict ? (
                <span className="self-center text-sm font-semibold text-slate-600">
                  Bewertet: {current.verdict === "keep" ? "gut" : "schlecht"}
                </span>
              ) : null}
            </div>
          </div>
        </article>
      ) : null}

      {inbox.runs.length > 1 ? (
        <div>
          <h3 className="text-sm font-extrabold uppercase tracking-wide text-slate-500">Letzte Läufe</h3>
          <ul className="mt-3 space-y-2">
            {inbox.runs.slice(1, 12).map((run) => (
              <li key={run.id} className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-sm">
                <strong>{run.headline || run.landingHostname}</strong>
                <span className="text-slate-500">
                  {" "}
                  · {run.verdict === "keep" ? "gut" : run.verdict === "reject" ? "schlecht" : "offen"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-slate-950">{value}</p>
    </div>
  );
}
