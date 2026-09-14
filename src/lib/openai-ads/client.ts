import "server-only";

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_PAGES = 100;
const MAX_PREVIEW_ITEMS = 10;
const MAX_PREVIEW_BODY_LENGTH = 1_000_000;

export type OpenAIAdsAccount = {
  id: string;
  name: string;
  url: string;
  preview_url: string | null;
  status: string | null;
  timezone: string;
  currency_code: string;
  review: {
    status: "in_review" | "rejected" | "approved";
    reason?: string | null;
  };
  account_integrity_review: {
    review: {
      status: "in_review" | "rejected" | "approved";
      reason?: string | null;
    };
    details: {
      decision?: string | null;
      reason?: string | null;
      status_updated_at?: string | null;
    } | null;
  } | null;
};

export type OpenAIAdsCampaign = {
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
  created_at: number;
  updated_at: number;
  objective?: string | null;
  targeting?: Record<string, unknown> | null;
  product_feed_id: string | null;
  landing_page_configuration?: Record<string, unknown> | null;
  serving_issues?: unknown[];
  serving_issues_observed: boolean;
};

export type OpenAIAdsAdGroup = {
  id: string;
  name: string;
  description: string | null;
  context_hints: string[];
  status: string;
  landing_page_configuration?: Record<string, unknown> | null;
  product_set?: Record<string, unknown> | null;
  bidding_config: {
    billing_event_type: string;
    strategy?: string | null;
    max_bid_micros?: number | null;
    custom_audience_bid_multipliers?: unknown[];
  };
  created_at: number;
  updated_at: number;
  serving_issues?: unknown[];
  serving_issues_observed: boolean;
};

export type OpenAIAdsAd = {
  id: string;
  name: string;
  status: string;
  review_status: "in_review" | "rejected" | "approved";
  creative: {
    type: string;
    title: string;
    body: string;
    price?: string | null;
    file_id?: string | null;
    image_url?: string | null;
    image_crop?: Record<string, unknown> | null;
    target_url: string | null;
  };
  landing_page_configuration?: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  serving_issues?: unknown[];
  serving_issues_observed: boolean;
};

export type OpenAIAdsInsight = {
  id: string;
  start_time: number;
  end_time: number;
  readable_time: string;
  campaign_id: string;
  campaign_name: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions?: number | null;
  data_status?: string | null;
  [key: string]: unknown;
};

export type OpenAIAdsGeoLocation = {
  id: string;
  type: string;
  canonical_name: string;
  country_code: string;
  name: string;
  region_code: string | null;
};

export type OpenAIAdsConversionInsight = {
  entity_id: string;
  date: string;
  conversions: number;
  click_through_conversions: number | null;
  view_through_conversions: number | null;
};

export type OpenAIAdsAdPreview = {
  bodies: string[];
};

type ListResponse<T> = {
  object: string;
  data: T[];
  first_id: string | null;
  last_id: string | null;
  has_more: boolean;
  count?: number;
};

export class OpenAIAdsApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(input: {
    message: string;
    status: number;
    code?: string | null;
    requestId?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(input.message);
    this.name = "OpenAIAdsApiError";
    this.status = input.status;
    this.code = input.code ?? null;
    this.requestId = input.requestId ?? null;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} fehlt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }

  return value;
}

function asRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} fehlt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asOptionalNullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new OpenAIAdsApiError({
    message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht lesbar.`,
    status: 502,
    code: "invalid_provider_response",
  });
}

function asRequiredNullableString(
  payload: Record<string, unknown>,
  key: string,
  field: string,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} fehlt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return asOptionalNullableString(payload[key], field);
}

function asOptionalString(
  payload: Record<string, unknown>,
  key: string,
  field: string,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return null;
  return asString(payload[key], field);
}

function asOptionalNonNegativeSafeInteger(
  payload: Record<string, unknown>,
  key: string,
  field: string,
): number | null {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return null;
  const value = payload[key];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht exakt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return value;
}

function asRequiredNonNegativeFiniteNumber(
  payload: Record<string, unknown>,
  key: string,
  field: string,
): number {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} fehlt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const value = payload[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht exakt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return value;
}

function asOptionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (isRecord(value) && !Array.isArray(value)) return value;
  throw new OpenAIAdsApiError({
    message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht lesbar.`,
    status: 502,
    code: "invalid_provider_response",
  });
}

function asLandingPageConfiguration(
  value: unknown,
  field: string,
): Record<string, unknown> | null {
  const record = asOptionalRecord(value, field);
  if (
    record &&
    (!Object.prototype.hasOwnProperty.call(record, "query_string_template") ||
      (record.query_string_template !== null &&
        typeof record.query_string_template !== "string"))
  ) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field}.query_string_template fehlt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return record;
}

