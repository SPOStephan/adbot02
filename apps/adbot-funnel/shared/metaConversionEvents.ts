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
