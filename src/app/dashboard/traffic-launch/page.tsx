import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CampaignGeoTargetCard } from "@/components/CampaignGeoTargetCard";
import { LeadLaunchCanary } from "@/components/LeadLaunchCanary";
import { MetaPixelBinding } from "@/components/MetaPixelBinding";
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
import {
  listFunnelPurposeHints,
  resolvePublicFunnelPurposeHint,
} from "@/lib/funnel-purpose-hints";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<{
    assetId?: string | string[];
    funnelUrl?: string | string[];
    ideaId?: string | string[];
  }>;
};

async function TrafficLaunchBody({
  query,
}: {
  query: { assetId?: string | string[]; funnelUrl?: string | string[]; ideaId?: string | string[] };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/traffic-launch");
  }

  const initialFunnelUrl =
    typeof query.funnelUrl === "string" &&
    query.funnelUrl.length <= 2_000 &&
    query.funnelUrl.startsWith("https://")
      ? query.funnelUrl
      : null;

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

  const [readyCustomDomains, storedFunnelPurposeHints, initialFunnelPurposeHint] =
    await Promise.all([
      listReadyCustomerCustomDomains(user.id).catch(() => []),
      listFunnelPurposeHints(user.id).catch(() => []),
      initialFunnelUrl
        ? resolvePublicFunnelPurposeHint(initialFunnelUrl).catch(() => null)
        : Promise.resolve(null),
    ]);
  const funnelPurposeHints = initialFunnelPurposeHint
    ? [
        initialFunnelPurposeHint,
        ...storedFunnelPurposeHints.filter(
          (hint) => hint.destinationUrl !== initialFunnelPurposeHint.destinationUrl,
        ),
      ]
    : storedFunnelPurposeHints;

  const policyLaunchReady = Boolean(
    policyView?.status === "ACTIVE" &&
      policyView.allowNewLaunches &&
      policyView.allowStatusChanges,
  );

  if (!metaConnected || !metaAccount) {
    return (
      <div className="mt-8">
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Meta ist noch nicht verbunden.</p>
          <p className="mt-1 text-sm leading-6">
            Verbinde jetzt das Werbekonto. Danach werden Facebook-Seite, Instagram-Konto,
            Pixel und Kampagnenberechtigungen direkt hier geladen.
          </p>
          <form action="/api/connectors/meta/start" className="mt-4" method="post">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800"
              type="submit"
            >
              Meta jetzt verbinden
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {onboardingData.pixels.length === 0 ? (
        <MetaPixelBinding pixels={onboardingData.pixels} standalone />
      ) : null}
      <CampaignGeoTargetCard compact />
      {!initialFunnelUrl ? (
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
      ) : null}
      <LeadLaunchCanary
        brandProfileId={brandProfileView?.id ?? null}
        currency={marketingCurrency}
        data={onboardingData}
        facebookPages={launchFacebookPages}
        instagramAccounts={launchInstagramAccounts}
        initialDestinationUrl={initialFunnelUrl}
        initialFacebookPageId={brandProfileView?.facebookPageId}
        initialInstagramActorId={brandProfileView?.instagramActorId}
        killSwitchMode={killSwitchView?.mode ?? "FREEZE_WRITES"}
        policyLaunchReady={policyLaunchReady}
        readyCustomDomains={readyCustomDomains}
        funnelPurposeHints={funnelPurposeHints}
        writeScopeGranted={writeScopeGranted}
      />
    </div>
  );
}

export default async function TrafficLaunchPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const copy = DASHBOARD_PAGE_COPY.trafficLaunch;
  const funnelCampaign =
    typeof query.funnelUrl === "string" && query.funnelUrl.startsWith("https://");
  return (
    <>
      <DashboardPageHeader
        description={
          funnelCampaign
            ? "Funnel, Zielgebiet, Pixel, Werbemittel und Anzeigentexte prüfen — anschließend die Meta-Kampagne starten."
            : copy.description
        }
        eyebrow={copy.eyebrow}
        title={funnelCampaign ? "Funnel mit Meta bewerben" : copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <TrafficLaunchBody query={query} />
      </Suspense>
    </>
  );
}
