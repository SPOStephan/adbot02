/** Campaign overview shapes returned by the Adbot portal for the Funnel "Kampagnen" page. */

/** One ad card as Adbot renders it (image, text, headline, destination). */
export type PortalCampaignAdCard = {
  key: string;
  imageUrl: string | null;
  primaryText: string;
  headline: string;
  description: string;
  destinationUrl: string;
  callToActionLabel: string;
  previewLabel: string;
  instagramPermalinkUrl: string | null;
};

export type PortalFunnelCampaign = {
  id: string;
  displayName: string;
  kind: "lead" | "traffic";
  lifecycle: "active" | "archived";
  statusLabel: string;
  funnelUrl: string;
  destinationUrl: string | null;
  variantDestinationUrl: string | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  startTime: string | null;
  stopTime: string | null;
  spend: number | null;
  impressions: number | null;
  linkClicks: number | null;
  leads: number | null;
  currency: string;
  previewMode: "single" | "dynamic" | "structural" | "none";
  cards: PortalCampaignAdCard[];
  totalCombinationCount: number;
  isTruncated: boolean;
};

export type PortalFunnelCampaignOverview = {
  available: boolean;
  advertiserName: string | null;
  campaigns: PortalFunnelCampaign[];
};
