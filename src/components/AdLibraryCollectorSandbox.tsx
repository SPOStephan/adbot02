"use client";

import {
  FlaskConical,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  AD_EXAMPLE_OBJECTIVES,
  AD_EXAMPLE_PLATFORMS,
  AD_EXAMPLE_SOURCE_KINDS,
} from "@/lib/ad-examples/types";
import {
  EMPTY_INSPIRATION_CORPUS_CENSUS,
  type InspirationCorpusCensus,
} from "@/lib/ad-learning/types";
import {
  COLLECTOR_IMPORT_BATCH_MAX,
  COLLECTOR_PROVIDERS,
  COLLECTOR_STATUSES,
  type CollectorInbox,
  type CollectorItemView,
  type CollectorMemoryPreview,
  type CollectorStatus,
} from "@/lib/ad-library-collector/types";
import { collectorStatusLabel } from "@/lib/ad-library-collector/status";

type PanelProps = {
  initialInbox: CollectorInbox;
  initialCensus?: InspirationCorpusCensus | null;
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
  items?: CollectorItemView[];
  item?: CollectorItemView;
  preview?: CollectorMemoryPreview;
  imported?: number;
  skippedDuplicate?: number;
  failed?: number;
  attempted?: number;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">
      {children}
    </span>
  );
}

