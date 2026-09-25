import type { CampaignGeoPlaceKind, CampaignGeoSearchHit } from "./types";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

function placeKindFromNominatim(addresstype: string | undefined): CampaignGeoPlaceKind {
  if (addresstype === "country") return "country";
  if (addresstype === "state" || addresstype === "region" || addresstype === "county") {
    return "region";
  }
  if (
    addresstype === "city" ||
    addresstype === "town" ||
    addresstype === "village" ||
    addresstype === "municipality" ||
    addresstype === "suburb"
  ) {
    return "city";
  }
  return "other";
}

export async function searchCampaignGeoPlaces(query: string): Promise<CampaignGeoSearchHit[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 120) return [];

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "6");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AdbotCampaignGeo/1.0 (https://adbot.app)",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error("Die Ortssuche ist gerade nicht erreichbar.");
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) return [];

  const hits: CampaignGeoSearchHit[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    const label = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || label.length < 2) continue;
    const address = row.address && typeof row.address === "object"
      ? (row.address as Record<string, unknown>)
      : {};
    const countryCode = typeof address.country_code === "string"
      ? address.country_code.toUpperCase()
      : null;
    hits.push({
      placeLabel: label.slice(0, 240),
      placeKind: placeKindFromNominatim(
        typeof row.addresstype === "string" ? row.addresstype : undefined,
      ),
      countryCode: countryCode && /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
      latitude: Math.round(lat * 1_000_000) / 1_000_000,
      longitude: Math.round(lon * 1_000_000) / 1_000_000,
    });
  }
  return hits;
}
