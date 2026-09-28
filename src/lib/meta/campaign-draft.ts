import {
  CAMPAIGN_GEO_PLACE_KINDS,
  type CampaignGeoTarget,
} from "@/lib/campaign-geo/types";
import type {
  MetaCampaignDraftPayload,
  MetaCampaignDraftView,
} from "@/lib/meta/campaign-draft-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STRUCTURAL_MODES = ["off", "two_ads", "two_ad_sets", "funnel_split"] as const;
const PERFORMANCE_GOALS = ["volume", "quality"] as const;
const AD_CATEGORIES = ["", "standard", "employment"] as const;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} ist ungültig.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length > max || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`${field} ist ungültig oder zu lang.`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} ist ungültig.`);
  return value;
}

function choice<const T extends readonly string[]>(
  value: unknown,
  field: string,
  choices: T,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new Error(`${field} ist ungültig.`);
  }
  return value as T[number];
}

function textList(
  value: unknown,
  field: string,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${field} ist ungültig.`);
  }
  return value.map((item, index) => text(item, `${field} ${index + 1}`, maxLength));
}

function id(value: unknown, field: string): string {
  const parsed = text(value, field, 36);
  if (parsed && !UUID.test(parsed)) throw new Error(`${field} ist ungültig.`);
  return parsed;
}

function metaId(value: unknown, field: string): string {
  const parsed = text(value, field, 64);
  if (parsed && !/^\d{1,64}$/.test(parsed)) throw new Error(`${field} ist ungültig.`);
  return parsed;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} ist ungültig.`);
  }
  return value;
}

function normalizeGeo(value: unknown): CampaignGeoTarget | null {
  if (value === null) return null;
  const geo = object(value, "Das Zielgebiet");
  const placeKind = choice(geo.placeKind, "Die Gebietsart", CAMPAIGN_GEO_PLACE_KINDS);
  const countryCode = geo.countryCode === null
    ? null
    : text(geo.countryCode, "Der Ländercode", 2).toUpperCase();
  const radiusKm = nullableNumber(geo.radiusKm, "Der Radius");
  if (radiusKm !== null && (!Number.isInteger(radiusKm) || radiusKm < 1 || radiusKm > 80)) {
    throw new Error("Der Radius ist ungültig.");
  }
  return {
    placeLabel: text(geo.placeLabel, "Das Zielgebiet", 200),
    placeKind,
    countryCode,
    latitude: nullableNumber(geo.latitude, "Der Breitengrad"),
    longitude: nullableNumber(geo.longitude, "Der Längengrad"),
    radiusKm,
    openaiLocationId:
      geo.openaiLocationId === null ? null : text(geo.openaiLocationId, "Die OpenAI-Orts-ID", 200),
    metaLocationKey:
      geo.metaLocationKey === null ? null : text(geo.metaLocationKey, "Der Meta-Ortsschlüssel", 200),
  };
}

export function normalizeMetaCampaignDraftPayload(value: unknown): MetaCampaignDraftPayload {
  const payload = object(value, "Der Kampagnenentwurf");
  const normalized: MetaCampaignDraftPayload = {
    campaignName: text(payload.campaignName, "Der Kampagnenname", 240),
    destinationUrl: text(payload.destinationUrl, "Die Ziel-URL", 2_048),
    adCategory: choice(payload.adCategory, "Die Anzeigenkategorie", AD_CATEGORIES),
    dailyBudget: text(payload.dailyBudget, "Das Tagesbudget", 32),
    facebookPageId: metaId(payload.facebookPageId, "Die Facebook-Seite"),
    instagramActorId: metaId(payload.instagramActorId, "Das Instagram-Konto"),
    primaryTexts: textList(payload.primaryTexts, "Der Anzeigentext", 5, 500),
    headlines: textList(payload.headlines, "Die Überschrift", 5, 255),
    descriptions: textList(payload.descriptions, "Die Beschreibung", 5, 255),
    structuralMode: choice(payload.structuralMode, "Die Anzeigenstruktur", STRUCTURAL_MODES),
    variantDestinationUrl: text(payload.variantDestinationUrl, "Die zweite Ziel-URL", 2_048),
    useMetaExperiment: boolean(payload.useMetaExperiment, "Die Meta-Experiment-Auswahl"),
    dynamicCreativeImages: boolean(payload.dynamicCreativeImages, "Die Mehrfachmotiv-Auswahl"),
    includeFormatSiblings: boolean(payload.includeFormatSiblings, "Die Formatableitungen"),
    assetId: id(payload.assetId, "Das Hauptmotiv"),
    extraAssetIds: [...new Set(textList(payload.extraAssetIds, "Die weiteren Motive", 9, 36).map((item) => {
      if (!UUID.test(item)) throw new Error("Eine Werbemittel-ID ist ungültig.");
      return item;
    }))],
    ad2Primary: text(payload.ad2Primary, "Der zweite Anzeigentext", 500),
    ad2Headline: text(payload.ad2Headline, "Die zweite Überschrift", 255),
    ad2Description: text(payload.ad2Description, "Die zweite Beschreibung", 255),
    pixelRowId: id(payload.pixelRowId, "Das Pixel"),
    performanceGoal: choice(payload.performanceGoal, "Das Performance-Ziel", PERFORMANCE_GOALS),
    geo: normalizeGeo(payload.geo),
  };
  if (JSON.stringify(normalized).length > 65_536) {
    throw new Error("Der Kampagnenentwurf ist zu groß.");
  }
  return normalized;
}

export function parseMetaCampaignDraftSave(value: unknown): {
  draftId: string | null;
  revision: number;
  payload: MetaCampaignDraftPayload;
} {
  const body = object(value, "Die Entwurfsanfrage");
  const draftId = body.draftId === null ? null : id(body.draftId, "Die Entwurfs-ID");
  if (draftId === "") throw new Error("Die Entwurfs-ID ist ungültig.");
  if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 1) {
    throw new Error("Die Entwurfsrevision ist ungültig.");
  }
  return {
    draftId,
    revision: Number(body.revision),
    payload: normalizeMetaCampaignDraftPayload(body.payload),
  };
}

export function parseMetaCampaignDraftStatus(value: unknown): {
  draftId: string;
  status: "ARCHIVED" | "LAUNCHED";
} {
  const body = object(value, "Die Entwurfsstatusanfrage");
  const draftId = id(body.draftId, "Die Entwurfs-ID");
  if (!draftId) throw new Error("Die Entwurfs-ID ist ungültig.");
  return {
    draftId,
    status: choice(body.status, "Der Entwurfsstatus", ["ARCHIVED", "LAUNCHED"] as const),
  };
}

export function toMetaCampaignDraftView(row: Record<string, unknown>): MetaCampaignDraftView | null {
  try {
    if (
      typeof row.id !== "string" ||
      typeof row.campaign_name !== "string" ||
      typeof row.destination_url !== "string" ||
      typeof row.updated_at !== "string"
    ) return null;
    const revision = Number(row.revision);
    if (!Number.isSafeInteger(revision) || revision < 1) return null;
    return {
      id: row.id,
      campaignName: row.campaign_name,
      destinationUrl: row.destination_url,
      payload: normalizeMetaCampaignDraftPayload(row.payload),
      revision,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}
