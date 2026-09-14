export class OpenAIAdsInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OpenAIAdsInputError";
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OpenAIAdsInputError(
      "invalid_request",
      "Die Anfrage enthält kein gültiges Objekt.",
    );
  }
  return value as Record<string, unknown>;
}

function asUuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new OpenAIAdsInputError("invalid_uuid", `${field} ist ungültig.`);
  }
  return value;
}

function asText(
  value: unknown,
  field: string,
  options: { min: number; max: number; optional?: boolean },
): string | null {
  if ((value === null || value === undefined || value === "") && options.optional) {
    return null;
  }
  if (typeof value !== "string") {
    throw new OpenAIAdsInputError("invalid_text", `${field} ist ungültig.`);
  }
  const normalized = value.trim();
  if (options.optional && normalized === "") {
    return null;
  }
  if (normalized.length < options.min || normalized.length > options.max) {
    throw new OpenAIAdsInputError(
      "invalid_text_length",
      `${field} muss zwischen ${options.min} und ${options.max} Zeichen enthalten.`,
    );
  }
  return normalized;
}

function asHttpsUrl(value: unknown, field: string): string {
  const text = asText(value, field, { min: 8, max: 2048 });
  try {
    const url = new URL(text!);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      hostname.includes(":") ||
      /^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(hostname) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === "::1"
    ) {
      throw new Error("unsafe_url");
    }
    return url.toString();
  } catch {
    throw new OpenAIAdsInputError(
      "invalid_url",
      `${field} muss eine öffentliche HTTPS-Adresse ohne Fragment sein.`,
    );
  }
}

function amountToMicros(
  value: unknown,
  field: string,
  minimumMicros = 1_000_000,
  maximumMicros = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new OpenAIAdsInputError("invalid_amount", `${field} ist ungültig.`);
  }
  const normalized = String(value).trim().replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(normalized);
  if (!match) {
    throw new OpenAIAdsInputError(
      "invalid_amount",
      `${field} muss ein positiver Geldbetrag mit höchstens sechs Nachkommastellen sein.`,
    );
  }
  const micros =
    Number(match[1]) * 1_000_000 +
    Number((match[2] ?? "").padEnd(6, "0"));
  if (
    !Number.isSafeInteger(micros) ||
    micros < minimumMicros ||
    micros > maximumMicros
  ) {
    throw new OpenAIAdsInputError(
      "amount_out_of_range",
      `${field} liegt außerhalb des zulässigen Bereichs.`,
    );
  }
  return micros;
}

function asDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new OpenAIAdsInputError(
      "invalid_date",
      `${field} muss ein gültiges Datum sein.`,
    );
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value ||
    value < "2000-01-01" ||
    value > "2100-01-01"
  ) {
    throw new OpenAIAdsInputError("invalid_date", `${field} ist ungültig.`);
  }
  return value;
}

export function parseOpenAIAdsConnectInput(value: unknown) {
  const body = asRecord(value);
  const apiKey = asText(body.apiKey, "API-Key", { min: 20, max: 4096 });
  return { apiKey: apiKey! };
}

export function parseOpenAIAdsAccountCommand(value: unknown) {
  const body = asRecord(value);
  return {
    platformAccountId: asUuid(body.platformAccountId, "Verbindung"),
  };
}

export function parseOpenAIAdsDisconnectInput(value: unknown) {
  const body = asRecord(value);
  if (body.confirmation !== "disconnect_openai_ads") {
    throw new OpenAIAdsInputError(
      "confirmation_required",
      "Die Trennung muss ausdrücklich bestätigt werden.",
    );
  }
  return {
    platformAccountId: asUuid(body.platformAccountId, "Verbindung"),
  };
}

export function parseOpenAIAdsGeoSearch(value: string | null) {
  const query = asText(value, "Suchbegriff", { min: 2, max: 100 });
  return query!;
}

export type OpenAIAdsLaunchInput = {
  platformAccountId: string;
  campaignName: string;
  campaignDescription: string | null;
  biddingType: "impressions" | "clicks";
  billingEventType: "impression" | "click";
  dailyBudgetMicros: number;
  maxBidMicros: number;
  startDate: string | null;
  endDate: string | null;
  locationIds: string[];
  adGroupName: string;
  contextHints: string[];
  adName: string;
  title: string;
  body: string;
  targetUrl: string;
  imageUrl: string;
};

