import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const OPENAI_ADS_LAUNCH_CONTRACT = "paused_campaign_daily_v1";
export const OPENAI_ADS_ACTIVATION_PREVIEW_TTL_MS = 5 * 60 * 1000;
export const OPENAI_ADS_MIN_TIMESTAMP = 946_684_800;
export const OPENAI_ADS_MAX_TIMESTAMP = 4_102_444_800;
export const OPENAI_ADS_MIN_DAILY_BUDGET_MICROS = 1_000_000;
export const OPENAI_ADS_MAX_BID_MICROS = 30_400_000_000_000;

export type OpenAIAdsLaunchBudgetSummary = {
  currency: string;
  dailyBudgetMicros: number;
};

export type StoredOpenAIAdsLaunchContract = {
  contractVersion: typeof OPENAI_ADS_LAUNCH_CONTRACT;
  remoteAccountId: string;
  currency: string;
  accountTimezone: string;
  campaignName: string;
  campaignDescription: string | null;
  biddingType: "impressions" | "clicks";
  billingEventType: "impression" | "click";
  dailyBudgetMicros: number;
  maxBidMicros: number;
  startTime: number | null;
  endTime: number | null;
  locationIds: string[];
  adGroupName: string;
  contextHints: string[];
  adName: string;
  title: string;
  body: string;
  targetUrl: string;
  imageUrl: string;
};

export type OpenAIAdsAccountSnapshot = {
  id: string;
  name: string;
  status: string | null;
  currency_code: string;
  timezone: string;
  review: { status: string };
  account_integrity_review?: { review: { status: string } } | null;
};

export type OpenAIAdsCampaignSnapshot = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  bidding_type: string;
  budget: {
    lifetime_spend_limit_micros?: number | null;
    lifetime_spend_limit_micros_present: boolean;
    daily_spend_limit_micros?: number | null;
  };
  start_time: number | null;
  end_time: number | null;
  targeting?: Record<string, unknown> | null;
  product_feed_id: string | null;
  landing_page_configuration?: Record<string, unknown> | null;
  serving_issues?: unknown[];
  serving_issues_observed: boolean;
};

export type OpenAIAdsAdGroupSnapshot = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  bidding_config: {
    billing_event_type: string;
    strategy?: string | null;
    max_bid_micros?: number | null;
    custom_audience_bid_multipliers?: unknown[];
  };
  context_hints: string[];
  landing_page_configuration?: Record<string, unknown> | null;
  product_set?: Record<string, unknown> | null;
  serving_issues?: unknown[];
  serving_issues_observed: boolean;
};

export type OpenAIAdsAdSnapshot = {
  id: string;
  name: string;
  status: string;
  review_status: string;
  creative: {
    type: string;
    title: string;
    body: string;
    price?: string | null;
    file_id?: string | null;
    image_crop?: Record<string, unknown> | null;
    target_url: string | null;
  };
  landing_page_configuration?: Record<string, unknown> | null;
  serving_issues?: unknown[];
  serving_issues_observed: boolean;
};

export type OpenAIAdsLaunchReadback = {
  account: OpenAIAdsAccountSnapshot;
  campaign: OpenAIAdsCampaignSnapshot;
  adGroup: OpenAIAdsAdGroupSnapshot;
  ad: OpenAIAdsAdSnapshot;
  parentageVerified: boolean;
};

export type OpenAIAdsLaunchValidation =
  | { ok: true }
  | { ok: false; code: string; message: string };

