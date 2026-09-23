import type { InspirationCorpusCensus } from "@/lib/ad-learning/types";

export const COLLECTOR_PROVIDERS = [
  { value: "manual", label: "Manuell / Sandbox" },
  { value: "chatgpt_ad_library", label: "ChatGPT Ad Library" },
  { value: "meta", label: "Meta Ad Library" },
  { value: "google", label: "Google Transparency" },
  { value: "tiktok", label: "TikTok Commercial Content" },
] as const;

export const COLLECTOR_STATUSES = [
  { value: "fetched", label: "Eingegangen" },
  { value: "reviewed", label: "Geprüft" },
  { value: "ready_for_import", label: "Bereit für Vault" },
  { value: "imported", label: "Im Vault" },
  { value: "rejected", label: "Verworfen" },
  { value: "failed", label: "Fehler" },
] as const;

export type CollectorProvider = (typeof COLLECTOR_PROVIDERS)[number]["value"];
export type CollectorStatus = (typeof COLLECTOR_STATUSES)[number]["value"];

export type CollectorDraft = {
  provider: CollectorProvider;
  externalId: string;
  collectorBatchId: string | null;
  platform: string;
  sourceKind: string;
  sourceUrl: string | null;
  imageUrl: string | null;
  imageHash: string | null;
  title: string;
  advertiserName: string;
  industry: string;
  objective: string;
  objectiveDetail: string;
  funnelStage: string;
  evidenceLevel: string;
  rightsBasis: string;
  rightsConfirmed: boolean;
  format: string;
  country: string;
  language: string;
  hookText: string;
  bodyText: string;
  ctaText: string;
  landingPageUrl: string | null;
  performanceNote: string;
  whyItWorks: string;
  tags: string[];
  qualityRating: number;
  useForGeneration: boolean;
  rawPayload: Record<string, unknown>;
};

export type CollectorItemView = CollectorDraft & {
  id: string;
  status: CollectorStatus;
  imageStorageBucket: string | null;
  imageStoragePath: string | null;
  brandAssetId: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  hasImage: boolean;
};

export type CollectorCounts = {
  fetched: number;
  reviewed: number;
  ready_for_import: number;
  imported: number;
  rejected: number;
  failed: number;
  total: number;
};

export type CollectorInbox = {
  items: CollectorItemView[];
  counts: CollectorCounts;
  lastBatchId: string | null;
  migrationNeeded: boolean;
};

export type CollectorMemoryPreview = {
  query: { platform: string; objective: string; industry: string };
  census: InspirationCorpusCensus;
  livePromptBlock: string;
  liveMatches: Array<{
    brandAssetId: string;
    platform: string;
    objective: string;
    industry: string;
    hookText: string;
    bodyText: string;
    evidenceLevel: string;
    qualityRating: number;
    score: number;
  }>;
  sandboxMatches: Array<{
    id: string;
    status: CollectorStatus;
    provider: CollectorProvider;
    title: string;
    platform: string;
    objective: string;
    industry: string;
    hookText: string;
    bodyText: string;
    score: number;
    wouldEnterLiveMemory: boolean;
  }>;
  mergedPromptIfImported: string;
};

export const EMPTY_COLLECTOR_COUNTS: CollectorCounts = {
  fetched: 0,
  reviewed: 0,
  ready_for_import: 0,
  imported: 0,
  rejected: 0,
  failed: 0,
  total: 0,
};

export const COLLECTOR_IMPORT_BATCH_MAX = 10;
