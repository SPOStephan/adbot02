"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ImagePlus,
  Lightbulb,
  Link2,
  LoaderCircle,
  Rocket,
  Sparkles,
  Type,
} from "lucide-react";

import type { CampaignIdeaView } from "@/lib/campaign-pipeline/idea-core";

type SourceMode = "LINK" | "SCREENSHOT" | "KEYWORDS";

type Notice = { tone: "success" | "error"; message: string } | null;

const OBJECTIVES: Array<{ value: string; label: string }> = [
  { value: "OUTCOME_TRAFFIC", label: "Traffic / Websitebesuche" },
  { value: "OUTCOME_LEADS", label: "Leads" },
  { value: "OUTCOME_SALES", label: "Verkäufe" },
  { value: "OUTCOME_AWARENESS", label: "Bekanntheit" },
  { value: "OUTCOME_ENGAGEMENT", label: "Interaktion" },
];

const STATUS_LABEL: Record<CampaignIdeaView["status"], string> = {
  QUEUED: "In der Pipeline",
  READY: "Verstanden — wartet",
  REALIZING: "Wird umgesetzt",
  REALIZED: "Kampagne vorbereitet",
  FAILED: "Analyse unvollständig",
  ARCHIVED: "Archiviert",
};

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100";

async function postJson<T extends Record<string, unknown>>(
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    ok?: boolean;
    message?: string;
  };
  if (!response.ok || !result.ok) {
    throw new Error(
      result.message ?? "Die Aktion konnte nicht sicher abgeschlossen werden.",
    );
  }
  return result;
}

function sourceLabel(type: SourceMode): string {
  if (type === "LINK") return "Link";
  if (type === "SCREENSHOT") return "Screenshot";
  return "Stichworte";
}

