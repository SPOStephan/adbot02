import {
  CHATGPT_AD_LIBRARY_IMAGE_HOST,
  CHATGPT_AD_LIBRARY_ORIGIN,
  CHATGPT_AD_LIBRARY_PROVIDER,
  type ChatGPTAdLibraryRecord,
} from "@/lib/chatgpt-ad-library/types";
import type { AdExampleInput } from "@/lib/ad-examples/types";
import {
  isLikelyChatGPTAdTriggerPrompt,
  stripChatGPTAdLibrarySeoBlurb,
} from "@/lib/chatgpt-ad-library/parse-html";

export class ChatGPTAdLibraryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatGPTAdLibraryParseError";
  }
}

function text(value: unknown, field: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new ChatGPTAdLibraryParseError(`${field} fehlt.`);
  }
  return normalized.slice(0, max);
}

function optionalText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringArray(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, maxLen)),
    ),
  ].slice(0, maxItems);
}

function httpsUrl(value: unknown, field: string): string {
  const raw = text(value, field, 2048);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ChatGPTAdLibraryParseError(`${field} ist keine gültige URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ChatGPTAdLibraryParseError(`${field} muss HTTPS ohne Credentials sein.`);
  }
  url.hash = "";
  return url.toString();
}

function optionalHttpsUrl(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return httpsUrl(value, field);
}

export function normalizeChatGPTAdLibraryRecord(
  value: unknown,
): ChatGPTAdLibraryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChatGPTAdLibraryParseError("Datensatz muss ein Objekt sein.");
  }
  const row = value as Record<string, unknown>;
  const idRaw = row.id;
  const id =
    typeof idRaw === "number" && Number.isFinite(idRaw)
      ? String(Math.trunc(idRaw))
      : typeof idRaw === "string" && /^\d{1,12}$/.test(idRaw.trim())
        ? idRaw.trim()
        : null;
  if (!id) {
    throw new ChatGPTAdLibraryParseError("id muss eine positive Zahl sein.");
  }

  const sourceUrl =
    optionalHttpsUrl(row.sourceUrl, "sourceUrl") ??
    `${CHATGPT_AD_LIBRARY_ORIGIN}/ad/${id}`;
  if (!sourceUrl.startsWith(`${CHATGPT_AD_LIBRARY_ORIGIN}/ad/`)) {
    throw new ChatGPTAdLibraryParseError(
      "sourceUrl muss auf chatgptadlibrary.com/ad/ zeigen.",
    );
  }

  const imageUrl = httpsUrl(row.imageUrl, "imageUrl");
  const imageParsed = new URL(imageUrl);
  const imageHost = imageParsed.hostname.toLowerCase();
  if (imageHost !== CHATGPT_AD_LIBRARY_IMAGE_HOST) {
    throw new ChatGPTAdLibraryParseError(
      `imageUrl muss von ${CHATGPT_AD_LIBRARY_IMAGE_HOST} stammen.`,
    );
  }
  const imagePath = imageParsed.pathname.toLowerCase();
  if (
    /placeholder|monday\d|sample|fake|demo/i.test(imagePath) ||
    !/^\/c\/[0-9a-f]{2}\/[0-9a-f]{32,128}\.webp$/i.test(imagePath)
  ) {
    throw new ChatGPTAdLibraryParseError(
      "imageUrl muss ein echtes CDN-Hash-WebP sein (kein Placeholder).",
    );
  }

  return {
    id,
    sourceUrl,
    advertiserName: text(row.advertiserName, "advertiserName", 120),
    title: text(row.title, "title", 120),
    body: stripChatGPTAdLibrarySeoBlurb(optionalText(row.body, 2000)),
    imageUrl,
    landingPageUrl: optionalHttpsUrl(row.landingPageUrl, "landingPageUrl"),
    triggeringPrompts: stringArray(row.triggeringPrompts, 40, 400).filter(
      isLikelyChatGPTAdTriggerPrompt,
    ),
    category: stringArray(row.category, 12, 100),
  };
}

export function toAdExampleInput(record: ChatGPTAdLibraryRecord): AdExampleInput {
  const industry =
    record.category.find((item) => /saas|software|tech|hotel|travel|e-?commerce|finance|health|beauty|real estate|marketing/i.test(item)) ??
    record.category[0] ??
    "ChatGPT Ads · allgemein";
  const prompts = record.triggeringPrompts.map((item) => item.trim()).filter(Boolean);
  const body = record.body.trim();
  const objectiveDetail = (
    body ||
    prompts.slice(0, 3).join(" · ") ||
    `${record.advertiserName}: ${record.title}`
  ).slice(0, 600);

  return {
    title: record.title.slice(0, 120),
    advertiserName: record.advertiserName.slice(0, 120),
    platform: "openai_ads",
    industry: industry.slice(0, 100),
    objective: "traffic",
    objectiveDetail,
    funnelStage: "consideration",
    sourceKind: "chatgpt_ad_library",
    sourceUrl: record.sourceUrl,
    evidenceLevel: "public_transparency",
    rightsBasis: "reference_only",
    rightsConfirmed: true,
    format: "Chat Card / Bild",
    country: "Mehrere / unbekannt",
    language: "en",
    hookText: record.title.slice(0, 500),
    bodyText: body.slice(0, 2000),
    ctaText: "",
    landingPageUrl: record.landingPageUrl,
    performanceNote: "",
    whyItWorks: prompts.slice(0, 12).join("\n").slice(0, 1500),
    tags: [
      "chatgpt-ad-library",
      "internal-only",
      ...record.category
        .map((item) => item.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, "-"))
        .filter(Boolean)
        .slice(0, 8),
    ].slice(0, 12),
    qualityRating: 3,
    // Never auto-enable for customer-facing creative generation.
    useForGeneration: false,
  };
}

export function externalSourceMetadata(record: ChatGPTAdLibraryRecord): Record<string, unknown> {
  return {
    provider: CHATGPT_AD_LIBRARY_PROVIDER,
    external_id: String(record.id),
    source_url: record.sourceUrl,
    image_url: record.imageUrl,
    triggering_prompts: record.triggeringPrompts,
    categories: record.category,
    customer_visible: false,
    use_for_internal_intelligence: true,
    imported_at: new Date().toISOString(),
  };
}