export function AdLibraryCollectorSandbox({
  initialInbox,
  initialCensus = null,
}: PanelProps) {
  const [inbox, setInbox] = useState(initialInbox);
  const [filter, setFilter] = useState<CollectorStatus | "all">("all");
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jsonl, setJsonl] = useState("");
  const [preview, setPreview] = useState<CollectorMemoryPreview | null>(null);
  const [probe, setProbe] = useState({
    platform: "openai_ads",
    objective: "",
    industry: "",
  });
  const census = preview?.census ?? initialCensus ?? EMPTY_INSPIRATION_CORPUS_CENSUS;

  const visible = useMemo(
    () =>
      inbox.items.filter((item) => filter === "all" || item.status === filter),
    [inbox.items, filter],
  );

  async function refresh() {
    const response = await fetch("/api/admin/ad-library-collector", {
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => ({}))) as CollectorInbox & {
      ok?: boolean;
      message?: string;
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message ?? "Sandbox konnte nicht geladen werden.");
    }
    setInbox({
      items: payload.items ?? [],
      counts: payload.counts ?? inbox.counts,
      lastBatchId: payload.lastBatchId ?? null,
      migrationNeeded: Boolean(payload.migrationNeeded),
    });
  }

  async function run(label: string, work: () => Promise<string>) {
    if (pending) return;
    setPending(label);
    setError(null);
    setNotice(null);
    try {
      setNotice(await work());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aktion fehlgeschlagen.");
    } finally {
      setPending(null);
    }
  }

  async function enqueueForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await run("enqueue", async () => {
      const response = await fetch("/api/admin/ad-library-collector", {
        method: "POST",
        credentials: "same-origin",
        body: new FormData(form),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Eintrag nicht gespeichert.");
      }
      form.reset();
      await refresh();
      return "Beispiel liegt in der Sandbox — noch nicht im live Gedächtnis.";
    });
  }

  async function enqueueJsonl() {
    await run("jsonl", async () => {
      const records = jsonl
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .flatMap((line) => {
          const parsed = JSON.parse(line) as unknown;
          return Array.isArray(parsed) ? parsed : [parsed];
        });
      const response = await fetch("/api/admin/ad-library-collector", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enqueue", records }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "JSONL-Import fehlgeschlagen.");
      }
      setJsonl("");
      await refresh();
      return `${payload.items?.length ?? 0} Datensätze in die Sandbox gelegt.`;
    });
  }

  async function setStatus(item: CollectorItemView, status: CollectorStatus) {
    await run(item.id, async () => {
      const response = await fetch("/api/admin/ad-library-collector", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_status", id: item.id, status }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Status nicht geändert.");
      }
      await refresh();
      return `${item.title}: ${collectorStatusLabel(status)}.`;
    });
  }

  async function importReady() {
    await run("import", async () => {
      const response = await fetch("/api/admin/ad-library-collector/import", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Vault-Import fehlgeschlagen.");
      }
      await refresh();
      return `Vault: ${payload.imported ?? 0} neu, ${payload.skippedDuplicate ?? 0} schon da, ${payload.failed ?? 0} Fehler (max. ${COLLECTOR_IMPORT_BATCH_MAX}).`;
    });
  }

  async function runPreview(event: React.FormEvent) {
    event.preventDefault();
    await run("preview", async () => {
      const response = await fetch("/api/admin/ad-library-collector", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", ...probe }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok || !payload.preview) {
        throw new Error(payload.message ?? "Gedächtnis-Probe fehlgeschlagen.");
      }
      setPreview(payload.preview);
      return "Probe gelesen — links live Vault, rechts Sandbox.";
    });
  }

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">
            Korpus-Sandbox
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-950">
            Staging vor dem zentralen Gedächtnis
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            Hier landen Beispiele, bevor sie die KI wirklich sieht. Live-Gedächtnis
            ist der Inspiration-Vault (`brand_assets`, `library_scope=INSPIRATION`) —
            für jede Branche, nicht nur Hotels oder SaaS. Copy-Vorschläge scannen
            den ganzen Vault. First-Party-Winner bleiben am Kundenkonto.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-900"
          disabled={Boolean(pending)}
          onClick={() => run("refresh", async () => { await refresh(); return "Sandbox aktualisiert."; })}
          type="button"
        >
          {pending === "refresh" ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Aktualisieren
        </button>
      </div>

      {inbox.migrationNeeded ? (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Tabelle `ad_library_collector_items` fehlt noch. Migration
          `20260916120000_ad_library_collector_items.sql` im produktiven Supabase
          ausführen, danach diese Seite neu laden.
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {COLLECTOR_STATUSES.map((status) => (
          <button
            key={status.value}
            className={`rounded-xl border px-3 py-3 text-left ${
              filter === status.value
                ? "border-violet-400 bg-white"
                : "border-violet-100 bg-white/70"
            }`}
            onClick={() => setFilter(status.value)}
            type="button"
          >
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
              {status.label}
            </p>
            <p className="mt-1 text-2xl font-extrabold text-slate-950">
              {inbox.counts[status.value]}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-violet-100 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-violet-700">
          Live-Gedächtnis · ganzer Vault
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Scan ohne 500er-Deckel. „Bild + Text“ sind die Zeilen, aus denen die KI
          Muster ziehen kann — unabhängig von der Branche.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <CensusMetric label="Gescannt" value={census.scanned} />
          <CensusMetric label="Mit Text" value={census.learningEligible} />
          <CensusMetric label="Bild + Text" value={census.imageAndText} />
          <CensusMetric label="Nur Text" value={census.textOnly} />
          <CensusMetric label="Nur Bild" value={census.imageOnly} />
        </div>
        {census.scanned > 0 ? (
          <p className="mt-3 text-sm font-semibold text-violet-950">
            {census.imageAndText >= 1000
              ? `Zahlenbasis für „Tausende echte ChatGPT Ads“: ${census.imageAndText} mit Bild und Text im Gedächtnis.`
              : `Noch keine Tausender-Basis: ${census.imageAndText} mit Bild und Text, ${census.learningEligible} mit Text.`}
          </p>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            Zahlen erscheinen nach der ersten Probe oder wenn der Server-Scan fertig ist.
          </p>
        )}
        {census.industries.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {census.industries.slice(0, 16).map((item) => (
              <button
                key={item.name}
                className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-950 hover:bg-violet-100"
                onClick={() =>
                  setProbe((current) => ({
                    ...current,
                    industry: item.name === "(ohne Zuordnung)" ? "" : item.name,
                  }))
                }
                type="button"
              >
                {item.name} · {item.imageAndText}/{item.total}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <form
        className="mt-6 grid gap-3 rounded-2xl border border-violet-100 bg-white p-4 md:grid-cols-4"
        onSubmit={runPreview}
      >
        <div className="md:col-span-4 flex items-center gap-2 text-sm font-bold text-violet-900">
          <FlaskConical className="size-4" />
          Gedächtnis-Probe — was die KI für eine beliebige Branche ziehen würde
        </div>
        <label className="grid gap-1">
          <FieldLabel>Plattform</FieldLabel>
          <select
            className="h-11 rounded-xl border border-slate-300 px-3"
            onChange={(event) => setProbe((current) => ({ ...current, platform: event.target.value }))}
            value={probe.platform}
          >
            <option value="">Alle Plattformen</option>
            {AD_EXAMPLE_PLATFORMS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <FieldLabel>Werbeziel</FieldLabel>
          <select
            className="h-11 rounded-xl border border-slate-300 px-3"
            onChange={(event) => setProbe((current) => ({ ...current, objective: event.target.value }))}
            value={probe.objective}
          >
            <option value="">Alle Ziele</option>
            {AD_EXAMPLE_OBJECTIVES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <FieldLabel>Branche</FieldLabel>
          <input
            className="h-11 rounded-xl border border-slate-300 px-3"
            onChange={(event) => setProbe((current) => ({ ...current, industry: event.target.value }))}
            placeholder="beliebig — leer = alle Branchen"
            value={probe.industry}
          />
        </label>
        <div className="flex items-end">
          <button
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-bold text-white disabled:opacity-60"
            disabled={Boolean(pending)}
            type="submit"
          >
            {pending === "preview" ? <LoaderCircle className="size-4 animate-spin" /> : <FlaskConical className="size-4" />}
            Probe
          </button>
        </div>
      </form>

      {preview ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Live-Vault</p>
            <p className="mt-1 text-sm text-slate-600">
              Das sieht die Copy-KI jetzt. Sandbox-Zeilen sind hier nicht drin.
            </p>
            {preview.liveMatches.length < 1 ? (
              <p className="mt-3 text-sm text-slate-500">Noch keine passenden Vault-Muster.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {preview.liveMatches.map((item) => (
                  <li key={item.brandAssetId} className="rounded-xl border border-slate-100 px-3 py-2">
                    <strong>{item.platform}/{item.objective}</strong>
                    <span className="text-slate-500"> · Score {item.score}</span>
                    <p className="mt-1 text-slate-700">{item.hookText || item.bodyText || "—"}</p>
                  </li>
                ))}
              </ul>
            )}
            {preview.livePromptBlock ? (
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                {preview.livePromptBlock}
              </pre>
            ) : null}
          </div>
          <div className="rounded-2xl border border-violet-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Sandbox</p>
            <p className="mt-1 text-sm text-slate-600">
              Wartet auf Review/Import. „Bereit für Vault“ würde nach Import in den Prompt rutschen.
            </p>
            {preview.sandboxMatches.length < 1 ? (
              <p className="mt-3 text-sm text-slate-500">Keine passenden Staging-Einträge.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {preview.sandboxMatches.map((item) => (
                  <li key={item.id} className="rounded-xl border border-violet-100 px-3 py-2">
                    <strong>{item.title}</strong>
                    <span className="text-slate-500">
                      {" "}
                      · {collectorStatusLabel(item.status)} · Score {item.score}
                    </span>
                    <p className="mt-1 text-slate-700">{item.hookText || item.bodyText || "—"}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <form
        className="mt-6 grid gap-4 rounded-2xl border border-violet-100 bg-white p-4 md:grid-cols-2"
        onSubmit={enqueueForm}
      >
        <p className="md:col-span-2 text-sm font-bold text-slate-900">
          Beispiel in die Sandbox legen — nicht direkt in den Vault
        </p>
        <label className="grid gap-1">
          <FieldLabel>Interner Titel</FieldLabel>
          <input className="h-11 rounded-xl border border-slate-300 px-3" maxLength={120} name="title" required />
        </label>
        <label className="grid gap-1">
          <FieldLabel>Werbetreibender</FieldLabel>
          <input className="h-11 rounded-xl border border-slate-300 px-3" maxLength={120} name="advertiserName" required />
        </label>
        <label className="grid gap-1">
          <FieldLabel>Plattform</FieldLabel>
          <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue="meta" name="platform">
            {AD_EXAMPLE_PLATFORMS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <FieldLabel>Branche</FieldLabel>
          <input className="h-11 rounded-xl border border-slate-300 px-3" name="industry" placeholder="beliebig — z. B. Handwerk, Klinik, Shop" required />
        </label>
        <label className="grid gap-1">
          <FieldLabel>Werbeziel</FieldLabel>
          <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue="sales" name="objective">
            {AD_EXAMPLE_OBJECTIVES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <FieldLabel>Quelle</FieldLabel>
          <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue="user_upload" name="sourceKind">
            {AD_EXAMPLE_SOURCE_KINDS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 md:col-span-2">
          <FieldLabel>Zieldefinition</FieldLabel>
          <textarea className="min-h-20 rounded-xl border border-slate-300 px-3 py-2" name="objectiveDetail" placeholder="Was soll die Anzeige bewirken?" />
        </label>
        <label className="grid gap-1 md:col-span-2">
          <FieldLabel>Hook</FieldLabel>
          <textarea className="min-h-20 rounded-xl border border-slate-300 px-3 py-2" name="hookText" />
        </label>
        <label className="grid gap-1 md:col-span-2">
          <FieldLabel>Anzeigentext</FieldLabel>
          <textarea className="min-h-24 rounded-xl border border-slate-300 px-3 py-2" name="bodyText" />
        </label>
        <label className="grid gap-1">
          <FieldLabel>Quelllink</FieldLabel>
          <input className="h-11 rounded-xl border border-slate-300 px-3" name="sourceUrl" placeholder="https://…" type="url" />
        </label>
        <label className="grid gap-1">
          <FieldLabel>Screenshot (für Vault später Pflicht)</FieldLabel>
          <input
            accept="image/png,image/jpeg"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-violet-50 file:px-3 file:py-2 file:font-bold file:text-violet-800"
            name="file"
            type="file"
          />
        </label>
        <input name="provider" type="hidden" value="manual" />
        <input name="evidenceLevel" type="hidden" value="visual_only" />
        <input name="rightsBasis" type="hidden" value="reference_only" />
        <input name="funnelStage" type="hidden" value="conversion" />
        <input name="format" type="hidden" value="Bildanzeige" />
        <input name="country" type="hidden" value="Deutschland" />
        <input name="language" type="hidden" value="Deutsch" />
        <label className="flex items-start gap-3 rounded-xl border border-violet-100 bg-violet-50 p-3 md:col-span-2">
          <input className="mt-1 size-4" name="rightsConfirmed" required type="checkbox" />
          <span className="text-sm text-violet-950">
            Rechtmäßig als interne Referenz. Wird nicht kundensichtbar und nicht gelancht.
          </span>
        </label>
        <div className="md:col-span-2">
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            disabled={Boolean(pending)}
            type="submit"
          >
            {pending === "enqueue" ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
            In die Sandbox
          </button>
        </div>
      </form>

      <details className="mt-4 rounded-2xl border border-violet-100 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-slate-900">
          JSONL für Collector / Stapel
        </summary>
        <textarea
          className="mt-3 min-h-32 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
          onChange={(event) => setJsonl(event.target.value)}
          placeholder='{"provider":"meta","external_id":"123","title":"…","advertiser_name":"…","platform":"meta","industry":"Handwerk","hook_text":"…","body_text":"…","source_url":"https://…","image_url":"https://…"}'
          value={jsonl}
        />
        <button
          className="mt-3 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-60"
          disabled={Boolean(pending) || !jsonl.trim()}
          onClick={enqueueJsonl}
          type="button"
        >
          JSONL einlegen
        </button>
      </details>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-900">
          Inbox {filter === "all" ? "" : `· ${collectorStatusLabel(filter)}`} · {visible.length}
          {inbox.lastBatchId ? ` · letzter Batch ${inbox.lastBatchId}` : ""}
        </p>
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          disabled={Boolean(pending) || inbox.counts.ready_for_import < 1}
          onClick={importReady}
          type="button"
        >
          {pending === "import" ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
          Bereite in den Vault holen
        </button>
      </div>

      {notice ? <p className="mt-3 text-sm text-emerald-800">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}

      <ul className="mt-4 space-y-3">
        {visible.map((item) => (
          <li key={item.id} className="rounded-2xl border border-violet-100 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-violet-700">
                  {collectorStatusLabel(item.status)} · {COLLECTOR_PROVIDERS.find((row) => row.value === item.provider)?.label ?? item.provider}
                </p>
                <h3 className="mt-1 text-base font-extrabold text-slate-950">{item.title}</h3>
                <p className="text-sm text-slate-600">
                  {item.advertiserName} · {item.platform}/{item.objective} · {item.industry}
                  {item.hasImage ? " · Bild da" : " · ohne Bild"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {item.status === "fetched" ? (
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold" disabled={Boolean(pending)} onClick={() => setStatus(item, "reviewed")} type="button">
                    Geprüft
                  </button>
                ) : null}
                {item.status === "reviewed" ? (
                  <button className="rounded-lg border border-violet-300 px-3 py-1.5 text-xs font-bold text-violet-800" disabled={Boolean(pending)} onClick={() => setStatus(item, "ready_for_import")} type="button">
                    Bereit für Vault
                  </button>
                ) : null}
                {item.status !== "imported" && item.status !== "rejected" ? (
                  <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600" disabled={Boolean(pending)} onClick={() => setStatus(item, "rejected")} type="button">
                    Verwerfen
                  </button>
                ) : null}
                {item.status === "rejected" ? (
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold" disabled={Boolean(pending)} onClick={() => setStatus(item, "fetched")} type="button">
                    Wieder öffnen
                  </button>
                ) : null}
              </div>
            </div>
            {item.hookText || item.bodyText ? (
              <p className="mt-3 text-sm leading-6 text-slate-700">
                {item.hookText || item.bodyText}
              </p>
            ) : null}
            {item.lastError ? (
              <p className="mt-2 text-sm text-red-700">{item.lastError}</p>
            ) : null}
            {item.brandAssetId ? (
              <p className="mt-2 text-xs text-slate-500">Vault-Asset {item.brandAssetId}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CensusMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-950">
        {value}
      </p>
    </div>
  );
}
