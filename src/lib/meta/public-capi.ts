/**
 * Conversions API (erweitert): reine Logik für den öffentlichen Endpunkt
 * `POST /api/v1/conversions/events` (Route folgt in Teil 3).
 *
 * - Ereignis-Schlüssel erzeugen/prüfen (gespeichert wird nur der SHA-256-Hash)
 * - Anfrage validieren, Einwilligung prüfen, Rohdaten normalisieren + hashen
 * - Protokollzeile ohne personenbezogene Daten bauen
 *
 * Bewusst nur `node:crypto` als Import, damit Node-Testskripte die Datei mit
 * `--experimental-strip-types` direkt laden können. Erlaubte Ereignisnamen
 * werden vom Aufrufer übergeben (zentrale Tabelle `conversion-events.ts`
 * + `PUBLIC_CAPI_FEEDBACK_EVENT_NAMES`).
 *
 * Der Versand an Meta läuft über den bestehenden Weg
 * (`sendConnectionCapiEvents` in `connection-capi.ts`).
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const PUBLIC_CAPI_MAX_EVENTS_PER_REQUEST = 100;
export const PUBLIC_CAPI_MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60;
export const PUBLIC_CAPI_MAX_FUTURE_SKEW_SECONDS = 5 * 60;
export const PUBLIC_CAPI_MAX_CUSTOM_DATA_BYTES = 8 * 1024;

/**
 * Qualitäts-Rückmeldungen, die nicht in der zentralen Ereignis-Tabelle stehen
 * (dort stünden sie als wählbares Kampagnenziel). Nur hier erlaubt.
 */
export const PUBLIC_CAPI_FEEDBACK_EVENT_NAMES = ["DisqualifiedLead"] as const;

export const PUBLIC_CAPI_ACTION_SOURCES = [
  "website",
  "system_generated",
  "email",
  "app",
  "phone_call",
  "chat",
  "physical_store",
  "business_messaging",
  "other",
] as const;

export type PublicCapiActionSource = (typeof PUBLIC_CAPI_ACTION_SOURCES)[number];
export type PublicCapiKeyMode = "live" | "test";

export type PublicCapiEventStatus =
  | "sent"
  | "skipped_no_consent"
  | "duplicate"
  | "invalid"
  | "meta_error";

// ---------------------------------------------------------------------------
// Ereignis-Schlüssel
// ---------------------------------------------------------------------------

const KEY_PATTERN = /^adb_ev_(live|test)_([0-9a-f]{64})$/;
const KEY_PREFIX_VISIBLE_CHARS = 8;

export type GeneratedPublicCapiKey = {
  /** Klartext, wird dem Kunden genau einmal angezeigt und nie gespeichert. */
  key: string;
  /** Anzeigbarer Anfang, z. B. `adb_ev_live_1a2b3c4d`. */
  prefix: string;
  /** SHA-256 (hex) des Klartexts – das Einzige, was gespeichert wird. */
  hash: string;
  mode: PublicCapiKeyMode;
};

export function hashPublicCapiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generatePublicCapiKey(
  mode: PublicCapiKeyMode,
  random: (size: number) => Buffer = randomBytes,
): GeneratedPublicCapiKey {
  const secret = random(32).toString("hex");
  const key = `adb_ev_${mode}_${secret}`;
  return {
    key,
    prefix: `adb_ev_${mode}_${secret.slice(0, KEY_PREFIX_VISIBLE_CHARS)}`,
    hash: hashPublicCapiKey(key),
    mode,
  };
}

export type ParsedPublicCapiKey = {
  key: string;
  mode: PublicCapiKeyMode;
  hash: string;
};

/** Liest `Authorization: Bearer adb_ev_…`. Ungültiges Format → null. */
export function parsePublicCapiAuthorization(
  header: string | null | undefined,
): ParsedPublicCapiKey | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  if (!match) return null;
  const key = match[1];
  if (key.length > 128) return null;
  const parsed = KEY_PATTERN.exec(key);
  if (!parsed) return null;
  return { key, mode: parsed[1] as PublicCapiKeyMode, hash: hashPublicCapiKey(key) };
}

/** Konstantzeit-Vergleich zweier Hex-Hashes. */
export function publicCapiKeyHashEquals(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

// ---------------------------------------------------------------------------
// Erlaubte Domains
// ---------------------------------------------------------------------------

export function normalizePublicCapiHostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253) return null;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
  if (host.includes("..") || !host.includes(".")) return null;
  return host;
}

