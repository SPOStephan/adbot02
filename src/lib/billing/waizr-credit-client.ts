import "server-only";

import {
  CreditServiceContractError,
  CreditServiceUnavailableError,
  InsufficientCreditsError,
} from "./credit-errors";

const DEFAULT_BASE_URL = "https://credits.waizr.co";
const DEFAULT_TIMEOUT_MS = 8_000;
const TOKEN_EXPIRY_SKEW_MS = 30_000;

export type WaizrCreditClientConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
};

export type WaizrAccount = {
  id: string;
  status: "active" | "suspended" | "closed";
};

export type WaizrBalance = {
  accountId: string;
  available: number;
  reserved: number;
  total: number;
  nextExpiryAt: string | null;
  asOf: string;
};

export type WaizrQuote = {
  id: string;
  accountId: string;
  serviceCode: string;
  amount: number;
};

export type WaizrReservation = {
  id: string;
  accountId: string;
  quoteId: string;
  actionReference: string;
  amountReserved: number;
  amountCaptured: number;
  amountReleased: number;
  status: "reserved" | "captured" | "released" | "expired";
};

type ErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
  code?: string;
  message?: string;
  error_description?: string;
};

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;
let tokenPromise: Promise<TokenCache> | null = null;

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(
      `Die Umgebungsvariable ${name} fehlt. Bitte ausschließlich serverseitig in Vercel hinterlegen.`,
    );
  }
  return normalized;
}

function safeInt(value: unknown, label: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new CreditServiceContractError(
      `Der Credit-Service lieferte einen ungültigen Wert für ${label}.`,
    );
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseError(payload: unknown): { code: string; message: string } {
  const data = isRecord(payload) ? (payload as ErrorResponse) : {};
  const nested = isRecord(data.error) ? data.error : null;
  return {
    code:
      (typeof nested?.code === "string" && nested.code) ||
      (typeof data.code === "string" && data.code) ||
      "CREDIT_SERVICE_ERROR",
    message:
      (typeof nested?.message === "string" && nested.message) ||
      (typeof data.message === "string" && data.message) ||
      (typeof data.error_description === "string" && data.error_description) ||
      "Credit operation failed.",
  };
}

export function getWaizrCreditClientConfig(): WaizrCreditClientConfig {
  const baseUrl = (process.env.WAIZR_CREDIT_API_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  if (!baseUrl.startsWith("https://")) {
    throw new Error("WAIZR_CREDIT_API_URL muss HTTPS verwenden.");
  }
  const timeoutRaw = Number(process.env.WAIZR_CREDIT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(1_000, Math.min(30_000, Math.trunc(timeoutRaw)))
    : DEFAULT_TIMEOUT_MS;
  return {
    baseUrl,
    clientId: required("WAIZR_CREDIT_CLIENT_ID", process.env.WAIZR_CREDIT_CLIENT_ID),
    clientSecret: required(
      "WAIZR_CREDIT_CLIENT_SECRET",
      process.env.WAIZR_CREDIT_CLIENT_SECRET,
    ),
    timeoutMs,
  };
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CreditServiceContractError(
      "Der Credit-Service lieferte keine gültige JSON-Antwort.",
    );
  }
}

async function issueToken(config: WaizrCreditClientConfig): Promise<TokenCache> {
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope:
      "accounts:read accounts:write credits:read credits:reserve credits:capture credits:release catalog:read",
  });
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new CreditServiceUnavailableError();
  }
  const payload = await parseJson(response);
  if (!response.ok || !isRecord(payload)) {
    const apiError = responseError(payload);
    throw new CreditServiceContractError(
      `OAuth beim Credit-Service fehlgeschlagen (${apiError.code}).`,
    );
  }
  const accessToken = payload.access_token;
  const expiresIn = Number(payload.expires_in);
  if (
    typeof accessToken !== "string" ||
    !accessToken ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new CreditServiceContractError(
      "Der Credit-Service lieferte ein ungültiges OAuth-Token.",
    );
  }
  return {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1_000,
  };
}

async function accessToken(config: WaizrCreditClientConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
    return tokenCache.accessToken;
  }
  if (!tokenPromise) {
    tokenPromise = issueToken(config).finally(() => {
      tokenPromise = null;
    });
  }
  tokenCache = await tokenPromise;
  return tokenCache.accessToken;
}

