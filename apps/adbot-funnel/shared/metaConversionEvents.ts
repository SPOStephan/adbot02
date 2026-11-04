/**
 * Zentrale Tabelle der Meta-Conversion-Ereignisse (eine Quelle der Wahrheit).
 *
 * Je Ereignis:
 * - `customEventType`: Meta-Enum für `promoted_object.custom_event_type` (Ad-Set)
 * - `pixelEventName`: Pixel-/CAPI-`event_name` (Standard-Event, Title Case)
 * - `insightsActionTypes`: Insights-`action_type`s fürs Reporting
 * - `campaignObjective`: passendes Kampagnenziel
 * - `expectsValue`: ob das Ereignis üblicherweise `value`/`currency` trägt
 * - `labelDe`: deutsches UI-Label
 *
 * Gespiegelt in:
 * - SQL: `public.meta_conversion_events`
 *   (supabase/migrations/20261104090000_meta_conversion_event_catalog.sql)
 * - Funnel-App: apps/adbot-funnel/shared/metaConversionEvents.ts (identische Kopie)
 * `scripts/test-meta-conversion-events.mjs` prüft, dass alle drei übereinstimmen.
 *
 * Diese Datei hat bewusst keine Imports, damit Portal, Funnel-App und
 * Node-Testskripte sie unverändert laden können.
 *
 * Default bleibt `LEAD`: Bestehende Lead-Kampagnen, Pixel-Bestätigungen und
 * Funnel-Apps verhalten sich unverändert (Funnel sendet weiterhin `Lead`).
 */

export type MetaConversionCampaignObjective = "OUTCOME_LEADS" | "OUTCOME_SALES";

export type MetaConversionEventDefinition = {
  customEventType: string;
  pixelEventName: string;
  insightsActionTypes: readonly string[];
  campaignObjective: MetaConversionCampaignObjective;
  expectsValue: boolean;
  labelDe: string;
};

export const DEFAULT_META_CONVERSION_EVENT_TYPE = "LEAD";
export const DEFAULT_META_PIXEL_EVENT_NAME = "Lead";

export const META_CONVERSION_EVENTS: readonly MetaConversionEventDefinition[] = [
  {
    customEventType: "LEAD",
    pixelEventName: "Lead",
    // Identisch zur bisherigen Lead-Zählung im Reporting.
    insightsActionTypes: [
      "lead",
      "omni_lead",
      "onsite_conversion.lead_grouped",
      "offsite_conversion.fb_pixel_lead",
    ],
    campaignObjective: "OUTCOME_LEADS",
    expectsValue: false,
    labelDe: "Lead",
  },
  {
    customEventType: "COMPLETE_REGISTRATION",
    pixelEventName: "CompleteRegistration",
    insightsActionTypes: [
      "complete_registration",
      "omni_complete_registration",
      "offsite_conversion.fb_pixel_complete_registration",
    ],
    campaignObjective: "OUTCOME_LEADS",
    expectsValue: false,
    labelDe: "Registrierung abgeschlossen",
  },
  {
    customEventType: "CONTACT",
    pixelEventName: "Contact",
    insightsActionTypes: ["contact_total", "contact_website"],
    campaignObjective: "OUTCOME_LEADS",
    expectsValue: false,
    labelDe: "Kontaktaufnahme",
  },
  {
    customEventType: "SUBMIT_APPLICATION",
    pixelEventName: "SubmitApplication",
    insightsActionTypes: ["submit_application_total", "submit_application_website"],
    campaignObjective: "OUTCOME_LEADS",
    expectsValue: false,
    labelDe: "Bewerbung eingereicht",
  },
  {
    customEventType: "SCHEDULE",
    pixelEventName: "Schedule",
    insightsActionTypes: ["schedule_total", "schedule_website"],
    campaignObjective: "OUTCOME_LEADS",
    expectsValue: false,
    labelDe: "Termin gebucht",
  },
  {
    customEventType: "PURCHASE",
    pixelEventName: "Purchase",
    // Identisch zur bisherigen Kauf-Zählung im Reporting.
    insightsActionTypes: ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"],
    campaignObjective: "OUTCOME_SALES",
    expectsValue: true,
    labelDe: "Kauf",
  },
  {
    customEventType: "SUBSCRIBE",
    pixelEventName: "Subscribe",
    insightsActionTypes: ["subscribe_total", "subscribe_website"],
    campaignObjective: "OUTCOME_SALES",
    expectsValue: true,
    labelDe: "Abo abgeschlossen",
  },
  {
    customEventType: "START_TRIAL",
    pixelEventName: "StartTrial",
    insightsActionTypes: ["start_trial_total", "start_trial_website"],
    campaignObjective: "OUTCOME_SALES",
    expectsValue: true,
    labelDe: "Testphase gestartet",
  },
  {
    customEventType: "INITIATED_CHECKOUT",
    pixelEventName: "InitiateCheckout",
    insightsActionTypes: [
      "initiate_checkout",
      "omni_initiated_checkout",
      "offsite_conversion.fb_pixel_initiate_checkout",
    ],
    campaignObjective: "OUTCOME_SALES",
    expectsValue: false,
    labelDe: "Bezahlvorgang gestartet",
  },
  {
    customEventType: "ADD_PAYMENT_INFO",
    pixelEventName: "AddPaymentInfo",
    insightsActionTypes: [
      "add_payment_info",
      "offsite_conversion.fb_pixel_add_payment_info",
    ],
    campaignObjective: "OUTCOME_SALES",
    expectsValue: false,
    labelDe: "Zahlungsdaten hinzugefügt",
  },
  {
    customEventType: "ADD_TO_CART",
    pixelEventName: "AddToCart",
    insightsActionTypes: [
      "add_to_cart",
      "omni_add_to_cart",
      "offsite_conversion.fb_pixel_add_to_cart",
    ],
    campaignObjective: "OUTCOME_SALES",
    expectsValue: false,
    labelDe: "In den Warenkorb gelegt",
  },
  {
    customEventType: "SEARCH",
    pixelEventName: "Search",
    insightsActionTypes: ["search", "omni_search", "offsite_conversion.fb_pixel_search"],
    campaignObjective: "OUTCOME_SALES",
    expectsValue: false,
    labelDe: "Suche",
  },
  {
    // Meta-Enum heißt CONTENT_VIEW (nicht VIEW_CONTENT); Pixel-Event ist ViewContent.
    customEventType: "CONTENT_VIEW",
    pixelEventName: "ViewContent",
    insightsActionTypes: [
      "view_content",
      "omni_view_content",
      "offsite_conversion.fb_pixel_view_content",
    ],
    campaignObjective: "OUTCOME_SALES",
    expectsValue: false,
    labelDe: "Inhalt angesehen",
  },
];

