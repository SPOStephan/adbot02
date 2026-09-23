/**
 * Platform-agnostic master generation, then placement crops
 * for whichever ad platforms the customer has connected.
 */

export type ConnectedAdPlatform =
  | "meta"
  | "google"
  | "tiktok"
  | "linkedin"
  | "openai_ads"
  | "other";

export type PlatformFormatSlot = {
  key: string;
  platform: ConnectedAdPlatform;
  label: string;
  width: number;
  height: number;
  note: string;
};

export const PLATFORM_FORMAT_SLOTS: readonly PlatformFormatSlot[] = [
  {
    key: "meta_feed_1x1",
    platform: "meta",
    label: "Meta Feed 1:1",
    width: 1080,
    height: 1080,
    note: "Standard für Feed-Anzeigen",
  },
  {
    key: "meta_feed_4x5",
    platform: "meta",
    label: "Meta Feed 4:5",
    width: 1080,
    height: 1350,
    note: "Mehr Fläche im mobilen Feed",
  },
  {
    key: "meta_story_9x16",
    platform: "meta",
    label: "Meta Story 9:16",
    width: 1080,
    height: 1920,
    note: "Stories, Reels und hochkantige Platzierungen",
  },
  {
    key: "google_landscape_191",
    platform: "google",
    label: "Google Landscape 1.91:1",
    width: 1200,
    height: 628,
    note: "Display / Demand Gen Landscape",
  },
  {
    key: "google_square_1x1",
    platform: "google",
    label: "Google Square 1:1",
    width: 1200,
    height: 1200,
    note: "Display Quadrat",
  },
  {
    key: "tiktok_vertical_9x16",
    platform: "tiktok",
    label: "TikTok 9:16",
    width: 1080,
    height: 1920,
    note: "In-Feed / Spark",
  },
  {
    key: "linkedin_landscape_191",
    platform: "linkedin",
    label: "LinkedIn Landscape 1.91:1",
    width: 1200,
    height: 627,
    note: "Single Image Ads",
  },
] as const;

export function normalizeConnectedPlatform(value: string): ConnectedAdPlatform | null {
  const key = value.trim().toLowerCase();
  if (key === "meta" || key === "facebook" || key === "instagram") return "meta";
  if (key === "google" || key === "google_ads") return "google";
  if (key === "tiktok") return "tiktok";
  if (key === "linkedin") return "linkedin";
  if (key === "openai_ads" || key === "chatgpt" || key === "openai") return "openai_ads";
  if (key === "other") return "other";
  return null;
}

export function formatSlotsForConnectedPlatforms(
  platforms: readonly string[],
): PlatformFormatSlot[] {
  const connected = new Set(
    platforms
      .map((item) => normalizeConnectedPlatform(item))
      .filter((item): item is ConnectedAdPlatform => Boolean(item)),
  );
  return PLATFORM_FORMAT_SLOTS.filter((slot) => connected.has(slot.platform));
}

export function describeFormatStep(platforms: readonly string[]): string {
  const slots = formatSlotsForConnectedPlatforms(platforms);
  if (slots.length === 0) {
    return "Noch keine Werbeplattform verbunden — es bleibt bei der Mastergrafik. Formate folgen, sobald ein Konto hängt.";
  }
  const labels = [...new Set(slots.map((slot) => slot.label))];
  return `Verbundene Plattformen bestimmen die Zuschnitte: ${labels.join(", ")}.`;
}
