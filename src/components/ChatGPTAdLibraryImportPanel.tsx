"use client";

import { ExternalLink, FlaskConical, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX } from "@/lib/chatgpt-ad-library/import-constants";

type ImportSummary = {
  attempted: number;
  imported: number;
  refreshed?: number;
  skippedDuplicate: number;
  failed: number;
  results: Array<{
    externalId: string;
    status: string;
    brandAssetId: string | null;
    error: string | null;
  }>;
};

type CrawlStatus = {
  enabled: boolean;
  pendingCount: number;
  skippedCount?: number;
  vaultCount?: number;
  lastPlanSource?: "pending" | "catalog" | "probe" | "empty" | null;
  queueStarved?: boolean;
  nextDiscoverShard: number;
  nextProbeId?: number;
  catalogSize?: number;
  lastPlanAt: string | null;
  lastIngestAt: string | null;
  lastDiscoverAt: string | null;
  lastRunSummary?: Record<string, unknown>;
  totalPlanned: number;
  totalImported: number;
  totalSkippedDuplicate: number;
  totalFailed: number;
  scrapeBatchMax: number;
  unlockerConfigured?: boolean;
  unlockerProvider?: string;
};

export type ChatGPTAdLibraryHitCard = {
  brandAssetId: string;
  externalId: string;
  title: string;
  advertiserName: string;
  previewUrl: string;
  sourceUrl: string | null;
  bodyText?: string;
  hookText?: string;
  triggeringPrompts?: string[];
  landingPageUrl?: string | null;
};

type UnlockerProbe = {
  ok: boolean;
  configured: boolean;
  ingested: boolean;
  importStatus: "imported" | "refreshed" | "skipped_duplicate" | "failed" | "skipped_no_copy" | null;
  adId: string;
  pageUrl: string;
  checkpoint: boolean;
  httpStatus: number;
  hasImage: boolean;
  hasCopy: boolean;
  parseOk: boolean;
  title: string | null;
  body: string | null;
  promptCount: number;
  triggeringPrompts: string[];
  imageUrl: string | null;
  credits: string | null;
  providerError: string | null;
  attempt: "none" | "auto" | "stealth_fallback";
  message: string;
};

type PanelProps = {
  initialCrawl?: CrawlStatus | null;
  initialCrawlError?: string | null;
  initialHits?: ChatGPTAdLibraryHitCard[];
  initialImportedCount?: number | null;
};

