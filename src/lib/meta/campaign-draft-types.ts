import type { CampaignGeoTarget } from "@/lib/campaign-geo/types";
import type { FunnelAdCategory } from "@/lib/funnel-purpose-hint-types";
import type { LeadPerformanceGoal } from "@/lib/meta/lead-performance-goal";

export type MetaCampaignDraftPayload = {
  campaignName: string;
  destinationUrl: string;
  adCategory: FunnelAdCategory | "";
  dailyBudget: string;
  facebookPageId: string;
  instagramActorId: string;
  primaryTexts: string[];
  headlines: string[];
  descriptions: string[];
  structuralMode: "off" | "two_ads" | "two_ad_sets" | "funnel_split";
  variantDestinationUrl: string;
  useMetaExperiment: boolean;
  dynamicCreativeImages: boolean;
  includeFormatSiblings: boolean;
  assetId: string;
  extraAssetIds: string[];
  ad2Primary: string;
  ad2Headline: string;
  ad2Description: string;
  pixelRowId: string;
  performanceGoal: LeadPerformanceGoal;
  /**
   * Meta promoted_object.custom_event_type for this launch (e.g. LEAD,
   * COMPLETE_REGISTRATION). Older drafts without the field load as LEAD.
   */
  conversionEventType: string;
  geo: CampaignGeoTarget | null;
};

export type MetaCampaignDraftView = {
  id: string;
  campaignName: string;
  destinationUrl: string;
  payload: MetaCampaignDraftPayload;
  revision: number;
  updatedAt: string;
};
