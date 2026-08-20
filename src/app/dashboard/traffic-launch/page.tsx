import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LeadLaunchCanary } from "@/components/LeadLaunchCanary";
import { TrafficLaunchCanary } from "@/components/TrafficLaunchCanary";
import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { loadCustomerDashboard } from "@/lib/dashboard/load-customer-dashboard";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<{
    assetId?: string | string[];
  }>;
};

async function TrafficLaunchBody({
  query,
}: {
  query: { assetId?: string | string[] };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/traffic-launch");
  }

  const {
    metaAccount,
    metaConnected,
    writeScopeGranted,
    policyView,
    brandProfileView,
    launchFacebookPages,
    launchInstagramAccounts,
    killSwitchView,
    onboardingData,
    marketingCurrency,
  } = await loadCustomerDashboard(user, query, { sideEffects: false });

  const policyLaunchReady = Boolean(
    policyView?.status === "ACTIVE" &&
      policyView.allowNewLaunches &&
      policyView.allowStatusChanges,
  );

  if (!metaConnected || !metaAccount) {
    return (
      <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="font-bold">Meta ist noch nicht verbunden.</p>
        <p className="mt-1 text-sm leading-6">
          Verbinde Meta auf der Übersicht, bevor du Launches vorbereitest.
        </p>
      </section>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      <TrafficLaunchCanary
        brandProfileId={brandProfileView?.id ?? null}
        currency={marketingCurrency}
        data={onboardingData}
        facebookPages={launchFacebookPages}
        instagramAccounts={launchInstagramAccounts}
        initialAssetId={
          typeof query.assetId === "string" &&
          /^[0-9a-f-]{36}$/i.test(query.assetId)
            ? query.assetId
            : null
        }
        initialFacebookPageId={brandProfileView?.facebookPageId}
        initialInstagramActorId={brandProfileView?.instagramActorId}
        killSwitchMode={killSwitchView?.mode ?? "FREEZE_WRITES"}
        policyLaunchReady={policyLaunchReady}
        writeScopeGranted={writeScopeGranted}
      />
      <LeadLaunchCanary
        brandProfileId={brandProfileView?.id ?? null}
        currency={marketingCurrency}
        data={onboardingData}
        facebookPages={launchFacebookPages}
        instagramAccounts={launchInstagramAccounts}
        initialFacebookPageId={brandProfileView?.facebookPageId}
        initialInstagramActorId={brandProfileView?.instagramActorId}
        killSwitchMode={killSwitchView?.mode ?? "FREEZE_WRITES"}
        policyLaunchReady={policyLaunchReady}
        writeScopeGranted={writeScopeGranted}
      />
    </div>
  );
}

export default async function TrafficLaunchPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const copy = DASHBOARD_PAGE_COPY.trafficLaunch;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <TrafficLaunchBody query={query} />
      </Suspense>
    </>
  );
}
