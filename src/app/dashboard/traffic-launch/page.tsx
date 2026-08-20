import { redirect } from "next/navigation";

import { LeadLaunchCanary } from "@/components/LeadLaunchCanary";
import { TrafficLaunchCanary } from "@/components/TrafficLaunchCanary";
import { loadCustomerDashboard } from "@/lib/dashboard/load-customer-dashboard";
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

export default async function TrafficLaunchPage({ searchParams }: PageProps) {
  const query = await searchParams;
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
  } = await loadCustomerDashboard(user, query);

  const policyLaunchReady = Boolean(
    policyView?.status === "ACTIVE" &&
      policyView.allowNewLaunches &&
      policyView.allowStatusChanges,
  );

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Launch
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Traffic-Launch
        </h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Traffic- und Lead-Canaries vorbereiten und starten — ohne den Rest der Autonomie-Oberfläche.
        </p>
      </div>

      {!metaConnected || !metaAccount ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Meta ist noch nicht verbunden.</p>
          <p className="mt-1 text-sm leading-6">
            Verbinde Meta auf der Übersicht, bevor du Launches vorbereitest.
          </p>
        </section>
      ) : (
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
      )}
    </>
  );
}
