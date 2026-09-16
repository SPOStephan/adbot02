"use client";

import {
  ExternalLink,
  Filter,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";

import {
  AD_EXAMPLE_EVIDENCE_LEVELS,
  AD_EXAMPLE_FUNNEL_STAGES,
  AD_EXAMPLE_OBJECTIVES,
  AD_EXAMPLE_PLATFORMS,
  AD_EXAMPLE_RIGHTS_BASES,
  AD_EXAMPLE_SOURCE_KINDS,
  isGenericAdExampleObjectiveDetail,
  labelForOption,
  type AdExampleView,
} from "@/lib/ad-examples/types";

type ApiResponse = {
  ok?: boolean;
  message?: string;
  example?: AdExampleView | null;
  assetId?: string;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{children}</span>;
}

function ExampleInsight({ example }: { example: AdExampleView }) {
  const prompts = example.triggeringPrompts ?? [];
  const body = example.bodyText.trim();
  const hook = example.hookText.trim();
  const detail = example.objectiveDetail.trim();
  const hideDetail =
    example.sourceKind === "chatgpt_ad_library" || isGenericAdExampleObjectiveDetail(detail);
  const copy = body || hook || (hideDetail ? "" : detail);

  return (
    <>
      {copy ? (
        <p className="mt-3 text-sm leading-6 text-slate-700">{copy}</p>
      ) : null}
      {prompts.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm leading-6 text-slate-800">
          {prompts.slice(0, 8).map((prompt) => (
            <li key={prompt}>“{prompt}”</li>
          ))}
        </ul>
      ) : example.sourceKind === "chatgpt_ad_library" ? (
        <p className="mt-3 text-sm text-amber-800">Keine Trigger-Prompts in der Quelle gefunden.</p>
      ) : !copy && detail ? (
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{detail}</p>
      ) : null}
    </>
  );
}