function parseJsonlOrJson(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error("JSON-Array erwartet.");
    return parsed;
  }
  if (trimmed.startsWith("{")) {
    try {
      const single = JSON.parse(trimmed) as unknown;
      if (Array.isArray(single)) return single;
      if (single && typeof single === "object") return [single];
    } catch {
      // fall through to JSONL
    }
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

export function ChatGPTAdLibraryImportPanel({
  initialCrawl = null,
  initialCrawlError = null,
  initialHits = [],
  initialImportedCount = null,
}: PanelProps) {
  const [pending, setPending] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(initialImportedCount);
  const [raw, setRaw] = useState("");
  const [queueRaw, setQueueRaw] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialCrawlError);
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);
  const [crawl, setCrawl] = useState<CrawlStatus | null>(initialCrawl);
  const [hits, setHits] = useState<ChatGPTAdLibraryHitCard[]>(initialHits);
  const [workerHint, setWorkerHint] = useState<string | null>(null);
  const [probe, setProbe] = useState<UnlockerProbe | null>(null);

  const refreshCrawl = useCallback(async () => {
    const [crawlRes, importRes, hitsRes] = await Promise.all([
      fetch("/api/admin/chatgpt-ad-library/crawl", { credentials: "same-origin" }),
      fetch("/api/admin/chatgpt-ad-library/import", { credentials: "same-origin" }),
      fetch("/api/admin/chatgpt-ad-library/intelligence?limit=96", {
        credentials: "same-origin",
      }),
    ]);
    const crawlPayload = (await crawlRes.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: CrawlStatus;
      workerHint?: string;
      message?: string;
    };
    const importPayload = (await importRes.json().catch(() => ({}))) as {
      ok?: boolean;
      imported?: number;
      message?: string;
    };
    const hitsPayload = (await hitsRes.json().catch(() => ({}))) as {
      ok?: boolean;
      hits?: ChatGPTAdLibraryHitCard[];
      message?: string;
    };
    if (crawlRes.ok && crawlPayload.ok && crawlPayload.status) {
      setCrawl(crawlPayload.status);
      setWorkerHint(crawlPayload.workerHint ?? null);
    } else {
      setError(crawlPayload.message ?? "Crawl-Status konnte nicht geladen werden.");
    }
    if (importRes.ok && importPayload.ok && typeof importPayload.imported === "number") {
      setImportedCount(importPayload.imported);
    }
    if (hitsRes.ok && hitsPayload.ok && Array.isArray(hitsPayload.hits)) {
      setHits(hitsPayload.hits);
    }
  }, []);

  useEffect(() => {
    if (initialCrawl) return;
    void refreshCrawl().catch(() => {
      setError("Crawl-Status konnte nicht geladen werden.");
    });
  }, [initialCrawl, refreshCrawl]);

  async function runImport() {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    setLastSummary(null);
    try {
      const records = parseJsonlOrJson(raw);
      if (records.length < 1) {
        throw new Error("Bitte mindestens einen Datensatz als JSON oder JSONL einfügen.");
      }
      if (records.length > CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX) {
        throw new Error(
          `Höchstens ${CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX} Datensätze pro Lauf. Bitte aufteilen.`,
        );
      }

      const response = await fetch("/api/admin/chatgpt-ad-library/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        summary?: ImportSummary;
      };
      if (!response.ok || !payload.ok || !payload.summary) {
        throw new Error(payload.message ?? "Import fehlgeschlagen.");
      }
      setLastSummary(payload.summary);
      setImportedCount((current) =>
        typeof current === "number"
          ? current + payload.summary!.imported
          : payload.summary!.imported,
      );
      setNotice(
        `Import fertig: ${payload.summary.imported} neu · ${payload.summary.skippedDuplicate} Duplikate · ${payload.summary.failed} Fehler.`,
      );
      if (payload.summary.imported > 0) {
        window.setTimeout(() => window.location.reload(), 900);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function toggleCrawl(enabled: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/chatgpt-ad-library/crawl", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_enabled", enabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        status?: CrawlStatus;
      };
      if (!response.ok || !payload.ok || !payload.status) {
        throw new Error(payload.message ?? "Crawl-Status konnte nicht gesetzt werden.");
      }
      setCrawl(payload.status);
      setNotice(enabled ? "Automatischer Klein-Scrape aktiv." : "Automatischer Scrape pausiert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Crawl-Toggle fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function importSeed() {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/chatgpt-ad-library/crawl", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import_seed" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        status?: CrawlStatus;
        summary?: ImportSummary;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Seed-Import fehlgeschlagen.");
      }
      if (payload.status) setCrawl(payload.status);
      if (payload.summary) setLastSummary(payload.summary);
      setNotice(
        `Seed-Import: ${payload.summary?.imported ?? 0} neu · ${payload.summary?.skippedDuplicate ?? 0} schon vorhanden.`,
      );
      await refreshCrawl();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Seed-Import fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function probeUnlocker() {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    setProbe(null);
    try {
      const response = await fetch("/api/admin/chatgpt-ad-library/crawl", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe_unlocker", adId: "7341" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        probe?: UnlockerProbe;
      };
      if (!response.ok || !payload.ok || !payload.probe) {
        throw new Error(payload.message ?? "Unlocker-Probe fehlgeschlagen.");
      }
      setProbe(payload.probe);
      setNotice(payload.probe.message);
      await refreshCrawl();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unlocker-Probe fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function enqueueIds() {
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const ids = queueRaw
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter((item) => /^\d{1,12}$/.test(item));
      if (ids.length < 1) throw new Error("Mindestens eine numerische Ad-ID angeben.");
      const response = await fetch("/api/admin/chatgpt-ad-library/crawl", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enqueue", ids }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        added?: number;
        pendingCount?: number;
        status?: CrawlStatus;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Queue-Update fehlgeschlagen.");
      }
      if (payload.status) setCrawl(payload.status);
      setNotice(
        `${payload.added ?? 0} IDs in die Crawl-Queue gelegt · wartend: ${payload.pendingCount ?? "?"}`,
      );
      await refreshCrawl();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Queue-Update fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function unstickQueue() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/chatgpt-ad-library/crawl", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unstick" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        status?: CrawlStatus;
        unstick?: {
          pendingBefore: number;
          pendingAfter: number;
          droppedImported: number;
          droppedSkipped: number;
          vaultCount: number;
        };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Stau konnte nicht aufgelöst werden.");
      }
      if (payload.status) setCrawl(payload.status);
      setNotice(
        `Queue bereinigt: ${payload.unstick?.pendingBefore ?? "?"} → ${payload.unstick?.pendingAfter ?? "?"} wartend. Der nächste Lauf holt echte Queue-IDs, nicht den Katalog-Loop.`,
      );
      await refreshCrawl();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stau-Auflösung fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function runNow() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/chatgpt-ad-library/crawl", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run_now" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        status?: CrawlStatus;
        result?: {
          plannedIds?: string[];
          summary?: { imported?: number; failed?: number };
          failures?: Array<{ id: string; error: string }>;
        };
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Sofortlauf fehlgeschlagen.");
      }
      if (payload.status) setCrawl(payload.status);
      const imported = payload.result?.summary?.imported ?? 0;
      const failed = payload.result?.failures?.length ?? payload.result?.summary?.failed ?? 0;
      setNotice(
        `Sofortlauf: ${payload.result?.plannedIds?.length ?? 0} IDs geplant · ${imported} neu · ${failed} übersprungen/fehlgeschlagen.`,
      );
      await refreshCrawl();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sofortlauf fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-6">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
              Automatisch · kleine Mengen
            </p>
            <h2 className="mt-2 text-lg font-extrabold text-emerald-950">
              Wiederkehrender Scrape (max. {crawl?.scrapeBatchMax ?? 5}/Lauf)
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-950/80">
              Die Queue hat Vorrang. Unlocker: bis {crawl?.scrapeBatchMax ?? 40} IDs pro
              Runde, 12 parallel, Cron jede Minute, ein Lauf füllt das 800-Sekunden-Fenster.
              ScrapingBee-Credits sind keine Bremse — Tarif upgraden, wenn sie leer sind.
              Tote IDs (404/ohne Copy) werden übersprungen, nicht endlos wiederholt.
            </p>
            {workerHint ? <p className="mt-2 text-xs text-emerald-900/70">{workerHint}</p> : null}
            {crawl?.unlockerConfigured ? (
              <p className="mt-2 text-sm font-semibold text-emerald-800">
                Unlocker-Key gesetzt ({crawl.unlockerProvider ?? "scrapingbee"}). Probe importiert
                Bild + Anzeigentext + Trigger-Prompts — nicht nur das Bild.
              </p>
            ) : (
              <p className="mt-2 text-sm font-semibold text-amber-900">
                Unlocker fehlt. Trial auf scrapingbee.com (1000 Credits, keine Karte) → Key als{" "}
                <code>SCRAPINGBEE_API_KEY</code> in Vercel Production → neu deployen → Probe.
                Freelance noch nicht kaufen.
              </p>
            )}
          </div>
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm font-extrabold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            disabled={pending}
            onClick={() => void refreshCrawl()}
            type="button"
          >
            <RefreshCw className="size-4" />
            Status
          </button>
        </div>

        {error ? (
          <p
            className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <CrawlMetric label="Queue wartend" value={crawl ? String(crawl.pendingCount) : "…"} />
          <CrawlMetric label="Im Vault" value={crawl ? String(crawl.vaultCount ?? importedCount ?? "…") : "…"} />
          <CrawlMetric label="Übersprungen" value={crawl ? String(crawl.skippedCount ?? 0) : "…"} />
          <CrawlMetric
            label="Lauf-Zähler Import"
            value={crawl ? String(crawl.totalImported) : "…"}
          />
          <CrawlMetric label="Lauf-Zähler Fehler" value={crawl ? String(crawl.totalFailed) : "…"} />
        </div>
        {crawl?.queueStarved ? (
          <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Stau: {crawl.pendingCount} IDs warten, aber die letzten Läufe haben nur den
            Systemkatalog wiederholt ({Array.isArray(crawl.lastRunSummary?.last_plan_ids)
              ? (crawl.lastRunSummary?.last_plan_ids as unknown[]).join(", ")
              : "Katalog-IDs"}
            ). „Stau auflösen“ und „Jetzt einen Lauf“ holt die echte Queue.
          </p>
        ) : null}
        <p className="mt-3 text-xs text-emerald-900/70">
          Letzter Ingest: {formatWhen(crawl?.lastIngestAt)} · Discover:{" "}
          {formatWhen(crawl?.lastDiscoverAt)} · Probe ab #{crawl?.nextProbeId ?? "–"} · Geplant
          gesamt: {crawl?.totalPlanned ?? "–"}
        </p>
        <LastRunBox
          summary={crawl?.lastRunSummary}
          imported={crawl?.vaultCount ?? crawl?.totalImported ?? 0}
          planSource={crawl?.lastPlanSource ?? null}
        />

        <section className="mt-5 rounded-xl border border-emerald-200 bg-white p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-emerald-700">
                Importierte ChatGPT-Ads
              </p>
              <h3 className="mt-1 text-base font-extrabold text-emerald-950">
                Interner Korpus · nie kundensichtbar
              </h3>
            </div>
            <p className="text-sm font-semibold text-emerald-900">
              {importedCount ?? hits.length} im Vault
            </p>
          </div>
          {hits.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {hits.map((hit) => (
                <article
                  className="overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50/40"
                  key={hit.brandAssetId}
                >
                  <a
                    className="flex min-h-40 items-center justify-center bg-white"
                    href={hit.previewUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {/* Private signed previews cannot use next/image. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={hit.title}
                      className="max-h-48 w-full object-contain"
                      src={hit.previewUrl}
                    />
                  </a>
                  <div className="p-3">
                    <p className="text-[11px] font-extrabold uppercase tracking-wide text-emerald-700">
                      #{hit.externalId}
                    </p>
                    <h4 className="mt-1 text-sm font-extrabold text-emerald-950">{hit.title}</h4>
                    <p className="mt-1 text-xs font-semibold text-emerald-900/80">
                      {hit.advertiserName}
                    </p>
                    {hit.bodyText || hit.hookText ? (
                      <p className="mt-2 text-sm leading-5 text-emerald-950">
                        {hit.bodyText || hit.hookText}
                      </p>
                    ) : (
                      <p className="mt-2 text-xs font-semibold text-amber-800">
                        Kein Anzeigentext gespeichert.
                      </p>
                    )}
                    {(hit.triggeringPrompts ?? []).length > 0 ? (
                      <ul className="mt-2 space-y-1 text-xs leading-5 text-emerald-900">
                        {(hit.triggeringPrompts ?? []).slice(0, 6).map((prompt) => (
                          <li key={prompt}>“{prompt}”</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-amber-800">Keine Trigger-Prompts gespeichert.</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3">
                    {hit.sourceUrl ? (
                      <a
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                        href={hit.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Quelle
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                    {hit.landingPageUrl ? (
                      <a
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                        href={hit.landingPageUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Landing
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-3 space-y-3 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-950">
              <p className="font-semibold">
                Noch keine ChatGPT-Ads im Vault. GitHub-Runner sehen die Ad-Seiten nicht (Vercel-
                Checkpoint). Das CDN-Bild des mitgebrachten Seeds ist öffentlich — den können wir
                sofort legen.
              </p>
              <button
                className="inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 py-3 text-sm font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50"
                disabled={pending}
                onClick={() => void importSeed()}
                type="button"
              >
                GlossGenius-Seed jetzt importieren
              </button>
            </div>
          )}
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 py-3 text-sm font-extrabold text-white hover:bg-emerald-800 disabled:opacity-50"
            disabled={pending || crawl?.enabled === true}
            onClick={() => void toggleCrawl(true)}
            type="button"
          >
            Auto-Scrape an
          </button>
          <button
            className="inline-flex min-h-11 items-center rounded-xl border border-emerald-300 bg-white px-4 py-3 text-sm font-extrabold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
            disabled={pending || crawl?.enabled === false}
            onClick={() => void toggleCrawl(false)}
            type="button"
          >
            Pausieren
          </button>
          <button
            className="inline-flex min-h-11 items-center rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm font-extrabold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
            disabled={pending}
            onClick={() => void unstickQueue()}
            type="button"
          >
            Stau auflösen
          </button>
          <button
            className="inline-flex min-h-11 items-center rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm font-extrabold text-sky-950 hover:bg-sky-100 disabled:opacity-50"
            disabled={pending}
            onClick={() => void runNow()}
            type="button"
          >
            Jetzt einen Lauf
          </button>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-extrabold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
            disabled={pending}
            onClick={() => void probeUnlocker()}
            type="button"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FlaskConical className="size-4" />
            )}
            Unlocker-Probe + Import #7341
          </button>
          <span className="text-sm font-semibold text-emerald-900">
            Status: {crawl ? (crawl.enabled ? "aktiv" : "pausiert") : "…"}
          </span>
        </div>

        {probe ? <UnlockerProbeBox probe={probe} /> : null}

        <details className="mt-4 rounded-xl border border-emerald-200 bg-white/70 p-3">
          <summary className="cursor-pointer text-xs font-extrabold uppercase tracking-wide text-emerald-800">
            Notfall: IDs manuell nachreichen
          </summary>
        <label className="mt-3 grid gap-2">
          <span className="text-xs font-semibold text-emerald-900">
            Nur Notfall. Normalweg: Systemkatalog, Sitemap und Probe füllen die Queue.
          </span>
          <div className="flex flex-wrap gap-2">
            <input
              className="h-11 min-w-[16rem] flex-1 rounded-xl border border-emerald-300 bg-white px-3 font-mono text-sm"
              onChange={(event) => setQueueRaw(event.target.value)}
              placeholder="7341, 2773, 6179"
              value={queueRaw}
            />
            <button
              className="inline-flex min-h-11 items-center rounded-xl border border-emerald-300 bg-white px-4 text-sm font-extrabold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50"
              disabled={pending}
              onClick={() => void enqueueIds()}
              type="button"
            >
              In Queue legen
            </button>
          </div>
        </label>
        </details>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
              Interne Quelle · nie kundensichtbar
            </p>
            <h2 className="mt-2 text-lg font-extrabold">Manueller JSON-Import (Fallback)</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Quelle{" "}
              <a
                className="font-semibold text-blue-700 hover:underline"
                href="https://www.chatgptadlibrary.com/library"
                rel="noreferrer"
                target="_blank"
              >
                chatgptadlibrary.com/library
                <ExternalLink className="ml-1 inline size-3.5" />
              </a>
              . Nur nötig, wenn du gezielt einzelne Datensätze nachreichst. Der automatische Scrape
              oben ist der Normalweg.
            </p>
          </div>
          <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            Im Korpus: {importedCount === null ? "…" : importedCount}
          </p>
        </div>

        <label className="mt-5 grid gap-2">
          <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
            JSON / JSONL (max. {CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX} pro Lauf)
          </span>
          <textarea
            className="min-h-40 rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs leading-5"
            onChange={(event) => setRaw(event.target.value)}
            placeholder='{"id":7341,"advertiserName":"…","title":"…","imageUrl":"https://img.chatgptadlibrary.com/c/…webp","triggeringPrompts":[],"category":[]}'
            value={raw}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={pending}
            onClick={() => void runImport()}
            type="button"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
            In Inspiration Vault importieren
          </button>
          <a
            className="text-sm font-semibold text-blue-700 hover:underline"
            href="/api/admin/chatgpt-ad-library/intelligence"
          >
            Internen KI-Korpus abrufen
          </a>
        </div>

        {notice ? (
          <p
            className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
            role="status"
          >
            {notice}
          </p>
        ) : null}
        {error ? (
          <p
            className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {lastSummary && lastSummary.failed > 0 ? (
          <ul className="mt-4 space-y-1 rounded-xl border border-rose-100 bg-rose-50/60 p-3 text-xs text-rose-900">
            {lastSummary.results
              .filter((item) => item.status === "failed")
              .slice(0, 12)
              .map((item) => (
                <li key={`${item.externalId}-${item.error}`}>
                  #{item.externalId}: {item.error}
                </li>
              ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}

function CrawlMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-emerald-100 bg-white px-4 py-3">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-emerald-700">{label}</p>
      <p className="mt-1 text-xl font-extrabold text-emerald-950">{value}</p>
    </div>
  );
}

function formatWhen(value: string | null | undefined): string {
  if (!value) return "noch nie";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function UnlockerProbeBox({ probe }: { probe: UnlockerProbe }) {
  const tone = probe.ok
    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
    : "border-rose-200 bg-rose-50 text-rose-950";
  return (
    <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${tone}`} role="status">
      <p className="text-[11px] font-extrabold uppercase tracking-wide">
        Unlocker-Probe · Bild + Text
      </p>
      <p className="mt-1 font-semibold">{probe.message}</p>
      <p className="mt-2 text-xs">
        #{probe.adId}
        {` · HTTP ${probe.httpStatus || "–"}`}
        {` · Checkpoint ${probe.checkpoint ? "ja" : "nein"}`}
        {` · Bild ${probe.hasImage ? "ja" : "nein"}`}
        {` · Copy ${probe.hasCopy ? "ja" : "nein"}`}
        {` · Prompts ${probe.promptCount ?? 0}`}
        {probe.importStatus ? ` · Import ${probe.importStatus}` : ""}
        {probe.credits != null && probe.credits !== "" ? ` · Credits ${probe.credits}` : ""}
        {probe.attempt && probe.attempt !== "none" ? ` · Versuch ${probe.attempt}` : ""}
        {probe.title ? ` · ${probe.title}` : ""}
      </p>
      {probe.body ? <p className="mt-2 text-sm leading-5">{probe.body}</p> : null}
      {(probe.triggeringPrompts ?? []).length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs leading-5">
          {probe.triggeringPrompts.slice(0, 6).map((prompt) => (
            <li key={prompt}>“{prompt}”</li>
          ))}
        </ul>
      ) : null}
      {probe.providerError ? (
        <p className="mt-2 font-mono text-xs">{probe.providerError}</p>
      ) : null}
      {probe.ok ? (
        <p className="mt-2 text-xs font-semibold">
          Bild + Text liegen im Vault (oder waren schon da). Die Karte darunter muss Copy und
          Prompts zeigen, nicht nur das Bild.
        </p>
      ) : probe.checkpoint ? (
        <p className="mt-2 text-xs font-semibold">
          Die 50 Dollar nicht ausgeben. Derselbe Block bleibt mit mehr Credits.
        </p>
      ) : probe.httpStatus === 400 ? (
        <p className="mt-2 text-xs font-semibold">
          Kein Checkpoint. ScrapingBee hat die Anfrage selbst abgelehnt — Freelance ändert das
          nicht. Nach dem Parameter-Fix erneut probe.
        </p>
      ) : (
        <p className="mt-2 text-xs font-semibold">Die 50 Dollar nicht ausgeben.</p>
      )}
    </div>
  );
}

function LastRunBox({
  summary,
  imported,
  planSource,
}: {
  summary?: Record<string, unknown>;
  imported: number;
  planSource?: "pending" | "catalog" | "probe" | "empty" | null;
}) {
  const planIds = Array.isArray(summary?.last_plan_ids)
    ? summary.last_plan_ids.map(String).join(", ")
    : "";
  const discoverCount =
    typeof summary?.last_discover_count === "number" ? summary.last_discover_count : null;
  const lastImported =
    typeof summary?.last_imported === "number" ? summary.last_imported : null;
  const sourceLabel =
    planSource === "pending"
      ? "Queue"
      : planSource === "catalog"
        ? "Katalog"
        : planSource === "probe"
          ? "Sequenz-Probe"
          : null;

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-950">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-emerald-700">
        Letzter Lauf
      </p>
      <p className="mt-1 font-semibold">
        {planIds ? `Geplant: ${planIds}` : "Noch kein Plan gespeichert."}
        {sourceLabel ? ` · Quelle ${sourceLabel}` : ""}
        {discoverCount != null ? ` · Discover ${discoverCount} IDs` : ""}
        {lastImported != null ? ` · zuletzt importiert ${lastImported}` : ""}
        {` · Vault gesamt ${imported}`}
      </p>
    </div>
  );
}
