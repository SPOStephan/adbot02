import {
  CITY_RADIUS_FALLBACK_KM,
  META_RADIUS_MAX_KM,
  META_RADIUS_MIN_KM,
  type CampaignGeoPlaceKind,
  type CampaignGeoTarget,
} from "./types";

const COUNTRY = /^[A-Z]{2}$/;

export function isCampaignGeoPlaceKind(value: string): value is CampaignGeoPlaceKind {
  return value === "country" || value === "region" || value === "city" || value === "other";
}

export function parseCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return COUNTRY.test(code) ? code : null;
}

export function parseRadiusKm(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric);
  if (rounded < META_RADIUS_MIN_KM || rounded > META_RADIUS_MAX_KM) return null;
  return rounded;
}

export function parseCoordinate(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
  return Math.round(numeric * 1_000_000) / 1_000_000;
}

export function parseCampaignGeoTarget(value: unknown): CampaignGeoTarget | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const placeLabel = typeof row.placeLabel === "string"
    ? row.placeLabel.trim()
    : typeof row.place_label === "string"
      ? row.place_label.trim()
      : "";
  if (placeLabel.length < 2 || placeLabel.length > 240) return null;
  const kindRaw = typeof row.placeKind === "string"
    ? row.placeKind
    : typeof row.place_kind === "string"
      ? row.place_kind
      : "city";
  const placeKind = isCampaignGeoPlaceKind(kindRaw) ? kindRaw : "city";
  return {
    placeLabel,
    placeKind,
    countryCode: parseCountryCode(row.countryCode ?? row.country_code),
    latitude: parseCoordinate(row.latitude, -90, 90),
    longitude: parseCoordinate(row.longitude, -180, 180),
    radiusKm: parseRadiusKm(row.radiusKm ?? row.radius_km),
    openaiLocationId: optionalId(row.openaiLocationId ?? row.openai_location_id),
    metaLocationKey: optionalId(row.metaLocationKey ?? row.meta_location_key),
  };
}

function optionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 64 ? trimmed : null;
}

/** Circle radius for pin-drop platforms. Country-level places stay without circle. */
export function effectiveRadiusKm(geo: CampaignGeoTarget): number | null {
  if (geo.radiusKm != null) return geo.radiusKm;
  if (geo.placeKind === "country") return null;
  if (geo.latitude != null && geo.longitude != null) return CITY_RADIUS_FALLBACK_KM;
  return null;
}

export function fallbackCountryCode(geo: CampaignGeoTarget | null): string {
  return geo?.countryCode || "DE";
}

export type MetaAdSetTargeting = {
  geo_locations:
    | { countries: string[] }
    | {
        custom_locations: Array<{
          latitude: number;
          longitude: number;
          radius: number;
          distance_unit: "kilometer";
        }>;
        location_types: Array<"home">;
      };
};

export function toMetaAdSetTargeting(geo: CampaignGeoTarget | null): MetaAdSetTargeting {
  if (!geo) {
    return { geo_locations: { countries: ["DE"] } };
  }
  const radius = effectiveRadiusKm(geo);
  if (radius != null && geo.latitude != null && geo.longitude != null) {
    return {
      geo_locations: {
        custom_locations: [
          {
            latitude: geo.latitude,
            longitude: geo.longitude,
            radius,
            distance_unit: "kilometer",
          },
        ],
        location_types: ["home"],
      },
    };
  }
  return { geo_locations: { countries: [fallbackCountryCode(geo)] } };
}

export function toOpenAIAdsLocationQuery(geo: CampaignGeoTarget): string {
  return geo.placeLabel;
}

export function pickOpenAILocationId(
  geo: CampaignGeoTarget,
  candidates: Array<{ id: string; country_code?: string | null; name?: string; canonical_name?: string }>,
): string | null {
  if (geo.openaiLocationId) return geo.openaiLocationId;
  if (candidates.length === 0) return null;
  const country = geo.countryCode;
  const labeled = geo.placeLabel.toLowerCase();
  const ranked = [...candidates].sort((left, right) => {
    const leftCountry = country && left.country_code?.toUpperCase() === country ? 0 : 1;
    const rightCountry = country && right.country_code?.toUpperCase() === country ? 0 : 1;
    if (leftCountry !== rightCountry) return leftCountry - rightCountry;
    const leftName = `${left.name ?? ""} ${left.canonical_name ?? ""}`.toLowerCase();
    const rightName = `${right.name ?? ""} ${right.canonical_name ?? ""}`.toLowerCase();
    const leftHit = leftName.includes(labeled.split(",")[0] ?? labeled) ? 0 : 1;
    const rightHit = rightName.includes(labeled.split(",")[0] ?? labeled) ? 0 : 1;
    return leftHit - rightHit;
  });
  return ranked[0]?.id ?? null;
}

export function toGoogleAdsProximity(geo: CampaignGeoTarget | null): {
  supported: boolean;
  mode: "proximity" | "country" | "none";
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
} {
  if (!geo) return { supported: false, mode: "none" };
  const radius = effectiveRadiusKm(geo);
  if (radius != null && geo.latitude != null && geo.longitude != null) {
    return {
      supported: true,
      mode: "proximity",
      latitude: geo.latitude,
      longitude: geo.longitude,
      radiusKm: radius,
    };
  }
  if (geo.countryCode) {
    return { supported: true, mode: "country", countryCode: geo.countryCode };
  }
  return { supported: false, mode: "none" };
}

export function toTikTokLocation(geo: CampaignGeoTarget | null) {
  return toGoogleAdsProximity(geo);
}
