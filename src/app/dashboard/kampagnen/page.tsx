import { redirect } from "next/navigation";

import { MetaAdAccountPicker } from "@/components/MetaAdAccountPicker";
import { MetaCampaignOverview } from "@/components/MetaCampaignOverview";
import { loadCustomerDashboard } from "@/lib/dashboard/load-customer-dashboard";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

export default async function KampagnenPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/kampagnen");
  }

  const {
    metaAccount,
    metaConnected,
    adAccountPickerOptions,
    campaignRows,
    organicBoostCampaignViewsResolved,
    boostSettingsView,
    killSwitchView,
    policyView,
    organicPlannerLastError,
    organicPlannerStatus,
    pendingBoostCandidateCount,
    recommendationRows,
    marketingCurrency,
  } = await loadCustomerDashboard(user);

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Meta Live
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Kampagnen</h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Aktives Werbekonto, Kampagnenleistung und Empfehlungen — getrennt vom Beitragsabruf.
        </p>
      </div>

      {!metaConnected || !metaAccount ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Meta ist noch nicht verbunden.</p>
          <p className="mt-1 text-sm leading-6">
            Verbinde Meta auf der Übersicht, damit Kampagnendaten geladen werden können.
          </p>
        </section>
      ) : (
        <>
          {adAccountPickerOptions.length > 0 ? (
            <div className="mt-8">
              <MetaAdAccountPicker accounts={adAccountPickerOptions} />
            </div>
          ) : null}

          <MetaCampaignOverview
            adAccounts={adAccountPickerOptions}
            campaigns={campaignRows}
            organicBoostCampaigns={organicBoostCampaignViewsResolved}
            organicBoostConfigured={Boolean(
              boostSettingsView &&
                boostSettingsView.boostMode !== "OFF" &&
                boostSettingsView.enabled,
            )}
            killSwitchMode={killSwitchView?.mode ?? null}
            allowBudgetChanges={Boolean(policyView?.allowBudgetChanges)}
            allowStatusChanges={Boolean(policyView?.allowStatusChanges)}
            organicPlannerLastError={organicPlannerLastError}
            organicPlannerStatus={organicPlannerStatus}
            pendingBoostCandidateCount={pendingBoostCandidateCount}
            counts={{
              campaigns: metaAccount.marketing_campaign_count ?? 0,
              adSets: metaAccount.marketing_ad_set_count ?? 0,
              ads: metaAccount.marketing_ad_count ?? 0,
              creatives: metaAccount.marketing_creative_count ?? 0,
              insights: metaAccount.marketing_insight_count ?? 0,
            }}
            currency={marketingCurrency}
            errorCode={metaAccount.marketing_sync_error_code ?? null}
            insightsSince={metaAccount.marketing_insights_since ?? null}
            insightsUntil={metaAccount.marketing_insights_until ?? null}
            lastSuccessAt={metaAccount.marketing_last_success_at ?? null}
            recommendations={recommendationRows}
            status={metaAccount.marketing_sync_status ?? "idle"}
          />
        </>
      )}
    </>
  );
}