/** Gebräuchliche Schreibweisen, die auf ein Meta-Enum zeigen. */
const CUSTOM_EVENT_TYPE_ALIASES: Readonly<Record<string, string>> = {
  VIEW_CONTENT: "CONTENT_VIEW",
  INITIATE_CHECKOUT: "INITIATED_CHECKOUT",
};

function normalizeKey(value: string): string {
  return value.trim().toUpperCase();
}

const BY_CUSTOM_EVENT_TYPE = new Map<string, MetaConversionEventDefinition>(
  META_CONVERSION_EVENTS.map((event) => [event.customEventType, event]),
);

const BY_PIXEL_EVENT_NAME = new Map<string, MetaConversionEventDefinition>(
  META_CONVERSION_EVENTS.map((event) => [normalizeKey(event.pixelEventName), event]),
);

/**
 * Findet ein Ereignis anhand des Meta-Enums (`COMPLETE_REGISTRATION`), eines
 * Alias (`VIEW_CONTENT`) oder des Pixel-Namens (`CompleteRegistration`).
 * Groß-/Kleinschreibung egal. Unbekannt → `null`.
 */
export function findMetaConversionEvent(
  value: string | null | undefined,
): MetaConversionEventDefinition | null {
  const key = normalizeKey(value ?? "");
  if (!key) return null;
  const aliased = CUSTOM_EVENT_TYPE_ALIASES[key] ?? key;
  return BY_CUSTOM_EVENT_TYPE.get(aliased) ?? BY_PIXEL_EVENT_NAME.get(key) ?? null;
}

export function isKnownMetaCustomEventType(value: string | null | undefined): boolean {
  return findMetaConversionEvent(value) !== null;
}

/**
 * Portal-`custom_event_type` (z. B. `LEAD`, `COMPLETE_REGISTRATION`) →
 * Pixel-/CAPI-`event_name` (z. B. `Lead`, `CompleteRegistration`).
 * Leer oder unbekannt → `Lead` (bisheriger Default).
 */
export function metaPixelEventNameForCustomEventType(
  customEventType: string | null | undefined,
): string {
  return findMetaConversionEvent(customEventType)?.pixelEventName ?? DEFAULT_META_PIXEL_EVENT_NAME;
}

/** Kanonisches Meta-Enum (Alias/Pixel-Name aufgelöst) oder `null`, wenn unbekannt. */
export function normalizeMetaCustomEventType(value: string | null | undefined): string | null {
  return findMetaConversionEvent(value)?.customEventType ?? null;
}

