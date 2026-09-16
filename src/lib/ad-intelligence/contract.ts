export const AD_INTELLIGENCE_CONTRACT_VERSION =
  "adbot-ad-intelligence-v1" as const;

export const AD_INTELLIGENCE_PLATFORMS = [
  "meta",
  "openai_ads",
  "google",
  "tiktok",
] as const;

export const AD_INTELLIGENCE_OBJECTIVES = [
  "awareness",
  "traffic",
  "engagement",
  "leads",
  "app_promotion",
  "sales",
] as const;

export const AD_INTELLIGENCE_FUNNEL_STAGES = [
  "awareness",
  "consideration",
  "conversion",
  "retention",
] as const;

export type AdIntelligencePlatform =
  (typeof AD_INTELLIGENCE_PLATFORMS)[number];
export type AdIntelligenceObjective =
  (typeof AD_INTELLIGENCE_OBJECTIVES)[number];
export type AdIntelligenceFunnelStage =
  (typeof AD_INTELLIGENCE_FUNNEL_STAGES)[number];

export type AdIntelligenceBrief = {
  contractVersion: typeof AD_INTELLIGENCE_CONTRACT_VERSION;
  platform: AdIntelligencePlatform;
  industry: string;
  objective: AdIntelligenceObjective;
  funnelStage: AdIntelligenceFunnelStage;
  market: string;
  language: string;
  brandName: string;
  offer: string;
  audience: string;
  landingPageUrl?: string;
  landingPageTitle?: string;
  landingPageDescription?: string;
  landingPageExcerpt?: string;
  requiredFacts: string[];
  forbiddenClaims: string[];
  brandAssets: Array<{
    kind: "logo" | "image" | "video" | "color" | "font" | "copy";
    label: string;
    reference: string;
  }>;
  assetPolicy: "reuse_first_then_generate_missing";
};

export type AdIntelligencePackage = {
  contract_version: typeof AD_INTELLIGENCE_CONTRACT_VERSION;
  platform: AdIntelligencePlatform;
  strategy: {
    audience_insight: string;
    big_idea: string;
    value_proposition: string;
    proof_angle: string;
    funnel_stage: AdIntelligenceFunnelStage;
  };
  copy: {
    primary_text: string;
    headline: string;
    description: string;
    cta: string;
    search_headlines: string[];
    search_descriptions: string[];
    video_hook: string;
    voiceover: string;
  };
  creative: {
    concept: string;
    image_prompt: string;
    visual_hierarchy: string[];
    format_notes: string;
  };
  compliance: {
    claims_to_verify: string[];
    prohibited_assumptions: string[];
  };
};

export class AdIntelligenceContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdIntelligenceContractError";
  }
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new AdIntelligenceContractError(`${field} fehlt.`);
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max) {
    throw new AdIntelligenceContractError(`${field} ist ungültig.`);
  }
  return normalized;
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new AdIntelligenceContractError(`${field} fehlt.`);
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length > max) {
    throw new AdIntelligenceContractError(`${field} ist zu lang.`);
  }
  return normalized;
}

function textArray(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new AdIntelligenceContractError(`${field} ist ungültig.`);
  }
  return value.map((item, index) =>
    requiredText(item, `${field}[${index}]`, maxLength),
  );
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdIntelligenceContractError(`${field} ist ungültig.`);
  }
  return value as Record<string, unknown>;
}

