import { redirect } from "next/navigation";

import { DashboardPageHeader } from "@/components/DashboardPageHeader";
import { OpenAIAdsConnectionForm } from "@/components/OpenAIAdsConnectionForm";
import { OpenAIAdsWorkspace } from "@/components/OpenAIAdsWorkspace";
import { loadOpenAIAdsDashboard } from "@/lib/openai-ads/dashboard";
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

  const accounts = await loadOpenAIAdsDashboard(user.id);

  return (
    <>
      <DashboardPageHeader
        description="Werbekonten verbinden, echte Delivery-Daten vergleichen und ChatGPT-Ad-Kampagnen mit einer sicheren PAUSED-zu-ACTIVE-Freigabe steuern."
        eyebrow="OpenAI Advertiser API"
        title="ChatGPT Ads"
      />

      <section className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
        <p className="font-black">Neu in Adbot: echter ChatGPT-Ads-Connector</p>
        <p className="mt-1 max-w-4xl text-sm leading-6">
          Adbot liest Konten, Kampagnen, Anzeigengruppen, Anzeigen und Insights
          direkt aus der OpenAI Advertiser API. Neue Launches werden zuerst auf
          allen Ebenen pausiert angelegt. Erst eine zweite, ausdrückliche
          Freigabe kann nach aktuellem Account- und Anzeigen-Review Ausgaben
          starten.
        </p>
      </section>

      <div className="mt-8">
        <OpenAIAdsWorkspace accounts={accounts} />
      </div>

      <div className="mt-8">
        <OpenAIAdsConnectionForm />
      </div>
    </>
  );
}
