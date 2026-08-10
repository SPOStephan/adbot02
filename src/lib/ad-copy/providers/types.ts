import "server-only";

import type { LandingPageContext } from "@/lib/ad-copy/page-context";
import type { TokenUsage } from "@/lib/ad-copy/pricing";

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

export type AdCopyProvider = {
  key: string;
  generate(input: {
    page: LandingPageContext;
    objective: AdCopyObjective;
  }): Promise<AdCopyProviderResult>;
};