export function assertAdIntelligencePackage(
  value: unknown,
): AdIntelligencePackage {
  const root = record(value, "Antwort");
  if (root.contract_version !== AD_INTELLIGENCE_CONTRACT_VERSION) {
    throw new AdIntelligenceContractError("Unbekannte Vertragsversion.");
  }
  if (
    typeof root.platform !== "string" ||
    !AD_INTELLIGENCE_PLATFORMS.includes(
      root.platform as AdIntelligencePlatform,
    )
  ) {
    throw new AdIntelligenceContractError("Plattform ist ungültig.");
  }

  const strategy = record(root.strategy, "strategy");
  const copy = record(root.copy, "copy");
  const creative = record(root.creative, "creative");
  const compliance = record(root.compliance, "compliance");
  const funnelStage = requiredText(strategy.funnel_stage, "funnel_stage", 32);
  if (
    !AD_INTELLIGENCE_FUNNEL_STAGES.includes(
      funnelStage as AdIntelligenceFunnelStage,
    )
  ) {
    throw new AdIntelligenceContractError("funnel_stage ist ungültig.");
  }

  return {
    contract_version: AD_INTELLIGENCE_CONTRACT_VERSION,
    platform: root.platform as AdIntelligencePlatform,
    strategy: {
      audience_insight: requiredText(
        strategy.audience_insight,
        "audience_insight",
        600,
      ),
      big_idea: requiredText(strategy.big_idea, "big_idea", 300),
      value_proposition: requiredText(
        strategy.value_proposition,
        "value_proposition",
        500,
      ),
      proof_angle: requiredText(strategy.proof_angle, "proof_angle", 500),
      funnel_stage: funnelStage as AdIntelligenceFunnelStage,
    },
    copy: {
      primary_text: boundedText(copy.primary_text, "primary_text", 1200),
      headline: boundedText(copy.headline, "headline", 300),
      description: boundedText(copy.description, "description", 500),
      cta: boundedText(copy.cta, "cta", 100),
      search_headlines: textArray(
        copy.search_headlines,
        "search_headlines",
        15,
        100,
      ),
      search_descriptions: textArray(
        copy.search_descriptions,
        "search_descriptions",
        4,
        200,
      ),
      video_hook: boundedText(copy.video_hook, "video_hook", 300),
      voiceover: boundedText(copy.voiceover, "voiceover", 1200),
    },
    creative: {
      concept: requiredText(creative.concept, "concept", 800),
      image_prompt: boundedText(creative.image_prompt, "image_prompt", 1800),
      visual_hierarchy: textArray(
        creative.visual_hierarchy,
        "visual_hierarchy",
        8,
        200,
      ),
      format_notes: requiredText(creative.format_notes, "format_notes", 600),
    },
    compliance: {
      claims_to_verify: textArray(
        compliance.claims_to_verify,
        "claims_to_verify",
        12,
        300,
      ),
      prohibited_assumptions: textArray(
        compliance.prohibited_assumptions,
        "prohibited_assumptions",
        12,
        300,
      ),
    },
  };
}

export function adIntelligenceSystemPrompt(): string {
  return [
    "Du bist der plattformübergreifende Adbot-Kreativkern.",
    `Antworte ausschließlich als JSON nach ${AD_INTELLIGENCE_CONTRACT_VERSION}.`,
    "Entwickle eine belegbare Werbestrategie, keine erfundenen Produktfakten.",
    "Nutze nur Fakten aus dem Briefing und kennzeichne zu prüfende Claims.",
    "Erzeuge eigenständige Formulierungen ohne reale Marken, Slogans oder Vorlagen nachzuahmen.",
    "Ein optionaler Lernkontext liefert interne Muster und First-Party-Signale — abstrahieren, nicht kopieren, keine Performance aus Fremdanzeigen ableiten.",
    "Verwende freigegebene Brand-Assets zuerst und plane neue Assets nur für fehlende Formate.",
    "Passe Copy, Format und Creative-Brief an die Zielplattform an.",
    "Alle Felder des Vertrags müssen vorhanden sein; nicht benötigte Listen bleiben leer.",
  ].join(" ");
}

export function serializeAdIntelligenceBrief(
  brief: AdIntelligenceBrief,
): string {
  return JSON.stringify(
    {
      contract_version: brief.contractVersion,
      platform: brief.platform,
      industry: brief.industry,
      objective: brief.objective,
      funnel_stage: brief.funnelStage,
      market: brief.market,
      language: brief.language,
      brand_name: brief.brandName,
      offer: brief.offer,
      audience: brief.audience,
      landing_page: {
        url: brief.landingPageUrl ?? null,
        title: brief.landingPageTitle ?? null,
        description: brief.landingPageDescription ?? null,
        excerpt: brief.landingPageExcerpt ?? null,
      },
      required_facts: brief.requiredFacts,
      forbidden_claims: brief.forbiddenClaims,
      brand_assets: brief.brandAssets,
      asset_policy: brief.assetPolicy,
    },
    null,
    2,
  );
}
