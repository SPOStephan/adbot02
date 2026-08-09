"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, Sparkles } from "lucide-react";

export type CampaignBriefView = {
  id: string;
  status: "DRAFT" | "READY" | "CONSUMED" | "ARCHIVED";
  objective: string;
  landingUrl: string;
  landingHostname: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

const OBJECTIVES: Array<{ value: string; label: string }> = [
  { value: "OUTCOME_TRAFFIC", label: "Traffic / Websitebesuche" },
  { value: "OUTCOME_AWARENESS", label: "Bekanntheit" },
  { value: "OUTCOME_ENGAGEMENT", label: "Interaktion" },
  { value: "OUTCOME_LEADS", label: "Leads" },
  { value: "OUTCOME_SALES", label: "Verkäufe" },
  { value: "OUTCOME_APP_PROMOTION", label: "App-Promotion" },
];

const STATUS_LABEL: Record<CampaignBriefView["status"], string> = {
  DRAFT: "Entwurf",
  READY: "Bereit",
  CONSUMED: "Verwendet",
  ARCHIVED: "Archiviert",
};

type Notice = { tone: "success" | "error"; message: string } | null;

type Props = {
  briefs: CampaignBriefView[];
};

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

function objectiveLabel(value: string): string {
  return OBJECTIVES.find((item) => item.value === value)?.label ?? value;
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("de-DE", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(date);
}

async function postControl(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    alreadyExisted?: boolean;
  };

  if (!response.ok || !result.ok) {
    throw new Error(
      result.message ?? "Die Aktion konnte nicht sicher abgeschlossen werden.",
    );
  }

  return result;
}

export function CampaignAssistantBrief({ briefs }: Props) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [pending, setPending] = useState(false);
  const [archivePendingId, setArchivePendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [objective, setObjective] = useState(OBJECTIVES[0].value);
  const [landingUrl, setLandingUrl] = useState("");
  const [notes, setNotes] = useState("");

  function refresh() {
    startRefresh(() => {
      router.refresh();
    });
  }

  async function submitBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);

    try {
      const result = await postControl("/api/meta/automation/campaign-brief", {
        objective,
        landingUrl,
        notes,
      });
      setNotice({
        tone: "success",
        message: result.alreadyExisted
          ? "Dieser Brief existiert bereits als offener Entwurf und wurde aktualisiert."
          : "Kampagnen-Brief als Entwurf gespeichert. Als Nächstes folgen Texte und Creatives.",
      });
      setNotes("");
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Kampagnen-Brief konnte nicht gespeichert werden.",
      });
    } finally {
      setPending(false);
    }
  }

  async function archiveBrief(briefId: string) {
    setArchivePendingId(briefId);
    setNotice(null);

    try {
      await postControl("/api/meta/automation/campaign-brief/archive", {
        briefId,
      });
      setNotice({
        tone: "success",
        message: "Der Kampagnen-Brief wurde archiviert.",
      });
      refresh();
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Kampagnen-Brief konnte nicht archiviert werden.",
      });
    } finally {
      setArchivePendingId(null);
    }
  }

  return (
    <section className="mt-10 scroll-mt-24" id="kampagnen-assistent">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-950 px-5 py-6 text-white sm:px-7">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-sky-300">
              <Sparkles className="size-4" />
              Kampagnen-Assistent
            </div>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Ziel und Landingpage festlegen
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Speichere zuerst Werbeziel und HTTPS-Landingpage als Brief. Für den
              ersten Live-Test: Creative hochladen und unter{" "}
              <a className="font-bold text-sky-300 underline" href="#traffic-launch">
                Traffic Canary
              </a>{" "}
              die Kampagne vorbereiten — ohne Meta-Writes in diesem Brief-Schritt.
            </p>
          </div>
        </div>

        <div className="grid gap-0 xl:grid-cols-2 xl:divide-x xl:divide-slate-200">
          <form className="p-5 sm:p-7" onSubmit={submitBrief}>
            <h3 className="font-extrabold text-slate-900">Neuer Brief</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Ein Brief ist die Grundlage für spätere Creative-Vorschläge. Er
              wird nur in Adbot gespeichert.
            </p>

            <div className="mt-6 grid gap-4">
              <label className="text-sm font-bold text-slate-800">
                Werbeziel
                <select
                  className={inputClass}
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

              <label className="text-sm font-bold text-slate-800">
                Landingpage (HTTPS)
                <input
                  className={inputClass}
                  onChange={(event) => setLandingUrl(event.target.value)}
                  placeholder="https://www.example.de/angebot"
                  required
                  type="url"
                  value={landingUrl}
                />
              </label>

              <label className="text-sm font-bold text-slate-800">
                Notiz (optional)
                <textarea
                  className={`${inputClass} min-h-24 resize-y font-medium`}
                  maxLength={500}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="z. B. Fokus auf Neukunden im DACH-Raum"
                  value={notes}
                />
              </label>
            </div>

            {notice ? (
              <p
                className={`mt-4 rounded-xl px-4 py-3 text-sm font-semibold ${
                  notice.tone === "success"
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-rose-50 text-rose-800"
                }`}
              >
                {notice.message}
              </p>
            ) : null}

            <button
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending || isRefreshing}
              type="submit"
            >
              {pending ? "Speichern…" : "Brief speichern"}
            </button>
          </form>

          <div className="border-t border-slate-200 p-5 sm:p-7 xl:border-t-0">
            <h3 className="font-extrabold text-slate-900">Offene Briefs</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Entwürfe und bereite Briefs für die nächste Assistenten-Stufe.
            </p>

            {briefs.length === 0 ? (
              <p className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Noch kein Brief gespeichert.
              </p>
            ) : (
              <ul className="mt-6 space-y-3">
                {briefs.map((brief) => (
                  <li
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                    key={brief.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900">
                          {objectiveLabel(brief.objective)}
                        </p>
                        <a
                          className="mt-1 block break-all text-sm font-semibold text-blue-700 hover:underline"
                          href={brief.landingUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {brief.landingUrl}
                        </a>
                        {brief.notes ? (
                          <p className="mt-2 text-xs leading-5 text-slate-600">
                            {brief.notes}
                          </p>
                        ) : null}
                        <p className="mt-2 text-xs text-slate-500">
                          {STATUS_LABEL[brief.status]} ·{" "}
                          {displayDate(brief.updatedAt)}
                        </p>
                      </div>
                      {(brief.status === "DRAFT" || brief.status === "READY") && (
                        <button
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                          disabled={archivePendingId === brief.id || isRefreshing}
                          onClick={() => void archiveBrief(brief.id)}
                          type="button"
                        >
                          <Archive className="size-3.5" />
                          {archivePendingId === brief.id
                            ? "…"
                            : "Archivieren"}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