function ExampleFields({ example, includeFile }: { example?: AdExampleView; includeFile: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {includeFile ? (
        <label className="grid gap-1 md:col-span-2">
          <FieldLabel>Screenshot / Creative</FieldLabel>
          <input
            accept="image/png,image/jpeg"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-blue-700"
            name="file"
            required
            type="file"
          />
        </label>
      ) : null}

      <label className="grid gap-1">
        <FieldLabel>Interner Titel</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.title} maxLength={120} name="title" placeholder="Sommerangebot mit Preisanker" required />
      </label>
      <label className="grid gap-1">
        <FieldLabel>Werbetreibender</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.advertiserName} maxLength={120} name="advertiserName" placeholder="Marke / Unternehmen" required />
      </label>
      <label className="grid gap-1">
        <FieldLabel>Plattform</FieldLabel>
        <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.platform ?? "openai_ads"} name="platform">
          {AD_EXAMPLE_PLATFORMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <FieldLabel>Branche</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.industry} list="ad-example-industries" maxLength={100} name="industry" placeholder="z. B. Hotels & Reisen" required />
        <datalist id="ad-example-industries">
          <option value="Hotels & Reisen" /><option value="E-Commerce" /><option value="SaaS & Software" /><option value="Finanzen" /><option value="Gesundheit" /><option value="Bildung" /><option value="Immobilien" /><option value="Automotive" /><option value="Gastronomie" /><option value="Beauty & Kosmetik" />
        </datalist>
      </label>
      <label className="grid gap-1">
        <FieldLabel>Werbeziel</FieldLabel>
        <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.objective ?? "sales"} name="objective">
          {AD_EXAMPLE_OBJECTIVES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <FieldLabel>Funnel-Stufe</FieldLabel>
        <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.funnelStage ?? "conversion"} name="funnelStage">
          {AD_EXAMPLE_FUNNEL_STAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 md:col-span-2">
        <FieldLabel>Zieldefinition</FieldLabel>
        <textarea className="min-h-24 rounded-xl border border-slate-300 px-3 py-2" defaultValue={example?.objectiveDetail} maxLength={600} name="objectiveDetail" placeholder="Was soll die Anzeige bei welcher Zielgruppe konkret bewirken?" required />
      </label>
      <label className="grid gap-1">
        <FieldLabel>Quellentyp</FieldLabel>
        <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.sourceKind ?? "official_library"} name="sourceKind">
          {AD_EXAMPLE_SOURCE_KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <FieldLabel>Quelllink (bei Bibliothek / Werbetreibendem Pflicht)</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.sourceUrl ?? ""} maxLength={2048} name="sourceUrl" placeholder="https://…" type="url" />
      </label>
      <label className="grid gap-1">
        <FieldLabel>Evidenzniveau</FieldLabel>
        <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.evidenceLevel ?? "visual_only"} name="evidenceLevel">
          {AD_EXAMPLE_EVIDENCE_LEVELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <FieldLabel>Rechtebasis</FieldLabel>
        <select className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.rightsBasis ?? "reference_only"} name="rightsBasis">
          {AD_EXAMPLE_RIGHTS_BASES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <FieldLabel>Format</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.format ?? "Bildanzeige"} maxLength={80} name="format" placeholder="Bild, Video, Carousel, Search…" required />
      </label>
      <label className="grid gap-1">
        <FieldLabel>Land / Markt</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.country ?? "Deutschland"} maxLength={80} name="country" required />
      </label>
      <label className="grid gap-1">
        <FieldLabel>Sprache</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.language ?? "Deutsch"} maxLength={60} name="language" required />
      </label>
      <label className="grid gap-1">
        <FieldLabel>CTA</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.ctaText} maxLength={120} name="ctaText" placeholder="Jetzt buchen" />
      </label>
      <label className="grid gap-1 md:col-span-2">
        <FieldLabel>Hook / Headline</FieldLabel>
        <textarea className="min-h-20 rounded-xl border border-slate-300 px-3 py-2" defaultValue={example?.hookText} maxLength={500} name="hookText" />
      </label>
      <label className="grid gap-1 md:col-span-2">
        <FieldLabel>Anzeigentext</FieldLabel>
        <textarea className="min-h-28 rounded-xl border border-slate-300 px-3 py-2" defaultValue={example?.bodyText} maxLength={2000} name="bodyText" />
      </label>
      <label className="grid gap-1 md:col-span-2">
        <FieldLabel>Landingpage (optional)</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.landingPageUrl ?? ""} maxLength={2048} name="landingPageUrl" placeholder="https://…" type="url" />
      </label>
      <label className="grid gap-1 md:col-span-2">
        <FieldLabel>Warum funktioniert dieses Beispiel?</FieldLabel>
        <textarea className="min-h-24 rounded-xl border border-slate-300 px-3 py-2" defaultValue={example?.whyItWorks} maxLength={1500} name="whyItWorks" placeholder="Hook, Angebot, Trust, visuelle Hierarchie, Zielgruppenfit…" />
      </label>
      <label className="grid gap-1 md:col-span-2">
        <FieldLabel>Performance-Hinweis (nur mit Datenbeleg)</FieldLabel>
        <textarea className="min-h-20 rounded-xl border border-slate-300 px-3 py-2" defaultValue={example?.performanceNote} maxLength={1000} name="performanceNote" placeholder="Nur belegte Werte eintragen; ansonsten leer lassen." />
      </label>
      <label className="grid gap-1">
        <FieldLabel>Tags</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.tags.join(", ")} name="tags" placeholder="preisanker, social-proof, urgency" />
      </label>
      <label className="grid gap-1">
        <FieldLabel>Qualität (1–5)</FieldLabel>
        <input className="h-11 rounded-xl border border-slate-300 px-3" defaultValue={example?.qualityRating ?? 3} max={5} min={1} name="qualityRating" type="number" />
      </label>
      <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3 md:col-span-2">
        <input defaultChecked={example?.useForGeneration ?? false} className="mt-1 size-4" name="useForGeneration" type="checkbox" />
        <span className="text-sm text-slate-700"><strong>Für Creative-Vorschläge freigeben.</strong> Nur die abstrahierten Muster dürfen als Referenz in die Generierung einfließen; das Beispiel selbst wird niemals ausgespielt.</span>
      </label>
      <label className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 md:col-span-2">
        <input defaultChecked={example?.rightsConfirmed ?? false} className="mt-1 size-4" name="rightsConfirmed" required type="checkbox" />
        <span className="text-sm text-blue-950">Ich bestätige, dass Screenshot und Angaben rechtmäßig als interne Analyse- und Inspirationsreferenz gespeichert werden dürfen.</span>
      </label>
    </div>
  );
}

