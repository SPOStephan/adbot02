import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Layers3,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { APP_SITE_URL } from "@/lib/site-urls";

const benefits = [
  "Meta, Google, TikTok und weitere Kanäle in einer Oberfläche",
  "Klare Budgetgrenzen und kontrollierte Freigaben",
  "Portabler Code auf deiner eigenen Infrastruktur",
];

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
        <Link className="flex items-center gap-3 font-extrabold" href="/">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
            <BarChart3 className="size-5" />
          </span>
          <span>AdPilot</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link className="hidden px-3 py-2 text-sm font-semibold text-slate-300 hover:text-white sm:block" href={`${APP_SITE_URL}/login`}>
            Anmelden
          </Link>
          <Link
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-blue-50"
            href={`${APP_SITE_URL}/registrieren`}
          >
            Portal öffnen
          </Link>
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-7xl gap-14 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:pb-28 lg:pt-24">
        <div className="pointer-events-none absolute -left-36 top-0 size-[32rem] rounded-full bg-blue-600/20 blur-3xl" />
        <div className="relative">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
            <Sparkles className="size-4" />
            Multi-Platform Marketing
          </p>
          <h1 className="max-w-3xl text-5xl font-extrabold tracking-[-0.04em] sm:text-6xl lg:text-7xl">
            Kampagnen steuern. Ergebnisse verstehen. Sicher skalieren.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
            Ein zentrales Cockpit für kanalübergreifende Werbung – vorbereitet für
            KI-gestützte Creatives, Auswertung und Optimierung mit menschlicher Kontrolle.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 font-bold shadow-xl shadow-blue-600/20 transition hover:bg-blue-500"
              href={`${APP_SITE_URL}/registrieren`}
            >
              Kostenlos starten
              <ArrowRight className="size-5" />
            </Link>
            <Link
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-6 py-3.5 font-bold text-slate-200 transition hover:border-slate-500 hover:bg-slate-900"
              href={`${APP_SITE_URL}/login`}
            >
              Zum Dashboard
            </Link>
          </div>
          <div className="mt-10 space-y-3">
            {benefits.map((benefit) => (
              <p className="flex items-start gap-3 text-sm text-slate-300" key={benefit}>
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-400" />
                {benefit}
              </p>
            ))}
          </div>
        </div>

        <div className="relative flex items-center">
          <div className="w-full rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-blue-950/60 backdrop-blur">
            <div className="rounded-[1.4rem] bg-slate-50 p-5 text-slate-950 sm:p-7">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-600">Dashboard-Vorschau</p>
                  <p className="mt-1 text-xl font-extrabold">Kampagnenleistung</p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Demo</span>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-3">
                {[
                  ["Leads", "1.284"],
                  ["Kosten / Lead", "6,56 €"],
                  ["Klickrate", "3,82 %"],
                  ["Kanäle", "4"],
                ].map(([label, value]) => (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4" key={label}>
                    <p className="text-xs font-semibold text-slate-400">{label}</p>
                    <p className="mt-2 text-xl font-extrabold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-slate-950 p-5 text-white">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-blue-500/20 text-blue-300">
                    <Layers3 className="size-5" />
                  </span>
                  <div>
                    <p className="font-bold">Connectoren modular aufbauen</p>
                    <p className="text-xs text-slate-400">Meta und Google zuerst, weitere danach</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-white/10 bg-slate-900/60">
        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-10 sm:grid-cols-3 lg:px-8">
          {[
            [ShieldCheck, "Kontrollierte Freigaben", "Keine Kampagne startet ohne definierte Berechtigung."],
            [Layers3, "Modulare Connectoren", "Jede Plattform bleibt technisch sauber getrennt."],
            [Sparkles, "KI mit Leitplanken", "Vorschläge automatisieren, Entscheidungen nachvollziehbar halten."],
          ].map(([Icon, title, text]) => {
            const FeatureIcon = Icon as typeof ShieldCheck;
            return (
              <article className="rounded-2xl border border-white/10 p-5" key={title as string}>
                <FeatureIcon className="size-5 text-blue-400" />
                <h2 className="mt-4 font-bold">{title as string}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{text as string}</p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
