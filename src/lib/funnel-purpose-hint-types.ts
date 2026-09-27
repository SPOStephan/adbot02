export type FunnelAdCategory = "standard" | "employment";

export type FunnelPurposeHint = {
  destinationUrl: string;
  title: string;
  category: FunnelAdCategory;
  metaTracking?: {
    enabled: boolean;
    pixelId: string;
    eventName: string;
  };
};
