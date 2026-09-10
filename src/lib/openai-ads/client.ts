import "server-only";

const REQUEST_TIMEOUT_MS = 25_000;
const MAX_PAGES = 100;

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
};

export type OpenAIAdsCampaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  bidding_type: string;
  budget: {
    lifetime_spend_limit_micros?: number | null;
    daily_spend_limit_micros?: number | null;
  };
  start_time: number | null;
  end_time: number | null;
  created_at: number;
  updated_at: number;
  objective?: string | null;
  targeting?: Record<string, unknown> | null;
  serving_issues?: unknown[];
};

export type OpenAIAdsAdGroup = {
  id: string;
  name: string;
  description: string | null;
  context_hints: string[];
  status: string;
  bidding_config: {
    billing_event_type: string;
    strategy?: string | null;
    max_bid_micros?: number | null;
  };
  created_at: number;
  updated_at: number;
  serving_issues?: unknown[];
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
    file_id?: string | null;
    image_url?: string | null;
    target_url: string | null;
  };
  created_at: number;
  updated_at: number;
  serving_issues?: unknown[];
};

export type OpenAIAdsInsight = {
  id: string;
  start_time: number;
  end_time: number;
  readable_time?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  impressions?: number | null;
  clicks?: number | null;
  spend?: number | null;
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
  date: string | null;
  conversions: number;
  click_through_conversions: number | null;
  view_through_conversions: number | null;
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

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

function parseList<T>(payload: unknown, itemParser: (value: unknown) => T): ListResponse<T> {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat keine gültige Liste zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  return {
    object: typeof payload.object === "string" ? payload.object : "list",
    data: payload.data.map(itemParser),
    first_id: asNullableString(payload.first_id),
    last_id: asNullableString(payload.last_id),
    has_more: payload.has_more === true,
    count: asFiniteNumber(payload.count, payload.data.length),
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
    preview_url: asNullableString(payload.preview_url),
    status: asNullableString(payload.status),
    timezone: asString(payload.timezone, "timezone"),
    currency_code: asString(payload.currency_code, "currency_code").toUpperCase(),
    review: {
      status: reviewStatus as OpenAIAdsAccount["review"]["status"],
      reason: asNullableString(payload.review.reason),
    },
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

  return {
    id: asString(payload.id, "campaign.id"),
    name: asString(payload.name, "campaign.name"),
    description: asNullableString(payload.description),
    status: asString(payload.status, "campaign.status"),
    bidding_type: asString(payload.bidding_type, "campaign.bidding_type"),
    budget: {
      lifetime_spend_limit_micros:
        typeof payload.budget.lifetime_spend_limit_micros === "number"
          ? payload.budget.lifetime_spend_limit_micros
          : null,
      daily_spend_limit_micros:
        typeof payload.budget.daily_spend_limit_micros === "number"
          ? payload.budget.daily_spend_limit_micros
          : null,
    },
    start_time:
      typeof payload.start_time === "number" ? payload.start_time : null,
    end_time: typeof payload.end_time === "number" ? payload.end_time : null,
    created_at: asFiniteNumber(payload.created_at),
    updated_at: asFiniteNumber(payload.updated_at),
    objective: asNullableString(payload.objective),
    targeting: isRecord(payload.targeting) ? payload.targeting : null,
    serving_issues: Array.isArray(payload.serving_issues)
      ? payload.serving_issues
      : [],
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

  return {
    id: asString(payload.id, "ad_group.id"),
    name: asString(payload.name, "ad_group.name"),
    description: asNullableString(payload.description),
    context_hints: Array.isArray(payload.context_hints)
      ? payload.context_hints.filter((item): item is string => typeof item === "string")
      : [],
    status: asString(payload.status, "ad_group.status"),
    bidding_config: {
      billing_event_type: asString(
        payload.bidding_config.billing_event_type,
        "ad_group.billing_event_type",
      ),
      strategy: asNullableString(payload.bidding_config.strategy),
      max_bid_micros:
        typeof payload.bidding_config.max_bid_micros === "number"
          ? payload.bidding_config.max_bid_micros
          : null,
    },
    created_at: asFiniteNumber(payload.created_at),
    updated_at: asFiniteNumber(payload.updated_at),
    serving_issues: Array.isArray(payload.serving_issues)
      ? payload.serving_issues
      : [],
  };
}

function parseAd(payload: unknown): OpenAIAdsAd {
  if (!isRecord(payload) || !isRecord(payload.creative)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat eine ungültige Anzeige zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  const reviewStatus = asString(payload.review_status, "ad.review_status");
  if (!["in_review", "rejected", "approved"].includes(reviewStatus)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat einen unbekannten Anzeigen-Reviewstatus zurückgegeben.",
      status: 502,
      code: "unknown_review_status",
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
      body: typeof payload.creative.body === "string" ? payload.creative.body : "",
      file_id: asNullableString(payload.creative.file_id),
      image_url: asNullableString(payload.creative.image_url),
      target_url: asNullableString(payload.creative.target_url),
    },
    created_at: asFiniteNumber(payload.created_at),
    updated_at: asFiniteNumber(payload.updated_at),
    serving_issues: Array.isArray(payload.serving_issues)
      ? payload.serving_issues
      : [],
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
    start_time: asFiniteNumber(payload.start_time),
    end_time: asFiniteNumber(payload.end_time),
    readable_time: asNullableString(payload.readable_time),
    campaign_id: asNullableString(payload.campaign_id),
    campaign_name: asNullableString(payload.campaign_name),
    impressions:
      typeof payload.impressions === "number" ? payload.impressions : null,
    clicks: typeof payload.clicks === "number" ? payload.clicks : null,
    spend: typeof payload.spend === "number" ? payload.spend : null,
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
    region_code: asNullableString(payload.region_code),
  };
}

function parseConversionInsight(payload: unknown): OpenAIAdsConversionInsight {
  if (!isRecord(payload)) {
    throw new OpenAIAdsApiError({
      message: "OpenAI Ads hat ungültige Conversiondaten zurückgegeben.",
      status: 502,
      code: "invalid_provider_response",
    });
  }

  return {
    entity_id: asString(payload.entity_id, "conversion.entity_id"),
    date: asNullableString(payload.date),
    conversions: asFiniteNumber(payload.conversions),
    click_through_conversions:
      typeof payload.click_through_conversions === "number"
        ? payload.click_through_conversions
        : null,
    view_through_conversions:
      typeof payload.view_through_conversions === "number"
        ? payload.view_through_conversions
        : null,
  };
}

export type OpenAIAdsClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export class OpenAIAdsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAIAdsClientOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("OpenAI Ads API Key fehlt.");
    }

    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
      const response = parseList(payload, parser);
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
    return this.listAll("/campaigns", new URLSearchParams(), parseCampaign);
  }

  async getCampaign(id: string): Promise<OpenAIAdsCampaign> {
    return parseCampaign(await this.request(`/campaigns/${encodeURIComponent(id)}`));
  }

  async listAdGroups(campaignId: string): Promise<OpenAIAdsAdGroup[]> {
    const query = new URLSearchParams({ campaign_id: campaignId });
    return this.listAll("/ad_groups", query, parseAdGroup);
  }

  async getAdGroup(id: string): Promise<OpenAIAdsAdGroup> {
    return parseAdGroup(await this.request(`/ad_groups/${encodeURIComponent(id)}`));
  }

  async listAds(adGroupId: string): Promise<OpenAIAdsAd[]> {
    const query = new URLSearchParams({ ad_group_id: adGroupId });
    return this.listAll("/ads", query, parseAd);
  }

  async getAd(id: string): Promise<OpenAIAdsAd> {
    return parseAd(await this.request(`/ads/${encodeURIComponent(id)}`));
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
    for (const field of [
      "metadata.readable_time",
      "metadata.data_status",
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
        time_granularity: "daily",
        time_ranges: [
          JSON.stringify({
            type: "unix_range",
            start: String(input.startUnix),
            end: String(input.endUnix),
          }),
        ],
        entity_ids: input.campaignIds,
        group_by_entity: true,
        include_zero_rows: false,
      }),
    });
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads hat keine gültigen Conversiondaten geliefert.",
        status: 502,
        code: "invalid_provider_response",
      });
    }
    return payload.data.map(parseConversionInsight);
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

  async previewAd(id: string): Promise<Record<string, unknown>> {
    const payload = await this.request(`/ads/${encodeURIComponent(id)}/preview`, {
      method: "POST",
    });
    if (!isRecord(payload)) {
      throw new OpenAIAdsApiError({
        message: "OpenAI Ads hat keine gültige Vorschau zurückgegeben.",
        status: 502,
        code: "invalid_provider_response",
      });
    }
    return payload;
  }
}
