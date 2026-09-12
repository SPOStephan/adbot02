import { Suspense } from "react";
import { redirect } from "next/navigation";

import { MetaAdAccountPicker } from "@/components/MetaAdAccountPicker";
import {
  MetaCampaignOverview,
  type MetaCreativeOptimizationCycleView,
} from "@/components/MetaCampaignOverview";
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

async function KampagnenBody() {
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
  } = await loadCustomerDashboard(user, {}, { sideEffects: false });

  if (!metaConnected || !metaAccount) {
    return (
      <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="font-bold">Meta ist noch nicht verbunden.</p>
        <p className="mt-1 text-sm leading-6">
          Verbinde Meta auf der Übersicht, damit Kampagnendaten geladen werden können.
        </p>
      </section>
    );
  }

  const { data: creativeCycleRows, error: creativeCycleError } = await supabase
    .from("meta_creative_optimization_cycles")
    .select(
      "id,test_kind,status,platform_ad_set_id,started_at,measurement_start_date,measurement_end_date,completed_at,completion_reason,created_at",
    )
    .eq("platform_account_id", metaAccount.id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(8);
  const creativeOptimizationCycles: MetaCreativeOptimizationCycleView[] =
    creativeCycleError || !Array.isArray(creativeCycleRows)
      ? []
      : creativeCycleRows.flatMap((row) => {
          if (
            typeof row.id !== "string"
            || (row.test_kind !== "FORMAT" && row.test_kind !== "CREATIVE")
            || ![
              "PLANNED", "ACTIVE_TEST", "PAUSE_PLANNED",
              "COMPLETED", "FAILED", "CANCELLED",
            ].includes(String(row.status))
            || typeof row.platform_ad_set_id !== "string"
            || typeof row.created_at !== "string"
          ) return [];
          return [{
            id: row.id,
            testKind: row.test_kind,
            status: row.status as MetaCreativeOptimizationCycleView["status"],
            platformAdSetId: row.platform_ad_set_id,
            startedAt: typeof row.started_at === "string" ? row.started_at : null,
            measurementStartDate:
              typeof row.measurement_start_date === "string"
                ? row.measurement_start_date
                : null,
            measurementEndDate:
              typeof row.measurement_end_date === "string"
                ? row.measurement_end_date
                : null,
            completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
            completionReason:
              typeof row.completion_reason === "string" ? row.completion_reason : null,
            createdAt: row.created_at,
          }];
        });

  return (
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
        creativeOptimizationCycles={creativeOptimizationCycles}
        status={metaAccount.marketing_sync_status ?? "idle"}
      />
    </>
  );
}

export default function KampagnenPage() {
  const copy = DASHBOARD_PAGE_COPY.kampagnen;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <KampagnenBody />
      </Suspense>
    </>
  );
}
