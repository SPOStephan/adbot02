import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { MetaPixelBinding } from "@/components/MetaPixelBinding";
import { loadCustomerDashboard } from "@/lib/dashboard/load-customer-dashboard";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";
import {
  createFreebieSsoEntryPath,
  createFunnelSsoEntryPath,
} from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

async function TrackingBody() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/tracking");
  }

  const { metaConnected, metaAccount, onboardingData } =
    await loadCustomerDashboard(user, {}, { sideEffects: false });

  if (!metaConnected || !metaAccount) {
    return (
      <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="font-bold">Meta ist noch nicht verbunden.</p>
        <p className="mt-1 text-sm leading-6">
          Verbinde Meta zuerst auf der{" "}
          <Link className="font-semibold underline underline-offset-2" href="/dashboard">
            Übersicht
          </Link>
          , danach kannst du hier das Pixel für Funnel, Freebie und Kampagnen
          hinterlegen.
        </p>
      </section>
    );
  }

  return (
    <div className="mt-8 space-y-6">
      <MetaPixelBinding pixels={onboardingData.pixels} standalone />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-extrabold tracking-tight">Wohin wirkt das Pixel?</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>
            <span className="font-semibold text-slate-800">Funnel</span> und{" "}
            <span className="font-semibold text-slate-800">Freebie</span> übernehmen
            die bestätigte Pixel-ID automatisch (wenn dort noch keine andere
            manuell steht) und melden Absenden bzw. Anmeldung als Lead an Meta.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Lead-Kampagnen</span>{" "}
            optimieren auf dieses Pixel und Event (Traffic-Launch) — ohne
            zusätzlichen Token.
          </li>
          <li>
            Später auch{" "}
            <span className="font-semibold text-slate-800">Traffic / PageViews</span>{" "}
            — dieselbe globale Verbindung.
          </li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            className="inline-flex items-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
            href={createFunnelSsoEntryPath()}
            rel="noopener noreferrer"
            target="_blank"
          >
            Funnel öffnen
          </a>
          <a
            className="inline-flex items-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
            href={createFreebieSsoEntryPath()}
            rel="noopener noreferrer"
            target="_blank"
          >
            Freebie öffnen
          </a>
          <Link
            className="inline-flex items-center rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50"
            href="/dashboard/traffic-launch"
          >
            Zum Traffic-Launch
          </Link>
        </div>
      </section>
    </div>
  );
}

export default function TrackingPage() {
  const copy = DASHBOARD_PAGE_COPY.tracking;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <TrackingBody />
      </Suspense>
    </>
  );
}