/**
 * Zulässige Ad-Set-`optimization_goal`s für ein Ereignis.
 * `QUALITY_LEAD` nur bei `LEAD`; alle anderen Ereignisse `OFFSITE_CONVERSIONS`.
 */
export function metaOptimizationGoalsForEvent(
  customEventType: string | null | undefined,
): readonly string[] {
  const event = findMetaConversionEvent(customEventType);
  if (!event) return [];
  return event.customEventType === "LEAD"
    ? ["OFFSITE_CONVERSIONS", "QUALITY_LEAD"]
    : ["OFFSITE_CONVERSIONS"];
}

export type MetaLaunchConversionEventIssue = {
  code: "unknown_conversion_event" | "conversion_event_objective_mismatch" | "conversion_event_goal_mismatch";
  message: string;
};

/**
 * Prüft, ob Ereignis, Kampagnenziel und Optimierungsziel eines Launches
 * zusammenpassen. Nur Lead- und Sales-Ziele werden geprüft; andere Ziele
 * (z. B. Traffic) bleiben unverändert erlaubt.
 */
export function metaLaunchConversionEventIssue(input: {
  objective: string | null | undefined;
  optimizationGoal: string | null | undefined;
  customEventType: string | null | undefined;
}): MetaLaunchConversionEventIssue | null {
  const event = findMetaConversionEvent(input.customEventType);
  if (!event) {
    return {
      code: "unknown_conversion_event",
      message: "Dieses Conversion-Ereignis wird von Adbot nicht unterstützt.",
    };
  }
  const objective = (input.objective ?? "").trim().toUpperCase();
  if (objective !== "OUTCOME_LEADS" && objective !== "OUTCOME_SALES") return null;
  if (objective !== event.campaignObjective) {
    return {
      code: "conversion_event_objective_mismatch",
      message: `„${event.labelDe}“ (${event.pixelEventName}) gehört zum Kampagnenziel ${event.campaignObjective}, nicht ${objective}.`,
    };
  }
  const goal = (input.optimizationGoal ?? "").trim().toUpperCase();
  if (goal && !metaOptimizationGoalsForEvent(event.customEventType).includes(goal)) {
    return {
      code: "conversion_event_goal_mismatch",
      message: `Das Optimierungsziel ${goal} passt nicht zu „${event.labelDe}“. Erlaubt: ${metaOptimizationGoalsForEvent(event.customEventType).join(", ")}.`,
    };
  }
  return null;
}

export type MetaConversionReport = {
  customEventType: string;
  pixelEventName: string;
  labelDe: string;
  /** Anzahl des Optimierungsereignisses im Zeitraum (null = keine Daten). */
  conversions: number | null;
  costPerConversion: number | null;
  /** Conversion-Wert (z. B. Umsatz) – nur wenn Meta Werte meldet. */
  conversionValue: number | null;
  /** Wert / Ausgaben, nur bei Wert-Ereignissen mit Wert > 0. */
  roas: number | null;
};

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Größter Wert unter den action_types des Ereignisses. Meta meldet dieselben
 * Conversions oft parallel unter mehreren Typen (z. B. `omni_…` und
 * `offsite_conversion.fb_pixel_…`); das Maximum zählt sie nicht doppelt.
 */
function maxActionValue(
  map: Readonly<Record<string, unknown>> | null | undefined,
  actionTypes: readonly string[],
): number | null {
  if (!map) return null;
  let best: number | null = null;
  for (const type of actionTypes) {
    const value = finiteNumber(map[type]);
    if (value !== null && (best === null || value > best)) best = value;
  }
  return best;
}

/**
 * Reporting für das gespeicherte Optimierungsereignis einer Kampagne.
 * - kein/unbekanntes Ereignis → `null` (Altkampagnen: Anzeige wie bisher)
 * - LEAD → bisherige Lead-Zahl (`leads`), unverändert
 * - PURCHASE → bisherige Kauf-Zahl/-Wert (`purchases`, `purchaseValue`)
 * - alle anderen → aus den summierten Roh-`actions`/`action_values`
 */
