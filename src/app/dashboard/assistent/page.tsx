import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CampaignAssistantBrief } from "@/components/CampaignAssistantBrief";
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
export const maxDuration = 120;

async function AssistentBody() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/assistent");
  }

  const { metaConnected, metaAccount, campaignBriefViews } =
    await loadCustomerDashboard(user, {}, { sideEffects: false });

  if (!metaConnected || !metaAccount) {
    return (
      <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="font-bold">Meta ist noch nicht verbunden.</p>
        <p className="mt-1 text-sm leading-6">
          Sobald Kampagnendaten vorliegen, erscheinen hier die Assistenten-Hinweise.
        </p>
      </section>
    );
  }

  return <CampaignAssistantBrief briefs={campaignBriefViews} />;
}

export default function AssistentPage() {
  const copy = DASHBOARD_PAGE_COPY.assistent;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <AssistentBody />
      </Suspense>
    </>
  );
}