/** Exakte Domain oder deren Subdomain (`www.kiready.co` bei `kiready.co`). */
export function publicCapiHostAllowed(
  host: string,
  allowedHostnames: readonly string[],
): boolean {
  const normalized = normalizePublicCapiHostname(host);
  if (!normalized) return false;
  return allowedHostnames.some((entry) => {
    const allowed = normalizePublicCapiHostname(entry);
    return Boolean(
      allowed && (normalized === allowed || normalized.endsWith(`.${allowed}`)),
    );
  });
}

// ---------------------------------------------------------------------------
// user_data: normalisieren + hashen (Rohdaten verlassen diese Funktion nie)
// ---------------------------------------------------------------------------

const SHA256_HEX = /^[0-9a-f]{64}$/;
const MAX_VALUES_PER_FIELD = 5;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stringValues(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of list.slice(0, MAX_VALUES_PER_FIELD)) {
    if (typeof item === "string" && item.trim()) out.push(item.trim());
    else if (typeof item === "number" && Number.isFinite(item)) out.push(String(item));
  }
  return out;
}

function hashedValues(
  value: unknown,
  normalize: (raw: string) => string | null,
): string[] | undefined {
  const hashes = new Set<string>();
  for (const raw of stringValues(value)) {
    const lowered = raw.toLowerCase();
    if (SHA256_HEX.test(lowered)) {
      hashes.add(lowered);
      continue;
    }
    const normalized = normalize(raw);
    if (normalized) hashes.add(sha256Hex(normalized));
  }
  return hashes.size ? [...hashes] : undefined;
}

const normalizeEmail = (raw: string) => {
  const value = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
};
const normalizePhone = (raw: string) => {
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length >= 6 ? digits : null;
};
const normalizeName = (raw: string) => {
  const value = raw.normalize("NFC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  return value || null;
};
const normalizeCompact = (raw: string) => {
  const value = raw.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  return value || null;
};
const normalizeCountry = (raw: string) => {
  const value = raw.trim().toLowerCase();
  return /^[a-z]{2}$/.test(value) ? value : null;
};
const normalizeGender = (raw: string) => {
  const value = raw.trim().toLowerCase().charAt(0);
  return value === "f" || value === "m" ? value : null;
};
const normalizeBirthDate = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  return /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(digits) ? digits : null;
};
const normalizeExternalId = (raw: string) => {
  const value = raw.trim();
  return value && value.length <= 256 ? value : null;
};

/** [Meta-Feld, akzeptierte Eingabe-Namen, Normalisierung] */
const HASHED_FIELDS: ReadonlyArray<
  readonly [string, readonly string[], (raw: string) => string | null]
> = [
  ["em", ["em", "email"], normalizeEmail],
  ["ph", ["ph", "phone"], normalizePhone],
  ["fn", ["fn", "first_name"], normalizeName],
  ["ln", ["ln", "last_name"], normalizeName],
  ["ct", ["ct", "city"], normalizeCompact],
  ["st", ["st", "state"], normalizeCompact],
  ["zp", ["zp", "zip"], normalizeCompact],
  ["country", ["country"], normalizeCountry],
  ["ge", ["ge", "gender"], normalizeGender],
  ["db", ["db", "date_of_birth"], normalizeBirthDate],
  ["external_id", ["external_id"], normalizeExternalId],
];

function plainText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

export type PublicCapiUserData = Record<string, string | string[]>;

/**
 * Baut Metas `user_data`: Identitätsfelder nur als SHA-256, IP/User-Agent/
 * fbp/fbc unverändert (nur zur Weiterleitung, nie gespeichert).
 */
export function normalizePublicCapiUserData(input: unknown): PublicCapiUserData {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const out: PublicCapiUserData = {};
  for (const [metaKey, inputKeys, normalize] of HASHED_FIELDS) {
    const hashes = new Set<string>();
    for (const inputKey of inputKeys) {
      for (const hash of hashedValues(source[inputKey], normalize) ?? []) hashes.add(hash);
    }
    if (hashes.size) out[metaKey] = [...hashes].slice(0, MAX_VALUES_PER_FIELD);
  }
  const ip = plainText(source.client_ip_address, 64);
  if (ip && /^[0-9a-fA-F:.]+$/.test(ip)) out.client_ip_address = ip;
  const userAgent = plainText(source.client_user_agent, 512);
  if (userAgent) out.client_user_agent = userAgent;
  const fbp = plainText(source.fbp, 256);
  if (fbp && /^fb\.\d\.\d+\.\S+$/.test(fbp)) out.fbp = fbp;
  const fbc = plainText(source.fbc, 512);
  if (fbc && /^fb\.\d\.\d+\.\S+$/.test(fbc)) out.fbc = fbc;
  return out;
}

