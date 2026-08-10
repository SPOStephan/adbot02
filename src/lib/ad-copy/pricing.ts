import "server-only";

/** 1 Adbot-Credit = 0.01 EUR (product agreement). */
export const ADBOT_CREDIT_EUR_VALUE = 0.01;

/** Customer pays at least 1.5× real provider cost. */
export const AI_COST_MARKUP = 1.5;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ModelEurRates = {
  inputEurPerMillionTokens: number;
  outputEurPerMillionTokens: number;
};

export function providerCostEur(
  usage: TokenUsage,
  rates: ModelEurRates,
): number {
  const input =
    (Math.max(0, usage.inputTokens) / 1_000_000) *
    rates.inputEurPerMillionTokens;
  const output =
    (Math.max(0, usage.outputTokens) / 1_000_000) *
    rates.outputEurPerMillionTokens;
  return input + output;
}

/**
 * Convert provider EUR cost into Adbot credits with markup.
 * Always at least 1 credit when there was any positive cost.
 */
export function creditsFromProviderCostEur(
  costEur: number,
  floorCredits: number,
): number {
  const floored = Math.max(1, Math.trunc(floorCredits) || 1);
  if (!(costEur > 0) || !Number.isFinite(costEur)) {
    return floored;
  }
  const markedUp = costEur * AI_COST_MARKUP;
  const usageCredits = Math.ceil(markedUp / ADBOT_CREDIT_EUR_VALUE - 1e-12);
  return Math.max(floored, usageCredits);
}

/** Conservative pre-reserve for a single ad-copy suggestion. */
export function estimateCopySuggestionCredits(rates: ModelEurRates): number {
  return creditsFromProviderCostEur(
    providerCostEur(
      { inputTokens: 3_500, outputTokens: 500 },
      rates,
    ),
    5,
  );
}
