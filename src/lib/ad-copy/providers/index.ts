import "server-only";

import { createOpenAiAdCopyProvider, openAiRatesFromEnv } from "./openai";
import type { AdCopyProvider } from "./types";

export type { AdCopyObjective, AdCopyProvider, AdCopySuggestion } from "./types";

/**
 * Resolve the active ad-copy provider. Switch via AD_COPY_PROVIDER.
 * No provider SDK is imported outside its adapter.
 */
export function getAdCopyProvider(): AdCopyProvider {
  const key = (process.env.AD_COPY_PROVIDER ?? "openai").trim().toLowerCase();

  if (key === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY fehlt. Textvorschläge sind noch nicht konfiguriert.",
      );
    }
    return createOpenAiAdCopyProvider({
      apiKey,
      model: (process.env.AD_COPY_OPENAI_MODEL ?? "gpt-4o-mini").trim(),
      rates: openAiRatesFromEnv(),
    });
  }

  throw new Error(
    `Unbekannter AD_COPY_PROVIDER „${key}“. Erlaubt derzeit: openai.`,
  );
}

export function getActiveAdCopyProviderKey(): string {
  return (process.env.AD_COPY_PROVIDER ?? "openai").trim().toLowerCase();
}
