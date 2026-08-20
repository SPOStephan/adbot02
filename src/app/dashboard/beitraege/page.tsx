import { redirect } from "next/navigation";

import { MetaContentSyncPanel } from "@/components/MetaContentSyncPanel";
import { loadCustomerDashboard } from "@/lib/dashboard/load-customer-dashboard";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

export default async function BeitraegePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/beitraege");
  }

  const {
    metaAccount,
    metaConnected,
    writeScopeGranted,
    reconnectRequired,
    connectedAssetViews,
    showExtraAssetHint,
    needsContentAssetSetup,
    contentSyncSnapshot,
    killSwitchView,
    boostSettingsView,
    boostOverrideByCandidate,
    organicBoostPlanByCandidate,
    eligiblePendingBoostCandidates,
    shouldAutoPlanOrganicBoost,
    organicPlannerStatus,
    organicPlannerLastError,
    policyView,
  } = await loadCustomerDashboard(user);

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Content
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Beiträge</h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Beitragsabruf, verbundene Seiten und Kandidaten für Beitrag-Push — unabhängig vom Kampagnenabruf.
        </p>
      </div>

      {!metaConnected || !metaAccount || !contentSyncSnapshot ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Meta ist noch nicht verbunden.</p>
          <p className="mt-1 text-sm leading-6">
            Verbinde Meta auf der Übersicht, damit Beiträge abgerufen werden können.
          </p>
        </section>
      ) : (
        <MetaContentSyncPanel
          boost={{
            autoPlanEnabled: shouldAutoPlanOrganicBoost,
            boostEnabled: Boolean(boostSettingsView?.enabled),
            boostMode: boostSettingsView?.boostMode ?? "OFF",
            canApprove: Boolean(
              writeScopeGranted &&
                killSwitchView?.mode === "FREEZE_WRITES" &&
                boostSettingsView?.enabled,
            ),
            canPrepare: Boolean(
              writeScopeGranted &&
                killSwitchView?.mode === "FREEZE_WRITES" &&
                boostSettingsView?.enabled &&
                policyView?.status === "ACTIVE" &&
                policyView.allowNewLaunches,
            ),
            heldPlanByCandidate: Object.fromEntries(
              organicBoostPlanByCandidate.entries(),
            ),
            killSwitchMode: killSwitchView?.mode ?? null,
            organicPlannerLastError: organicPlannerLastError,
            organicPlannerStatus: organicPlannerStatus,
            overrideByCandidate: Object.fromEntries(
              boostOverrideByCandidate.entries(),
            ),
            pendingBoostCandidateIds: eligiblePendingBoostCandidates.map(
              (candidate) => candidate.id,
            ),
            policyActive: Boolean(
              policyView?.status === "ACTIVE" &&
                policyView.allowNewLaunches &&
                policyView.allowStatusChanges,
            ),
          }}
          connectedAssets={connectedAssetViews}
          initial={{
            status: contentSyncSnapshot.status,
            errorCode: contentSyncSnapshot.errorCode,
            lastSyncStartedAt: contentSyncSnapshot.lastSyncStartedAt,
            lastSyncedAt: contentSyncSnapshot.lastSyncedAt,
            nextSyncAt: contentSyncSnapshot.nextSyncAt,
            displayNextSyncAt: contentSyncSnapshot.displayNextSyncAt,
            baselineCompleted: contentSyncSnapshot.baselineCompleted,
            seenCount: contentSyncSnapshot.seenCount,
            newCount: contentSyncSnapshot.newCount,
            storedCandidateCount: contentSyncSnapshot.storedCandidateCount,
            candidates: contentSyncSnapshot.candidates,
          }}
          needsContentAssetSetup={needsContentAssetSetup}
          reconnectRequired={reconnectRequired}
          showExtraAssetHint={showExtraAssetHint}
          writeScopeGranted={writeScopeGranted}
        />
      )}
    </>
  );
}
