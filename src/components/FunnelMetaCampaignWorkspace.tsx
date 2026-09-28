"use client";

import { useState, type ComponentProps } from "react";

import { CampaignGeoTargetCard } from "@/components/CampaignGeoTargetCard";
import { LeadLaunchCanary } from "@/components/LeadLaunchCanary";
import type { CampaignGeoTarget } from "@/lib/campaign-geo/types";
import type { MetaCampaignDraftView } from "@/lib/meta/campaign-draft-types";

type Props = Omit<
  ComponentProps<typeof LeadLaunchCanary>,
  "campaignDraftEnabled" | "campaignGeo" | "initialDraft"
> & {
  initialDraft?: MetaCampaignDraftView | null;
};

export function FunnelMetaCampaignWorkspace({ initialDraft = null, ...leadProps }: Props) {
  const [geo, setGeo] = useState<CampaignGeoTarget | null>(
    initialDraft?.payload.geo ?? null,
  );

  return (
    <>
      <CampaignGeoTargetCard
        compact
        initialGeo={initialDraft?.payload.geo}
        onSaved={setGeo}
      />
      <LeadLaunchCanary
        {...leadProps}
        campaignDraftEnabled
        campaignGeo={geo}
        initialDraft={initialDraft}
      />
    </>
  );
}
