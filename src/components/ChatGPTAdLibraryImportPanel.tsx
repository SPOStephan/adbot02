"use client";

import { ExternalLink, LoaderCircle, Upload } from "lucide-react";
import { useEffect, useState } from "react";

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

function parseJsonlOrJson(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error("JSON-Array erwartet.");
    return parsed;
  }
  if (trimmed.startsWith("{")) {
    // Single object or NDJSON starting with object — try JSON first, else JSONL.
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
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<ImportSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/admin/chatgpt-ad-library/import", {
          credentials: "same-origin",
        });
        const payload = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          imported?: number;
        };
        if (!cancelled && response.ok && payload.ok && typeof payload.imported === "number") {
          setImportedCount(payload.imported);
        }
      } catch {
        // Status is optional; import can still run.
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
        // Reload so the main library list picks up new rows.
        window.setTimeout(() => window.location.reload(), 900);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
            Interne Quelle · nie kundensichtbar
          </p>
          <h2 className="mt-2 text-lg font-extrabold">ChatGPT Ad Library Import</h2>
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
            . Datensätze landen im Inspiration Vault mit{" "}
            <code className="rounded bg-slate-100 px-1">reference_only</code>,{" "}
            <code className="rounded bg-slate-100 px-1">use_for_generation=false</code> und{" "}
            <code className="rounded bg-slate-100 px-1">customer_visible=false</code>. Die interne
            KI darf sie als Wissensbasis lesen; Kunden sehen sie nie.
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
        <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800" role="alert">
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
  );
}
