"use client";

import { useState, type ComponentProps, type ReactNode } from "react";

import { CampaignGeoTargetCard } from "@/components/CampaignGeoTargetCard";
import { LeadLaunchCanary } from "@/components/LeadLaunchCanary";
import type { CampaignGeoTarget } from "@/lib/campaign-geo/types";
import type { MetaCampaignDraftView } from "@/lib/meta/campaign-draft-types";

type Props = Omit<
  ComponentProps<typeof LeadLaunchCanary>,
  "campaignDraftEnabled" | "campaignGeo" | "initialDraft" | "onLaunchStateChange"
> & {
  header?: ReactNode;
  initialDraft?: MetaCampaignDraftView | null;
};

export function FunnelMetaCampaignWorkspace({
  header = null,
  initialDraft = null,
  ...leadProps
}: Props) {
  const [geo, setGeo] = useState<CampaignGeoTarget | null>(
    initialDraft?.payload.geo ?? null,
  );
  const [launchState, setLaunchState] = useState<"IDLE" | "QUEUED" | "ACTIVE">(
    "IDLE",
  );
  const launchCompleted = launchState !== "IDLE";

  return (
    <div className={launchCompleted ? undefined : "space-y-8"}>
      {launchCompleted ? null : header}
      {launchCompleted ? null : (
        <CampaignGeoTargetCard
          compact
          initialGeo={initialDraft?.payload.geo}
          onSaved={setGeo}
        />
      )}
      <LeadLaunchCanary
        {...leadProps}
        campaignDraftEnabled
        campaignGeo={geo}
        initialDraft={initialDraft}
        onLaunchStateChange={setLaunchState}
      />
    </div>
  );
}