function hasCustomerIdentifier(userData: PublicCapiUserData): boolean {
  return Boolean(
    userData.em ||
      userData.ph ||
      userData.external_id ||
      userData.fbp ||
      userData.fbc ||
      (userData.client_ip_address && userData.client_user_agent),
  );
}

// ---------------------------------------------------------------------------
// Anfrage validieren
// ---------------------------------------------------------------------------

export type PublicCapiEventKey = { eventName: string; eventId: string };

export type PublicCapiPreparedEvent =
  | {
      index: number;
      status: "valid";
      eventName: string;
      eventId: string;
      actionSource: PublicCapiActionSource;
      /** Fertiges Meta-Ereignis (user_data bereits gehasht). */
      metaEvent: Record<string, unknown>;
    }
  | {
      index: number;
      status: "skipped_no_consent" | "duplicate";
      eventName: string;
      eventId: string;
      actionSource: PublicCapiActionSource | null;
    }
  | {
      index: number;
      status: "invalid";
      reason: string;
      eventName: string | null;
      eventId: string | null;
      actionSource: PublicCapiActionSource | null;
    };

export type PublicCapiRequestContext = {
  nowSeconds: number;
  keyMode: PublicCapiKeyMode;
  allowedEventNames: ReadonlySet<string>;
  allowedHostnames: readonly string[];
};

export type PublicCapiParsedRequest =
  | { ok: false; httpStatus: 400; error: string; message: string }
  | {
      ok: true;
      testEventCode: string | null;
      events: PublicCapiPreparedEvent[];
    };

const EVENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const EVENT_ID_PATTERN = /^[\x21-\x7e]{1,128}$/;
const TEST_EVENT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

function requestError(error: string, message: string): PublicCapiParsedRequest {
  return { ok: false, httpStatus: 400, error, message };
}

function eventIdText(value: unknown): string | null {
  const text =
    typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return EVENT_ID_PATTERN.test(text) ? text : null;
}

function actionSourceOf(value: unknown): PublicCapiActionSource | null {
  if (value === undefined || value === null || value === "") return "website";
  return typeof value === "string" &&
    (PUBLIC_CAPI_ACTION_SOURCES as readonly string[]).includes(value)
    ? (value as PublicCapiActionSource)
    : null;
}

function parseCustomData(
  value: unknown,
): { ok: true; data?: Record<string, unknown> } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "custom_data_not_object" };
  }
  const data = { ...(value as Record<string, unknown>) };
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    return { ok: false, reason: "custom_data_not_serializable" };
  }
  if (size > PUBLIC_CAPI_MAX_CUSTOM_DATA_BYTES) {
    return { ok: false, reason: "custom_data_too_large" };
  }
  if (data.value !== undefined) {
    const amount = typeof data.value === "string" ? Number(data.value) : data.value;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      return { ok: false, reason: "custom_data_value_invalid" };
    }
    data.value = amount;
    if (typeof data.currency !== "string") {
      return { ok: false, reason: "custom_data_currency_missing" };
    }
  }
  if (data.currency !== undefined) {
    const currency = typeof data.currency === "string" ? data.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { ok: false, reason: "custom_data_currency_invalid" };
    }
    data.currency = currency;
  }
  return { ok: true, data };
}

function parseOriginalEventData(
  value: unknown,
): { ok: true; data?: Record<string, unknown> } | { ok: false; reason: string } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "original_event_data_not_object" };
  }
  const source = value as Record<string, unknown>;
  const eventName = typeof source.event_name === "string" ? source.event_name.trim() : "";
  if (!EVENT_NAME_PATTERN.test(eventName)) {
    return { ok: false, reason: "original_event_data_event_name_invalid" };
  }
  const data: Record<string, unknown> = { event_name: eventName };
  if (source.event_id !== undefined) {
    const eventId = eventIdText(source.event_id);
    if (!eventId) return { ok: false, reason: "original_event_data_event_id_invalid" };
    data.event_id = eventId;
  }
  if (source.event_time !== undefined) {
    if (!Number.isInteger(source.event_time) || (source.event_time as number) <= 0) {
      return { ok: false, reason: "original_event_data_event_time_invalid" };
    }
    data.event_time = source.event_time;
  }
  return { ok: true, data };
}

