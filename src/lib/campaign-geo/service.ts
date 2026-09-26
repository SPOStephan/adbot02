import type { SupabaseClient } from "@supabase/supabase-js";

import { parseCampaignGeoTarget } from "./adapters";
import type { CampaignGeoTarget } from "./types";

export function rowToCampaignGeoTarget(row: unknown): CampaignGeoTarget | null {
  return parseCampaignGeoTarget(row);
}

export async function loadCustomerCampaignGeo(
  supabase: SupabaseClient,
  userId: string,
): Promise<CampaignGeoTarget | null> {
  const { data, error } = await supabase
    .from("customer_campaign_geo")
    .select(
      "place_label,place_kind,country_code,latitude,longitude,radius_km,openai_location_id,meta_location_key",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error("Das Zielgebiet konnte nicht geladen werden.");
  }
  return rowToCampaignGeoTarget(data);
}

export async function saveCustomerCampaignGeo(
  supabase: SupabaseClient,
  userId: string,
  geo: CampaignGeoTarget,
): Promise<CampaignGeoTarget> {
  const { data, error } = await supabase
    .from("customer_campaign_geo")
    .upsert(
      {
        user_id: userId,
        place_label: geo.placeLabel,
        place_kind: geo.placeKind,
        country_code: geo.countryCode,
        latitude: geo.latitude,
        longitude: geo.longitude,
        radius_km: geo.radiusKm,
        openai_location_id: geo.openaiLocationId,
        meta_location_key: geo.metaLocationKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select(
      "place_label,place_kind,country_code,latitude,longitude,radius_km,openai_location_id,meta_location_key",
    )
    .single();
  if (error || !data) {
    throw new Error("Das Zielgebiet konnte nicht gespeichert werden.");
  }
  const saved = rowToCampaignGeoTarget(data);
  if (!saved) {
    throw new Error("Das gespeicherte Zielgebiet ist ungültig.");
  }
  return saved;
}

export async function clearCustomerCampaignGeo(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("customer_campaign_geo")
    .delete()
    .eq("user_id", userId);
  if (error) {
    throw new Error("Das Zielgebiet konnte nicht entfernt werden.");
  }
}