function asTargetingGeoLocations(value: unknown, field: string) {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht lesbar.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const result: Record<string, unknown> = { ...value };
  if (Object.prototype.hasOwnProperty.call(value, "countries")) {
    result.countries = asStringArray(value.countries, `${field}.countries`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "include")) {
    if (!Array.isArray(value.include)) {
      throw new OpenAIAdsApiError({
        message: `Ungültige OpenAI-Ads-Antwort: ${field}.include ist nicht lesbar.`,
        status: 502,
        code: "invalid_provider_response",
      });
    }
    result.include = value.include.map((item, index) => {
      if (!isRecord(item) || Array.isArray(item)) {
        throw new OpenAIAdsApiError({
          message: `Ungültige OpenAI-Ads-Antwort: ${field}.include.${index} ist nicht lesbar.`,
          status: 502,
          code: "invalid_provider_response",
        });
      }
      return {
        id: asString(item.id, `${field}.include.${index}.id`),
        name: asString(item.name, `${field}.include.${index}.name`),
        type: asString(item.type, `${field}.include.${index}.type`),
        country_code: asString(
          item.country_code,
          `${field}.include.${index}.country_code`,
        ),
        region_code: asRequiredNullableString(
          item,
          "region_code",
          `${field}.include.${index}.region_code`,
        ),
      };
    });
  }
  return result;
}

function asTargetingDimensionRecord(
  value: unknown,
  field: string,
  requiredArrayKey: string | null,
) {
  if (!isRecord(value) || Array.isArray(value)) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht lesbar.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const result: Record<string, unknown> = { ...value };
  if (requiredArrayKey) {
    if (!Object.prototype.hasOwnProperty.call(value, requiredArrayKey)) {
      throw new OpenAIAdsApiError({
        message: `Ungültige OpenAI-Ads-Antwort: ${field}.${requiredArrayKey} fehlt.`,
        status: 502,
        code: "invalid_provider_response",
      });
    }
    result[requiredArrayKey] = asStringArray(
      value[requiredArrayKey],
      `${field}.${requiredArrayKey}`,
    );
  } else if (Object.prototype.hasOwnProperty.call(value, "included")) {
    result.included = asStringArray(value.included, `${field}.included`);
  }
  return result;
}