async function request<T>(input: {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  retryAuthentication?: boolean;
}): Promise<{ data: T; status: number }> {
  const config = getWaizrCreditClientConfig();
  const token = await accessToken(config);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (input.body) headers["Content-Type"] = "application/json";
  if (input.idempotencyKey) headers["Idempotency-Key"] = input.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${input.path}`, {
      method: input.method,
      headers,
      body: input.body ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new CreditServiceUnavailableError();
  }

  if (response.status === 401 && input.retryAuthentication !== false) {
    tokenCache = null;
    return request<T>({ ...input, retryAuthentication: false });
  }

  const payload = await parseJson(response);
  if (!response.ok) {
    const apiError = responseError(payload);
    if (response.status === 402 || apiError.code === "INSUFFICIENT_CREDITS") {
      throw new InsufficientCreditsError();
    }
    if (response.status >= 500) {
      throw new CreditServiceUnavailableError();
    }
    throw new CreditServiceContractError(
      `Credit-Service-Anfrage fehlgeschlagen (${apiError.code}).`,
    );
  }
  return { data: payload as T, status: response.status };
}

export async function createWaizrAccount(input: {
  displayName: string;
  externalOrganizationId: string;
  idempotencyKey: string;
}): Promise<WaizrAccount> {
  const { data: payload } = await request<Record<string, unknown>>({
    method: "POST",
    path: "/v1/accounts",
    idempotencyKey: input.idempotencyKey,
    body: {
      displayName: input.displayName,
      externalReference: {
        system: "adbot",
        organizationId: input.externalOrganizationId,
      },
      metadata: { product: "adbot", contractVersion: 1 },
    },
  });
  if (
    typeof payload.id !== "string" ||
    !["active", "suspended", "closed"].includes(String(payload.status))
  ) {
    throw new CreditServiceContractError(
      "Der Credit-Service lieferte ein ungültiges Konto.",
    );
  }
  return {
    id: payload.id,
    status: payload.status as WaizrAccount["status"],
  };
}

export async function getWaizrBalance(accountId: string): Promise<WaizrBalance> {
  const { data: payload } = await request<Record<string, unknown>>({
    method: "GET",
    path: `/v1/accounts/${encodeURIComponent(accountId)}/balance`,
  });
  if (typeof payload.accountId !== "string" || typeof payload.asOf !== "string") {
    throw new CreditServiceContractError(
      "Der Credit-Service lieferte einen ungültigen Saldo.",
    );
  }
  return {
    accountId: payload.accountId,
    available: safeInt(payload.available, "available"),
    reserved: safeInt(payload.reserved, "reserved"),
    total: safeInt(payload.total, "total"),
    nextExpiryAt:
      typeof payload.nextExpiryAt === "string" ? payload.nextExpiryAt : null,
    asOf: payload.asOf,
  };
}

export async function createWaizrQuote(input: {
  accountId: string;
  serviceCode: string;
  amount: number;
  idempotencyKey: string;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<WaizrQuote> {
  const { data: payload } = await request<Record<string, unknown>>({
    method: "POST",
    path: "/v1/quotes",
    idempotencyKey: input.idempotencyKey,
    body: {
      accountId: input.accountId,
      serviceCode: input.serviceCode,
      quantity: input.amount,
      metadata: input.metadata ?? {},
    },
  });
  if (
    typeof payload.id !== "string" ||
    typeof payload.accountId !== "string" ||
    typeof payload.serviceCode !== "string"
  ) {
    throw new CreditServiceContractError(
      "Der Credit-Service lieferte ein ungültiges Angebot.",
    );
  }
  return {
    id: payload.id,
    accountId: payload.accountId,
    serviceCode: payload.serviceCode,
    amount: safeInt(payload.amount, "quote.amount"),
  };
}

export async function createWaizrReservation(input: {
  accountId: string;
  quoteId: string;
  actionReference: string;
  expiresInSeconds: number;
  idempotencyKey: string;
  metadata?: Record<string, string | number | boolean | null>;
}): Promise<WaizrReservation & { alreadyExisted: boolean }> {
  const { data: payload, status } = await request<Record<string, unknown>>({
    method: "POST",
    path: "/v1/reservations",
    idempotencyKey: input.idempotencyKey,
    body: {
      accountId: input.accountId,
      quoteId: input.quoteId,
      actionReference: input.actionReference,
      expiresInSeconds: input.expiresInSeconds,
      metadata: input.metadata ?? {},
    },
  });
  return { ...parseReservation(payload), alreadyExisted: status === 200 };
}

export async function captureWaizrReservation(input: {
  reservationId: string;
  idempotencyKey: string;
}): Promise<WaizrReservation> {
  const { data: payload } = await request<Record<string, unknown>>({
    method: "POST",
    path: `/v1/reservations/${encodeURIComponent(input.reservationId)}/capture`,
    idempotencyKey: input.idempotencyKey,
    body: {},
  });
  return parseReservation(payload);
}

export async function releaseWaizrReservation(input: {
  reservationId: string;
  idempotencyKey: string;
  reason?: string;
}): Promise<WaizrReservation> {
  const { data: payload } = await request<Record<string, unknown>>({
    method: "POST",
    path: `/v1/reservations/${encodeURIComponent(input.reservationId)}/release`,
    idempotencyKey: input.idempotencyKey,
    body: input.reason ? { reason: input.reason.slice(0, 500) } : {},
  });
  return parseReservation(payload);
}

function parseReservation(payload: Record<string, unknown>): WaizrReservation {
  const status = String(payload.status ?? "");
  if (
    typeof payload.id !== "string" ||
    typeof payload.accountId !== "string" ||
    typeof payload.quoteId !== "string" ||
    typeof payload.actionReference !== "string" ||
    !["reserved", "captured", "released", "expired"].includes(status)
  ) {
    throw new CreditServiceContractError(
      "Der Credit-Service lieferte eine ungültige Reservation.",
    );
  }
  return {
    id: payload.id,
    accountId: payload.accountId,
    quoteId: payload.quoteId,
    actionReference: payload.actionReference,
    amountReserved: safeInt(payload.amountReserved, "amountReserved"),
    amountCaptured: safeInt(payload.amountCaptured, "amountCaptured"),
    amountReleased: safeInt(payload.amountReleased, "amountReleased"),
    status: status as WaizrReservation["status"],
  };
}

export function clearWaizrCreditTokenCacheForTests(): void {
  tokenCache = null;
  tokenPromise = null;
}