type ActivationPreviewTokenPayload = {
  version: 1;
  userId: string;
  launchId: string;
  remoteAccountId: string;
  campaignId: string;
  adGroupId: string;
  adId: string;
  currency: string;
  dailyBudgetMicros: number;
  contractHash: string;
  providerPreviewHash: string;
  expiresAtMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function accountLocalDateToUnix(
  value: string | null,
  timeZone: string,
): number | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const targetUtcMs = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  let candidateMs = targetUtcMs;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(
        formatter
          .formatToParts(new Date(candidateMs))
          .filter((part) => part.type !== "literal")
          .map((part) => [part.type, part.value]),
      );
      const representedMs = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      candidateMs += targetUtcMs - representedMs;
    }
    const verified = Object.fromEntries(
      formatter
        .formatToParts(new Date(candidateMs))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    if (
      `${verified.year}-${verified.month}-${verified.day}` !== value ||
      verified.hour !== "00" ||
      verified.minute !== "00" ||
      verified.second !== "00"
    ) {
      return null;
    }
    const seconds = candidateMs / 1000;
    return Number.isSafeInteger(seconds) &&
      seconds >= OPENAI_ADS_MIN_TIMESTAMP &&
      seconds <= OPENAI_ADS_MAX_TIMESTAMP
      ? seconds
      : null;
  } catch {
    return null;
  }
}

function safePositiveInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

function nullableNonNegativeSafeInteger(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : undefined;
}

function uniqueTextArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result = value.map(requiredText);
  if (result.some((item) => item === null)) return null;
  return [...new Set(result as string[])];
}

function equalTextSets(left: string[], right: string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function isEmptyTargetingDimension(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (!isRecord(value)) return false;
  return Object.values(value).every(isEmptyTargetingDimension);
}

function isNeutralLandingPageConfiguration(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, nested]) =>
      key === "query_string_template" &&
      (nested === null || nested === undefined || nested === ""),
  );
}

function targetingLocationIds(value: unknown): string[] | null {
  if (!isRecord(value) || !isRecord(value.locations)) return null;
  for (const [key, dimension] of Object.entries(value)) {
    if (key !== "locations" && !isEmptyTargetingDimension(dimension)) {
      return null;
    }
  }
  for (const [key, dimension] of Object.entries(value.locations)) {
    if (key !== "include" && !isEmptyTargetingDimension(dimension)) {
      return null;
    }
  }
  const include = value.locations.include;
  if (!Array.isArray(include)) return null;
  const ids = include.map((item) =>
    isRecord(item) ? requiredText(item.id) : null,
  );
  if (ids.some((item) => item === null)) return null;
  return [...new Set(ids as string[])];
}

function servingIssuesAllowed(input: {
  value: unknown[] | undefined;
  level: "campaign" | "ad_group" | "ad";
  expectedStatus: "paused" | "active";
  reviewStatus: string;
}): boolean {
  if (!Array.isArray(input.value)) return false;
  if (input.expectedStatus === "active") return input.value.length === 0;
  const allowed = new Set<string>(
    input.level === "campaign"
      ? [
          "campaign_not_active",
          "campaign_has_no_serving_ready_ad_groups",
          "ad_group_not_active",
        ]
      : input.level === "ad_group"
        ? [
            "campaign_not_active",
            "ad_group_not_active",
            "ad_group_has_no_serving_ready_ads",
          ]
        : ["campaign_not_active", "ad_group_not_active", "ad_not_active"],
  );
  if (input.reviewStatus === "in_review") {
    allowed.add("review_not_approved");
    allowed.add("ad_in_review");
    if (input.level !== "ad") {
      allowed.add("partial_serving_review_not_approved");
      allowed.add("partial_serving_ad_in_review");
    }
  }
  return input.value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      typeof (item as { code?: unknown }).code === "string" &&
      allowed.has((item as { code: string }).code),
  );
}

export function openAIAdsLaunchContractHash(
  contract: StoredOpenAIAdsLaunchContract,
): string {
  return createHash("sha256").update(JSON.stringify(contract)).digest("base64url");
}

export function openAIAdsProviderPreviewHash(bodies: string[]): string | null {
  if (
    bodies.length === 0 ||
    bodies.length > 10 ||
    bodies.some(
      (body) =>
        typeof body !== "string" ||
        !body.trim() ||
        body.length > 1_000_000,
    )
  ) {
    return null;
  }
  return createHash("sha256").update(JSON.stringify(bodies)).digest("base64url");
}

function fail(code: string, message: string): OpenAIAdsLaunchValidation {
  return { ok: false, code, message };
}

function previewSignature(secret: string, encodedPayload: string): Buffer {
  const signingKey = createHmac("sha256", secret)
    .update("openai-ads-activation-preview-v1")
    .digest();
  return createHmac("sha256", signingKey).update(encodedPayload).digest();
}

