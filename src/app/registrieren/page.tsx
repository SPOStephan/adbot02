import Link from "next/link";
import { BarChart3, CircleCheckBig, Sparkles } from "lucide-react";

import { AuthForm } from "@/components/AuthForm";

export default function RegisterPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-2">
        <section className="flex flex-col justify-between px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
          <Link className="flex items-center gap-3 font-bold" href="/">
            <span className="grid size-10 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
              <BarChart3 className="size-5" />
            </span>
            <span>AdPilot</span>
          </Link>

          <div className="my-16 max-w-xl lg:my-0">
            <p className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              <Sparkles className="size-4" />
              Dein Marketing-Cockpit
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Starte mit einer sauberen, erweiterbaren Basis.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Das erste Inkrement umfasst Anmeldung, geschützte Bereiche und ein
              plattformübergreifendes Dashboard. Reale Werbekonten werden danach
              kontrolliert verbunden.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {[
                "Eigene Supabase-Datenbank",
                "Deployment über dein Vercel",
                "Portabler Next.js-Code",
                "Schrittweise API-Freigaben",
              ].map((benefit) => (
                <p className="flex items-center gap-2 text-sm text-slate-200" key={benefit}>
                  <CircleCheckBig className="size-4 shrink-0 text-emerald-400" />
                  {benefit}
                </p>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-500">Keine Bindung an proprietäres Hosting.</p>
        </section>

        <section className="flex items-center bg-slate-50 px-6 py-12 text-slate-950 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            <p className="text-sm font-bold text-blue-600">Konto anlegen</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Portalzugang erstellen</h2>
            <p className="mb-8 mt-3 text-slate-500">
              Nach der Registrierung kannst du direkt in das geschützte Dashboard wechseln.
            </p>
            <AuthForm mode="register" />
          </div>
        </section>
      </div>
    </main>
  );
}
