import {
  AD_EXAMPLE_EVIDENCE_LEVELS,
  AD_EXAMPLE_FUNNEL_STAGES,
  AD_EXAMPLE_OBJECTIVES,
  AD_EXAMPLE_PLATFORMS,
  AD_EXAMPLE_RIGHTS_BASES,
  AD_EXAMPLE_SOURCE_KINDS,
  type AdExampleInput,
} from "@/lib/ad-examples/types";

export class AdExampleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdExampleInputError";
  }
}

function text(value: unknown, field: string, max: number, required = false): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new AdExampleInputError(`${field} fehlt.`);
  if (normalized.length > max) {
    throw new AdExampleInputError(`${field} ist länger als ${max} Zeichen.`);
  }
  return normalized;
}

function enumValue<T extends string>(
  value: unknown,
  field: string,
  options: readonly { value: T }[],
): T {
  if (typeof value !== "string" || !options.some((option) => option.value === value)) {
    throw new AdExampleInputError(`${field} ist ungültig.`);
  }
  return value as T;
}

function optionalPublicUrl(value: unknown, field: string): string | null {
  const normalized = text(value, field, 2048);
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new AdExampleInputError(`${field} ist keine gültige URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new AdExampleInputError(`${field} muss eine öffentliche HTTPS-URL sein.`);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new AdExampleInputError(`${field} darf nicht auf ein internes Ziel zeigen.`);
  }
  url.hash = "";
  return url.toString();
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

function tags(value: unknown): string[] {
  const source = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return [...new Set(source.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))]
    .slice(0, 12)
    .map((item) => item.slice(0, 40));
}

export function parseAdExampleInput(source: Record<string, unknown>): AdExampleInput {
  const rightsConfirmed = booleanValue(source.rightsConfirmed);
  if (!rightsConfirmed) {
    throw new AdExampleInputError(
      "Bitte bestätige, dass das Material rechtmäßig als interne Referenz gespeichert werden darf.",
    );
  }
  const rating = Number(source.qualityRating ?? 3);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AdExampleInputError("Qualitätsbewertung muss zwischen 1 und 5 liegen.");
  }

  const sourceKind = enumValue(source.sourceKind, "Quellentyp", AD_EXAMPLE_SOURCE_KINDS);
  const sourceUrl = optionalPublicUrl(source.sourceUrl, "Quelllink");
  if (
    (sourceKind === "official_library" || sourceKind === "advertiser_page") &&
    !sourceUrl
  ) {
    throw new AdExampleInputError(
      "Für eine offizielle Bibliothek oder Werbetreibendenseite ist ein Quelllink erforderlich.",
    );
  }
  const evidenceLevel = enumValue(
    source.evidenceLevel,
    "Evidenzniveau",
    AD_EXAMPLE_EVIDENCE_LEVELS,
  );
  const performanceNote = text(
    source.performanceNote,
    "Performance-Hinweis",
    1000,
  );
  if (evidenceLevel === "visual_only" && performanceNote) {
    throw new AdExampleInputError(
      "Bei rein visueller Evidenz dürfen keine Performancewerte hinterlegt werden.",
    );
  }

  return {
    title: text(source.title, "Titel", 120, true),
    advertiserName: text(source.advertiserName, "Werbetreibender", 120, true),
    platform: enumValue(source.platform, "Plattform", AD_EXAMPLE_PLATFORMS),
    industry: text(source.industry, "Branche", 100, true),
    objective: enumValue(source.objective, "Werbeziel", AD_EXAMPLE_OBJECTIVES),
    objectiveDetail: text(source.objectiveDetail, "Zieldefinition", 600, true),
    funnelStage: enumValue(source.funnelStage, "Funnel-Stufe", AD_EXAMPLE_FUNNEL_STAGES),
    sourceKind,
    sourceUrl,
    evidenceLevel,
    rightsBasis: enumValue(source.rightsBasis, "Rechtebasis", AD_EXAMPLE_RIGHTS_BASES),
    rightsConfirmed: true,
    format: text(source.format, "Format", 80, true),
    country: text(source.country, "Land / Markt", 80, true),
    language: text(source.language, "Sprache", 60, true),
    hookText: text(source.hookText, "Hook", 500),
    bodyText: text(source.bodyText, "Anzeigentext", 2000),
    ctaText: text(source.ctaText, "CTA", 120),
    landingPageUrl: optionalPublicUrl(source.landingPageUrl, "Landingpage"),
    performanceNote,
    whyItWorks: text(source.whyItWorks, "Warum funktioniert es?", 1500),
    tags: tags(source.tags),
    qualityRating: rating,
    useForGeneration: booleanValue(source.useForGeneration),
  };
}

export function adExampleMetadata(input: AdExampleInput): Record<string, unknown> {
  return {
    contract_version: 2,
    library: "ad_example_library",
    source_kind: input.sourceKind,
    never_launch: true,
    ad_example: {
      title: input.title,
      advertiser_name: input.advertiserName,
      platform: input.platform,
      industry: input.industry,
      objective: input.objective,
      objective_detail: input.objectiveDetail,
      funnel_stage: input.funnelStage,
      source_kind: input.sourceKind,
      source_url: input.sourceUrl,
      evidence_level: input.evidenceLevel,
      rights_basis: input.rightsBasis,
      rights_confirmed: input.rightsConfirmed,
      format: input.format,
      country: input.country,
      language: input.language,
      hook_text: input.hookText,
      body_text: input.bodyText,
      cta_text: input.ctaText,
      landing_page_url: input.landingPageUrl,
      performance_note: input.performanceNote,
      why_it_works: input.whyItWorks,
      tags: input.tags,
      quality_rating: input.qualityRating,
      use_for_generation: input.useForGeneration,
    },
  };
}
