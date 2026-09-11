"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  Calculator,
  CircleAlert,
  CircleCheckBig,
  FlaskConical,
  LockKeyhole,
  Network,
} from "lucide-react";

import {
  STRATEGY_CURRENCIES,
  STRATEGY_OBJECTIVES,
  type StrategyCurrency,
  type StrategyObjective,
  type StrategyPlatformId,
} from "@/lib/cross-platform-strategy/catalog";
import type {
  CrossPlatformStrategyPlan,
  StrategyPlatformReadiness,
} from "@/lib/cross-platform-strategy/types";

const OBJECTIVE_LABELS: Record<StrategyObjective, string> = {
  awareness: "Bekanntheit",
  traffic: "Websitebesuche",
  engagement: "Interaktion",
  leads: "Leads",
  app_promotion: "App-Promotion",
  sales: "Verkäufe / Umsatz",
};

const SIGNAL_LABELS: Record<string, string> = {
  prior: "Ziel-Fit / Exploration",
  awareness_efficiency: "Ausspielungs-Effizienz",
  traffic_efficiency: "Traffic-Effizienz",
  conversion_efficiency: "Ergebnis-Effizienz",
  revenue_efficiency: "Umsatz-Effizienz",
};

const CONFIDENCE_LABELS: Record<string, string> = {
  low: "niedrig",
  medium: "mittel",
  high: "hoch",
};

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

