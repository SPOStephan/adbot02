import Link from "next/link";
import { BarChart3, KeyRound } from "lucide-react";

import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { MARKETING_SITE_URL } from "@/lib/site-urls";

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-2">
        <section className="flex flex-col justify-between px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
          <Link className="flex items-center gap-3 font-bold" href={MARKETING_SITE_URL}>
            <span className="grid size-10 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30">
              <BarChart3 className="size-5" />
            </span>
            <span>AdPilot</span>
          </Link>

          <div className="my-16 max-w-xl lg:my-0">
            <p className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              <KeyRound className="size-4" />
              Zugang wiederherstellen
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Passwort zurücksetzen.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Du bekommst einen Link per E-Mail. Danach kannst du ein neues Passwort setzen und
              wieder ins Portal.
            </p>
          </div>

          <p className="text-xs text-slate-500">Deine Infrastruktur. Dein Code. Deine Daten.</p>
        </section>

        <section className="flex items-center bg-slate-50 px-6 py-12 text-slate-950 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            <p className="text-sm font-bold text-blue-600">Passwort vergessen</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Link anfordern</h2>
            <p className="mb-8 mt-3 text-slate-500">
              Gib die E-Mail-Adresse deines Portal-Kontos ein.
            </p>
            <ForgotPasswordForm />
          </div>
        </section>
      </div>
    </main>
  );
}