export function issueOpenAIAdsActivationPreviewToken(input: {
  secret: string;
  userId: string;
  launchId: string;
  remoteAccountId: string;
  campaignId: string;
  adGroupId: string;
  adId: string;
  budget: OpenAIAdsLaunchBudgetSummary;
  contractHash: string;
  providerPreviewHash: string;
  nowMs?: number;
}): string {
  const payload: ActivationPreviewTokenPayload = {
    version: 1,
    userId: input.userId,
    launchId: input.launchId,
    remoteAccountId: input.remoteAccountId,
    campaignId: input.campaignId,
    adGroupId: input.adGroupId,
    adId: input.adId,
    currency: input.budget.currency,
    dailyBudgetMicros: input.budget.dailyBudgetMicros,
    contractHash: input.contractHash,
    providerPreviewHash: input.providerPreviewHash,
    expiresAtMs:
      (input.nowMs ?? Date.now()) + OPENAI_ADS_ACTIVATION_PREVIEW_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = previewSignature(input.secret, encodedPayload).toString(
    "base64url",
  );
  return `${encodedPayload}.${signature}`;
}

export function verifyOpenAIAdsActivationPreviewToken(input: {
  token: string;
  secret: string;
  userId: string;
  launchId: string;
  remoteAccountId: string;
  campaignId: string;
  adGroupId: string;
  adId: string;
  budget: OpenAIAdsLaunchBudgetSummary;
  contractHash: string;
  providerPreviewHash?: string;
  nowMs?: number;
}): boolean {
  const [encodedPayload, encodedSignature, extra] = input.token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return false;
  let suppliedSignature: Buffer;
  let parsedPayload: unknown;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
    parsedPayload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    return false;
  }
  const expectedSignature = previewSignature(input.secret, encodedPayload);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return false;
  }
  if (!isRecord(parsedPayload)) return false;
  const payload = parsedPayload as ActivationPreviewTokenPayload;
  return (
    payload.version === 1 &&
    payload.expiresAtMs >= (input.nowMs ?? Date.now()) &&
    payload.userId === input.userId &&
    payload.launchId === input.launchId &&
    payload.remoteAccountId === input.remoteAccountId &&
    payload.campaignId === input.campaignId &&
    payload.adGroupId === input.adGroupId &&
    payload.adId === input.adId &&
    payload.currency === input.budget.currency &&
    payload.dailyBudgetMicros === input.budget.dailyBudgetMicros &&
    typeof payload.contractHash === "string" &&
    payload.contractHash.length > 0 &&
    payload.contractHash === input.contractHash &&
    typeof payload.providerPreviewHash === "string" &&
    payload.providerPreviewHash.length > 0 &&
    (input.providerPreviewHash === undefined ||
      payload.providerPreviewHash === input.providerPreviewHash)
  );
}

export function budgetSummary(input: {
  currency: string;
  dailyBudgetMicros: number;
}): OpenAIAdsLaunchBudgetSummary | null {
  const currency = requiredText(input.currency)?.toUpperCase() ?? null;
  const dailyBudgetMicros = safePositiveInteger(input.dailyBudgetMicros);
  if (!currency || !/^[A-Z]{3}$/.test(currency) || !dailyBudgetMicros) {
    return null;
  }
  return {
    currency,
    dailyBudgetMicros,
  };
}

