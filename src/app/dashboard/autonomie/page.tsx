import { redirect } from "next/navigation";

import { AutomationControlCenter } from "@/components/AutomationControlCenter";
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

export default async function AutonomiePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/autonomie");
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
    boostEligibleAssets,
    boostSettingsView,
    automationAuditViews,
    domainViews,
    blueprintViews,
    brandAssetViews,
    onboardingData,
    marketingCurrency,
    automationScopeView,
    budgetCanaryViews,
    canPrepareBudgetCanary,
    canConfirmBudgetCanary,
  } = await loadCustomerDashboard(user, query);

  return (
    <>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">
          Steuerung
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Autonomie</h1>
        <p className="mt-2 max-w-2xl text-slate-500">
          Kunden-Policy, Kill-Switch, Boost und Onboarding — getrennt von der Kampagnenübersicht.
        </p>
      </div>

      {!metaConnected || !metaAccount ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <p className="font-bold">Meta ist noch nicht verbunden.</p>
          <p className="mt-1 text-sm leading-6">
            Verbinde Meta auf der Übersicht, bevor du Autonomie-Einstellungen nutzt.
          </p>
        </section>
      ) : (
        <AutomationControlCenter
          accountName={metaAccount.account_name ?? "Meta-Werbekonto"}
          auditEvents={automationAuditViews}
          automationScope={automationScopeView}
          boostEligibleAssets={boostEligibleAssets}
          boostSettings={boostSettingsView}
          brandProfile={brandProfileView}
          budgetCanaries={budgetCanaryViews}
          canPrepareBudgetCanary={canPrepareBudgetCanary}
          canConfirmBudgetCanary={canConfirmBudgetCanary}
          currency={marketingCurrency}
          facebookPages={launchFacebookPages}
          instagramAccounts={launchInstagramAccounts}
          killSwitch={killSwitchView}
          onboarding={onboardingData}
          initialTrafficAssetId={
            typeof query.assetId === "string" &&
            /^[0-9a-f-]{36}$/i.test(query.assetId)
              ? query.assetId
              : null
          }
          policy={policyView}
          readiness={{
            writeScopeGranted,
            verifiedDomains: domainViews.filter(
              (domain) => domain.status === "VERIFIED",
            ).length,
            activeBlueprints: blueprintViews.filter(
              (blueprint) => blueprint.status === "ACTIVE",
            ).length,
            readyBrandAssets: brandAssetViews.length,
          }}
        />
      )}
    </>
  );
}