function formatMoney(minor: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function stageLabel(stage: StrategyPlatformReadiness["integrationStage"]): string {
  if (stage === "live") return "Datenadapter vorhanden";
  if (stage === "next") return "Nächster Adapter";
  return "Vorbereitet";
}

type Notice = { tone: "error" | "success"; message: string } | null;

type Props = {
  readiness: StrategyPlatformReadiness[];
  suggestedCurrency: StrategyCurrency;
};

export function CrossPlatformStrategyPlanner({
  readiness,
  suggestedCurrency,
}: Props) {
  const initialPlatforms = useMemo(
    () =>
      new Set<StrategyPlatformId>(["meta", "google", "openai_ads"]),
    [],
  );
  const [objective, setObjective] = useState<StrategyObjective>("sales");
  const [currency, setCurrency] = useState<StrategyCurrency>(suggestedCurrency);
  const [dailyBudget, setDailyBudget] = useState("100.00");
  const [selected, setSelected] = useState(initialPlatforms);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [plan, setPlan] = useState<CrossPlatformStrategyPlan | null>(null);

  function togglePlatform(platform: StrategyPlatformId) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(platform)) {
        if (next.size > 1) next.delete(platform);
      } else if (next.size < 10) {
        next.add(platform);
      }
      return next;
    });
    setPlan(null);
  }

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    setPlan(null);

    try {
      const response = await fetch("/api/strategy/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective,
          currency,
          dailyBudget,
          selectedPlatforms: [...selected],
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        plan?: CrossPlatformStrategyPlan;
      };
      if (!response.ok || !body.ok || !body.plan) {
        throw new Error(
          body.message ?? "Der Strategieplan konnte nicht sicher berechnet werden.",
        );
      }
      setPlan(body.plan);
      setNotice({
        tone: "success",
        message:
          body.plan.status === "ready"
            ? "Strategieplan vollständig berechnet. Es wurden keine Werbekonten verändert."
            : "Strategieplan berechnet. Nicht bereite Kanäle und Übergangsschritte sind gekennzeichnet.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Strategieplan konnte nicht sicher berechnet werden.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <section className="overflow-hidden rounded-3xl border border-blue-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-blue-950 via-blue-900 to-blue-700 px-5 py-7 text-white sm:px-7">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-200">
            <Network className="size-4" />
            Plattformübergreifende Strategie
          </div>
          <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Ein Ziel, ein Gesamtbudget, ein nachvollziehbarer Kanalplan
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-blue-100">
            Adbot kombiniert den Fit des Werbeziels mit freigegebenen Live-Kennzahlen;
            in V1 ist die Performancegewichtung ausschließlich für Meta freigegeben.
            Fehlende Daten werden als kontrollierte Exploration behandelt, niemals als
            vermeintlicher Gewinner. Teilweise fehlende Kennzahlen führen nur zu Ziel-Priors;
            gemischte oder abweichende Währungen blockieren den Kanal. Dieser Schritt plant
            ausschließlich und verändert keine Kampagne.
          </p>
        </div>

        <form className="p-5 sm:p-7" onSubmit={calculate}>
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="text-sm font-bold text-slate-800">
              Geschäftsziel
              <select
                className={inputClass}
                onChange={(event) => {
                  setObjective(event.target.value as StrategyObjective);
                  setPlan(null);
                }}
                value={objective}
              >
                {STRATEGY_OBJECTIVES.map((value) => (
                  <option key={value} value={value}>
                    {OBJECTIVE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-800">
              Gesamt-Tagesbudget
              <input
                className={inputClass}
                inputMode="decimal"
                min="1"
                onChange={(event) => {
                  setDailyBudget(event.target.value);
                  setPlan(null);
                }}
                required
                step="0.01"
                type="number"
                value={dailyBudget}
              />
            </label>
            <label className="text-sm font-bold text-slate-800">
              Währung
              <select
                className={inputClass}
                onChange={(event) => {
                  setCurrency(event.target.value as StrategyCurrency);
                  setPlan(null);
                }}
                value={currency}
              >
                {STRATEGY_CURRENCIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="mt-7">
            <legend className="text-sm font-extrabold text-slate-900">
              Kanäle auswählen (maximal 10)
            </legend>
            <p className="mt-1 text-sm text-slate-500">
              Noch nicht verbundene Adapter erscheinen als Blocker und erhalten kein Budget.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {readiness.map((item) => {
                const checked = selected.has(item.platform);
                const connected = item.connectedAccountCount === 1;
                const ambiguous = item.connectedAccountCount > 1;
                return (
                  <label
                    className={`cursor-pointer rounded-2xl border p-4 transition ${
                      checked
                        ? "border-blue-400 bg-blue-50 ring-2 ring-blue-100"
                        : "border-slate-200 bg-white hover:border-blue-200"
                    }`}
                    key={item.platform}
                  >
                    <span className="flex items-start gap-3">
                      <input
                        checked={checked}
                        className="mt-1 size-4 accent-blue-600"
                        onChange={() => togglePlatform(item.platform)}
                        type="checkbox"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-slate-900">{item.name}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                              connected
                                ? "bg-emerald-100 text-emerald-800"
                                : ambiguous
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {connected
                              ? "verbunden"
                              : ambiguous
                                ? `${item.connectedAccountCount} Konten`
                                : "nicht verbunden"}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-600">
                          {item.description}
                        </span>
                        <span className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-blue-700">
                          {stageLabel(item.integrationStage)}
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pending}
              type="submit"
            >
              <Calculator className="size-4" />
              {pending ? "Plan wird berechnet…" : "Strategie und Budget berechnen"}
            </button>
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
              <LockKeyhole className="size-4" /> Keine Provider-Writes in diesem Schritt
            </span>
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
        </form>
      </section>

      {plan ? (
        <section className="space-y-5" aria-live="polite">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Zielbudget", formatMoney(plan.requestedDailyBudgetMinor, plan.currency)],
              ["Allokiert", formatMoney(plan.targetAllocatedDailyBudgetMinor, plan.currency)],
              ["Vertrauen", CONFIDENCE_LABELS[plan.confidence] ?? plan.confidence],
              ["Status", plan.status === "ready" ? "Bereit" : plan.status === "partial" ? "Teilweise" : "Blockiert"],
            ].map(([label, value]) => (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={label}>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
                <p className="mt-2 text-xl font-extrabold text-slate-950">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {plan.allocations.map((allocation) => (
              <article
                className={`rounded-2xl border bg-white p-5 shadow-sm ${
                  allocation.eligible ? "border-slate-200" : "border-amber-200"
                }`}
                key={allocation.platform}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-extrabold text-slate-950">
                      {allocation.platformName}
                    </h3>
                    <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                      {SIGNAL_LABELS[allocation.signal] ?? allocation.signal} · Vertrauen {" "}
                      {CONFIDENCE_LABELS[allocation.confidence] ?? allocation.confidence}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      allocation.eligible
                        ? "bg-blue-100 text-blue-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {allocation.eligible
                      ? `${(allocation.shareBps / 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`
                      : "nicht allokiert"}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase text-slate-500">Plattform-Zielbudget</p>
                    <p className="mt-1 font-extrabold text-blue-700">
                      {formatMoney(allocation.targetDailyBudgetMinor, plan.currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase text-slate-500">Gesamtscore</p>
                    <p className="mt-1 font-extrabold text-slate-900">
                      {allocation.score}/100
                    </p>
                  </div>
                </div>

                {allocation.eligible ? (
                  <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1.5">
                      Ziel-Fit {allocation.objectiveAffinity}/100
                    </span>
                    {allocation.performanceScore !== null ? (
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1.5">
                        Performance {allocation.performanceScore}/100
                      </span>
                    ) : null}
                    {allocation.exploration ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1.5 text-violet-800">
                        <FlaskConical className="size-3.5" /> Exploration
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {[...allocation.blockers, ...allocation.reasons].length > 0 ? (
                  <ul className="mt-4 space-y-2 text-xs leading-5 text-slate-600">
                    {allocation.blockers.map((item) => (
                      <li className="flex gap-2 text-amber-900" key={`block-${item}`}>
                        <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {item}
                      </li>
                    ))}
                    {allocation.reasons.map((item) => (
                      <li className="flex gap-2" key={`reason-${item}`}>
                        <CircleCheckBig className="mt-0.5 size-3.5 shrink-0 text-blue-600" /> {item}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="font-extrabold text-slate-900">Grenzen vor einer späteren Ausführung</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Der Plan verteilt das bestätigte Gesamtbudget auf Plattformebene. Konkrete
              Kampagnen- oder Anzeigengruppenänderungen benötigen zuerst providerbezogene
              Budget-Owner, Währung und Mutationshistorie.
            </p>
            <ul className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
              <li>Später maximal 20 % Budgetänderung je Budgetobjekt und 24 Stunden</li>
              <li>Später zwölf Stunden Cooldown je geändertem Budgetobjekt</li>
              <li>Frischer Read vor und Read-back nach jedem späteren Write</li>
              <li>Dieser Plan hat keine Provideraktion erzeugt</li>
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
