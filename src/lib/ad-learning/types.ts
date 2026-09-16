export type AdLearningPlatform =
  | "meta"
  | "openai_ads"
  | "google"
  | "tiktok"
  | "linkedin"
  | "other";

export type AdLearningObjective =
  | "awareness"
  | "traffic"
  | "engagement"
  | "leads"
  | "sales"
  | "app_installs"
  | "retention"
  | "other";

export type InspirationPattern = {
  brandAssetId: string;
  platform: string;
  objective: string;
  industry: string;
  hookText: string;
  bodyText: string;
  whyItWorks: string;
  evidenceLevel: string;
  triggeringPrompts: string[];
  qualityRating: number;
};

export type CustomerCreativeSignal = {
  brandAssetId: string;
  trainingStatus: "marked_good" | "performance_winner";
  label: string;
};

export type TrainingGroundSignal = {
  runId: string;
  verdict: "keep" | "reject";
  platform: string;
  objective: string;
  industry: string;
  landingHostname: string;
  headline: string;
  primaryText: string;
  note: string;
};

export type AdLearningContext = {
  inspirationPatterns: InspirationPattern[];
  customerSignals: CustomerCreativeSignal[];
  trainingSignals: TrainingGroundSignal[];
};

export const EMPTY_AD_LEARNING_CONTEXT: AdLearningContext = {
  inspirationPatterns: [],
  customerSignals: [],
  trainingSignals: [],
};
