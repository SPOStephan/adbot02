import "server-only";

import {
  creditsFromProviderCostEur,
  providerCostEur,
  type ModelEurRates,
} from "@/lib/ad-copy/pricing";
import type {
  AdCopyProvider,
  AdCopyProviderResult,
  AdCopySuggestion,
} from "@/lib/ad-copy/providers/types";

type OpenAiConfig = {
  apiKey: string;
  model: string;
  rates: ModelEurRates;
};

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() || trimmed;
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenAI lieferte kein JSON-Objekt.");
  }
  return parsed as Record<string, unknown>;
}

function asCopyField(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeSuggestion(value: Record<string, unknown>): AdCopySuggestion {
  const primaryText = asCopyField(
    value.primaryText ?? value.primary_text ?? value.message,
    500,
  );
  const headline = asCopyField(
    value.headline ?? value.name ?? value.title,
    255,
  );
  const description = asCopyField(
    value.description ?? value.linkDescription,
    255,
  );
  if (!primaryText || !headline) {
    throw new Error("OpenAI lieferte unvollständige Anzeigentexte.");
  }
  return { primaryText, headline, description };
}

export function createOpenAiAdCopyProvider(
  config: OpenAiConfig,
): AdCopyProvider {
  return {
    key: "openai",
    async generate(input): Promise<AdCopyProviderResult> {
      const system = [
        "Du schreibst Meta-Anzeigentexte auf Deutsch.",
        "Antworte ausschließlich mit einem JSON-Objekt:",
        '{"primaryText":"...","headline":"...","description":"..."}',
        "primaryText: Anzeigentext, Ziel ca. 125 Zeichen, max. 500.",
        "headline: Überschrift, Ziel ca. 40 Zeichen, max. 255.",
        "description: optional kurz, Ziel ca. 30 Zeichen, max. 255.",
        "Kein Markdown, keine Erklärungen, keine Platzhalter.",
        "Ton: klar, konkret, werblich aber nicht marktschreierisch.",
      ].join(" ");

      const user = [
        `Werbeziel: ${input.objective}`,
        `URL: ${input.page.url}`,
        `Seitentitel: ${input.page.title || "—"}`,
        `Meta-Beschreibung: ${input.page.description || "—"}`,
        "Seitenauszug:",
        input.page.excerpt || "—",
      ].join("\n");

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.7,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        throw new Error(
          `OpenAI-Anfrage fehlgeschlagen (HTTP ${response.status}).`,
        );
      }

      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const first = choices[0] as Record<string, unknown> | undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      const content =
        typeof message?.content === "string" ? message.content : "";
      if (!content) {
        throw new Error("OpenAI lieferte keinen Text.");
      }

      const usageRaw = payload.usage as Record<string, unknown> | undefined;
      const usage = {
        inputTokens:
          typeof usageRaw?.prompt_tokens === "number"
            ? usageRaw.prompt_tokens
            : 0,
        outputTokens:
          typeof usageRaw?.completion_tokens === "number"
            ? usageRaw.completion_tokens
            : 0,
      };
      const costEur = providerCostEur(usage, config.rates);

      return {
        suggestion: normalizeSuggestion(parseJsonObject(content)),
        usage,
        providerKey: "openai",
        model: config.model,
        costEur,
      };
    },
  };
}

export function openAiRatesFromEnv(): ModelEurRates {
  const input = Number(
    process.env.AD_COPY_OPENAI_INPUT_EUR_PER_MTOK ?? "0.14",
  );
  const output = Number(
    process.env.AD_COPY_OPENAI_OUTPUT_EUR_PER_MTOK ?? "0.55",
  );
  if (
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  ) {
    throw new Error("OpenAI-Tokenpreise (EUR/MTok) sind ungültig konfiguriert.");
  }
  return {
    inputEurPerMillionTokens: input,
    outputEurPerMillionTokens: output,
  };
}

/** Exported for tests — pricing helper stays provider-agnostic. */
export function openAiCreditsForUsage(
  usage: { inputTokens: number; outputTokens: number },
  rates: ModelEurRates,
  floor = 5,
): number {
  return creditsFromProviderCostEur(providerCostEur(usage, rates), floor);
}