export function parseStoredOpenAIAdsLaunchContract(
  value: unknown,
): StoredOpenAIAdsLaunchContract | null {
  if (!isRecord(value) || value.contractVersion !== OPENAI_ADS_LAUNCH_CONTRACT) {
    return null;
  }
  const remoteAccountId = requiredText(value.remoteAccountId);
  const currency = requiredText(value.currency)?.toUpperCase() ?? null;
  const accountTimezone = requiredText(value.accountTimezone);
  const campaignName = requiredText(value.campaignName);
  const campaignDescription =
    value.campaignDescription === null
      ? null
      : requiredText(value.campaignDescription);
  const dailyBudgetMicros = safePositiveInteger(value.dailyBudgetMicros);
  const maxBidMicros = safePositiveInteger(value.maxBidMicros);
  const startTime = nullableNonNegativeSafeInteger(value.startTime);
  const endTime = nullableNonNegativeSafeInteger(value.endTime);
  const locationIds = uniqueTextArray(value.locationIds);
  const adGroupName = requiredText(value.adGroupName);
  const contextHints = uniqueTextArray(value.contextHints);
  const adName = requiredText(value.adName);
  const title = requiredText(value.title);
  const body = requiredText(value.body);
  const targetUrl = requiredText(value.targetUrl);
  const imageUrl = requiredText(value.imageUrl);
  const biddingType = value.biddingType;
  const billingEventType = value.billingEventType;
  if (
    !remoteAccountId ||
    !currency ||
    !accountTimezone ||
    !campaignName ||
    (value.campaignDescription !== null && !campaignDescription) ||
    !/^[A-Z]{3}$/.test(currency) ||
    !dailyBudgetMicros ||
    !maxBidMicros ||
    dailyBudgetMicros < OPENAI_ADS_MIN_DAILY_BUDGET_MICROS ||
    maxBidMicros > OPENAI_ADS_MAX_BID_MICROS ||
    startTime === undefined ||
    endTime === undefined ||
    !locationIds ||
    !adGroupName ||
    !contextHints ||
    !adName ||
    !title ||
    !body ||
    !targetUrl ||
    !imageUrl ||
    (startTime !== null &&
      (startTime < OPENAI_ADS_MIN_TIMESTAMP ||
        startTime > OPENAI_ADS_MAX_TIMESTAMP)) ||
    (endTime !== null &&
      (endTime < OPENAI_ADS_MIN_TIMESTAMP ||
        endTime > OPENAI_ADS_MAX_TIMESTAMP)) ||
    (startTime !== null && endTime !== null && endTime <= startTime) ||
    (biddingType !== "impressions" && biddingType !== "clicks") ||
    (billingEventType !== "impression" && billingEventType !== "click") ||
    (biddingType === "clicks" && billingEventType !== "click") ||
    (biddingType === "impressions" && billingEventType !== "impression")
  ) {
    return null;
  }
  return {
    contractVersion: OPENAI_ADS_LAUNCH_CONTRACT,
    remoteAccountId,
    currency,
    accountTimezone,
    campaignName,
    campaignDescription,
    biddingType,
    billingEventType,
    dailyBudgetMicros,
    maxBidMicros,
    startTime,
    endTime,
    locationIds,
    adGroupName,
    contextHints,
    adName,
    title,
    body,
    targetUrl,
    imageUrl,
  };
}

export function buildPausedCampaignPayload(input: {
  name: string;
  description: string | null;
  biddingType: "impressions" | "clicks";
  dailyBudgetMicros: number;
  startTime: number | null;
  endTime: number | null;
  locationIds: string[];
}): Record<string, unknown> {
  return {
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    status: "paused",
    budget: {
      daily_spend_limit_micros: input.dailyBudgetMicros,
    },
    bidding_type: input.biddingType,
    ...(input.startTime ? { start_time: input.startTime } : {}),
    ...(input.endTime ? { end_time: input.endTime } : {}),
    targeting: {
      locations: {
        include: input.locationIds.map((id) => ({ id })),
      },
    },
  };
}

export function buildPausedAdGroupPayload(input: {
  campaignId: string;
  name: string;
  description: string | null;
  contextHints: string[];
  billingEventType: "impression" | "click";
  maxBidMicros: number;
}): Record<string, unknown> {
  return {
    campaign_id: input.campaignId,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    context_hints: input.contextHints,
    status: "paused",
    bidding_config: {
      billing_event_type: input.billingEventType,
      strategy: "fixed_bid",
      max_bid_micros: input.maxBidMicros,
    },
  };
}

export function buildPausedAdPayload(input: {
  adGroupId: string;
  name: string;
  title: string;
  body: string;
  targetUrl: string;
  fileId: string;
}): Record<string, unknown> {
  return {
    ad_group_id: input.adGroupId,
    name: input.name,
    status: "paused",
    creative: {
      type: "chat_card",
      title: input.title,
      body: input.body,
      target_url: input.targetUrl,
      file_id: input.fileId,
    },
  };
}

