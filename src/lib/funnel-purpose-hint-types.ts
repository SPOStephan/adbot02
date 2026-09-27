export type FunnelAdCategory = "standard" | "employment";

export type FunnelPurposeHint = {
  destinationUrl: string;
  title: string;
  category: FunnelAdCategory;
};