function jsonValues(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

export function AdExampleLibraryAdmin({ initialExamples }: { initialExamples: AdExampleView[] }) {
  const createFormRef = useRef<HTMLFormElement>(null);
  const [examples, setExamples] = useState(initialExamples);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [objective, setObjective] = useState("all");
  const [industry, setIndustry] = useState("all");

  const industries = useMemo(
    () => [...new Set(examples.map((item) => item.industry))].sort((a, b) => a.localeCompare(b, "de")),
    [examples],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return examples.filter((item) => {
      const haystack = [item.title, item.advertiserName, item.industry, item.objectiveDetail, item.hookText, item.bodyText, ...(item.triggeringPrompts ?? []), ...item.tags].join(" ").toLowerCase();
      return (!needle || haystack.includes(needle)) && (platform === "all" || item.platform === platform) && (objective === "all" || item.objective === objective) && (industry === "all" || item.industry === industry);
    });
  }, [examples, query, platform, objective, industry]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending("create"); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/admin/ad-examples", { method: "POST", credentials: "same-origin", body: new FormData(event.currentTarget) });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok || !payload.example) throw new Error(payload.message ?? "Upload fehlgeschlagen.");
      setExamples((current) => [payload.example as AdExampleView, ...current.filter((item) => item.id !== payload.example?.id)]);
      createFormRef.current?.reset();
      setNotice("Werbebeispiel gespeichert und klassifiziert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload fehlgeschlagen.");
    } finally { setPending(null); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>, example: AdExampleView) {
    event.preventDefault();
    if (pending) return;
    setPending(example.id); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/admin/ad-examples", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: example.id, ...jsonValues(event.currentTarget) }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok || !payload.example) throw new Error(payload.message ?? "Speichern fehlgeschlagen.");
      setExamples((current) => current.map((item) => item.id === example.id ? payload.example as AdExampleView : item));
      setNotice("Klassifikation aktualisiert.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Speichern fehlgeschlagen."); }
    finally { setPending(null); }
  }

  async function remove(example: AdExampleView) {
    if (pending || !window.confirm(`„${example.title}“ wirklich entfernen?`)) return;
    setPending(example.id); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/admin/ad-examples", {
        method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: example.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? "Entfernen fehlgeschlagen.");
      setExamples((current) => current.filter((item) => item.id !== example.id));
      setNotice("Werbebeispiel entfernt.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Entfernen fehlgeschlagen."); }
    finally { setPending(null); }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0" /><div><p className="font-extrabold">Interne Lern- und Inspirationsbasis</p><p className="mt-1 text-sm leading-6">Beispiele bleiben für Kunden unsichtbar und sind technisch nie launchbar. Nur ausdrücklich freigegebene, abstrahierte Muster dürfen später Creative-Vorschläge beeinflussen. Quellen- und Evidenzniveau verhindern, dass bloß sichtbare Anzeigen als nachweislich erfolgreich behandelt werden.</p></div></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-extrabold">Offizielle Recherchequellen</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          Für ChatGPT Ads nutzen wir zusätzlich die öffentliche Inspirationsquelle{" "}
          <a
            className="font-semibold text-blue-700 hover:underline"
            href="https://www.chatgptadlibrary.com/library"
            rel="noreferrer"
            target="_blank"
          >
            chatgptadlibrary.com
          </a>{" "}
          — ausschließlich intern, nie kundensichtbar. Für andere Plattformen dienen diese
          offiziellen Oberflächen als Ausgangspunkt:
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["ChatGPT Ad Library", "https://www.chatgptadlibrary.com/library"],
            ["Meta Ad Library", "https://www.facebook.com/ads/library/"],
            ["Google Ads Transparency", "https://adstransparency.google.com/"],
            ["TikTok Commercial Content Library", "https://library.tiktok.com/"],
            ["TikTok Top Ads", "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en"],
          ].map(([label, href]) => (
            <a
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-extrabold text-blue-700 hover:bg-blue-100"
              href={href}
              key={href}
              rel="noreferrer"
              target="_blank"
            >
              {label}
              <ExternalLink className="size-3.5" />
            </a>
          ))}
        </div>
      </section>

      {notice ? <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">{notice}</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm" open={examples.length === 0}>
        <summary className="cursor-pointer list-none p-5 text-lg font-extrabold"><span className="inline-flex items-center gap-2"><ImagePlus className="size-5 text-blue-600" />Neues Werbebeispiel erfassen</span></summary>
        <form className="border-t border-slate-100 p-5" onSubmit={create} ref={createFormRef}>
          <ExampleFields includeFile />
          <button className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-extrabold text-white hover:bg-blue-700 disabled:opacity-50" disabled={pending === "create"} type="submit">{pending === "create" ? <LoaderCircle className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}Beispiel speichern</button>
        </form>
      </details>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-extrabold">Bibliothek</h2><p className="mt-1 text-sm text-slate-500">{filtered.length} von {examples.length} Beispielen sichtbar · {examples.filter((item) => item.useForGeneration).length} für Vorschläge freigegeben</p></div></div>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4">
          <label className="relative md:col-span-1"><Search className="absolute left-3 top-3 size-4 text-slate-400" /><input className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm" onChange={(event) => setQuery(event.target.value)} placeholder="Suchen…" value={query} /></label>
          <label className="relative"><Filter className="absolute left-3 top-3 size-4 text-slate-400" /><select className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm" onChange={(event) => setPlatform(event.target.value)} value={platform}><option value="all">Alle Plattformen</option>{AD_EXAMPLE_PLATFORMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setObjective(event.target.value)} value={objective}><option value="all">Alle Ziele</option>{AD_EXAMPLE_OBJECTIVES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select className="h-10 rounded-lg border border-slate-200 px-3 text-sm" onChange={(event) => setIndustry(event.target.value)} value={industry}><option value="all">Alle Branchen</option>{industries.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          {filtered.map((example) => (
            <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" key={example.id}>
              <div className="grid gap-0 sm:grid-cols-[15rem_1fr]">
                <a className="flex min-h-52 items-center justify-center bg-slate-100" href={example.previewUrl} rel="noreferrer" target="_blank">
                  {/* Private signed previews are generated dynamically and cannot use next/image. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt={example.title} className="max-h-72 w-full object-contain" src={example.previewUrl} />
                </a>
                <div className="p-5">
                  <div className="flex flex-wrap gap-2 text-[11px] font-extrabold uppercase tracking-wide">
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">{labelForOption(AD_EXAMPLE_PLATFORMS, example.platform)}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{example.industry}</span>
                    <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-700">{labelForOption(AD_EXAMPLE_OBJECTIVES, example.objective)}</span>
                    {example.useForGeneration ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Freigegeben</span> : null}
                    {example.legacy ? <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-800">Klassifizieren</span> : null}
                  </div>
                  <h3 className="mt-3 text-lg font-extrabold">{example.title}</h3>
                  <p className="mt-1 text-sm font-semibold text-slate-600">{example.advertiserName}</p>
                  <ExampleInsight example={example} />
                  <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold">
                    {example.sourceUrl ? <a className="inline-flex items-center gap-1 text-blue-700 hover:underline" href={example.sourceUrl} rel="noreferrer" target="_blank">Quelle <ExternalLink className="size-3" /></a> : null}
                    <span className="text-slate-500">Qualität {example.qualityRating}/5</span>
                    <span className="text-slate-500">{labelForOption(AD_EXAMPLE_EVIDENCE_LEVELS, example.evidenceLevel)}</span>
                  </div>
                </div>
              </div>
              <details className="border-t border-slate-100"><summary className="cursor-pointer list-none px-5 py-4 text-sm font-extrabold text-blue-700"><span className="inline-flex items-center gap-2"><Pencil className="size-4" />Klassifikation bearbeiten</span></summary><form className="border-t border-slate-100 p-5" onSubmit={(event) => void save(event, example)}><ExampleFields example={example} includeFile={false} /><div className="mt-5 flex flex-wrap gap-2"><button className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-blue-700 disabled:opacity-50" disabled={pending === example.id} type="submit">{pending === example.id ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}Speichern</button><button className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-200 px-4 py-3 text-sm font-extrabold text-rose-700 hover:bg-rose-50 disabled:opacity-50" disabled={pending === example.id} onClick={() => void remove(example)} type="button"><Trash2 className="size-4" />Entfernen</button></div></form></details>
            </article>
          ))}
        </div>
        {filtered.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">Keine Werbebeispiele für diese Filter.</p> : null}
      </section>
    </div>
  );
}
