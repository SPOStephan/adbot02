import "server-only";

import {
  adIntelligenceSystemPrompt,
  AD_INTELLIGENCE_CONTRACT_VERSION,
  assertAdIntelligencePackage,
  serializeAdIntelligenceBrief,
  type AdIntelligenceObjective,
  type AdIntelligencePackage,
} from "@/lib/ad-intelligence/contract";
import { adaptAdIntelligencePackage } from "@/lib/ad-intelligence/adapters";
import {
  providerCostEur,
  type ModelEurRates,
} from "@/lib/ad-copy/pricing";
import type {
  AdCopyProvider,
  AdCopyProviderResult,
} from "@/lib/ad-copy/providers/types";

const TOGETHER_INFERENCE_BASE_URL =
  "https://api-inference.together.ai/v1";

type TogetherConfig = {
  apiKey: string;
  model: string;
  rates: ModelEurRates;
};

function objectiveFor(
  value: "OUTCOME_TRAFFIC" | "OUTCOME_LEADS",
): AdIntelligenceObjective {
  return value === "OUTCOME_LEADS" ? "leads" : "traffic";
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return "";
      const record = item as Record<string, unknown>;
      return record.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .join("");
}

function parsePackage(raw: string): AdIntelligencePackage {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return assertAdIntelligencePackage(
    JSON.parse(fenced?.[1]?.trim() || trimmed) as unknown,
  );
}

export function createTogetherAdCopyProvider(
  config: TogetherConfig,
): AdCopyProvider {
  return {
    key: "adbot_intelligence",
    async generate(input): Promise<AdCopyProviderResult> {
      const response = await fetch(
        `${TOGETHER_INFERENCE_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.35,
            max_tokens: 2_500,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: adIntelligenceSystemPrompt() },
              {
                role: "user",
                content: serializeAdIntelligenceBrief({
                  contractVersion: AD_INTELLIGENCE_CONTRACT_VERSION,
                  platform: input.platform ?? "meta",
                  industry:
                    input.industry ?? "Aus der Landingpage ableiten",
                  objective: objectiveFor(input.objective),
                  funnelStage:
                    input.objective === "OUTCOME_LEADS"
                      ? "conversion"
                      : "consideration",
                  market:
                    input.market ??
                    "Aus Zielseite und Kampagnenkontext ableiten",
                  language:
                    input.language ?? "Sprache der Zielseite verwenden",
                  brandName:
                    input.brandName ??
                    (input.page.title || "Werbetreibender"),
                  offer:
                    input.offer ??
                    (input.page.description ||
                      input.page.excerpt ||
                      "Angebot der Landingpage"),
                  audience:
                    input.audience ??
                    "Menschen mit einer zur Landingpage passenden Informations- oder Kaufabsicht",
                  landingPageUrl: input.page.url,
                  landingPageTitle: input.page.title,
                  landingPageDescription: input.page.description,
                  landingPageExcerpt: input.page.excerpt,
                  requiredFacts: [
                    "Nur Aussagen verwenden, die aus den Landingpage-Inhalten hervorgehen.",
                  ],
                  forbiddenClaims: [
                    "Keine Garantien, Marktführerschaft, Preise oder Rabatte ohne Beleg.",
                    "Keine sensiblen persönlichen Eigenschaften unterstellen.",
                  ],
                  brandAssets: input.brandAssets ?? [],
                  assetPolicy: "reuse_first_then_generate_missing",
                }),
              },
            ],
          }),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(45_000),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        throw new Error(
          `Adbot-Intelligence-Anfrage fehlgeschlagen (HTTP ${response.status}).`,
        );
      }

      const choices = Array.isArray(payload.choices) ? payload.choices : [];
      const first = choices[0] as Record<string, unknown> | undefined;
      const message = first?.message as Record<string, unknown> | undefined;
      const content = textContent(message?.content);
      if (!content) {
        throw new Error("Adbot Intelligence lieferte keine Ausgabe.");
      }
      const generated = parsePackage(content);
      if (generated.platform !== (input.platform ?? "meta")) {
        throw new Error("Adbot Intelligence lieferte die falsche Plattform.");
      }
      const adapted = adaptAdIntelligencePackage(generated, {
        destinationUrl: input.page.url,
        brandName: input.page.title || "Werbetreibender",
      });
      if (adapted.platform !== "meta") {
        throw new Error(
          "Der bestehende Anzeigenkopie-Endpunkt unterstützt derzeit nur den Meta-Adapter.",
        );
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
        suggestion: {
          primaryText: adapted.primaryText,
          headline: adapted.headline,
          description: adapted.description,
        },
        usage,
        providerKey: "adbot_intelligence",
        model: config.model,
        costEur,
      };
    },
  };
}

export function togetherRatesFromEnv(): ModelEurRates {
  const inputRaw = process.env.AD_COPY_TOGETHER_INPUT_EUR_PER_MTOK?.trim();
  const outputRaw = process.env.AD_COPY_TOGETHER_OUTPUT_EUR_PER_MTOK?.trim();
  if (!inputRaw || !outputRaw) {
    throw new Error(
      "Together-Kostenallokation fehlt. Beide EUR/MTok-Werte müssen vor Aktivierung gesetzt werden.",
    );
  }
  const input = Number(inputRaw);
  const output = Number(outputRaw);
  if (
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    input < 0 ||
    output < 0
  ) {
    throw new Error(
      "Together-Tokenpreise (EUR/MTok) sind ungültig konfiguriert.",
    );
  }
  return {
    inputEurPerMillionTokens: input,
    outputEurPerMillionTokens: output,
  };
}
