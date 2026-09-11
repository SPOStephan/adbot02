import "server-only";

import type { LandingPageContext } from "@/lib/ad-copy/page-context";
import type { TokenUsage } from "@/lib/ad-copy/pricing";
import type { AdIntelligencePlatform } from "@/lib/ad-intelligence/contract";

export type AdCopyObjective = "OUTCOME_TRAFFIC" | "OUTCOME_LEADS";

export type AdCopySuggestion = {
  primaryText: string;
  headline: string;
  description: string;
};

export type AdCopyProviderResult = {
  suggestion: AdCopySuggestion;
  usage: TokenUsage;
  providerKey: string;
  model: string;
  costEur: number;
};

export type AdCopyIntelligenceContext = {
  platform?: AdIntelligencePlatform;
  market?: string;
  language?: string;
  industry?: string;
  brandName?: string;
  offer?: string;
  audience?: string;
  brandAssets?: Array<{
    kind: "logo" | "image" | "video" | "color" | "font" | "copy";
    label: string;
    reference: string;
  }>;
};

export type AdCopyProvider = {
  key: string;
  generate(
    input: {
      page: LandingPageContext;
      objective: AdCopyObjective;
    } & AdCopyIntelligenceContext,
  ): Promise<AdCopyProviderResult>;
};
