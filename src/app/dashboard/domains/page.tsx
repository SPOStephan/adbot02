import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CustomDomainBinding } from "@/components/CustomDomainBinding";
import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { listCustomerCustomDomains } from "@/lib/custom-domains/service";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";
import {
  createFreebieSsoEntryPath,
  createFunnelSsoEntryPath,
} from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

async function DomainsBody() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/domains");
  }

  let domains: Awaited<ReturnType<typeof listCustomerCustomDomains>> = [];
  let loadError: string | null = null;
  try {
    domains = await listCustomerCustomDomains(user.id);
  } catch {
    loadError =
      "Domains konnten nicht geladen werden. Die Tabelle ist ggf. noch nicht migriert.";
  }

  return (
    <div className="mt-8 space-y-6">
      {loadError ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
          {loadError}
        </p>
      ) : null}

      <CustomDomainBinding domains={domains} />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-extrabold tracking-tight">
          Wohin wirken verbundene Domains?
        </h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
          <li>
            <span className="font-semibold text-slate-800">Kampagnen</span>{" "}
            (Traffic-Launch): verbundene Domains erscheinen als Dropdown für die
            Ziel-URL.
          </li>
          <li>
            <span className="font-semibold text-slate-800">Funnel / Freebie</span>
            : Domain dort oder hier anlegen. Sync zeigt Herkunft und Bindung in
            dieser Liste. Kunde setzt nur CNAME — SSL/Hosting wird automatisch
            gesetzt. Routing bleibt im jeweiligen Tool (eigene Subdomain + DB).
            Eine Domain nicht an Funnel und Freebie gleichzeitig binden.
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

export default function DomainsPage() {
  const copy = DASHBOARD_PAGE_COPY.domains;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <DomainsBody />
      </Suspense>
    </>
  );
}
