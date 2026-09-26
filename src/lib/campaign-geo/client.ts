import type { CampaignGeoTarget } from "./types";

export async function fetchCampaignGeoTarget(): Promise<CampaignGeoTarget | null> {
  const response = await fetch("/api/campaign-geo", { cache: "no-store" });
  const result = (await response.json().catch(() => ({}))) as {
    geo?: CampaignGeoTarget | null;
  };
  if (!response.ok) return null;
  return result.geo ?? null;
}