export function metaConversionReport(input: {
  customEventType: string | null | undefined;
  spend: unknown;
  leads?: unknown;
  purchases?: unknown;
  purchaseValue?: unknown;
  actions?: Readonly<Record<string, unknown>> | null;
  actionValues?: Readonly<Record<string, unknown>> | null;
}): MetaConversionReport | null {
  const event = findMetaConversionEvent(input.customEventType);
  if (!event) return null;
  const spend = finiteNumber(input.spend);
  let conversions: number | null;
  let conversionValue: number | null;
  if (event.customEventType === "LEAD") {
    conversions = finiteNumber(input.leads);
    conversionValue = null;
  } else if (event.customEventType === "PURCHASE") {
    conversions = finiteNumber(input.purchases);
    conversionValue = finiteNumber(input.purchaseValue);
  } else {
    conversions = maxActionValue(input.actions, event.insightsActionTypes);
    if (conversions === null && input.actions) conversions = 0;
    conversionValue = maxActionValue(input.actionValues, event.insightsActionTypes);
  }
  const costPerConversion =
    spend !== null && conversions !== null && conversions > 0 ? spend / conversions : null;
  const roas =
    event.expectsValue && conversionValue !== null && conversionValue > 0 && spend !== null && spend > 0
      ? conversionValue / spend
      : null;
  return {
    customEventType: event.customEventType,
    pixelEventName: event.pixelEventName,
    labelDe: event.labelDe,
    conversions,
    costPerConversion,
    conversionValue: event.expectsValue ? conversionValue : null,
    roas,
  };
}

/**
 * Standard-UTM-Parameter für Anzeigen (Meta ersetzt die {{…}}-Makros).
 * Bei neuen Launches standardmäßig an, pro Kampagne abschaltbar.
 */
export const DEFAULT_META_URL_TAGS =
  "utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";

function utmKeysInUrl(raw: string): Set<string> {
  const keys = new Set<string>();
  const trimmed = raw.trim();
  const hashStart = trimmed.indexOf("#");
  const value = hashStart < 0 ? trimmed : trimmed.slice(0, hashStart);
  const queryStart = value.indexOf("?");
  if (queryStart < 0) return keys;
  const query = value.slice(queryStart + 1);
  for (const pair of query.split("&")) {
    const rawKey = pair.split("=")[0] ?? "";
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    } catch {
      // ungültiges Encoding: Rohschlüssel verwenden
    }
    key = key.trim().toLowerCase();
    if (key.startsWith("utm_")) keys.add(key);
  }
  return keys;
}

/**
 * url_tags für die Anzeigen dieses Launches: Standard-UTM-Parameter ohne die
 * utm-Schlüssel, die eine der Ziel-URLs bereits trägt (vorhandene Werte werden
 * nie überschrieben). `null`, wenn nichts mehr übrig bleibt.
 */
export function metaUrlTagsForDestinations(
  destinationUrls: ReadonlyArray<string | null | undefined>,
  urlTags: string = DEFAULT_META_URL_TAGS,
): string | null {
  const present = new Set<string>();
  for (const url of destinationUrls) {
    if (typeof url !== "string") continue;
    for (const key of utmKeysInUrl(url)) present.add(key);
  }
  const kept = urlTags
    .split("&")
    .filter((pair) => pair.length > 0)
    .filter((pair) => !present.has((pair.split("=")[0] ?? "").trim().toLowerCase()));
  return kept.length > 0 ? kept.join("&") : null;
}

/**
 * Antwort von `GET /{pixel_id}/stats?aggregation=event` → Summe je Pixel-
 * Ereignisname (z. B. `{ PageView: 120, Lead: 4 }`). Unbekannte Formen → `{}`.
 */
export function parsePixelEventStats(value: unknown): Record<string, number> {
  const totals: Record<string, number> = {};
  const root = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const buckets = Array.isArray(root?.data) ? root.data : [];
  for (const bucket of buckets) {
    const entries =
      bucket && typeof bucket === "object" && Array.isArray((bucket as Record<string, unknown>).data)
        ? ((bucket as Record<string, unknown>).data as unknown[])
        : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const name = (entry as Record<string, unknown>).value;
      const count = finiteNumber((entry as Record<string, unknown>).count);
      if (typeof name !== "string" || !name.trim() || count === null) continue;
      totals[name.trim()] = (totals[name.trim()] ?? 0) + count;
    }
  }
  return totals;
}

export type PixelEventSignal = {
  pixelEventName: string;
  /** Anzahl im Zeitraum; 0 = kein Signal. */
  count: number;
  received: boolean;
};

/** Ist das gewählte Ereignis laut Pixel-Statistik angekommen? */
export function pixelEventSignal(
  stats: Readonly<Record<string, number>>,
  customEventType: string | null | undefined,
): PixelEventSignal | null {
  const event = findMetaConversionEvent(customEventType);
  if (!event) return null;
  const wanted = event.pixelEventName.toUpperCase();
  let count = 0;
  for (const [name, value] of Object.entries(stats)) {
    if (name.toUpperCase() === wanted) count += value;
  }
  return { pixelEventName: event.pixelEventName, count, received: count > 0 };
}
