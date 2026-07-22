import Link from "next/link";
import { BarChart3, CheckCircle2, ShieldCheck } from "lucide-react";

import { AuthForm } from "@/components/AuthForm";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;

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
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              Marketing zentral steuern
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Kampagnenleistung auf einen Blick.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Verbinde später Meta, Google, TikTok und weitere Kanäle – mit einem
              gemeinsamen Dashboard und klaren Budgetgrenzen.
            </p>
            <div className="mt-10 space-y-4 text-sm text-slate-200">
              <p className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-emerald-400" />
                Getrennte Kunden- und Plattformkonten
              </p>
              <p className="flex items-center gap-3">
                <ShieldCheck className="size-5 text-emerald-400" />
                Supabase-Sitzungen mit serverseitigem Routenschutz
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-500">Deine Infrastruktur. Dein Code. Deine Daten.</p>
        </section>

        <section className="flex items-center bg-slate-50 px-6 py-12 text-slate-950 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            <p className="text-sm font-bold text-blue-600">Willkommen zurück</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Beim Portal anmelden</h2>
            <p className="mb-8 mt-3 text-slate-500">
              Nutze das Konto, das in deinem Supabase-Projekt verwaltet wird.
            </p>
            <AuthForm mode="login" nextPath={next} />
          </div>
        </section>
      </div>
    </main>
  );
}