function asTargeting(
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return null;
  const value = payload[key];
  if (!isRecord(value) || Array.isArray(value)) {
    throw new OpenAIAdsApiError({
      message: "Ungültige OpenAI-Ads-Antwort: campaign.targeting ist nicht lesbar.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const result: Record<string, unknown> = { ...value };
  for (const dimension of ["locations", "excluded_locations"] as const) {
    if (Object.prototype.hasOwnProperty.call(value, dimension)) {
      result[dimension] = asTargetingGeoLocations(
        value[dimension],
        `campaign.targeting.${dimension}`,
      );
    }
  }
  for (const dimension of [
    "custom_audiences",
    "excluded_custom_audiences",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(value, dimension)) {
      result[dimension] = asTargetingDimensionRecord(
        value[dimension],
        `campaign.targeting.${dimension}`,
        "ids",
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "platforms")) {
    result.platforms = asTargetingDimensionRecord(
      value.platforms,
      "campaign.targeting.platforms",
      null,
    );
  }
  return result;
}

function asImageCrop(
  payload: Record<string, unknown>,
  key: string,
): Record<string, number> | null {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) return null;
  const value = payload[key];
  if (!isRecord(value) || Array.isArray(value)) {
    throw new OpenAIAdsApiError({
      message: "Ungültige OpenAI-Ads-Antwort: ad.creative.image_crop ist nicht lesbar.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const crop = Object.fromEntries(
    ["x", "y", "width", "height"].map((field) => {
      const coordinate = value[field];
      if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
        throw new OpenAIAdsApiError({
          message: `Ungültige OpenAI-Ads-Antwort: ad.creative.image_crop.${field} fehlt.`,
          status: 502,
          code: "invalid_provider_response",
        });
      }
      return [field, coordinate];
    }),
  ) as Record<"x" | "y" | "width" | "height", number>;
  if (
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    Math.abs(crop.width - crop.height) > 1e-9 ||
    crop.x + crop.width > 1 ||
    crop.y + crop.height > 1
  ) {
    throw new OpenAIAdsApiError({
      message: "Ungültige OpenAI-Ads-Antwort: ad.creative.image_crop liegt außerhalb des Bildes.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return crop;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht lesbar.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return value;
}

function servingIssues(payload: Record<string, unknown>, field: string) {
  const observed = Object.prototype.hasOwnProperty.call(payload, "serving_issues");
  if (observed && !Array.isArray(payload.serving_issues)) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht lesbar.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const values = observed ? (payload.serving_issues as unknown[]) : [];
  for (const item of values) {
    if (!isRecord(item) || Array.isArray(item)) {
      throw new OpenAIAdsApiError({
        message: `Ungültige OpenAI-Ads-Antwort: ${field}.code fehlt.`,
        status: 502,
        code: "invalid_provider_response",
      });
    }
    asString(item.code, `${field}.code`);
  }
  return {
    values,
    observed,
  };
}

function asProductSet(value: unknown): Record<string, unknown> | null {
  const productSet = asOptionalRecord(value, "ad_group.product_set");
  if (!productSet) return null;
  const productFeedId = asString(
    productSet.product_feed_id,
    "ad_group.product_set.product_feed_id",
  );
  if (!Array.isArray(productSet.filters)) {
    throw new OpenAIAdsApiError({
      message: "Ungültige OpenAI-Ads-Antwort: ad_group.product_set.filters fehlt.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const filters = productSet.filters.map((value, index) => {
    if (!isRecord(value) || Array.isArray(value)) {
      throw new OpenAIAdsApiError({
        message: `Ungültige OpenAI-Ads-Antwort: ad_group.product_set.filters.${index} fehlt.`,
        status: 502,
        code: "invalid_provider_response",
      });
    }
    return {
      field: asString(value.field, `ad_group.product_set.filters.${index}.field`),
      operator: asString(
        value.operator,
        `ad_group.product_set.filters.${index}.operator`,
      ),
      values: asStringArray(
        value.values,
        `ad_group.product_set.filters.${index}.values`,
      ),
    };
  });
  return { product_feed_id: productFeedId, filters };
}

function asBidMultipliers(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat ungültige Gebotsmultiplikatoren zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return value.map((item, index) => {
    if (!isRecord(item) || Array.isArray(item)) {
      throw new OpenAIAdsApiError({
        message: `Ungültige OpenAI-Ads-Antwort: bid_multiplier.${index} fehlt.`,
        status: 502,
        code: "invalid_provider_response",
      });
    }
    return {
      custom_audience_id: asString(
        item.custom_audience_id,
        `bid_multiplier.${index}.custom_audience_id`,
      ),
      bid_multiplier_micros: asRequiredNonNegativeSafeInteger(
        item,
        "bid_multiplier_micros",
        `bid_multiplier.${index}.bid_multiplier_micros`,
      ),
    };
  });
}

function asNullableNonNegativeSafeInteger(
  value: unknown,
  field: string,
): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} ist nicht exakt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return value;
}

function asRequiredNullableNonNegativeSafeInteger(
  payload: Record<string, unknown>,
  key: string,
  field: string,
): number | null {
  if (!Object.prototype.hasOwnProperty.call(payload, key)) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} fehlt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return asNullableNonNegativeSafeInteger(payload[key], field);
}

function asRequiredNonNegativeSafeInteger(
  payload: Record<string, unknown>,
  key: string,
  field: string,
): number {
  const value = asRequiredNullableNonNegativeSafeInteger(payload, key, field);
  if (value === null) {
    throw new OpenAIAdsApiError({
      message: `Ungültige OpenAI-Ads-Antwort: ${field} fehlt.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return value;
}

function parseError(payload: unknown): { message: string; code: string | null } {
  if (!isRecord(payload)) {
    return {
      message: "OpenAI Ads hat die Anfrage abgelehnt.",
      code: null,
    };
  }

  const nested = isRecord(payload.error) ? payload.error : payload;
  return {
    message:
      typeof nested.message === "string" && nested.message.trim()
        ? nested.message
        : "OpenAI Ads hat die Anfrage abgelehnt.",
    code:
      typeof nested.code === "string"
        ? nested.code
        : typeof nested.type === "string"
          ? nested.type
          : null,
  };
}

function parseList<T>(
  payload: unknown,
  itemParser: (value: unknown) => T,
  requireCount = false,
): ListResponse<T> {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.data) ||
    typeof payload.object !== "string" ||
    !Object.prototype.hasOwnProperty.call(payload, "first_id") ||
    (payload.first_id !== null && typeof payload.first_id !== "string") ||
    !Object.prototype.hasOwnProperty.call(payload, "last_id") ||
    (payload.last_id !== null && typeof payload.last_id !== "string") ||
    typeof payload.has_more !== "boolean" ||
    (requireCount && !Object.prototype.hasOwnProperty.call(payload, "count")) ||
    (Object.prototype.hasOwnProperty.call(payload, "count") &&
      (typeof payload.count !== "number" ||
        !Number.isSafeInteger(payload.count) ||
        payload.count < 0))
  ) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat keine gültige Liste zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  return {
    object: payload.object,
    data: payload.data.map(itemParser),
    first_id: payload.first_id,
    last_id: payload.last_id,
    has_more: payload.has_more,
    count: typeof payload.count === "number" ? payload.count : payload.data.length,
  };
}

function parseAccountIntegrityReview(
  payload: Record<string, unknown>,
): OpenAIAdsAccount["account_integrity_review"] {
  if (!Object.prototype.hasOwnProperty.call(payload, "account_integrity_review")) {
    return null;
  }
  const integrity = payload.account_integrity_review;
  if (!isRecord(integrity) || Array.isArray(integrity) || !isRecord(integrity.review)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat kein gültiges Account-Integrity-Review zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const status = asString(
    integrity.review.status,
    "account_integrity_review.review.status",
  );
  if (!["in_review", "rejected", "approved"].includes(status)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat einen unbekannten Account-Integrity-Reviewstatus zurückgegeben.",
      status: 502,
      code: "unknown_review_status",
    });
  }
  let details: OpenAIAdsAccount["account_integrity_review"] extends infer T
    ? T extends { details: infer D }
      ? D
      : never
    : never = null;
  if (Object.prototype.hasOwnProperty.call(integrity, "details")) {
    if (!isRecord(integrity.details) || Array.isArray(integrity.details)) {
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads hat ungültige Account-Integrity-Details zurückgegeben.",
        status: 502,
        code: "invalid_provider_response",
      });
    }
    details = {
      decision: asOptionalString(
        integrity.details,
        "decision",
        "account_integrity_review.details.decision",
      ),
      reason: asOptionalString(
        integrity.details,
        "reason",
        "account_integrity_review.details.reason",
      ),
      status_updated_at: asOptionalString(
        integrity.details,
        "status_updated_at",
        "account_integrity_review.details.status_updated_at",
      ),
    };
  }
  return {
    review: {
      status: status as "in_review" | "rejected" | "approved",
      reason: asOptionalString(
        integrity.review,
        "reason",
        "account_integrity_review.review.reason",
      ),
    },
    details,
  };
}

function parseAccount(payload: unknown): OpenAIAdsAccount {
  if (!isRecord(payload) || !isRecord(payload.review)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat keine gültigen Kontodaten zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  const reviewStatus = asString(payload.review.status, "review.status");
  if (!["in_review", "rejected", "approved"].includes(reviewStatus)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat einen unbekannten Reviewstatus zurückgegeben.",
      status: 502,
      code: "unknown_review_status",
    });
  }

  return {
    id: asString(payload.id, "id"),
    name: asString(payload.name, "name"),
    url: asString(payload.url, "url"),
    preview_url: asRequiredNullableString(payload, "preview_url", "preview_url"),
    status: asOptionalString(payload, "status", "status"),
    timezone: asString(payload.timezone, "timezone"),
    currency_code: asString(payload.currency_code, "currency_code").toUpperCase(),
    review: {
      status: reviewStatus as OpenAIAdsAccount["review"]["status"],
      reason: asOptionalString(payload.review, "reason", "review.reason"),
    },
    account_integrity_review: parseAccountIntegrityReview(payload),
  };
}

function parseCampaign(payload: unknown): OpenAIAdsCampaign {
  if (!isRecord(payload) || !isRecord(payload.budget)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat eine ungültige Kampagne zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const campaignServingIssues = servingIssues(
    payload,
    "campaign.serving_issues",
  );

  return {
    id: asString(payload.id, "campaign.id"),
    name: asString(payload.name, "campaign.name"),
    description: asRequiredNullableString(
      payload,
      "description",
      "campaign.description",
    ),
    status: asString(payload.status, "campaign.status"),
    bidding_type: asString(payload.bidding_type, "campaign.bidding_type"),
    budget: {
      lifetime_spend_limit_micros: asOptionalNonNegativeSafeInteger(
        payload.budget,
        "lifetime_spend_limit_micros",
        "campaign.budget.lifetime_spend_limit_micros",
      ),
      lifetime_spend_limit_micros_present: Object.prototype.hasOwnProperty.call(
        payload.budget,
        "lifetime_spend_limit_micros",
      ),
      daily_spend_limit_micros: asOptionalNonNegativeSafeInteger(
        payload.budget,
        "daily_spend_limit_micros",
        "campaign.budget.daily_spend_limit_micros",
      ),
    },
    start_time: asRequiredNullableNonNegativeSafeInteger(
      payload,
      "start_time",
      "campaign.start_time",
    ),
    end_time: asRequiredNullableNonNegativeSafeInteger(
      payload,
      "end_time",
      "campaign.end_time",
    ),
    created_at: asRequiredNonNegativeSafeInteger(
      payload,
      "created_at",
      "campaign.created_at",
    ),
    updated_at: asRequiredNonNegativeSafeInteger(
      payload,
      "updated_at",
      "campaign.updated_at",
    ),
    objective: asOptionalString(payload, "objective", "campaign.objective"),
    targeting: asTargeting(payload, "targeting"),
    product_feed_id: asRequiredNullableString(
      payload,
      "product_feed_id",
      "campaign.product_feed_id",
    ),
    landing_page_configuration: asLandingPageConfiguration(
      payload.landing_page_configuration,
      "campaign.landing_page_configuration",
    ),
    serving_issues: campaignServingIssues.values,
    serving_issues_observed: campaignServingIssues.observed,
  };
}

function parseAdGroup(payload: unknown): OpenAIAdsAdGroup {
  if (!isRecord(payload) || !isRecord(payload.bidding_config)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat eine ungültige Anzeigengruppe zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const adGroupServingIssues = servingIssues(
    payload,
    "ad_group.serving_issues",
  );
  return {
    id: asString(payload.id, "ad_group.id"),
    name: asString(payload.name, "ad_group.name"),
    description: asRequiredNullableString(
      payload,
      "description",
      "ad_group.description",
    ),
    context_hints: asStringArray(
      payload.context_hints,
      "ad_group.context_hints",
    ),
    status: asString(payload.status, "ad_group.status"),
    landing_page_configuration: asLandingPageConfiguration(
      payload.landing_page_configuration,
      "ad_group.landing_page_configuration",
    ),
    product_set: asProductSet(payload.product_set),
    bidding_config: {
      billing_event_type: asString(
        payload.bidding_config.billing_event_type,
        "ad_group.billing_event_type",
      ),
      strategy: asOptionalString(
        payload.bidding_config,
        "strategy",
        "ad_group.bidding_config.strategy",
      ),
      max_bid_micros: asOptionalNonNegativeSafeInteger(
        payload.bidding_config,
        "max_bid_micros",
        "ad_group.bidding_config.max_bid_micros",
      ),
      custom_audience_bid_multipliers: asBidMultipliers(
        payload.bidding_config.custom_audience_bid_multipliers,
      ),
    },
    created_at: asRequiredNonNegativeSafeInteger(
      payload,
      "created_at",
      "ad_group.created_at",
    ),
    updated_at: asRequiredNonNegativeSafeInteger(
      payload,
      "updated_at",
      "ad_group.updated_at",
    ),
    serving_issues: adGroupServingIssues.values,
    serving_issues_observed: adGroupServingIssues.observed,
  };
}

function parseAd(payload: unknown): OpenAIAdsAd {
  if (
    !isRecord(payload) ||
    !isRecord(payload.creative) ||
    !isRecord(payload.review)
  ) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat eine ungültige Anzeige zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }
  const adServingIssues = servingIssues(payload, "ad.serving_issues");

  const reviewStatus = asString(payload.review_status, "ad.review_status");
  if (!["in_review", "rejected", "approved"].includes(reviewStatus)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat einen unbekannten Anzeigen-Reviewstatus zurückgegeben.",
      status: 502,
      code: "unknown_review_status",
    });
  }
  const nestedReviewStatus = asString(payload.review.status, "ad.review.status");
  if (nestedReviewStatus !== reviewStatus) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat widersprüchliche Anzeigen-Reviewstatus geliefert.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  return {
    id: asString(payload.id, "ad.id"),
    name: asString(payload.name, "ad.name"),
    status: asString(payload.status, "ad.status"),
    review_status: reviewStatus as OpenAIAdsAd["review_status"],
    creative: {
      type: asString(payload.creative.type, "ad.creative.type"),
      title: asString(payload.creative.title, "ad.creative.title"),
      body: asRequiredString(payload.creative.body, "ad.creative.body"),
      price: asOptionalString(payload.creative, "price", "ad.creative.price"),
      file_id: asOptionalString(
        payload.creative,
        "file_id",
        "ad.creative.file_id",
      ),
      image_url: asOptionalNullableString(
        payload.creative.image_url,
        "ad.creative.image_url",
      ),
      image_crop: asImageCrop(payload.creative, "image_crop"),
      target_url: asRequiredNullableString(
        payload.creative,
        "target_url",
        "ad.creative.target_url",
      ),
    },
    landing_page_configuration: asLandingPageConfiguration(
      payload.landing_page_configuration,
      "ad.landing_page_configuration",
    ),
    created_at: asRequiredNonNegativeSafeInteger(
      payload,
      "created_at",
      "ad.created_at",
    ),
    updated_at: asRequiredNonNegativeSafeInteger(
      payload,
      "updated_at",
      "ad.updated_at",
    ),
    serving_issues: adServingIssues.values,
    serving_issues_observed: adServingIssues.observed,
  };
}

function parseInsight(payload: unknown): OpenAIAdsInsight {
  if (!isRecord(payload)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat ungültige Insightdaten zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  return {
    ...payload,
    id: asString(payload.id, "insight.id"),
    start_time: asRequiredNonNegativeSafeInteger(
      payload,
      "start_time",
      "insight.start_time",
    ),
    end_time: asRequiredNonNegativeSafeInteger(
      payload,
      "end_time",
      "insight.end_time",
    ),
    readable_time: asString(payload.readable_time, "insight.readable_time"),
    campaign_id: asString(payload.campaign_id, "insight.campaign_id"),
    campaign_name: asString(payload.campaign_name, "insight.campaign_name"),
    impressions: asRequiredNonNegativeSafeInteger(
      payload,
      "impressions",
      "insight.impressions",
    ),
    clicks: asRequiredNonNegativeSafeInteger(
      payload,
      "clicks",
      "insight.clicks",
    ),
    spend: asRequiredNonNegativeFiniteNumber(payload, "spend", "insight.spend"),
    conversions:
      typeof payload.conversions === "number" ? payload.conversions : null,
    data_status: asNullableString(payload.data_status),
  };
}

function parseGeoLocation(payload: unknown): OpenAIAdsGeoLocation {
  if (!isRecord(payload)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat einen ungültigen Standort zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  return {
    id: asString(payload.id, "geo.id"),
    type: asString(payload.type, "geo.type"),
    canonical_name: asString(payload.canonical_name, "geo.canonical_name"),
    country_code: asString(payload.country_code, "geo.country_code"),
    name: asString(payload.name, "geo.name"),
    region_code: asOptionalNullableString(payload.region_code, "geo.region_code"),
  };
}

function requireServingIssuesObserved<T extends { serving_issues_observed: boolean }>(
  items: T[],
  field: string,
): T[] {
  if (items.some((item) => item.serving_issues_observed !== true)) {
    throw new OpenAIAdsApiError({
      message: `OpenAI Ads hat ${field} trotz ausdrücklicher Anforderung nicht zurückgegeben.`,
      status: 502,
      code: "invalid_provider_response",
    });
  }
  return items;
}

function parseConversionInsight(
  payload: unknown,
  date: string,
): OpenAIAdsConversionInsight {
  if (!isRecord(payload)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat ungültige Conversiondaten zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  return {
    entity_id: asString(payload.entity_id, "conversion.entity_id"),
    date,
    conversions: asRequiredNonNegativeSafeInteger(
      payload,
      "conversions",
      "conversion.conversions",
    ),
    click_through_conversions:
      asOptionalNonNegativeSafeInteger(
        payload,
        "click_through_conversions",
        "conversion.click_through_conversions",
      ),
    view_through_conversions:
      asOptionalNonNegativeSafeInteger(
        payload,
        "view_through_conversions",
        "conversion.view_through_conversions",
      ),
  };
}

export type OpenAIAdsClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  deadlineAtMs?: number;
};

export class OpenAIAdsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly deadlineAtMs: number | null;

  constructor(options: OpenAIAdsClientOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("OpenAI Ads API Key fehlt.");
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.deadlineAtMs = options.deadlineAtMs ?? null;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const remainingMs = this.deadlineAtMs
      ? this.deadlineAtMs - Date.now()
      : REQUEST_TIMEOUT_MS;
    if (remainingMs <= 1_000) {
      throw new OpenAIAdsApiError({
        message: "Das Zeitbudget des OpenAI-Ads-Abrufs ist ausgeschöpft.",
        status: 503,
        code: "sync_deadline_exceeded",
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(REQUEST_TIMEOUT_MS, remainingMs),
    );

    try {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${this.apiKey}`);
      headers.set("Accept", "application/json");
      if (init.body && !(init.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
      }

      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload: unknown = null;

      if (raw) {
        try {
          payload = JSON.parse(raw) as unknown;
        } catch {
          payload = null;
        }
      }

      if (!response.ok) {
        const parsed = parseError(payload);
        const retryAfter = Number(response.headers.get("retry-after"));
        throw new OpenAIAdsApiError({
          message: parsed.message,
          status: response.status,
          code: parsed.code,
          requestId:
            response.headers.get("x-request-id") ??
            response.headers.get("openai-request-id"),
          retryAfterSeconds:
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
        });
      }

      return payload;
    } catch (error) {
      if (error instanceof OpenAIAdsApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new OpenAIAdsApiError({
          message: "OpenAI Ads hat nicht rechtzeitig geantwortet.",
          status: 504,
          code: "provider_timeout",
        });
      }
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads ist derzeit nicht erreichbar.",
        status: 502,
        code: "provider_unavailable",
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async listAll<T>(
    path: string,
    params: URLSearchParams,
    parser: (value: unknown) => T,
    requireCount = false,
  ): Promise<T[]> {
    const items: T[] = [];
    let after: string | null = null;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams(params);
      query.set("limit", query.get("limit") ?? "500");
      if (after) {
        query.set("after", after);
      }

      const payload = await this.request(`${path}?${query.toString()}`);
      const response = parseList(payload, parser, requireCount);
      items.push(...response.data);

      if (!response.has_more) {
        return items;
      }
      if (!response.last_id || response.last_id === after) {
        throw new OpenAIAdsApiError({
          message: "OpenAI Ads hat einen ungültigen Pagination-Cursor geliefert.",
          status: 502,
          code: "invalid_pagination",
        });
      }
      after = response.last_id;
    }

    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat zu viele Ergebnisseiten geliefert.",
      status: 502,
      code: "pagination_limit_exceeded",
    });
  }

  async getAdAccount(): Promise<OpenAIAdsAccount> {
    return parseAccount(await this.request("/ad_account"));
  }

  async listCampaigns(): Promise<OpenAIAdsCampaign[]> {
    const query = new URLSearchParams();
    query.append("include[]", "serving_issues");
    return requireServingIssuesObserved(
      await this.listAll("/campaigns", query, parseCampaign),
      "campaign.serving_issues",
    );
  }

  async getCampaign(id: string): Promise<OpenAIAdsCampaign> {
    return requireServingIssuesObserved(
      [parseCampaign(await this.request(
        `/campaigns/${encodeURIComponent(id)}?include%5B%5D=serving_issues`,
      ))],
      "campaign.serving_issues",
    )[0];
  }

  async listAdGroups(campaignId: string): Promise<OpenAIAdsAdGroup[]> {
    const query = new URLSearchParams({ campaign_id: campaignId });
    query.append("include[]", "serving_issues");
    return requireServingIssuesObserved(
      await this.listAll("/ad_groups", query, parseAdGroup),
      "ad_group.serving_issues",
    );
  }

  async getAdGroup(id: string): Promise<OpenAIAdsAdGroup> {
    return requireServingIssuesObserved(
      [parseAdGroup(await this.request(
        `/ad_groups/${encodeURIComponent(id)}?include%5B%5D=serving_issues`,
      ))],
      "ad_group.serving_issues",
    )[0];
  }

  async listAds(adGroupId: string): Promise<OpenAIAdsAd[]> {
    const query = new URLSearchParams({ ad_group_id: adGroupId });
    query.append("include[]", "serving_issues");
    return requireServingIssuesObserved(
      await this.listAll("/ads", query, parseAd),
      "ad.serving_issues",
    );
  }

  async getAd(id: string): Promise<OpenAIAdsAd> {
    return requireServingIssuesObserved(
      [parseAd(await this.request(
        `/ads/${encodeURIComponent(id)}?include%5B%5D=serving_issues`,
      ))],
      "ad.serving_issues",
    )[0];
  }

  async listDailyCampaignInsights(input: {
    startUnix: number;
    endUnix: number;
  }): Promise<OpenAIAdsInsight[]> {
    const query = new URLSearchParams({
      time_granularity: "daily",
      aggregation_level: "campaign",
      limit: "2000",
    });
    query.append("includes[]", "zero_impression_items");
    for (const field of [
      "metadata.readable_time",
      "campaign.id",
      "campaign.name",
      "campaign.clicks",
      "campaign.impressions",
      "campaign.spend",
    ]) {
      query.append("fields[]", field);
    }
    query.append(
      "time_ranges[]",
      JSON.stringify({
        type: "unix_range",
        start: input.startUnix,
        end: input.endUnix,
      }),
    );

    return this.listAll(
      "/ad_account/insights",
      query,
      parseInsight,
      true,
    );
  }

  async searchGeoLocations(queryText: string): Promise<OpenAIAdsGeoLocation[]> {
    const query = new URLSearchParams({ q: queryText, limit: "20" });
    const payload = await this.request(`/geo_lookup/search?${query.toString()}`);
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads hat keine gültigen Standortergebnisse geliefert.",
        status: 502,
        code: "invalid_provider_response",
      });
    }
    return payload.results.map(parseGeoLocation);
  }

  async listDailyCampaignConversions(input: {
    date: string;
    startUnix: number;
    endUnix: number;
    campaignIds: string[];
  }): Promise<OpenAIAdsConversionInsight[]> {
    if (input.campaignIds.length === 0) {
      return [];
    }
    const payload = await this.request("/conversions/insights", {
      method: "POST",
      body: JSON.stringify({
        aggregation_level: "campaign",
        time_ranges: [
          JSON.stringify({
            type: "unix_range",
            start: String(input.startUnix),
            end: String(input.endUnix),
          }),
        ],
        entity_ids: input.campaignIds,
        include_zero_rows: true,
      }),
    });
    if (
      !isRecord(payload) ||
      typeof payload.object !== "string" ||
      !Array.isArray(payload.data) ||
      typeof payload.count !== "number" ||
      !Number.isSafeInteger(payload.count) ||
      payload.count < 0
    ) {
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads hat keine gültigen Conversiondaten geliefert.",
        status: 502,
        code: "invalid_provider_response",
      });
    }
    const rows = payload.data.map((item) =>
      parseConversionInsight(item, input.date),
    );
    const expectedIds = new Set(input.campaignIds);
    const returnedIds = new Set(rows.map((item) => item.entity_id));
    if (
      payload.count !== rows.length ||
      rows.length !== expectedIds.size ||
      returnedIds.size !== expectedIds.size ||
      rows.some((item) => !expectedIds.has(item.entity_id)) ||
      input.campaignIds.some((id) => !returnedIds.has(id))
    ) {
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads hat Conversiondaten nicht vollständig und eindeutig geliefert.",
        status: 502,
        code: "invalid_provider_response",
      });
    }
    return rows;
  }

  async uploadImageUrl(imageUrl: string, idempotencyKey?: string): Promise<string> {
    const payload = await this.request("/upload", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify({ image_url: imageUrl }),
    });
    if (!isRecord(payload)) {
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads hat keine gültige Datei-ID zurückgegeben.",
        status: 502,
        code: "invalid_provider_response",
      });
    }
    return asString(payload.file_id, "file_id");
  }

  async createCampaign(
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<OpenAIAdsCampaign> {
    return parseCampaign(
      await this.request("/campaigns", {
        method: "POST",
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
        body: JSON.stringify(input),
      }),
    );
  }

  async createAdGroup(
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<OpenAIAdsAdGroup> {
    return parseAdGroup(
      await this.request("/ad_groups", {
        method: "POST",
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
        body: JSON.stringify(input),
      }),
    );
  }

  async createAd(
    input: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<OpenAIAdsAd> {
    return parseAd(
      await this.request("/ads", {
        method: "POST",
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
        body: JSON.stringify(input),
      }),
    );
  }

  async activateCampaign(id: string): Promise<OpenAIAdsCampaign> {
    return parseCampaign(
      await this.request(`/campaigns/${encodeURIComponent(id)}/activate`, {
        method: "POST",
      }),
    );
  }

  async pauseCampaign(id: string): Promise<OpenAIAdsCampaign> {
    return parseCampaign(
      await this.request(`/campaigns/${encodeURIComponent(id)}/pause`, {
        method: "POST",
      }),
    );
  }

  async activateAdGroup(id: string): Promise<OpenAIAdsAdGroup> {
    return parseAdGroup(
      await this.request(`/ad_groups/${encodeURIComponent(id)}/activate`, {
        method: "POST",
      }),
    );
  }

  async pauseAdGroup(id: string): Promise<OpenAIAdsAdGroup> {
    return parseAdGroup(
      await this.request(`/ad_groups/${encodeURIComponent(id)}/pause`, {
        method: "POST",
      }),
    );
  }

  async activateAd(id: string): Promise<OpenAIAdsAd> {
    return parseAd(
      await this.request(`/ads/${encodeURIComponent(id)}/activate`, {
        method: "POST",
      }),
    );
  }

  async pauseAd(id: string): Promise<OpenAIAdsAd> {
    return parseAd(
      await this.request(`/ads/${encodeURIComponent(id)}/pause`, {
        method: "POST",
      }),
    );
  }

  async previewAd(id: string): Promise<OpenAIAdsAdPreview> {
    const payload = await this.request(`/ads/${encodeURIComponent(id)}/preview`, {
      method: "POST",
    });
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.data) ||
      payload.data.length === 0 ||
      payload.data.length > MAX_PREVIEW_ITEMS ||
      payload.data.some(
        (item) =>
          !isRecord(item) ||
          typeof item.body !== "string" ||
          !item.body.trim() ||
          item.body.length > MAX_PREVIEW_BODY_LENGTH,
      )
    ) {
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads hat keine gültige Vorschau zurückgegeben.",
        status: 502,
        code: "invalid_provider_response",
      });
    }
    return { bodies: payload.data.map((item) => (item as { body: string }).body) };
  }
}
