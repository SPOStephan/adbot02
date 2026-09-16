import { parseAdExampleInput } from "@/lib/ad-examples/input";
import type { AdExampleInput } from "@/lib/ad-examples/types";
import { scoreInspirationMatch } from "@/lib/ad-learning/context";
import type {
  CollectorDraft,
  CollectorProvider,
  CollectorStatus,
} from "./types";

export class CollectorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectorInputError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return undefined;
}

function text(value: unknown, max: number, fallback = ""): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (normalized || fallback).slice(0, max);
}

function optionalHttpsUrl(value: unknown, field: string): string | null {
  const raw = text(value, 2048);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CollectorInputError(`${field} ist keine gültige URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new CollectorInputError(`${field} muss eine öffentliche HTTPS-URL sein.`);
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
    throw new CollectorInputError(`${field} darf nicht auf ein internes Ziel zeigen.`);
  }
  url.hash = "";
  return url.toString();
}

const PROVIDERS: readonly CollectorProvider[] = [
  "manual",
  "chatgpt_ad_library",
  "meta",
  "google",
  "tiktok",
];

export function slugExternalId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "item";
}

export function normalizeCollectorDraft(source: unknown): CollectorDraft {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new CollectorInputError("Datensatz muss ein Objekt sein.");
  }
  const row = record(source);
  const nested = record(pick(row, "example", "ad_example"));
  const merged = { ...nested, ...row };

  const providerRaw = text(pick(merged, "provider"), 40, "manual");
  if (!PROVIDERS.includes(providerRaw as CollectorProvider)) {
    throw new CollectorInputError("Unbekannter Collector-Provider.");
  }
  const provider = providerRaw as CollectorProvider;

  const title = text(pick(merged, "title"), 120);
  const advertiserName = text(pick(merged, "advertiserName", "advertiser_name"), 120);
  if (!title) throw new CollectorInputError("Titel fehlt.");
  if (!advertiserName) throw new CollectorInputError("Werbetreibender fehlt.");

  const externalId = text(
    pick(merged, "externalId", "external_id", "id"),
    160,
    provider === "manual" ? `manual-${slugExternalId(`${advertiserName}-${title}`)}` : "",
  );
  if (!externalId) {
    throw new CollectorInputError("external_id fehlt.");
  }

  const sourceKind = text(
    pick(merged, "sourceKind", "source_kind"),
    40,
    provider === "manual" ? "user_upload" : "official_library",
  );
  const evidenceLevel = text(
    pick(merged, "evidenceLevel", "evidence_level"),
    40,
    provider === "manual" ? "visual_only" : "public_transparency",
  );
  const rightsBasis = text(
    pick(merged, "rightsBasis", "rights_basis"),
    40,
    "reference_only",
  );
  if (provider !== "manual") {
    if (evidenceLevel === "first_party_performance") {
      throw new CollectorInputError(
        "Fremde Library-Ads dürfen kein First-Party-Leistungsniveau tragen.",
      );
    }
    if (rightsBasis !== "reference_only") {
      throw new CollectorInputError("Collector-Ads bleiben reference_only.");
    }
  }

  const useForGeneration =
    provider === "manual" &&
    (merged.useForGeneration === true ||
      merged.use_for_generation === true ||
      merged.useForGeneration === "true" ||
      merged.use_for_generation === "true" ||
      merged.useForGeneration === "on");

  const tagsSource = pick(merged, "tags");
  const tags = Array.isArray(tagsSource)
    ? tagsSource.filter((item): item is string => typeof item === "string")
    : typeof tagsSource === "string"
      ? tagsSource.split(",")
      : [];

  const rating = Number(pick(merged, "qualityRating", "quality_rating") ?? 3);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new CollectorInputError("Qualitätsbewertung muss zwischen 1 und 5 liegen.");
  }

  return {
    provider,
    externalId,
    collectorBatchId: text(pick(merged, "collectorBatchId", "collector_batch_id"), 80) || null,
    platform: text(pick(merged, "platform"), 40, "other"),
    sourceKind,
    sourceUrl: optionalHttpsUrl(pick(merged, "sourceUrl", "source_url"), "Quelllink"),
    imageUrl: optionalHttpsUrl(pick(merged, "imageUrl", "image_url"), "Bild-URL"),
    imageHash: text(pick(merged, "imageHash", "image_hash"), 128) || null,
    title,
    advertiserName,
    industry: text(pick(merged, "industry"), 100, "Nicht klassifiziert"),
    objective: text(pick(merged, "objective"), 40, "other"),
    objectiveDetail: text(
      pick(merged, "objectiveDetail", "objective_detail"),
      600,
      "Interne Staging-Referenz.",
    ),
    funnelStage: text(pick(merged, "funnelStage", "funnel_stage"), 40, "conversion"),
    evidenceLevel,
    rightsBasis,
    rightsConfirmed:
      merged.rightsConfirmed === true ||
      merged.rights_confirmed === true ||
      merged.rightsConfirmed === "true" ||
      merged.rights_confirmed === "true" ||
      merged.rightsConfirmed === "on" ||
      provider !== "manual",
    format: text(pick(merged, "format"), 80, "Bildanzeige"),
    country: text(pick(merged, "country"), 80, "Deutschland"),
    language: text(pick(merged, "language"), 60, "Deutsch"),
    hookText: text(pick(merged, "hookText", "hook_text"), 500),
    bodyText: text(pick(merged, "bodyText", "body_text"), 2000),
    ctaText: text(pick(merged, "ctaText", "cta_text"), 120),
    landingPageUrl: optionalHttpsUrl(
      pick(merged, "landingPageUrl", "landing_page_url"),
      "Landingpage",
    ),
    performanceNote: text(pick(merged, "performanceNote", "performance_note"), 1000),
    whyItWorks: text(pick(merged, "whyItWorks", "why_it_works"), 1500),
    tags: [...new Set(tags.map((item) => item.trim().toLowerCase()).filter(Boolean))]
      .slice(0, 12)
      .map((item) => item.slice(0, 40)),
    qualityRating: rating,
    useForGeneration,
    rawPayload: record(pick(merged, "raw", "raw_payload") ?? merged),
  };
}

export function collectorDraftHasUsableCopy(draft: CollectorDraft): boolean {
  return Boolean(draft.hookText || draft.bodyText || draft.whyItWorks);
}

export function collectorDraftToAdExampleInput(draft: CollectorDraft): AdExampleInput {
  return parseAdExampleInput({
    title: draft.title,
    advertiserName: draft.advertiserName,
    platform: draft.platform,
    industry: draft.industry,
    objective: draft.objective,
    objectiveDetail: draft.objectiveDetail,
    funnelStage: draft.funnelStage,
    sourceKind: draft.sourceKind,
    sourceUrl: draft.sourceUrl,
    evidenceLevel: draft.evidenceLevel,
    rightsBasis: draft.rightsBasis,
    rightsConfirmed: true,
    format: draft.format,
    country: draft.country,
    language: draft.language,
    hookText: draft.hookText,
    bodyText: draft.bodyText,
    ctaText: draft.ctaText,
    landingPageUrl: draft.landingPageUrl,
    performanceNote: draft.performanceNote,
    whyItWorks: draft.whyItWorks,
    tags: draft.tags,
    qualityRating: draft.qualityRating,
    useForGeneration: draft.useForGeneration,
  });
}

export function assertReadyForImport(input: {
  draft: CollectorDraft;
  hasImage: boolean;
}): void {
  if (!input.draft.rightsConfirmed && input.draft.provider === "manual") {
    throw new CollectorInputError(
      "Bitte Rechtebestätigung setzen, bevor der Eintrag in den Vault darf.",
    );
  }
  if (!collectorDraftHasUsableCopy(input.draft)) {
    throw new CollectorInputError(
      "Für den Vault braucht der Eintrag Hook, Anzeigentext oder eine Begründung.",
    );
  }
  if (!input.hasImage && !input.draft.imageUrl) {
    throw new CollectorInputError(
      "Für den Vault braucht der Eintrag ein Bild (Upload oder HTTPS-Bild-URL).",
    );
  }
  collectorDraftToAdExampleInput(input.draft);
}

export function scoreCollectorDraft(
  draft: Pick<CollectorDraft, "platform" | "objective" | "industry" | "qualityRating">,
  query: { platform?: string; objective?: string; industry?: string },
): number {
  return scoreInspirationMatch(
    {
      platform: draft.platform,
      objective: draft.objective,
      industry: draft.industry,
      qualityRating: draft.qualityRating,
    },
    query,
  );
}
