/**
 * Pure helpers for "Als Vorlage duplizieren": turn an Adbot-launched Meta
 * campaign back into an editable campaign draft. The preferred source is the
 * launched draft itself; older launches without a draft are rebuilt from the
 * launch plan payload.
 *
 * Only type imports: scripts/test-meta-campaign-draft-duplicate.mjs loads this
 * file directly with --experimental-strip-types.
 */

import type { MetaCampaignDraftPayload } from "./campaign-draft-types";

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LAUNCH_TRACKING_SUFFIX = /\s*\[[0-9a-f]{12}-[a-z0-9]{1,3}\]\s*$/i;
const COPY_SUFFIX = /\s+\(Kopie(?: \d+)?\)$/;
const MAX_TEXTS = 5;
const MAX_EXTRA_ASSETS = 9;

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function metaId(value: unknown): string {
  const id = text(value);
  return /^\d{1,64}$/.test(id) ? id : "";
}

function clip(values: readonly string[], maxLength: number): string[] {
  return [...new Set(values.map((value) => value.slice(0, maxLength)).filter(Boolean))]
    .slice(0, MAX_TEXTS);
}

function feedTexts(feed: Row | null, key: string): string[] {
  const values = feed?.[key];
  if (!Array.isArray(values)) return [];
  return values.map((entry) => text(record(entry)?.text)).filter(Boolean);
}

type CreativeCopy = { bodies: string[]; titles: string[]; descriptions: string[] };

function creativeCopy(value: unknown): CreativeCopy {
  const creative = record(value);
  const feed = record(creative?.asset_feed_spec);
  const linkData = record(record(creative?.object_story_spec)?.link_data);
  const pick = (feedKey: string, linkKey: string) => {
    const fromFeed = feedTexts(feed, feedKey);
    if (fromFeed.length > 0) return fromFeed;
    const single = text(linkData?.[linkKey]);
    return single ? [single] : [];
  };
  return {
    bodies: pick("bodies", "message"),
    titles: pick("titles", "name"),
    descriptions: pick("descriptions", "description"),
  };
}

/** Meta campaign name without Adbot's launch tracking suffix (" [abc123def456-c]"). */
export function stripLaunchTrackingSuffix(name: string): string {
  return name.replace(LAUNCH_TRACKING_SUFFIX, "").trim();
}

/** "Name" → "Name (Kopie)"; a copy of a copy keeps a single suffix. */
export function duplicateCampaignName(name: string): string {
  const base = stripLaunchTrackingSuffix(name).replace(COPY_SUFFIX, "").trim() || "Kampagne";
  return `${base.slice(0, 230)} (Kopie)`;
}

function minorToBudget(value: unknown): string {
  const minor = Number(value);
  return Number.isSafeInteger(minor) && minor > 0 ? (minor / 100).toFixed(2) : "20.00";
}

/**
 * Rebuilds an editable draft from a launch plan's planned_payload. Targeting
 * is not reversed into a place: the copy starts without a Zielgebiet so the
 * customer picks the city explicitly.
 */
export function draftPayloadFromLaunchPlan(
  plannedPayload: unknown,
  options: { pixelRowId?: string | null } = {},
): MetaCampaignDraftPayload | null {
  const payload = record(plannedPayload);
  if (!payload) return null;
  const destinationUrl = text(payload.destination_url);
  if (!destinationUrl.startsWith("https://")) return null;

  const campaign = record(payload.campaign);
  const adSet = record(payload.ad_set);
  const creatives = Array.isArray(payload.creatives) ? payload.creatives : [];
  const primaryCreative = creatives[0] ?? payload.creative;
  const secondCreative = creatives.length > 1 ? creatives[1] : null;
  const first = creativeCopy(primaryCreative);
  const second = secondCreative ? creativeCopy(secondCreative) : null;
  const storySpec = record(record(primaryCreative)?.object_story_spec);

  const structuralAdCount = Number(payload.structural_ad_count);
  const structuralAdSetCount = Number(payload.structural_ad_set_count);
  const variantDestinationUrl = text(payload.variant_destination_url);
  const structuralMode: MetaCampaignDraftPayload["structuralMode"] =
    structuralAdCount === 2
      ? structuralAdSetCount === 2
        ? variantDestinationUrl
          ? "funnel_split"
          : "two_ad_sets"
        : "two_ads"
      : "off";

  const assetIds = Array.isArray(payload.brand_asset_ids)
    ? [...new Set(payload.brand_asset_ids.filter(
        (id): id is string => typeof id === "string" && UUID.test(id),
      ))]
    : [];
  const specialCategories = Array.isArray(campaign?.special_ad_categories)
    ? campaign.special_ad_categories
    : [];
  const pixelRowId = text(options.pixelRowId);

  return {
    campaignName: stripLaunchTrackingSuffix(text(campaign?.name)) || "Kampagne",
    destinationUrl,
    adCategory: specialCategories.includes("EMPLOYMENT") ? "employment" : "standard",
    dailyBudget: minorToBudget(payload.daily_budget_minor),
    facebookPageId: metaId(storySpec?.page_id),
    instagramActorId: metaId(storySpec?.instagram_user_id ?? storySpec?.instagram_actor_id),
    primaryTexts: clip(first.bodies, 500),
    headlines: clip(first.titles, 255),
    descriptions: clip(first.descriptions, 255),
    structuralMode,
    variantDestinationUrl: structuralMode === "funnel_split" ? variantDestinationUrl : "",
    useMetaExperiment: structuralAdSetCount === 2 && payload.use_meta_experiment === true,
    dynamicCreativeImages: structuralMode === "off" && assetIds.length > 1,
    includeFormatSiblings: payload.include_format_siblings !== false,
    assetId: assetIds[0] ?? "",
    extraAssetIds: structuralMode === "off" ? assetIds.slice(1, 1 + MAX_EXTRA_ASSETS) : [],
    ad2Primary: (second?.bodies[0] ?? "").slice(0, 500),
    ad2Headline: (second?.titles[0] ?? "").slice(0, 255),
    ad2Description: (second?.descriptions[0] ?? "").slice(0, 255),
    pixelRowId: UUID.test(pixelRowId) ? pixelRowId : "",
    performanceGoal: text(adSet?.optimization_goal) === "QUALITY_LEAD" ? "quality" : "volume",
    geo: null,
  };
}

/**
 * Picks the launched draft behind a plan: same destination URL and the Meta
 * campaign name without tracking suffix. Rows must be newest first.
 */
export function matchLaunchedDraft<T extends { campaign_name?: unknown; destination_url?: unknown }>(
  plannedPayload: unknown,
  launchedDrafts: readonly T[],
): T | null {
  const payload = record(plannedPayload);
  const destinationUrl = text(payload?.destination_url);
  const campaignName = stripLaunchTrackingSuffix(text(record(payload?.campaign)?.name));
  if (!destinationUrl || !campaignName) return null;
  return (
    launchedDrafts.find(
      (draft) =>
        text(draft.destination_url) === destinationUrl &&
        text(draft.campaign_name) === campaignName,
    ) ?? null
  );
}

/** The new draft: everything from the source, only the name marks it as copy. */
export function duplicateDraftPayload(
  source: MetaCampaignDraftPayload,
): MetaCampaignDraftPayload {
  return {
    ...source,
    primaryTexts: [...source.primaryTexts],
    headlines: [...source.headlines],
    descriptions: [...source.descriptions],
    extraAssetIds: [...source.extraAssetIds],
    geo: source.geo ? { ...source.geo } : null,
    campaignName: duplicateCampaignName(source.campaignName),
  };
}
