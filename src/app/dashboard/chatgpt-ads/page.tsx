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
        description="Werbekonten verbinden, echte Delivery-Daten vergleichen und ChatGPT-Ad-Kampagnen nach ausdrücklicher Budgetbestätigung direkt ACTIVE starten."
        eyebrow="OpenAI Advertiser API"
        title="ChatGPT Ads"
      />

      <section className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
        <p className="font-black">Neu in Adbot: echter ChatGPT-Ads-Connector</p>
        <p className="mt-1 max-w-4xl text-sm leading-6">
          Adbot liest Konten, Kampagnen, Anzeigengruppen, Anzeigen und Insights
          direkt aus der OpenAI Advertiser API. Nach Bestätigung von Targeting,
          Tages- und Laufzeitbudget legt Adbot neue Launches direkt ACTIVE an.
          Läuft die Anzeigenprüfung noch, beginnt die Auslieferung automatisch
          nach OpenAIs Genehmigung.
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
