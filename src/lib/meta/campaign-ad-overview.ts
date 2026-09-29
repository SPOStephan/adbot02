/**
 * Pure builder for the "Laufende Anzeigen" overview. It turns synced Meta
 * rows (campaigns, ad sets, ads, creatives) plus the Adbot launch plans that
 * created them into campaign cards with concrete ad previews.
 *
 * No runtime imports: scripts/test-campaign-ad-overview.mjs loads this file
 * directly with --experimental-strip-types. The combination sampler is
 * injected for the same reason.
 */

import type {
  MetaAdPreviewCombination,
  MetaAdPreviewCombinationResult,
} from "./ad-preview-combinations";

export type CampaignKind = "lead" | "traffic" | "boost" | "other";
export type CampaignLifecycle = "active" | "archived";
export type CampaignPreviewMode = "single" | "dynamic" | "structural" | "none";

export const CAMPAIGN_KIND_ORDER: readonly CampaignKind[] = [
  "lead",
  "traffic",
  "boost",
  "other",
];

export const CAMPAIGN_KIND_LABELS: Record<CampaignKind, string> = {
  lead: "Lead / Funnel",
  traffic: "Traffic",
  boost: "Beitrag-Push",
  other: "Sonstige",
};

export const MAX_CAMPAIGN_AD_CARDS = 20;

export type CampaignAdCard = {
  key: string;
  /** Brand asset id when the image comes from the Adbot media library. */
  assetId: string;
  imageUrl: string | null;
  primaryText: string;
  headline: string;
  description: string;
  destinationUrl: string;
  callToActionLabel: string;
  previewLabel: string;
  instagramPermalinkUrl: string | null;
};

export type CampaignAdOverviewItem = {
  id: string;
  platformCampaignId: string;
  name: string;
  displayName: string;
  kind: CampaignKind;
  lifecycle: CampaignLifecycle;
  statusLabel: string;
  objective: string | null;
  launchedByAdbot: boolean;
  destinationUrl: string | null;
  variantDestinationUrl: string | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  startTime: string | null;
  stopTime: string | null;
  updatedAt: string | null;
  spend: number | null;
  impressions: number | null;
  linkClicks: number | null;
  leads: number | null;
  currency: string;
  adCount: number;
  previewMode: CampaignPreviewMode;
  cards: CampaignAdCard[];
  totalCombinationCount: number;
  isTruncated: boolean;
};

type Row = Record<string, unknown>;

export type CampaignAdOverviewInput = {
  campaigns: readonly Row[];
  adGroups: readonly Row[];
  ads: readonly Row[];
  creatives: readonly Row[];
  plans: readonly Row[];
  campaignBindings: readonly Row[];
  performance: readonly Row[];
  currency: string;
  now: number;
  brandAssetImageUrl: (assetId: string) => string | null;
  buildCombinations: (input: {
    assetIds: readonly string[];
    primaryTexts: readonly string[];
    headlines: readonly string[];
    descriptions?: readonly string[];
    maxCombinations?: number;
    defaultPrimaryText?: string;
    defaultHeadline?: string;
  }) => MetaAdPreviewCombinationResult;
};

const RUNNING_EFFECTIVE_STATUSES = new Set([
  "ACTIVE",
  "IN_PROCESS",
  "WITH_ISSUES",
  "PENDING_REVIEW",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
]);