export function parseOpenAIAdsLaunchInput(
  value: unknown,
): OpenAIAdsLaunchInput {
  const body = asRecord(value);
  if (body.lifetimeBudget !== undefined) {
    throw new OpenAIAdsInputError(
      "legacy_budget_not_supported",
      "Neue OpenAI-Ads-Launches verwenden ausschließlich ein kampagnenspezifisches Tagesbudget.",
    );
  }
  if (body.confirmation !== "create_paused_openai_ads_campaign") {
    throw new OpenAIAdsInputError(
      "confirmation_required",
      "Die pausierte OpenAI-Ads-Kampagnenkette muss ausdrücklich bestätigt werden.",
    );
  }

  const biddingType = body.biddingType;
  if (biddingType !== "impressions" && biddingType !== "clicks") {
    throw new OpenAIAdsInputError(
      "invalid_bidding_type",
      "Als Gebotsziel ist Impressionen oder Klicks zulässig.",
    );
  }

  const billingEventType = biddingType === "clicks" ? "click" : "impression";
  const startDate = asDate(body.startDate, "Startdatum");
  const endDate = asDate(body.endDate, "Enddatum");
  if (startDate && endDate && endDate <= startDate) {
    throw new OpenAIAdsInputError(
      "invalid_date_range",
      "Das Enddatum muss nach dem Startdatum liegen.",
    );
  }

  const contextHints = Array.isArray(body.contextHints)
    ? body.contextHints.map((item) =>
        asText(item, "Kontexthinweis", { min: 2, max: 120 }),
      )
    : [];
  if (contextHints.length < 1 || contextHints.length > 20) {
    throw new OpenAIAdsInputError(
      "invalid_context_hints",
      "Bitte zwischen 1 und 20 Kontexthinweise angeben.",
    );
  }

  const locationIds = Array.isArray(body.locationIds)
    ? body.locationIds.map((item) => {
        if (typeof item !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(item)) {
          throw new OpenAIAdsInputError(
            "invalid_location",
            "Mindestens ein gültiger OpenAI-Standort muss gewählt werden.",
          );
        }
        return item;
      })
    : [];
  if (locationIds.length < 1 || locationIds.length > 50) {
    throw new OpenAIAdsInputError(
      "location_required",
      "Mindestens ein Standort ist erforderlich; weltweites Targeting wird nicht implizit freigeschaltet.",
    );
  }
  const dailyBudgetMicros = amountToMicros(body.dailyBudget, "Tagesbudget");

  return {
    platformAccountId: asUuid(body.platformAccountId, "Verbindung"),
    campaignName: asText(body.campaignName, "Kampagnenname", {
      min: 3,
      max: 200,
    })!,
    campaignDescription: asText(body.campaignDescription, "Beschreibung", {
      min: 0,
      max: 1000,
      optional: true,
    }),
    biddingType,
    billingEventType,
    dailyBudgetMicros,
    maxBidMicros: amountToMicros(
      body.maxBid,
      "Maximalgebot",
      1,
      30_400_000_000_000,
    ),
    startDate,
    endDate,
    locationIds: [...new Set(locationIds)],
    adGroupName: asText(body.adGroupName, "Anzeigengruppenname", {
      min: 3,
      max: 200,
    })!,
    contextHints: [...new Set(contextHints as string[])],
    adName: asText(body.adName, "Anzeigenname", { min: 3, max: 200 })!,
    title: asText(body.title, "Anzeigentitel", { min: 3, max: 50 })!,
    body: asText(body.body, "Anzeigentext", { min: 1, max: 100 })!,
    targetUrl: asHttpsUrl(body.targetUrl, "Ziel-URL"),
    imageUrl: asHttpsUrl(body.imageUrl, "Bild-URL"),
  };
}

export function parseOpenAIAdsActivationPreviewInput(value: unknown) {
  const body = asRecord(value);
  return {
    launchId: asUuid(body.launchId, "Launch"),
  };
}

export function parseOpenAIAdsActivationInput(value: unknown) {
  const body = asRecord(value);
  if (body.confirmation !== "activate_openai_ads_campaign") {
    throw new OpenAIAdsInputError(
      "confirmation_required",
      "Die kostenwirksame Kampagnenaktivierung muss ausdrücklich bestätigt werden.",
    );
  }

  return {
    launchId: asUuid(body.launchId, "Launch"),
    previewToken: asText(body.previewToken, "Aktivierungsbeleg", {
      min: 32,
      max: 4096,
    })!,
  };
}