export function validateOpenAIAdsLaunchReadback(input: {
  contract: StoredOpenAIAdsLaunchContract;
  expectedCampaignId: string;
  expectedAdGroupId: string;
  expectedAdId: string;
  expectedFileId: string;
  readback: OpenAIAdsLaunchReadback;
  expectedStatus: "paused" | "active";
  requireApprovedAd: boolean;
}): OpenAIAdsLaunchValidation {
  const { contract, readback } = input;
  if (readback.account.id !== contract.remoteAccountId) {
    return fail(
      "remote_account_mismatch",
      "Der API-Key gehört nicht zum erwarteten OpenAI-Ads-Konto.",
    );
  }
  if (readback.account.currency_code.toUpperCase() !== contract.currency) {
    return fail(
      "remote_currency_mismatch",
      "Die Währung des OpenAI-Ads-Kontos stimmt nicht mehr mit dem bestätigten Launch überein.",
    );
  }
  if (readback.account.timezone !== contract.accountTimezone) {
    return fail(
      "remote_timezone_mismatch",
      "Die Zeitzone des OpenAI-Ads-Kontos stimmt nicht mehr mit dem bestätigten Launch überein.",
    );
  }
  if (
    readback.account.status !== "active" ||
    readback.account.review.status !== "approved" ||
    (readback.account.account_integrity_review !== null &&
      readback.account.account_integrity_review !== undefined &&
      readback.account.account_integrity_review.review.status !== "approved")
  ) {
    return fail(
      "account_not_serving_ready",
      "Konto, Markenprüfung und eine vorhandene separate Kontoprüfung müssen aktiv beziehungsweise genehmigt sein.",
    );
  }
  if (
    readback.campaign.id !== input.expectedCampaignId ||
    readback.adGroup.id !== input.expectedAdGroupId ||
    readback.ad.id !== input.expectedAdId ||
    readback.parentageVerified !== true
  ) {
    return fail(
      "remote_chain_mismatch",
      "OpenAI Ads hat nicht die erwartete Kampagnenkette zurückgegeben.",
    );
  }
  if (
    readback.campaign.name !== contract.campaignName ||
    readback.campaign.description !== contract.campaignDescription ||
    readback.adGroup.name !== contract.adGroupName ||
    readback.adGroup.description !== contract.campaignDescription ||
    readback.ad.name !== contract.adName
  ) {
    return fail(
      "remote_identity_readback_mismatch",
      "OpenAI Ads hat Namen oder Beschreibung der bestätigten Kampagnenkette verändert.",
    );
  }
  if (
    readback.campaign.budget.daily_spend_limit_micros !==
      contract.dailyBudgetMicros ||
    readback.campaign.budget.lifetime_spend_limit_micros_present ||
    (readback.campaign.budget.lifetime_spend_limit_micros ?? null) !== null
  ) {
    return fail(
      "campaign_budget_readback_mismatch",
      "OpenAI Ads hat das erwartete kampagnenbezogene Tagesbudget nicht eindeutig bestätigt.",
    );
  }
  if (readback.campaign.bidding_type !== contract.biddingType) {
    return fail(
      "campaign_objective_readback_mismatch",
      "OpenAI Ads hat das erwartete Kampagnenziel nicht bestätigt.",
    );
  }
  const locationIds = targetingLocationIds(readback.campaign.targeting);
  if (
    readback.campaign.start_time !== contract.startTime ||
    readback.campaign.end_time !== contract.endTime ||
    readback.campaign.product_feed_id !== null ||
    !isNeutralLandingPageConfiguration(
      readback.campaign.landing_page_configuration,
    ) ||
    !locationIds ||
    !equalTextSets(locationIds, contract.locationIds)
  ) {
    return fail(
      "campaign_scope_readback_mismatch",
      "OpenAI Ads hat Zeitfenster oder Standorttargeting nicht wie bestätigt zurückgegeben.",
    );
  }
  if (
    readback.adGroup.bidding_config.billing_event_type !==
      contract.billingEventType ||
    readback.adGroup.bidding_config.strategy !== "fixed_bid" ||
    readback.adGroup.bidding_config.max_bid_micros !== contract.maxBidMicros ||
    (readback.adGroup.bidding_config.custom_audience_bid_multipliers?.length ??
      0) > 0
  ) {
    return fail(
      "ad_group_bid_readback_mismatch",
      "OpenAI Ads hat Abrechnung und Maximalgebot der Anzeigengruppe nicht bestätigt.",
    );
  }
  if (!equalTextSets(readback.adGroup.context_hints, contract.contextHints)) {
    return fail(
      "ad_group_context_readback_mismatch",
      "OpenAI Ads hat die Kontexthinweise der Anzeigengruppe nicht wie bestätigt zurückgegeben.",
    );
  }
  if (
    readback.adGroup.product_set !== null &&
    readback.adGroup.product_set !== undefined
  ) {
    return fail(
      "ad_group_product_scope_mismatch",
      "OpenAI Ads hat ein unerwartetes Produktset auf Anzeigengruppenebene zurückgegeben.",
    );
  }
  if (
    !isNeutralLandingPageConfiguration(
      readback.adGroup.landing_page_configuration,
    )
  ) {
    return fail(
      "ad_group_landing_scope_mismatch",
      "OpenAI Ads hat unerwartete Ziel-URL-Parameter auf Anzeigengruppenebene zurückgegeben.",
    );
  }
  if (
    readback.ad.creative.type !== "chat_card" ||
    readback.ad.creative.title !== contract.title ||
    readback.ad.creative.body !== contract.body ||
    (readback.ad.creative.price ?? null) !== null ||
    readback.ad.creative.target_url !== contract.targetUrl ||
    readback.ad.creative.file_id !== input.expectedFileId ||
    (readback.ad.creative.image_crop ?? null) !== null ||
    !isNeutralLandingPageConfiguration(
      readback.ad.landing_page_configuration,
    )
  ) {
    return fail(
      "ad_creative_readback_mismatch",
      "OpenAI Ads hat das bestätigte Creative nicht vollständig zurückgegeben.",
    );
  }
  if (
    readback.campaign.status !== input.expectedStatus ||
    readback.adGroup.status !== input.expectedStatus ||
    readback.ad.status !== input.expectedStatus
  ) {
    return fail(
      "launch_status_readback_mismatch",
      `OpenAI Ads hat den Status ${input.expectedStatus.toUpperCase()} nicht für die vollständige Kampagnenkette bestätigt.`,
    );
  }
  if (
    readback.campaign.serving_issues_observed !== true ||
    readback.adGroup.serving_issues_observed !== true ||
    readback.ad.serving_issues_observed !== true ||
    !servingIssuesAllowed({
      value: readback.campaign.serving_issues,
      level: "campaign",
      expectedStatus: input.expectedStatus,
      reviewStatus: readback.ad.review_status,
    }) ||
    !servingIssuesAllowed({
      value: readback.adGroup.serving_issues,
      level: "ad_group",
      expectedStatus: input.expectedStatus,
      reviewStatus: readback.ad.review_status,
    }) ||
    !servingIssuesAllowed({
      value: readback.ad.serving_issues,
      level: "ad",
      expectedStatus: input.expectedStatus,
      reviewStatus: readback.ad.review_status,
    })
  ) {
    return fail(
      "provider_serving_issue",
      "OpenAI Ads meldet ein Auslieferungsproblem für die Kampagnenkette.",
    );
  }
  if (input.requireApprovedAd && readback.ad.review_status !== "approved") {
    return fail(
      readback.ad.review_status === "rejected"
        ? "ad_review_rejected"
        : "ad_in_review",
      readback.ad.review_status === "rejected"
        ? "OpenAI hat die Anzeige abgelehnt. Bitte Creative und Richtlinien prüfen."
        : "Die Anzeige befindet sich noch in Prüfung und kann noch nicht aktiviert werden.",
    );
  }
  return { ok: true };
}
