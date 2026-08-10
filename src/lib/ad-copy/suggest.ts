import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { fetchLandingPageContext } from "@/lib/ad-copy/page-context";
import {
  creditsFromProviderCostEur,
  estimateCopySuggestionCredits,
} from "@/lib/ad-copy/pricing";
import {
  getAdCopyProvider,
  type AdCopyObjective,
  type AdCopySuggestion,
} from "@/lib/ad-copy/providers";
import { openAiRatesFromEnv } from "@/lib/ad-copy/providers/openai";
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
  return 5;
}

export async function suggestAdCopyForDestination(input: {
  userId: string;
  destinationUrl: string;
  objective?: AdCopyObjective;
}): Promise<SuggestAdCopyResult> {
  const objective = input.objective ?? "OUTCOME_TRAFFIC";
  const page = await fetchLandingPageContext(input.destinationUrl);
  const provider = getAdCopyProvider();

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

  let reservation;
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

  try {
    const generated = await provider.generate({ page, objective });
    const actualCredits = creditsFromProviderCostEur(generated.costEur, 5);

    // Prepaid estimate may be higher than actual; we keep the reserved amount
    // (never undercharge). If actual exceeds reserve, refuse to return unpaid work.
    if (actualCredits > reservation.amount) {
      throw new Error(
        "Die KI-Kosten lagen über der Credit-Reserve. Bitte erneut versuchen.",
      );
    }

    await commitCreditReservation({
      userId: input.userId,
      reservationId: reservation.reservationId,
    });

    return {
      suggestion: generated.suggestion,
      billing: {
        actionKey: "creative.generate_copy_set",
        creditsCharged: reservation.amount,
        providerCostEur: Number(generated.costEur.toFixed(6)),
        markup: 1.5,
        providerKey: generated.providerKey,
        model: generated.model,
      },
    };
  } catch (error) {
    try {
      await releaseCreditReservation({
        userId: input.userId,
        reservationId: reservation.reservationId,
      });
    } catch (releaseError) {
      console.error("ad_copy_credit_release_failed", {
        reservationId: reservation.reservationId,
        message:
          releaseError instanceof Error
            ? releaseError.message
            : "release_failed",
      });
    }
    throw error;
  }
}
