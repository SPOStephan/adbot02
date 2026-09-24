import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { fetchLandingPageContext } from "@/lib/ad-copy/page-context";
import {
  creditsFromProviderCostEur,
  estimateCopySuggestionCredits,
} from "@/lib/ad-copy/pricing";
import {
  getAdCopyProvider,
  type AdCopyIntelligenceContext,
  type AdCopyObjective,
  type AdCopySuggestion,
} from "@/lib/ad-copy/providers";
import { EMPTY_AD_LEARNING_CONTEXT } from "@/lib/ad-learning/context";
import { loadAdLearningContext } from "@/lib/ad-learning/retrieve";
import { openAiRatesFromEnv } from "@/lib/ad-copy/providers/openai";
import { togetherRatesFromEnv } from "@/lib/ad-copy/providers/together";
import {
  commitCreditReservation,
  InsufficientCreditsError,
  releaseCreditReservation,
  reserveCreditsAmount,
} from "@/lib/billing/credits";

export type SuggestAdCopyResult = {
  suggestion: AdCopySuggestion;
  billing: {
    actionKey: "creative.generate_copy_set";
    creditsCharged: number;
    providerCostEur: number;
    markup: number;
    providerKey: string;
    model: string;
  };
};

function estimateCreditsForActiveProvider(): number {
  const key = (process.env.AD_COPY_PROVIDER ?? "openai").trim().toLowerCase();
  if (key === "openai") {
    return estimateCopySuggestionCredits(openAiRatesFromEnv());
  }
  if (key === "adbot_intelligence") {
    return estimateCopySuggestionCredits(togetherRatesFromEnv());
  }
  return 5;
}

export async function suggestAdCopyForDestination(input: {
  userId: string;
  destinationUrl: string;
  objective?: AdCopyObjective;
  skipCredits?: boolean;
} & AdCopyIntelligenceContext): Promise<SuggestAdCopyResult> {
  const objective = input.objective ?? "OUTCOME_TRAFFIC";
  const page = await fetchLandingPageContext(input.destinationUrl);
  const provider = getAdCopyProvider();
  let landingHostname = "";
  try {
    landingHostname = new URL(page.url).hostname.toLowerCase();
  } catch {
    landingHostname = "";
  }

  const estimatedCredits = estimateCreditsForActiveProvider();
  const idempotencyKey = createHash("sha256")
    .update(
      [
        "ad-copy-suggest",
        input.userId,
        page.url,
        objective,
        randomUUID(),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 64);

  let reservation: {
    provider: "legacy" | "waizr";
    reservationId: string;
    amount: number;
  } | null = null;
  if (!input.skipCredits) {
    try {
      reservation = await reserveCreditsAmount({
        userId: input.userId,
        actionKey: "creative.generate_copy_set",
        amount: estimatedCredits,
        idempotencyKey,
        referenceType: "ad_copy_suggest",
      });
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        throw error;
      }
      throw error;
    }
  }

  try {
    const learning = await loadAdLearningContext({
      userId: input.userId,
      platform: input.platform ?? "meta",
      objective,
      industry: input.industry,
      landingHostname,
    }).catch(() => EMPTY_AD_LEARNING_CONTEXT);
    console.info("ad_learning_copy_context", {
      inspiration: learning.inspirationPatterns.length,
      customerSignals: learning.customerSignals.length,
      trainingSignals: learning.trainingSignals.length,
    });

    const generated = await provider.generate({
      page,
      objective,
      platform: input.platform,
      market: input.market,
      language: input.language,
      industry: input.industry,
      brandName: input.brandName,
      offer: input.offer,
      audience: input.audience,
      brandAssets: input.brandAssets,
      learning,
    });
    const actualCredits = creditsFromProviderCostEur(generated.costEur, 5);

    if (reservation && actualCredits > reservation.amount) {
      throw new Error(
        "Die KI-Kosten lagen über der Credit-Reserve. Bitte erneut versuchen.",
      );
    }

    if (reservation) {
      await commitCreditReservation({
        userId: input.userId,
        reservationId: reservation.reservationId,
        provider: reservation.provider,
      });
    }

    return {
      suggestion: generated.suggestion,
      billing: {
        actionKey: "creative.generate_copy_set",
        creditsCharged: reservation?.amount ?? 0,
        providerCostEur: Number(generated.costEur.toFixed(6)),
        markup: 1.5,
        providerKey: generated.providerKey,
        model: generated.model,
      },
    };
  } catch (error) {
    try {
      if (reservation) {
        await releaseCreditReservation({
          userId: input.userId,
          reservationId: reservation.reservationId,
          provider: reservation.provider,
        });
      }
    } catch (releaseError) {
      console.error("ad_copy_credit_release_failed", {
        reservationId: reservation?.reservationId ?? null,
        message:
          releaseError instanceof Error
            ? releaseError.message
            : "release_failed",
      });
    }
    throw error;
  }
}
