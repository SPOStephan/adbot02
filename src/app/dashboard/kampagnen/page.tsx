import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FilePenLine } from "lucide-react";

import { MetaAdAccountPicker } from "@/components/MetaAdAccountPicker";
import { MetaCampaignDraftActions } from "@/components/MetaCampaignDraftActions";
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
import { toMetaCampaignDraftView } from "@/lib/meta/campaign-draft";
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

  const { data: draftRows } = await supabase
    .from("meta_campaign_drafts")
    .select("id,campaign_name,destination_url,payload,revision,updated_at")
    .eq("user_id", user.id)
    .eq("platform_account_id", metaAccount.id)
    .eq("status", "DRAFT")
    .order("updated_at", { ascending: false })
    .limit(50);
  const campaignDrafts = Array.isArray(draftRows)
    ? draftRows.flatMap((row) => {
        const draft = toMetaCampaignDraftView(row as Record<string, unknown>);
        return draft ? [draft] : [];
      })
    : [];

  return (
    <>
      {adAccountPickerOptions.length > 0 ? (
        <div className="mt-8">
          <MetaAdAccountPicker accounts={adAccountPickerOptions} />
        </div>
      ) : null}

      <section
        aria-labelledby="campaign-drafts-title"
        className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        id="entwuerfe"
      >
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Gespeicherte Kampagnen
        </p>
        <h2 className="mt-2 text-xl font-extrabold tracking-tight" id="campaign-drafts-title">
          Entwürfe
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
          Noch nicht gestartete Funnel-Kampagnen werden automatisch gespeichert. Du
          kannst die Bearbeitung hier ohne Datenverlust fortsetzen.
        </p>
        {campaignDrafts.length ? (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {campaignDrafts.map((draft) => (
              <article className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={draft.id}>
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-100 text-blue-700">
                    <FilePenLine className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-extrabold text-slate-950">
                      {draft.campaignName}
                    </h3>
                    <p className="mt-1 truncate text-xs font-medium text-slate-500">
                      {draft.destinationUrl}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Zuletzt gespeichert: {new Date(draft.updatedAt).toLocaleString("de-DE")}
                    </p>
                    <MetaCampaignDraftActions draftId={draft.id} />
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
            Noch keine Kampagnenentwürfe. Sobald du einen Funnel mit Meta bewirbst,
            speichert Adbot deine Eingaben automatisch hier.
          </div>
        )}
      </section>

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
