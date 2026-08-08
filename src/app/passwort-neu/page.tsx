import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { SiteBrandMark } from "@/components/SiteBrandMark";
import { SiteFooter } from "@/components/SiteFooter";
import { UpdatePasswordForm } from "@/components/UpdatePasswordForm";
import { MARKETING_SITE_URL } from "@/lib/site-urls";

export default function UpdatePasswordPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-2">
        <section className="flex flex-col justify-between px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
          <SiteBrandMark href={MARKETING_SITE_URL} tone="dark" />

          <div className="my-16 max-w-xl lg:my-0">
            <p className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              <ShieldCheck className="size-4" />
              Neues Passwort
            </p>
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Zugang neu festlegen.
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              Wähle ein neues Passwort mit mindestens 8 Zeichen. Danach landest du im Dashboard.
            </p>
          </div>

          <p className="text-xs text-slate-500">Deine Infrastruktur. Dein Code. Deine Daten.</p>
        </section>

        <section className="flex items-center bg-slate-50 px-6 py-12 text-slate-950 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            <p className="text-sm font-bold text-blue-600">Passwort ändern</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight">Neues Passwort setzen</h2>
            <p className="mb-8 mt-3 text-slate-500">
              Dieser Schritt funktioniert nur über den Link aus der Zurücksetzen-E-Mail.
            </p>
            <UpdatePasswordForm />
          </div>
        </section>
      </div>
      <SiteFooter tone="dark" />
    </main>
  );
}
