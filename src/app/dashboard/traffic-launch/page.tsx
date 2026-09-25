import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LeadLaunchCanary } from "@/components/LeadLaunchCanary";
import { LiveSetupChecklist } from "@/components/LiveSetupGuide";
import {
  TrafficLaunchCanary,
} from "@/components/TrafficLaunchCanary";
import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { listReadyCustomerCustomDomains } from "@/lib/custom-domains/service";
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
    ideaId?: string | string[];
  }>;
};

async function TrafficLaunchBody({
  query,
}: {
  query: { assetId?: string | string[]; ideaId?: string | string[] };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/traffic-launch");
  }

  const ideaId =
    typeof query.ideaId === "string" && /^[0-9a-f-]{36}$/i.test(query.ideaId)
      ? query.ideaId
      : null;
  const { data: ideaRow } = ideaId
    ? await supabase
        .from("campaign_ideas")
        .select(
          "destination_url,realized_copy,realized_asset_id,screenshot_asset_id",
        )
        .eq("id", ideaId)
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };
  const realizedCopy =
    ideaRow?.realized_copy &&
    typeof ideaRow.realized_copy === "object" &&
    !Array.isArray(ideaRow.realized_copy)
      ? (ideaRow.realized_copy as Record<string, unknown>)
      : null;
  const ideaAssetId =
    typeof ideaRow?.realized_asset_id === "string" &&
    ideaRow.realized_asset_id !== ideaRow.screenshot_asset_id
      ? ideaRow.realized_asset_id
      : null;

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

  let readyCustomDomains: Awaited<
    ReturnType<typeof listReadyCustomerCustomDomains>
  > = [];
  try {
    readyCustomDomains = await listReadyCustomerCustomDomains(user.id);
  } catch {
    readyCustomDomains = [];
  }

  const policyLaunchReady = Boolean(
    policyView?.status === "ACTIVE" &&
      policyView.allowNewLaunches &&
      policyView.allowStatusChanges,
  );

  if (!metaConnected || !metaAccount) {
    return (
      <div className="mt-8 space-y-6">
        <LiveSetupChecklist currentId="canary" />
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Meta ist noch nicht verbunden.</p>
          <p className="mt-1 text-sm leading-6">
            Verbinde Meta auf der Übersicht, bevor du Launches vorbereitest.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      <LiveSetupChecklist currentId="canary" />
      <TrafficLaunchCanary
        brandProfileId={brandProfileView?.id ?? null}
        currency={marketingCurrency}
        data={onboardingData}
        facebookPages={launchFacebookPages}
        instagramAccounts={launchInstagramAccounts}
        initialAssetId={
          typeof query.assetId === "string" &&
          /^[0-9a-f-]{36}$/i.test(query.assetId) &&
          query.assetId !== ideaRow?.screenshot_asset_id
            ? query.assetId
            : ideaAssetId
        }
        initialDestinationUrl={
          typeof ideaRow?.destination_url === "string"
            ? ideaRow.destination_url
            : null
        }
        initialPrimaryText={
          typeof realizedCopy?.primaryText === "string"
            ? realizedCopy.primaryText
            : typeof realizedCopy?.primary_text === "string"
              ? realizedCopy.primary_text
              : null
        }
        initialHeadline={
          typeof realizedCopy?.headline === "string"
            ? realizedCopy.headline
            : null
        }
        initialDescription={
          typeof realizedCopy?.description === "string"
            ? realizedCopy.description
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
        readyCustomDomains={readyCustomDomains}
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
