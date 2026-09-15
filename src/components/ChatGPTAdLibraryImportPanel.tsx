"use client";

import { ExternalLink, LoaderCircle, RefreshCw, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CHATGPT_AD_LIBRARY_IMPORT_BATCH_MAX } from "@/lib/chatgpt-ad-library/import-constants";

type ImportSummary = {
  attempted: number;
  imported: number;
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
  nextDiscoverShard: number;
  lastPlanAt: string | null;
  lastIngestAt: string | null;
  lastDiscoverAt: string | null;
  totalPlanned: number;
  totalImported: number;
  totalSkippedDuplicate: number;
  totalFailed: number;
  scrapeBatchMax: number;
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

export function ChatGPTAdLibraryImportPanel() {
  const [pending, setPending] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [raw, setRaw] = useState("");
  const [queueRaw, setQueueRaw] = useState("7341");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);
  const [crawl, setCrawl] = useState<CrawlStatus | null>(null);
  const [workerHint, setWorkerHint] = useState<string | null>(null);

  const refreshCrawl = useCallback(async () => {
    const response = await fetch("/api/admin/chatgpt-ad-library/crawl", {
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: CrawlStatus;
      workerHint?: string;
      imported?: number;
    };
    if (response.ok && payload.ok && payload.status) {
      setCrawl(payload.status);
      setWorkerHint(payload.workerHint ?? null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [importRes, crawlRes] = await Promise.all([
          fetch("/api/admin/chatgpt-ad-library/import", { credentials: "same-origin" }),
          fetch("/api/admin/chatgpt-ad-library/crawl", { credentials: "same-origin" }),
        ]);
        const importPayload = (await importRes.json().catch(() => ({}))) as {
          ok?: boolean;
          imported?: number;
        };
        const crawlPayload = (await crawlRes.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: CrawlStatus;
          workerHint?: string;
        };
        if (cancelled) return;
        if (importRes.ok && importPayload.ok && typeof importPayload.imported === "number") {
          setImportedCount(importPayload.imported);
        }
        if (crawlRes.ok && crawlPayload.ok && crawlPayload.status) {
          setCrawl(crawlPayload.status);
          setWorkerHint(crawlPayload.workerHint ?? null);
        }
      } catch {
        // Status is optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
              Die Website blockiert Server-HTML (Vercel-Checkpoint). Deshalb holt eine{" "}
              <strong>GitHub Action alle 2 Stunden</strong> mit echtem Browser höchstens 5 Ads,
              entdeckt per Sitemap-Shard neue IDs und schreibt sie in den Inspiration Vault — ohne
              manuelles Schaufeln. Optional: IDs hier in die Queue legen.
            </p>
            {workerHint ? <p className="mt-2 text-xs text-emerald-900/70">{workerHint}</p> : null}
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CrawlMetric label="Queue" value={crawl ? String(crawl.pendingCount) : "…"} />
          <CrawlMetric label="Importiert (Crawl)" value={crawl ? String(crawl.totalImported) : "…"} />
          <CrawlMetric
            label="Duplikate"
            value={crawl ? String(crawl.totalSkippedDuplicate) : "…"}
          />
          <CrawlMetric label="Fehler" value={crawl ? String(crawl.totalFailed) : "…"} />
        </div>
        <p className="mt-3 text-xs text-emerald-900/70">
          Letzter Ingest: {crawl?.lastIngestAt ?? "noch nie"} · Discover-Shard:{" "}
          {crawl?.nextDiscoverShard ?? "–"} · Geplant gesamt: {crawl?.totalPlanned ?? "–"}
        </p>

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
          <span className="text-sm font-semibold text-emerald-900">
            Status: {crawl ? (crawl.enabled ? "aktiv" : "pausiert") : "…"}
          </span>
        </div>

        <label className="mt-4 grid gap-2">
          <span className="text-xs font-extrabold uppercase tracking-wide text-emerald-800">
            Ad-IDs in Queue (Komma/Leerzeichen)
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
