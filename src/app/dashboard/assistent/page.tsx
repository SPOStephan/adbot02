import { redirect } from "next/navigation";

import { CampaignAssistantBrief } from "@/components/CampaignAssistantBrief";
import { loadCustomerDashboard } from "@/lib/dashboard/load-customer-dashboard";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

export default async function AssistentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/assistent");
  }

  const { metaConnected, metaAccount, campaignBriefViews } =
    await loadCustomerDashboard(user);

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Analyse
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Assistent</h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Regelbasierte Hinweise aus gespeicherten Live-Kennzahlen — ohne automatische Änderungen.
        </p>
      </div>

      {!metaConnected || !metaAccount ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Meta ist noch nicht verbunden.</p>
          <p className="mt-1 text-sm leading-6">
            Sobald Kampagnendaten vorliegen, erscheinen hier die Assistenten-Hinweise.
          </p>
        </section>
      ) : (
        <CampaignAssistantBrief briefs={campaignBriefViews} />
      )}
    </>
  );
}
