import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CampaignGeoTargetCard } from "@/components/CampaignGeoTargetCard";
import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function ZielgruppenBody() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/zielgruppen");
  }
  return (
    <div className="mt-8 max-w-3xl">
      <CampaignGeoTargetCard />
    </div>
  );
}

export default function ZielgruppenPage() {
  const copy = DASHBOARD_PAGE_COPY.zielgruppen;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <ZielgruppenBody />
      </Suspense>
    </>
  );
}