function prepareEvent(
  raw: unknown,
  index: number,
  context: PublicCapiRequestContext,
  seen: Set<string>,
): PublicCapiPreparedEvent {
  const invalid = (
    reason: string,
    eventName: string | null = null,
    eventId: string | null = null,
    actionSource: PublicCapiActionSource | null = null,
  ): PublicCapiPreparedEvent => ({
    index,
    status: "invalid",
    reason,
    eventName,
    eventId,
    actionSource,
  });

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("event_not_object");
  }
  const event = raw as Record<string, unknown>;

  const eventName = typeof event.event_name === "string" ? event.event_name.trim() : "";
  if (!EVENT_NAME_PATTERN.test(eventName)) return invalid("event_name_invalid");
  if (!context.allowedEventNames.has(eventName)) {
    return invalid("event_name_not_allowed", eventName);
  }

  const eventId = eventIdText(event.event_id);
  if (!eventId) return invalid("event_id_missing", eventName);

  const actionSource = actionSourceOf(event.action_source);
  if (!actionSource) return invalid("action_source_invalid", eventName, eventId);

  // Einwilligung vor jeder Verarbeitung personenbezogener Daten prüfen.
  const consent =
    event.consent && typeof event.consent === "object" && !Array.isArray(event.consent)
      ? (event.consent as Record<string, unknown>)
      : null;
  if (!consent || consent.marketing !== true) {
    return { index, status: "skipped_no_consent", eventName, eventId, actionSource };
  }

  const dedupeKey = `${eventName}\u0000${eventId}`;
  if (seen.has(dedupeKey)) {
    return { index, status: "duplicate", eventName, eventId, actionSource };
  }

  let eventTime = context.nowSeconds;
  if (event.event_time !== undefined && event.event_time !== null) {
    if (!Number.isInteger(event.event_time)) {
      return invalid("event_time_invalid", eventName, eventId, actionSource);
    }
    eventTime = event.event_time as number;
    if (eventTime > context.nowSeconds + PUBLIC_CAPI_MAX_FUTURE_SKEW_SECONDS) {
      return invalid("event_time_in_future", eventName, eventId, actionSource);
    }
    if (eventTime < context.nowSeconds - PUBLIC_CAPI_MAX_EVENT_AGE_SECONDS) {
      return invalid("event_time_too_old", eventName, eventId, actionSource);
    }
  }

  let eventSourceUrl: string | undefined;
  if (event.event_source_url !== undefined && event.event_source_url !== null) {
    let parsed: URL | null = null;
    try {
      parsed =
        typeof event.event_source_url === "string" && event.event_source_url.length <= 2048
          ? new URL(event.event_source_url)
          : null;
    } catch {
      parsed = null;
    }
    if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
      return invalid("event_source_url_invalid", eventName, eventId, actionSource);
    }
    if (!publicCapiHostAllowed(parsed.hostname, context.allowedHostnames)) {
      return invalid("event_source_url_domain_not_allowed", eventName, eventId, actionSource);
    }
    eventSourceUrl = parsed.toString();
  }
  if (actionSource === "website" && !eventSourceUrl) {
    return invalid("event_source_url_missing", eventName, eventId, actionSource);
  }

  const userData = normalizePublicCapiUserData(event.user_data);
  if (actionSource === "website" && !userData.client_user_agent) {
    return invalid("client_user_agent_missing", eventName, eventId, actionSource);
  }
  if (!hasCustomerIdentifier(userData)) {
    return invalid("user_data_missing", eventName, eventId, actionSource);
  }

  const customData = parseCustomData(event.custom_data);
  if (!customData.ok) return invalid(customData.reason, eventName, eventId, actionSource);

  const original = parseOriginalEventData(event.original_event_data);
  if (!original.ok) return invalid(original.reason, eventName, eventId, actionSource);

  seen.add(dedupeKey);
  const metaEvent: Record<string, unknown> = {
    event_name: eventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: actionSource,
    user_data: userData,
  };
  if (eventSourceUrl) metaEvent.event_source_url = eventSourceUrl;
  if (customData.data) metaEvent.custom_data = customData.data;
  if (original.data) metaEvent.original_event_data = original.data;

  return { index, status: "valid", eventName, eventId, actionSource, metaEvent };
}

