export type TrainingVerdict = "keep" | "reject";

export type TrainingRunView = {
  id: string;
  landingUrl: string;
  landingHostname: string;
  landingTitle: string;
  landingExcerpt: string;
  platform: string;
  objective: string;
  industry: string;
  tags: string[];
  brief: string;
  headline: string;
  primaryText: string;
  description: string;
  imageAssetId: string | null;
  imagePreviewUrl: string | null;
  imageError: string | null;
  verdict: TrainingVerdict | null;
  verdictNote: string;
  ratedAt: string | null;
  createdAt: string;
};

export type TrainingInbox = {
  runs: TrainingRunView[];
  ratedCount: number;
  keepCount: number;
  rejectCount: number;
  migrationNeeded: boolean;
  imageGenerationConfigured: boolean;
};
