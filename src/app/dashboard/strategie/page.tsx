import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CrossPlatformStrategyPlanner } from "@/components/CrossPlatformStrategyPlanner";
import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { loadStrategyPlannerData } from "@/lib/cross-platform-strategy/data";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

async function loadStrategyPlannerDataSafe(userId: string) {
  try {
    return await loadStrategyPlannerData(userId, {
      selectedPlatforms: ["meta"],
    });
  } catch {
    return null;
  }
}

async function StrategyBody() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/strategie");
  }

  const data = await loadStrategyPlannerDataSafe(user.id);
  if (!data) {
    return (
      <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="font-bold">Strategiedaten konnten nicht geladen werden.</p>
        <p className="mt-1 text-sm leading-6">
          Bestehende Plattformverbindungen und Kampagnen bleiben unverändert. Es
          wurden keine Provideraktionen ausgelöst.
        </p>
      </section>
    );
  }

  return (
    <CrossPlatformStrategyPlanner
      readiness={data.readiness}
      suggestedCurrency={data.suggestedCurrency}
    />
  );
}

export default function StrategyPage() {
  const copy = DASHBOARD_PAGE_COPY.strategie;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <StrategyBody />
      </Suspense>
    </>
  );
}