export function parsePublicCapiRequest(
  body: unknown,
  context: PublicCapiRequestContext,
): PublicCapiParsedRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return requestError("body_invalid", "Der Body muss ein JSON-Objekt sein.");
  }
  const source = body as Record<string, unknown>;

  let testEventCode: string | null = null;
  if (source.test_event_code !== undefined && source.test_event_code !== null) {
    const code =
      typeof source.test_event_code === "string" ? source.test_event_code.trim() : "";
    if (!TEST_EVENT_CODE_PATTERN.test(code)) {
      return requestError("test_event_code_invalid", "test_event_code hat ein ungültiges Format.");
    }
    testEventCode = code;
  }
  if (context.keyMode === "test" && !testEventCode) {
    return requestError(
      "test_event_code_required",
      "Test-Schlüssel (adb_ev_test_…) senden nur mit test_event_code.",
    );
  }

  if (!Array.isArray(source.events) || source.events.length === 0) {
    return requestError("events_missing", "events muss eine nicht leere Liste sein.");
  }
  if (source.events.length > PUBLIC_CAPI_MAX_EVENTS_PER_REQUEST) {
    return requestError(
      "too_many_events",
      `Höchstens ${PUBLIC_CAPI_MAX_EVENTS_PER_REQUEST} Ereignisse je Anfrage.`,
    );
  }

  const seen = new Set<string>();
  const events = source.events.map((raw, index) => prepareEvent(raw, index, context, seen));
  return { ok: true, testEventCode, events };
}

/** Erlaubte Namen = zentrale Tabelle + Qualitäts-Rückmeldungen. */
export function publicCapiAllowedEventNames(
  catalogPixelEventNames: Iterable<string>,
): Set<string> {
  return new Set<string>([...catalogPixelEventNames, ...PUBLIC_CAPI_FEEDBACK_EVENT_NAMES]);
}

// ---------------------------------------------------------------------------
// Protokoll (keine personenbezogenen Daten)
// ---------------------------------------------------------------------------

export type PublicCapiLogRow = {
  key_id: string;
  user_id: string;
  pixel_id: string;
  event_name: string;
  event_id: string;
  action_source: string | null;
  is_test: boolean;
  status: "pending" | PublicCapiEventStatus;
  error_code: string | null;
  error_reason: string | null;
  fbtrace_id: string | null;
};

function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[^\x20-\x7e]/g, "").trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Baut eine Protokollzeile ausschließlich aus Metadaten. Es gibt bewusst
 * keinen Parameter für user_data/custom_data, damit nichts versehentlich
 * im Protokoll landet.
 */
export function publicCapiLogRow(input: {
  keyId: string;
  userId: string;
  pixelId: string;
  eventName: string;
  eventId: string;
  actionSource: string | null;
  isTest: boolean;
  status: PublicCapiLogRow["status"];
  errorCode?: string | number | null;
  errorReason?: string | null;
  fbtraceId?: string | null;
}): PublicCapiLogRow {
  return {
    key_id: input.keyId,
    user_id: input.userId,
    pixel_id: input.pixelId,
    event_name: input.eventName.slice(0, 64),
    event_id: input.eventId.slice(0, 128),
    action_source: clip(input.actionSource, 40),
    is_test: input.isTest,
    status: input.status,
    error_code:
      input.errorCode === null || input.errorCode === undefined
        ? null
        : clip(String(input.errorCode), 40),
    error_reason: clip(input.errorReason, 300),
    fbtrace_id: clip(input.fbtraceId, 80),
  };
}

// ---------------------------------------------------------------------------
// Meta-Antwort → Status je Ereignis
// ---------------------------------------------------------------------------

export type PublicCapiBatchSendResult = {
  status: "sent" | "failed";
  httpStatus?: number;
  eventsReceived?: number;
  traceId?: string;
  errorCode?: number;
  errorSubcode?: number;
  errorType?: string;
  attempts: number;
};

/** Wiederholen nur bei Überlast/Serverfehler – nie bei 4xx-Validierungsfehlern. */
export function publicCapiShouldRetry(httpStatus: number | undefined): boolean {
  if (httpStatus === undefined) return true; // Netzwerkfehler/Timeout
  return httpStatus === 429 || httpStatus >= 500;
}

export function publicCapiStatusFromSend(
  result: PublicCapiBatchSendResult,
): "sent" | "meta_error" {
  return result.status === "sent" ? "sent" : "meta_error";
}