export function CampaignIdeaPipeline({
  ideas,
  brandProfileId,
}: {
  ideas: CampaignIdeaView[];
  brandProfileId: string | null;
}) {
  const router = useRouter();
  const [sourceType, setSourceType] = useState<SourceMode>("LINK");
  const [sourceUrl, setSourceUrl] = useState("");
  const [keywords, setKeywords] = useState("");
  const [notes, setNotes] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [objective, setObjective] = useState("OUTCOME_TRAFFIC");
  const [screenshotAssetId, setScreenshotAssetId] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState("");
  const [pending, setPending] = useState(false);
  const [busyIdeaId, setBusyIdeaId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [realizeId, setRealizeId] = useState<string | null>(null);
  const [realizeUrl, setRealizeUrl] = useState("");
  const [realizeObjective, setRealizeObjective] = useState("OUTCOME_TRAFFIC");
  const [generateCreative, setGenerateCreative] = useState(true);

  async function uploadScreenshot(file: File | undefined) {
    if (!file) return;
    setPending(true);
    setNotice(null);
    try {
      const body = new FormData();
      body.set("file", file);
      if (brandProfileId) body.set("brandProfileId", brandProfileId);
      const response = await fetch("/api/meta/automation/asset-upload", {
        method: "POST",
        credentials: "same-origin",
        body,
      });
      const json = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        brandAssetId?: string;
        error?: string;
      };
      if (!response.ok || !json.ok || !json.brandAssetId) {
        throw new Error(json.error || "Screenshot konnte nicht geladen werden.");
      }
      setScreenshotAssetId(json.brandAssetId);
      setScreenshotName(file.name);
      setNotice({
        tone: "success",
        message:
          "Screenshot liegt als Inspiration — Adbot nutzt ihn niemals 1:1 als Anzeige.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Upload fehlgeschlagen.",
      });
    } finally {
      setPending(false);
    }
  }

  async function submitIdea(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const result = await postJson<{
        alreadyExisted?: boolean;
      }>("/api/meta/automation/campaign-idea", {
        sourceType,
        sourceUrl: sourceType === "LINK" ? sourceUrl.trim() : "",
        keywords: keywords.trim(),
        notes: notes.trim(),
        screenshotAssetId:
          sourceType === "SCREENSHOT" ? screenshotAssetId : "",
        destinationUrl: destinationUrl.trim(),
        objective,
      });
      setNotice({
        tone: "success",
        message: result.alreadyExisted
          ? "Diese Idee liegt schon in der Pipeline."
          : "Idee aufgenommen. Adbot hat den Kern gelesen — umsetzen kannst du jederzeit.",
      });
      setSourceUrl("");
      setKeywords("");
      setNotes("");
      setScreenshotAssetId(null);
      setScreenshotName("");
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Idee konnte nicht gespeichert werden.",
      });
    } finally {
      setPending(false);
    }
  }

  async function reanalyze(ideaId: string) {
    setBusyIdeaId(ideaId);
    try {
      await postJson("/api/meta/automation/campaign-idea/analyze", { ideaId });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Analyse fehlgeschlagen.",
      });
    } finally {
      setBusyIdeaId(null);
    }
  }

  async function archive(ideaId: string) {
    setBusyIdeaId(ideaId);
    try {
      await postJson("/api/meta/automation/campaign-idea/archive", { ideaId });
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Archivieren fehlgeschlagen.",
      });
    } finally {
      setBusyIdeaId(null);
    }
  }

  async function realize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!realizeId) return;
    setBusyIdeaId(realizeId);
    setNotice(null);
    try {
      const result = await postJson<{ launchPath?: string }>(
        "/api/meta/automation/campaign-idea/realize",
        {
          ideaId: realizeId,
          destinationUrl: realizeUrl.trim(),
          objective: realizeObjective,
          generateCreative,
        },
      );
      if (result.launchPath) {
        router.push(result.launchPath);
        return;
      }
      router.refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Umsetzung fehlgeschlagen.",
      });
    } finally {
      setBusyIdeaId(null);
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-blue-50 text-blue-700">
            <Lightbulb className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold text-slate-950">
              Idee in die Pipeline
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Link, Screenshot einer fremden Kampagne oder Stichworte. Ideen
              bleiben liegen, bis du „Idee jetzt umsetzen“ tippst. Fremde
              Anzeigen sind nur Inspiration — niemals 1:1.
            </p>
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={submitIdea}>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: "LINK" as const, icon: Link2, label: "Link" },
                { value: "SCREENSHOT" as const, icon: ImagePlus, label: "Screenshot" },
                { value: "KEYWORDS" as const, icon: Type, label: "Stichworte" },
              ] as const
            ).map((option) => (
              <button
                className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold ring-1 ring-inset ${
                  sourceType === option.value
                    ? "bg-blue-700 text-white ring-blue-700"
                    : "bg-slate-50 text-slate-700 ring-slate-200"
                }`}
                disabled={pending}
                key={option.value}
                onClick={() => setSourceType(option.value)}
                type="button"
              >
                <option.icon className="size-4" />
                {option.label}
              </button>
            ))}
          </div>

          {sourceType === "LINK" ? (
            <label className="block text-sm font-bold text-slate-800">
              Link zur Idee (HTTPS)
              <input
                className={inputClass}
                disabled={pending}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://…"
                required
                type="url"
                value={sourceUrl}
              />
            </label>
          ) : null}

          {sourceType === "SCREENSHOT" ? (
            <label className="block text-sm font-bold text-slate-800">
              Screenshot der fremden Anzeige
              <input
                accept="image/png,image/jpeg"
                className={inputClass}
                disabled={pending}
                onChange={(event) => void uploadScreenshot(event.target.files?.[0])}
                type="file"
              />
              <span className="mt-1 block text-xs font-medium text-slate-500">
                {screenshotName
                  ? `${screenshotName} — nur Inspiration, kein Launch-Motiv.`
                  : "PNG oder JPEG. Adbot liest das Muster, kopiert nichts."}
              </span>
            </label>
          ) : null}

          <label className="block text-sm font-bold text-slate-800">
            {sourceType === "KEYWORDS"
              ? "Was willst du wie bewerben?"
              : "Stichworte (optional)"}
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              disabled={pending}
              maxLength={500}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="Produkt, Angebot, Zielgruppe, Ton…"
              required={sourceType === "KEYWORDS"}
              value={keywords}
            />
          </label>

          <label className="block text-sm font-bold text-slate-800">
            Eigene Ziel-URL, falls schon klar (HTTPS)
            <input
              className={inputClass}
              disabled={pending}
              onChange={(event) => setDestinationUrl(event.target.value)}
              placeholder="https://dein-funnel.de/…"
              type="url"
              value={destinationUrl}
            />
          </label>

          <label className="block text-sm font-bold text-slate-800">
            Notiz
            <input
              className={inputClass}
              disabled={pending}
              maxLength={500}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional: Funnel-Idee, Einwand, Preis…"
              value={notes}
            />
          </label>

          <label className="block text-sm font-bold text-slate-800">
            Werbeziel
            <select
              className={inputClass}
              disabled={pending}
              onChange={(event) => setObjective(event.target.value)}
              value={objective}
            >
              {OBJECTIVES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          {notice ? (
            <p
              className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                notice.tone === "success"
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-rose-50 text-rose-800"
              }`}
              role="status"
            >
              {notice.message}
            </p>
          ) : null}

          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-sm font-extrabold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              pending || (sourceType === "SCREENSHOT" && !screenshotAssetId)
            }
            type="submit"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            In die Pipeline legen
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-extrabold text-slate-950">Deine Ideen</h2>
        {ideas.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm font-semibold text-slate-500">
            Noch keine Ideen. Sobald etwas liegt, versteht Adbot den Kern und
            wartet auf deinen Klick.
          </p>
        ) : (
          ideas.map((idea) => (
            <article
              className="rounded-2xl border border-slate-200 bg-white p-5"
              key={idea.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  {sourceLabel(idea.sourceType)}
                </span>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-800">
                  {STATUS_LABEL[idea.status]}
                </span>
              </div>
              {idea.sourceUrl ? (
                <p className="mt-2 break-all text-xs font-medium text-blue-700">
                  {idea.sourceUrl}
                </p>
              ) : null}
              {idea.keywords ? (
                <p className="mt-2 text-sm text-slate-700">{idea.keywords}</p>
              ) : null}
              {idea.screenshotAssetId ? (
                <div className="mt-3 max-w-xs overflow-hidden rounded-xl border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="Inspiration, nicht 1:1 nutzbar"
                    className="aspect-square w-full object-cover"
                    src={`/api/media-library/preview?assetId=${idea.screenshotAssetId}`}
                  />
                  <p className="bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                    Inspiration — niemals direkt als Anzeige
                  </p>
                </div>
              ) : null}
              <p className="mt-3 text-sm font-bold leading-6 text-slate-950">
                {idea.extractedCore.core_summary}
              </p>
              <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                {idea.extractedCore.product ? (
                  <div>
                    <dt className="font-bold text-slate-500">Produkt</dt>
                    <dd>{idea.extractedCore.product}</dd>
                  </div>
                ) : null}
                {idea.extractedCore.offer ? (
                  <div>
                    <dt className="font-bold text-slate-500">Angebot</dt>
                    <dd>{idea.extractedCore.offer}</dd>
                  </div>
                ) : null}
                {idea.extractedCore.audience ? (
                  <div>
                    <dt className="font-bold text-slate-500">Zielgruppe</dt>
                    <dd>{idea.extractedCore.audience}</dd>
                  </div>
                ) : null}
                {idea.extractedCore.hook_pattern ? (
                  <div>
                    <dt className="font-bold text-slate-500">Hook</dt>
                    <dd>{idea.extractedCore.hook_pattern}</dd>
                  </div>
                ) : null}
              </dl>
              {idea.realizedCopy ? (
                <div className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
                  <p className="font-extrabold">{idea.realizedCopy.headline}</p>
                  <p className="mt-1 whitespace-pre-wrap">
                    {idea.realizedCopy.primaryText}
                  </p>
                </div>
              ) : null}
              {idea.lastError ? (
                <p className="mt-3 text-sm font-semibold text-rose-700">
                  {idea.lastError}
                </p>
              ) : null}

              {realizeId === idea.id ? (
                <form className="mt-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4" onSubmit={realize}>
                  <p className="text-sm font-bold text-slate-900">
                    Wohin soll die umgesetzte Kampagne führen?
                  </p>
                  <input
                    className={inputClass}
                    onChange={(event) => setRealizeUrl(event.target.value)}
                    placeholder="https://dein-funnel.de/…"
                    required
                    type="url"
                    value={realizeUrl}
                  />
                  <select
                    className={inputClass}
                    onChange={(event) => setRealizeObjective(event.target.value)}
                    value={realizeObjective}
                  >
                    {OBJECTIVES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-start gap-2 text-sm font-semibold text-slate-800">
                    <input
                      checked={generateCreative}
                      className="mt-1 size-4"
                      onChange={(event) =>
                        setGenerateCreative(event.target.checked)
                      }
                      type="checkbox"
                    />
                    Neues Motiv aus dem Kern erzeugen — nicht den Screenshot verwenden
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50"
                      disabled={busyIdeaId === idea.id}
                      type="submit"
                    >
                      {busyIdeaId === idea.id ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Rocket className="size-4" />
                      )}
                      Jetzt umsetzen und zum Launch
                    </button>
                    <button
                      className="inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-sm font-bold text-slate-600"
                      onClick={() => setRealizeId(null)}
                      type="button"
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  {idea.status !== "REALIZED" ? (
                    <button
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50"
                      disabled={busyIdeaId === idea.id}
                      onClick={() => {
                        setRealizeId(idea.id);
                        setRealizeUrl(idea.destinationUrl ?? destinationUrl);
                        setRealizeObjective(idea.objective ?? objective);
                      }}
                      type="button"
                    >
                      <Rocket className="size-4" />
                      Idee jetzt umsetzen
                    </button>
                  ) : (
                    <a
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-extrabold text-white"
                      href={`/dashboard/traffic-launch?ideaId=${idea.id}${
                        idea.realizedAssetId
                          ? `&assetId=${idea.realizedAssetId}`
                          : ""
                      }`}
                    >
                      <Rocket className="size-4" />
                      Zum Launch
                    </a>
                  )}
                  <button
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                    disabled={busyIdeaId === idea.id}
                    onClick={() => void reanalyze(idea.id)}
                    type="button"
                  >
                    <Sparkles className="size-4" />
                    Kern neu lesen
                  </button>
                  <button
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-500 disabled:opacity-50"
                    disabled={busyIdeaId === idea.id}
                    onClick={() => void archive(idea.id)}
                    type="button"
                  >
                    <Archive className="size-4" />
                    Archiv
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}