const CALL_TO_ACTION_LABELS: Record<string, string> = {
  LEARN_MORE: "Mehr erfahren",
  SIGN_UP: "Registrieren",
  APPLY_NOW: "Jetzt bewerben",
  CONTACT_US: "Kontakt aufnehmen",
  SUBSCRIBE: "Abonnieren",
  GET_QUOTE: "Angebot anfordern",
  GET_OFFER: "Angebot sichern",
  BOOK_NOW: "Jetzt buchen",
  BOOK_TRAVEL: "Jetzt buchen",
  DOWNLOAD: "Herunterladen",
  SHOP_NOW: "Jetzt einkaufen",
  ORDER_NOW: "Jetzt bestellen",
  SEND_MESSAGE: "Nachricht senden",
  WHATSAPP_MESSAGE: "WhatsApp-Nachricht senden",
  CALL_NOW: "Jetzt anrufen",
  GET_DIRECTIONS: "Route planen",
  WATCH_MORE: "Mehr ansehen",
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function upper(value: unknown): string | null {
  const result = text(value);
  return result ? result.toUpperCase() : null;
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function timestamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function callToActionLabel(type: string | null | undefined): string {
  return (type && CALL_TO_ACTION_LABELS[type.toUpperCase()]) || "Mehr erfahren";
}

/** Removes technical stamps Adbot appends to campaign names. */
export function friendlyCampaignName(name: string): string {
  const withoutHash = name.replace(/\s*\[[0-9a-f-]{8,}\]\s*$/i, "").trim();
  const withoutStamp = withoutHash
    .replace(/\s+\d{4}-\d{2}-\d{2}T[\d:.-]+Z?$/i, "")
    .trim();
  return withoutStamp || name;
}

export function classifyCampaignKind(input: {
  objective: string | null;
  name: string;
  isOrganicBoost: boolean;
}): CampaignKind {
  if (input.isOrganicBoost || input.name.startsWith("Organic Boost")) {
    return "boost";
  }
  const objective = (input.objective ?? "").toUpperCase();
  if (objective === "OUTCOME_LEADS" || objective === "LEAD_GENERATION") {
    return "lead";
  }
  if (objective === "OUTCOME_TRAFFIC" || objective === "LINK_CLICKS") {
    return "traffic";
  }
  return "other";
}

export function campaignLifecycle(input: {
  status: string | null;
  effectiveStatus: string | null;
  stopTime: string | null;
  now: number;
}): { lifecycle: CampaignLifecycle; statusLabel: string } {
  const status = (input.status ?? "").toUpperCase();
  const effective = (input.effectiveStatus ?? status).toUpperCase();
  const stop = input.stopTime ? Date.parse(input.stopTime) : Number.NaN;
  const ended = Number.isFinite(stop) && stop <= input.now;

  if (status === "DELETED" || effective === "DELETED") {
    return { lifecycle: "archived", statusLabel: "Gelöscht" };
  }
  if (status === "ARCHIVED" || effective === "ARCHIVED") {
    return { lifecycle: "archived", statusLabel: "Archiviert" };
  }
  if (ended) {
    return { lifecycle: "archived", statusLabel: "Beendet" };
  }
  if (effective === "DISAPPROVED") {
    return { lifecycle: "archived", statusLabel: "Abgelehnt" };
  }
  if (status === "ACTIVE" && RUNNING_EFFECTIVE_STATUSES.has(effective)) {
    return {
      lifecycle: "active",
      statusLabel:
        effective === "ACTIVE"
          ? "Aktiv"
          : effective === "WITH_ISSUES"
            ? "Aktiv mit Hinweisen"
            : "In Prüfung",
    };
  }
  return { lifecycle: "archived", statusLabel: "Pausiert" };
}

type PlanCopy = {
  message: string | null;
  headline: string | null;
  description: string | null;
  callToActionType: string | null;
  bodies: string[];
  titles: string[];
  descriptions: string[];
};

type ParsedPlan = {
  id: string;
  isOrganicBoost: boolean;
  destinationUrl: string | null;
  variantDestinationUrl: string | null;
  brandAssetIds: string[];
  creatives: PlanCopy[];
};

function textVariants(spec: Row | null, key: string): string[] {
  const values = spec?.[key];
  if (!Array.isArray(values)) return [];
  const unique = new Set<string>();
  for (const value of values) {
    const entry = text(record(value)?.text);
    if (entry) unique.add(entry);
  }
  return [...unique];
}

function parseCreativeCopy(value: unknown): PlanCopy | null {
  const creative = record(value);
  if (!creative) return null;
  const linkData = record(record(creative.object_story_spec)?.link_data);
  const feed = record(creative.asset_feed_spec);
  const feedCallToAction = Array.isArray(feed?.call_to_action_types)
    ? text(feed.call_to_action_types[0])
    : null;
  return {
    message: text(linkData?.message),
    headline: text(linkData?.name),
    description: text(linkData?.description),
    callToActionType: text(record(linkData?.call_to_action)?.type) ?? feedCallToAction,
    bodies: textVariants(feed, "bodies"),
    titles: textVariants(feed, "titles"),
    descriptions: textVariants(feed, "descriptions"),
  };
}

function parsePlan(row: Row): ParsedPlan | null {
  const id = text(row.id);
  const payload = record(row.planned_payload);
  if (!id || !payload) return null;
  const creatives: PlanCopy[] = [];
  if (Array.isArray(payload.creatives)) {
    for (const entry of payload.creatives) {
      const copy = parseCreativeCopy(entry);
      if (copy) creatives.push(copy);
    }
  }
  if (creatives.length === 0) {
    const copy = parseCreativeCopy(payload.creative);
    if (copy) creatives.push(copy);
  }
  return {
    id,
    isOrganicBoost: row.source_rule_key === "organic-boost",
    destinationUrl: text(payload.destination_url),
    variantDestinationUrl: text(payload.variant_destination_url),
    brandAssetIds: Array.isArray(payload.brand_asset_ids)
      ? payload.brand_asset_ids.filter(
          (assetId): assetId is string =>
            typeof assetId === "string" && /^[0-9a-f-]{36}$/i.test(assetId),
        )
      : [],
    creatives,
  };
}

function creativeImageUrl(creative: Row | undefined): string | null {
  if (!creative) return null;
  const content = record(creative.content);
  return (
    text(content?.image_url) ??
    text(creative.thumbnail_url) ??
    text(content?.thumbnail_url)
  );
}

function isRunningAd(ad: Row): boolean {
  const status = upper(ad.status);
  const effective = upper(ad.effective_status) ?? status;
  return status === "ACTIVE" && RUNNING_EFFECTIVE_STATUSES.has(effective ?? "");
}

function buildCards(input: {
  kind: CampaignKind;
  plan: ParsedPlan | null;
  ads: Row[];
  creativesById: Map<string, Row>;
  brandAssetImageUrl: CampaignAdOverviewInput["brandAssetImageUrl"];
  buildCombinations: CampaignAdOverviewInput["buildCombinations"];
}): Pick<
  CampaignAdOverviewItem,
  "cards" | "previewMode" | "totalCombinationCount" | "isTruncated"
> {
  const { plan } = input;
  const destination = plan?.destinationUrl ?? "";
  const firstCopy = plan?.creatives[0] ?? null;
  const isDynamic =
    plan !== null &&
    plan.creatives.length <= 1 &&
    input.ads.length <= 1 &&
    (plan.brandAssetIds.length > 1 ||
      (firstCopy?.bodies.length ?? 0) > 1 ||
      (firstCopy?.titles.length ?? 0) > 1);

  if (isDynamic && plan) {
    const creative = input.ads[0]
      ? input.creativesById.get(String(input.ads[0].platform_creative_id ?? ""))
      : undefined;
    const fallbackImage = creativeImageUrl(creative);
    const result = input.buildCombinations({
      assetIds: plan.brandAssetIds.length > 0 ? plan.brandAssetIds : ["meta"],
      primaryTexts:
        firstCopy && firstCopy.bodies.length > 0
          ? firstCopy.bodies
          : [firstCopy?.message ?? text(creative?.body) ?? ""],
      headlines:
        firstCopy && firstCopy.titles.length > 0
          ? firstCopy.titles
          : [firstCopy?.headline ?? text(creative?.title) ?? ""],
      descriptions: firstCopy?.descriptions ?? [],
      maxCombinations: MAX_CAMPAIGN_AD_CARDS,
      defaultPrimaryText: "Anzeigentext",
      defaultHeadline: "Überschrift",
    });
    const cta = callToActionLabel(
      firstCopy?.callToActionType ?? text(creative?.call_to_action_type),
    );
    const cards = result.combinations.map(
      (combination: MetaAdPreviewCombination, index: number) => {
        const isBrandAsset = combination.assetId !== "meta";
        return {
          key: `${combination.assetId}:${index}`,
          assetId: isBrandAsset ? combination.assetId : "",
          imageUrl:
            (isBrandAsset ? input.brandAssetImageUrl(combination.assetId) : null) ??
            fallbackImage,
          primaryText: combination.primaryText,
          headline: combination.headline,
          description: combination.description,
          destinationUrl: destination,
          callToActionLabel: cta,
          previewLabel:
            result.combinations.length > 1 ? `Kombination ${index + 1}` : "Anzeige",
          instagramPermalinkUrl: null,
        } satisfies CampaignAdCard;
      },
    );
    return {
      cards,
      previewMode: "dynamic",
      totalCombinationCount: result.totalCombinationCount,
      isTruncated: result.isTruncated,
    };
  }

  const running = input.ads.filter(isRunningAd);
  const shownAds = (running.length > 0 ? running : input.ads).slice(
    0,
    MAX_CAMPAIGN_AD_CARDS,
  );
  const cards: CampaignAdCard[] = shownAds.map((ad, index) => {
    const creative = input.creativesById.get(String(ad.platform_creative_id ?? ""));
    const copy = plan?.creatives[index] ?? firstCopy;
    const planAssetId = plan?.brandAssetIds[index] ?? plan?.brandAssetIds[0] ?? "";
    const metaImage = creativeImageUrl(creative);
    const assetImage = planAssetId ? input.brandAssetImageUrl(planAssetId) : null;
    return {
      key: String(ad.id ?? index),
      assetId: metaImage ? "" : planAssetId,
      imageUrl: metaImage ?? assetImage,
      primaryText:
        text(creative?.body) ??
        copy?.message ??
        (input.kind === "boost" ? "Beworbener Beitrag" : ""),
      headline: text(creative?.title) ?? copy?.headline ?? "",
      description: copy?.description ?? "",
      destinationUrl:
        index === 1 && plan?.variantDestinationUrl
          ? plan.variantDestinationUrl
          : destination,
      callToActionLabel: callToActionLabel(
        text(creative?.call_to_action_type) ?? copy?.callToActionType,
      ),
      previewLabel:
        shownAds.length > 1
          ? `Anzeige ${index + 1}`
          : input.kind === "boost"
            ? "Beworbener Beitrag"
            : "Anzeige",
      instagramPermalinkUrl: text(creative?.instagram_permalink_url),
    };
  });
  return {
    cards,
    previewMode:
      cards.length === 0 ? "none" : cards.length > 1 ? "structural" : "single",
    totalCombinationCount: cards.length,
    isTruncated: running.length > 0
      ? running.length > shownAds.length
      : input.ads.length > shownAds.length,
  };
}

export function buildCampaignAdOverview(
  input: CampaignAdOverviewInput,
): CampaignAdOverviewItem[] {
  const plansById = new Map<string, ParsedPlan>();
  for (const row of input.plans) {
    const plan = parsePlan(row);
    if (plan) plansById.set(plan.id, plan);
  }

  const planByLocalCampaign = new Map<string, ParsedPlan>();
  const planByRemoteCampaign = new Map<string, ParsedPlan>();
  for (const binding of input.campaignBindings) {
    const plan = plansById.get(String(binding.plan_id ?? ""));
    if (!plan) continue;
    const local = text(binding.local_campaign_id);
    const remote = text(binding.remote_object_id);
    if (local && !planByLocalCampaign.has(local)) planByLocalCampaign.set(local, plan);
    if (remote && !planByRemoteCampaign.has(remote)) {
      planByRemoteCampaign.set(remote, plan);
    }
  }

  const campaignByAdGroup = new Map<string, string>();
  for (const adGroup of input.adGroups) {
    const id = text(adGroup.id);
    const campaignId = text(adGroup.campaign_id);
    if (id && campaignId) campaignByAdGroup.set(id, campaignId);
  }
  const adsByCampaign = new Map<string, Row[]>();
  for (const ad of input.ads) {
    const campaignId = campaignByAdGroup.get(String(ad.ad_group_id ?? ""));
    if (!campaignId) continue;
    const list = adsByCampaign.get(campaignId) ?? [];
    list.push(ad);
    adsByCampaign.set(campaignId, list);
  }
  const creativesById = new Map<string, Row>();
  for (const creative of input.creatives) {
    const id = text(creative.platform_creative_id);
    if (id) creativesById.set(id, creative);
  }
  const performanceByCampaign = new Map<string, Row>();
  for (const row of input.performance) {
    const id = text(row.campaign_id);
    if (id) performanceByCampaign.set(id, row);
  }

  const items: CampaignAdOverviewItem[] = [];
  for (const campaign of input.campaigns) {
    const id = text(campaign.id);
    const platformCampaignId = text(campaign.platform_campaign_id);
    if (!id || !platformCampaignId) continue;
    const name = text(campaign.name) ?? "Kampagne";
    const plan =
      planByLocalCampaign.get(id) ?? planByRemoteCampaign.get(platformCampaignId) ?? null;
    const objective = text(campaign.objective);
    const kind = classifyCampaignKind({
      objective,
      name,
      isOrganicBoost: plan?.isOrganicBoost === true,
    });
    const stopTime = timestamp(campaign.stop_time);
    const { lifecycle, statusLabel } = campaignLifecycle({
      status: text(campaign.status),
      effectiveStatus: text(campaign.effective_status),
      stopTime,
      now: input.now,
    });
    const ads = (adsByCampaign.get(id) ?? []).sort((left, right) =>
      String(left.platform_ad_id ?? left.id ?? "").localeCompare(
        String(right.platform_ad_id ?? right.id ?? ""),
      ),
    );
    const performance = performanceByCampaign.get(id);
    items.push({
      id,
      platformCampaignId,
      name,
      displayName: friendlyCampaignName(name),
      kind,
      lifecycle,
      statusLabel,
      objective,
      launchedByAdbot: plan !== null,
      destinationUrl: plan?.destinationUrl ?? null,
      variantDestinationUrl: plan?.variantDestinationUrl ?? null,
      dailyBudgetMinor: finite(campaign.daily_budget_minor),
      lifetimeBudgetMinor: finite(campaign.lifetime_budget_minor),
      startTime: timestamp(campaign.start_time),
      stopTime,
      updatedAt: timestamp(campaign.platform_updated_time),
      spend: finite(performance?.spend),
      impressions: finite(performance?.impressions),
      linkClicks: finite(performance?.inline_link_clicks),
      leads: finite(performance?.leads),
      currency: text(performance?.currency) ?? input.currency,
      adCount: ads.length,
      ...buildCards({
        kind,
        plan,
        ads,
        creativesById,
        brandAssetImageUrl: input.brandAssetImageUrl,
        buildCombinations: input.buildCombinations,
      }),
    });
  }

  return items.sort((left, right) => {
    if (left.lifecycle !== right.lifecycle) {
      return left.lifecycle === "active" ? -1 : 1;
    }
    const spendDelta = (right.spend ?? -1) - (left.spend ?? -1);
    if (spendDelta !== 0) return spendDelta;
    return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
  });
}

/** Same normalization as /api/internal/funnel-campaign-status. */
export function normalizeFunnelDestinationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Adbot Funnel only shows Lead/Funnel and Traffic campaigns that promote one
 * of the tenant's funnels. Everything else stays invisible there.
 */
export function filterFunnelCampaigns(
  items: readonly CampaignAdOverviewItem[],
  funnelUrls: readonly string[],
): Array<CampaignAdOverviewItem & { funnelUrl: string }> {
  const byNormalized = new Map<string, string>();
  for (const url of funnelUrls) {
    const normalized = normalizeFunnelDestinationUrl(url);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, url);
  }
  return items.flatMap((item) => {
    if (item.kind !== "lead" && item.kind !== "traffic") return [];
    for (const candidate of [item.destinationUrl, item.variantDestinationUrl]) {
      const normalized = candidate ? normalizeFunnelDestinationUrl(candidate) : null;
      const funnelUrl = normalized ? byNormalized.get(normalized) : undefined;
      if (funnelUrl) return [{ ...item, funnelUrl }];
    }
    return [];
  });
}
