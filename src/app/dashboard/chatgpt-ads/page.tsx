import { redirect } from "next/navigation";

import { CampaignGeoTargetCard } from "@/components/CampaignGeoTargetCard";
import { DashboardPageHeader } from "@/components/DashboardPageHeader";
import { OpenAIAdsConnectionForm } from "@/components/OpenAIAdsConnectionForm";
import { OpenAIAdsWorkspace } from "@/components/OpenAIAdsWorkspace";
import { loadOpenAIAdsDashboard } from "@/lib/openai-ads/dashboard";
import { getPublishedOpenAIAdsGuide } from "@/lib/openai-ads/guide";
import { hasOpenAIAdsEnv } from "@/lib/openai-ads/env";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 180;

export default async function ChatGPTAdsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/chatgpt-ads");
  }

  const configured = hasOpenAIAdsEnv();
  let accounts: Awaited<ReturnType<typeof loadOpenAIAdsDashboard>> = [];
  let dashboardAvailable = configured;
  let guideAvailable = false;

  if (configured) {
    try {
      accounts = await loadOpenAIAdsDashboard(user.id);
    } catch (error) {
      dashboardAvailable = false;
      console.error("openai_ads_dashboard_unavailable", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  try {
    guideAvailable = Boolean(await getPublishedOpenAIAdsGuide());
  } catch (error) {
    console.error("openai_ads_guide_unavailable", {
      message: error instanceof Error ? error.message : "unknown",
    });
  }

  return (
    <>
      <DashboardPageHeader
        description="Werbekonten verbinden und echte Delivery- sowie Conversion-Daten für die kanalübergreifende Auswertung laden."
        eyebrow="OpenAI Advertiser API"
        title="ChatGPT Ads"
      />

      <div className="mt-8">
        <CampaignGeoTargetCard compact />
      </div>

      {dashboardAvailable ? (
        <>
          <section className="mt-8 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-blue-950">
            <p className="font-black">ChatGPT Ads direkt mit Adbot verbinden</p>
            <p className="mt-1 max-w-4xl text-sm leading-6">
              Adbot liest Konten, Kampagnen, Anzeigengruppen, Anzeigen und Insights
              direkt aus der OpenAI Advertiser API. OpenAI nutzt derzeit
              accountgebundene Ads-API-Keys statt eines OAuth-Dialogs; Adbot führt
              deshalb durch die zwei nötigen Schritte und bestätigt das erkannte
              Werbekonto sofort.
            </p>
          </section>

          {accounts.length === 0 ? (
            <div className="mt-8">
              <OpenAIAdsConnectionForm guideAvailable={guideAvailable} />
            </div>
          ) : (
            <>
              <div className="mt-8">
                <OpenAIAdsWorkspace
                  accounts={accounts}
                />
              </div>

              <div className="mt-8">
                <OpenAIAdsConnectionForm guideAvailable={guideAvailable} />
              </div>
            </>
          )}
        </>
      ) : (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-black">ChatGPT Ads wird technisch aktiviert</p>
          <p className="mt-1 max-w-4xl text-sm leading-6">
            Der Connector ist noch nicht vollständig betriebsbereit. Deshalb sind
            Verbindung und Kampagnenstart bis zur abgeschlossenen
            Live-Konfiguration sicher deaktiviert. Bestehende Meta-Verbindungen
            und Kampagnen bleiben davon unverändert.
          </p>
        </section>
      )}
    </>
  );
}
