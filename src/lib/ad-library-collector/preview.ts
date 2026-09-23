import {
  EMPTY_AD_LEARNING_CONTEXT,
  EMPTY_INSPIRATION_CORPUS_CENSUS,
  type AdLearningContext,
  type InspirationCorpusCensus,
  type InspirationPattern,
} from "@/lib/ad-learning/types";
import { formatAdLearningPromptBlock, scoreInspirationMatch } from "@/lib/ad-learning/context";
import { scoreCollectorDraft } from "./normalize";
import type {
  CollectorItemView,
  CollectorMemoryPreview,
} from "./types";

export function buildCollectorMemoryPreview(input: {
  platform?: string;
  objective?: string;
  industry?: string;
  livePatterns: InspirationPattern[];
  stagedItems: CollectorItemView[];
  census?: InspirationCorpusCensus;
}): CollectorMemoryPreview {
  const query = {
    platform: (input.platform ?? "").trim(),
    objective: (input.objective ?? "").trim(),
    industry: (input.industry ?? "").trim(),
  };

  const liveMatches = input.livePatterns
    .map((pattern) => ({
      brandAssetId: pattern.brandAssetId,
      platform: pattern.platform,
      objective: pattern.objective,
      industry: pattern.industry,
      hookText: pattern.hookText,
      bodyText: pattern.bodyText,
      evidenceLevel: pattern.evidenceLevel,
      qualityRating: pattern.qualityRating,
      score: scoreInspirationMatch(pattern, query),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const sandboxMatches = input.stagedItems
    .filter((item) => item.status !== "rejected" && item.status !== "imported")
    .map((item) => ({
      id: item.id,
      status: item.status,
      provider: item.provider,
      title: item.title,
      platform: item.platform,
      objective: item.objective,
      industry: item.industry,
      hookText: item.hookText,
      bodyText: item.bodyText,
      score: scoreCollectorDraft(item, query),
      wouldEnterLiveMemory: item.status === "ready_for_import",
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const liveContext: AdLearningContext = {
    inspirationPatterns: input.livePatterns.slice(0, 5),
    customerSignals: [],
    trainingSignals: [],
  };

  const mergedPatterns: InspirationPattern[] = [
    ...input.livePatterns,
    ...input.stagedItems
      .filter((item) => item.status === "ready_for_import")
      .map((item) => ({
        brandAssetId: `sandbox:${item.id}`,
        platform: item.platform,
        objective: item.objective,
        industry: item.industry,
        hookText: item.hookText,
        bodyText: item.bodyText,
        whyItWorks: item.whyItWorks,
        evidenceLevel: item.evidenceLevel,
        triggeringPrompts: [],
        qualityRating: item.qualityRating,
        tags: item.tags ?? [],
        structureKind: "none",
        structureSlots: [],
      })),
  ]
    .map((pattern) => ({ pattern, score: scoreInspirationMatch(pattern, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.pattern);

  return {
    query,
    census: input.census ?? EMPTY_INSPIRATION_CORPUS_CENSUS,
    livePromptBlock: formatAdLearningPromptBlock(liveContext),
    liveMatches,
    sandboxMatches,
    mergedPromptIfImported: formatAdLearningPromptBlock({
      inspirationPatterns: mergedPatterns,
      customerSignals: [],
      trainingSignals: [],
    }),
  };
}

export function emptyCollectorMemoryPreview(query: {
  platform?: string;
  objective?: string;
  industry?: string;
}): CollectorMemoryPreview {
  return {
    query: {
      platform: query.platform ?? "",
      objective: query.objective ?? "",
      industry: query.industry ?? "",
    },
    census: EMPTY_INSPIRATION_CORPUS_CENSUS,
    livePromptBlock: formatAdLearningPromptBlock(EMPTY_AD_LEARNING_CONTEXT),
    liveMatches: [],
    sandboxMatches: [],
    mergedPromptIfImported: "",
  };
}
