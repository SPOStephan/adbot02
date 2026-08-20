import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Megaphone,
  Camera,
  Crosshair,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { FreebieWorkspaceCard } from "@/components/FreebieWorkspaceCard";
import { FunnelWorkspaceCard } from "@/components/FunnelWorkspaceCard";
import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { PerformanceChart } from "@/components/PerformanceChart";
import { PlatformStatusCard } from "@/components/PlatformStatusCard";
import { loadCustomerDashboard } from "@/lib/dashboard/load-customer-dashboard";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

type DashboardPageProps = {
  searchParams: Promise<{
    meta?: string | string[];
    meta_error?: string | string[];
    meta_missing_scopes?: string | string[];
    meta_unexpected_scopes?: string | string[];
    meta_callback_stage?: string | string[];
    assetId?: string | string[];
  }>;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Noch nicht ausgeführt";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Zeitpunkt nicht verfügbar";
  }

  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}

async function OverviewBody({
  query,
}: {
  query: Awaited<DashboardPageProps["searchParams"]>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const {
    platforms,
    hasConnectedPlatform,
    platformAccountReadFailed,
    metaAccount,
    metaConnected,
    metaNotice,
    marketingCurrency,
    marketingMetrics,
    chartPoints,
    pendingBoostCandidateCount,
    contentSyncSnapshot,
  } = await loadCustomerDashboard(user, query);

  const nextActions = [
    {
      href: "/dashboard/kampagnen",
      label: "Kampagnen",
      description: "Live-Leistung, Sync-Status und Empfehlungen",
      icon: Megaphone,
    },
    {
      href: "/dashboard/beitraege",
      label: "Beiträge",
      description: "Abruf, Assets und Beitrag-Push-Kandidaten",
      icon: Camera,
    },
    {
      href: "/dashboard/tracking",
      label: "Tracking",
      description: "Meta Pixel global für Funnel, Freebie und Kampagnen",
      icon: Crosshair,
    },
    {
      href: "/dashboard/autonomie",
      label: "Autonomie",
      description: "Policy, Kill-Switch und Boost-Einstellungen",
      icon: ShieldCheck,
    },
    {
      href: "/dashboard/assistent",
      label: "Assistent",
      description: "Regelbasierte Hinweise zu Kampagnen",
      icon: Sparkles,
    },
  ] as const;

  return (
    <>
      <div className="mt-5 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              metaAccount?.marketing_sync_status === "success"
                ? "bg-emerald-100 text-emerald-800"
                : platformAccountReadFailed
                  ? "bg-amber-100 text-amber-900"
                  : "bg-blue-100 text-blue-800"
            }`}
          >
            {metaAccount?.marketing_sync_status === "success"
              ? "Meta Live"
              : platformAccountReadFailed
                ? "Live-Daten konnten nicht geladen werden"
                : "Live-Daten noch nicht verfügbar"}
          </span>
          <span className="text-xs text-slate-400">
            {platformAccountReadFailed
              ? "Bestehende Verbindung bleibt unverändert"
              : hasConnectedPlatform
                ? `Datenstand ${formatDateTime(metaAccount?.marketing_last_success_at)}`
                : "Noch keine Werbekonten verbunden"}
          </span>
        </div>
        <span className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm">
          <CalendarDays className="size-4" />
          Letzte 30 Insight-Tage
        </span>
      </div>

      {metaNotice ? (
        <section
          aria-live="polite"
          className={`mt-8 flex gap-3 rounded-2xl border p-4 sm:p-5 ${
            metaNotice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-red-200 bg-red-50 text-red-950"
          }`}
          role={metaNotice.tone === "error" ? "alert" : "status"}
        >
          {metaNotice.tone === "success" ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-600" />
          )}
          <div>
            <p className="font-bold">{metaNotice.title}</p>
            <p className="mt-1 text-sm leading-6 opacity-80">{metaNotice.message}</p>
          </div>
        </section>
      ) : null}

      {platformAccountReadFailed ? (
        <section
          aria-live="assertive"
          className="mt-8 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:p-5"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div>
            <p className="font-bold">Verbindungsdaten konnten nicht geladen werden.</p>
            <p className="mt-1 text-sm leading-6 opacity-80">
              Die bestehende Meta-Verbindung bleibt unverändert. Bitte keinen Reconnect starten;
              der Lesezugriff muss zuerst geprüft werden.
            </p>
          </div>
        </section>
      ) : null}

      <section className="mt-10 scroll-mt-24" id="plattformen">
        <div>
          <h2 className="text-xl font-extrabold">Werbeplattformen</h2>
          <p className="mt-1 text-sm text-slate-500">
            Meta ist aktiv. Weitere Kanäle erscheinen hier als Platzhalter, sobald sie angebunden werden.
          </p>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {platforms.map(({ id, ...platform }) => (
            <PlatformStatusCard key={id} {...platform} />
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {marketingMetrics.map(({ label, value, icon: Icon, color }) => (
          <article
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            key={label}
          >
            <div className="flex items-start justify-between gap-3">
              <span className={`grid size-10 place-items-center rounded-xl ${color}`}>
                <Icon className="size-5" />
              </span>
              <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                Meta Live
              </span>
            </div>
            <p className="mt-5 text-sm font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.7fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-bold">Tägliche Werbeausgaben</p>
              <p className="mt-1 text-sm text-slate-500">
                Letzte 30 vollständige Meta-Insight-Tage
              </p>
            </div>
            <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
              {marketingCurrency}
            </span>
          </div>
          <PerformanceChart currency={marketingCurrency} points={chartPoints} />
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
            Als Nächstes
          </p>
          <h2 className="mt-2 text-lg font-extrabold">Arbeitsbereiche</h2>
          <ul className="mt-4 space-y-2">
            {nextActions.map(({ href, label, description, icon: Icon }) => (
              <li key={href}>
                <Link
                  className="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-3 transition hover:border-blue-300 hover:bg-blue-50"
                  href={href}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-950">{label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {description}
                    </span>
                  </span>
                  <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
          {metaConnected ? (
            <p className="mt-4 text-xs leading-5 text-slate-500">
              {pendingBoostCandidateCount > 0
                ? `${pendingBoostCandidateCount} offene Beitragskandidaten · `
                : null}
              {contentSyncSnapshot?.storedCandidateCount
                ? `${contentSyncSnapshot.storedCandidateCount} Beiträge gespeichert`
                : "Beitragsabruf unter Beiträge"}
            </p>
          ) : null}
        </article>
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <FunnelWorkspaceCard userEmail={user.email} />
        <FreebieWorkspaceCard userEmail={user.email} />
      </div>
    </>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const query = await searchParams;
  const copy = DASHBOARD_PAGE_COPY.overview;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <OverviewBody query={query} />
      </Suspense>
    </>
  );
}
