import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SiteBrandMark } from "@/components/SiteBrandMark";
import { decodePendingLink, KIREADY_COOKIE } from "@/lib/kiready/cookies";
import { getKireadyOidcEnv, isKireadyOidcConfigured } from "@/lib/kiready/env";
import { MARKETING_SITE_URL } from "@/lib/site-urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function KireadyLinkPage() {
  if (!isKireadyOidcConfigured()) {
    redirect("/login?error=KIready-Anmeldung%20ist%20noch%20nicht%20konfiguriert.");
  }
  const env = getKireadyOidcEnv();
  const jar = await cookies();
  const pending = decodePendingLink(jar.get(KIREADY_COOKIE.pending)?.value, env.stateSecret);
  if (!pending) {
    redirect("/login?error=Die%20Kontoverknuepfung%20ist%20abgelaufen.");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
        <SiteBrandMark href={MARKETING_SITE_URL} tone="dark" />
        <h1 className="mt-10 text-3xl font-extrabold tracking-tight">Konto einmalig verknüpfen</h1>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          Die bestätigte KIready-Adresse <strong>{pending.email}</strong> gehört bereits zu einem
          Adbot-Konto. Werbekonten, Kampagnen und Guthaben bleiben unverändert. Es wird nur die
          Anmeldung verbunden.
        </p>
        <p className="mt-3 text-sm text-slate-400">Unternehmen: {pending.organizationName}</p>
        <form action="/auth/kiready/link/confirm" className="mt-8 space-y-3" method="post">
          <button
            className="flex w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700"
            name="confirm"
            type="submit"
            value="1"
          >
            Ja, bestehendes Adbot-Konto verbinden
          </button>
          <button
            className="flex w-full items-center justify-center rounded-xl border border-slate-600 px-5 py-3 font-bold text-slate-100 hover:bg-slate-900"
            name="confirm"
            type="submit"
            value="0"
          >
            Abbrechen
          </button>
        </form>
      </div>
    </main>
  );
}
