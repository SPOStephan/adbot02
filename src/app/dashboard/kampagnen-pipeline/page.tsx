import { Suspense } from "react";
import { redirect } from "next/navigation";

import { CampaignIdeaPipeline } from "@/components/CampaignIdeaPipeline";
import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { parseIdeaCore, parseRealizedCopy } from "@/lib/campaign-pipeline/idea-core";
import type { CampaignIdeaView } from "@/lib/campaign-pipeline/idea-core";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 120;

function asSourceType(value: unknown): CampaignIdeaView["sourceType"] {
  return value === "SCREENSHOT" || value === "KEYWORDS" ? value : "LINK";
}

function asStatus(value: unknown): CampaignIdeaView["status"] {
  if (
    value === "QUEUED" ||
    value === "READY" ||
    value === "REALIZING" ||
    value === "REALIZED" ||
    value === "FAILED" ||
    value === "ARCHIVED"
  ) {
    return value;
  }
  return "QUEUED";
}

async function PipelineBody() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard/kampagnen-pipeline");
  }

  const { data: account } = await supabase
    .from("platform_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (!account) {
    return (
      <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="font-bold">Meta ist noch nicht verbunden.</p>
        <p className="mt-1 text-sm leading-6">
          Verbinde Meta auf der Übersicht, dann kannst du Ideen in die Pipeline legen.
        </p>
      </section>
    );
  }

  const [{ data: ideaRows }, { data: brand }] = await Promise.all([
    supabase
      .from("campaign_ideas")
      .select(
        "id,source_type,status,source_url,keywords,notes,screenshot_asset_id,extracted_core,extracted_at,last_error,destination_url,objective,realized_copy,realized_asset_id,realized_at,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .eq("platform_account_id", account.id)
      .neq("status", "ARCHIVED")
      .order("updated_at", { ascending: false })
      .limit(40),
    supabase
      .from("brand_profiles")
      .select("id")
      .eq("user_id", user.id)
      .eq("platform_account_id", account.id)
      .eq("status", "ACTIVE")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const ideas: CampaignIdeaView[] = (ideaRows ?? []).map((row) => ({
    id: String(row.id),
    sourceType: asSourceType(row.source_type),
    status: asStatus(row.status),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    keywords: row.keywords == null ? null : String(row.keywords),
    notes: row.notes == null ? null : String(row.notes),
    screenshotAssetId:
      row.screenshot_asset_id == null ? null : String(row.screenshot_asset_id),
    extractedCore: parseIdeaCore(row.extracted_core),
    extractedAt: row.extracted_at == null ? null : String(row.extracted_at),
    lastError: row.last_error == null ? null : String(row.last_error),
    destinationUrl:
      row.destination_url == null ? null : String(row.destination_url),
    objective: row.objective == null ? null : String(row.objective),
    realizedCopy: parseRealizedCopy(row.realized_copy),
    realizedAssetId:
      row.realized_asset_id == null ? null : String(row.realized_asset_id),
    realizedAt: row.realized_at == null ? null : String(row.realized_at),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));

  return (
    <CampaignIdeaPipeline
      brandProfileId={brand?.id ?? null}
      ideas={ideas}
    />
  );
}

export default function CampaignPipelinePage() {
  const copy = DASHBOARD_PAGE_COPY.kampagnenPipeline;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <Suspense fallback={<DashboardContentSkeleton />}>
        <PipelineBody />
      </Suspense>
    </>
  );
}
