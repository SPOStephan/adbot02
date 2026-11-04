import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_META_CONVERSION_EVENT_TYPE,
  META_CONVERSION_EVENTS,
  findMetaConversionEvent,
  isKnownMetaCustomEventType,
  metaConversionReport,
  metaLaunchConversionEventIssue,
  metaOptimizationGoalsForEvent,
  metaPixelEventNameForCustomEventType,
  normalizeMetaCustomEventType,
} from "../src/lib/meta/conversion-events.ts";

// Gleiche Funktion wie in src/lib/funnel-meta-sync.ts und der Funnel-App
// (beide delegieren nur hierhin; die Funnel-App-Kopie wird unten auf
// Gleichheit geprüft und dort per vitest getestet).
const mapPortalCustomEventToFunnelEventName = metaPixelEventNameForCustomEventType;

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

// Default bleibt LEAD → Lead.
assert.equal(DEFAULT_META_CONVERSION_EVENT_TYPE, "LEAD");

// Pflicht-Ereignisse aus dem Auftrag.
for (const type of ["LEAD", "COMPLETE_REGISTRATION", "PURCHASE", "SUBSCRIBE"]) {
  assert.ok(isKnownMetaCustomEventType(type), `${type} fehlt`);
}

// Tabelle in sich konsistent.
const seenTypes = new Set();
const seenPixel = new Set();
for (const e of META_CONVERSION_EVENTS) {
  assert.match(e.customEventType, /^[A-Z][A-Z0-9_]*$/);
  assert.match(e.pixelEventName, /^[A-Z][A-Za-z]*$/);
  assert.ok(!seenTypes.has(e.customEventType), `doppelt: ${e.customEventType}`);
  assert.ok(!seenPixel.has(e.pixelEventName), `doppelt: ${e.pixelEventName}`);
  seenTypes.add(e.customEventType);
  seenPixel.add(e.pixelEventName);
  assert.ok(e.insightsActionTypes.length > 0);
  assert.ok(["OUTCOME_LEADS", "OUTCOME_SALES"].includes(e.campaignObjective));
  assert.ok(e.labelDe.trim().length > 0);
}

// Mapping für alle Tabellenereignisse (Portal + Funnel-App identisch).
const expected = {
  LEAD: "Lead",
  COMPLETE_REGISTRATION: "CompleteRegistration",
  CONTACT: "Contact",
  SUBMIT_APPLICATION: "SubmitApplication",
  SCHEDULE: "Schedule",
  PURCHASE: "Purchase",
  SUBSCRIBE: "Subscribe",
  START_TRIAL: "StartTrial",
  INITIATED_CHECKOUT: "InitiateCheckout",
  ADD_PAYMENT_INFO: "AddPaymentInfo",
  ADD_TO_CART: "AddToCart",
  SEARCH: "Search",
  CONTENT_VIEW: "ViewContent",
};
assert.deepEqual(
  Object.fromEntries(META_CONVERSION_EVENTS.map((e) => [e.customEventType, e.pixelEventName])),
  expected,
);
for (const [type, pixel] of Object.entries(expected)) {
  assert.equal(metaPixelEventNameForCustomEventType(type), pixel);
  assert.equal(mapPortalCustomEventToFunnelEventName(type), pixel);
  assert.equal(mapPortalCustomEventToFunnelEventName(type.toLowerCase()), pixel);
  assert.equal(mapPortalCustomEventToFunnelEventName(` ${type} `), pixel);
  // Pixel-Namen selbst bleiben stabil.
  assert.equal(mapPortalCustomEventToFunnelEventName(pixel), pixel);
}

// Der gemeldete Fehler: früher "Complete_registration".
assert.equal(mapPortalCustomEventToFunnelEventName("COMPLETE_REGISTRATION"), "CompleteRegistration");

// Regression LEAD: Funnel/Freebie senden weiterhin exakt "Lead".
for (const value of ["LEAD", "lead", "Lead", "", "   ", null, undefined]) {
  assert.equal(mapPortalCustomEventToFunnelEventName(value), "Lead");
}

// Aliase.
assert.equal(findMetaConversionEvent("VIEW_CONTENT")?.customEventType, "CONTENT_VIEW");
assert.equal(findMetaConversionEvent("INITIATE_CHECKOUT")?.customEventType, "INITIATED_CHECKOUT");

// Unbekannt → Lead statt String-Heuristik.
assert.equal(findMetaConversionEvent("FOO_BAR"), null);
assert.equal(mapPortalCustomEventToFunnelEventName("FOO_BAR"), "Lead");
assert.equal(mapPortalCustomEventToFunnelEventName("not valid!"), "Lead");

// Lead/Kauf-Action-Types identisch zum bisherigen Reporting.
assert.deepEqual(findMetaConversionEvent("LEAD").insightsActionTypes, [
  "lead",
  "omni_lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
]);
assert.deepEqual(findMetaConversionEvent("PURCHASE").insightsActionTypes, [
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);
assert.equal(findMetaConversionEvent("PURCHASE").expectsValue, true);
assert.equal(findMetaConversionEvent("SUBSCRIBE").expectsValue, true);
assert.equal(findMetaConversionEvent("LEAD").expectsValue, false);

// Funnel-App-Kopie ist identisch.
assert.equal(
  read("apps/adbot-funnel/shared/metaConversionEvents.ts"),
  read("src/lib/meta/conversion-events.ts"),
  "apps/adbot-funnel/shared/metaConversionEvents.ts muss eine identische Kopie sein",
);

// SQL-Seed entspricht der TypeScript-Tabelle.
const sql = read("supabase/migrations/20261104090000_meta_conversion_event_catalog.sql");
const rowPattern =
  /\('([A-Z_]+)', '([A-Za-z]+)', array\[([^\]]*)\], '(OUTCOME_[A-Z]+)', (true|false), '([^']+)', \d+\)/g;
const sqlRows = [...sql.matchAll(rowPattern)].map((m) => ({
  customEventType: m[1],
  pixelEventName: m[2],
  insightsActionTypes: [...m[3].matchAll(/'([^']+)'/g)].map((a) => a[1]),
  campaignObjective: m[4],
  expectsValue: m[5] === "true",
  labelDe: m[6],
}));
assert.deepEqual(
  sqlRows,
  META_CONVERSION_EVENTS.map((e) => ({ ...e, insightsActionTypes: [...e.insightsActionTypes] })),
);

// Funnel-meta-sync im Portal nutzt die Tabelle (keine String-Heuristik mehr).
const portalSync = read("src/lib/funnel-meta-sync.ts");
assert.match(portalSync, /metaPixelEventNameForCustomEventType\(customEventType\)/);
assert.doesNotMatch(portalSync, /slice\(1\)\.toLowerCase\(\)/);
const funnelSoftApply = read("apps/adbot-funnel/shared/metaPixelSoftApply.ts");
assert.match(funnelSoftApply, /return metaPixelEventNameForCustomEventType\(customEventType\);/);
assert.doesNotMatch(funnelSoftApply, /slice\(1\)\.toLowerCase\(\)/);

// Freebie-Sync nutzt ebenfalls die Tabelle.
const freebieSync = read("src/lib/freebie-meta-sync.ts");
assert.match(freebieSync, /return metaPixelEventNameForCustomEventType\(customEventType\);/);
assert.doesNotMatch(freebieSync, /slice\(1\)\.toLowerCase\(\)/);

// ---- Teil 2: Launch ----

// Normalisierung + Optimierungsziele.
assert.equal(normalizeMetaCustomEventType("view_content"), "CONTENT_VIEW");
assert.equal(normalizeMetaCustomEventType("CompleteRegistration"), "COMPLETE_REGISTRATION");
assert.equal(normalizeMetaCustomEventType("FOO"), null);
assert.deepEqual(metaOptimizationGoalsForEvent("LEAD"), ["OFFSITE_CONVERSIONS", "QUALITY_LEAD"]);
for (const e of META_CONVERSION_EVENTS.filter((e) => e.customEventType !== "LEAD")) {
  assert.deepEqual(metaOptimizationGoalsForEvent(e.customEventType), ["OFFSITE_CONVERSIONS"]);
}

// Abnahme 1: COMPLETE_REGISTRATION unter OUTCOME_LEADS mit OFFSITE_CONVERSIONS ist gültig.
assert.equal(
  metaLaunchConversionEventIssue({
    objective: "OUTCOME_LEADS",
    optimizationGoal: "OFFSITE_CONVERSIONS",
    customEventType: "COMPLETE_REGISTRATION",
  }),
  null,
);
// QUALITY_LEAD nur bei LEAD.
assert.equal(
  metaLaunchConversionEventIssue({
    objective: "OUTCOME_LEADS",
    optimizationGoal: "QUALITY_LEAD",
    customEventType: "COMPLETE_REGISTRATION",
  })?.code,
  "conversion_event_goal_mismatch",
);
// LEAD-Regression: beide bisherigen Ziele weiterhin gültig.
for (const goal of ["OFFSITE_CONVERSIONS", "QUALITY_LEAD"]) {
  assert.equal(
    metaLaunchConversionEventIssue({ objective: "OUTCOME_LEADS", optimizationGoal: goal, customEventType: "LEAD" }),
    null,
  );
}
// Kauf/Abo verlangen OUTCOME_SALES.
for (const type of ["PURCHASE", "SUBSCRIBE"]) {
  assert.equal(
    metaLaunchConversionEventIssue({ objective: "OUTCOME_SALES", optimizationGoal: "OFFSITE_CONVERSIONS", customEventType: type }),
    null,
  );
  assert.equal(
    metaLaunchConversionEventIssue({ objective: "OUTCOME_LEADS", optimizationGoal: "OFFSITE_CONVERSIONS", customEventType: type })?.code,
    "conversion_event_objective_mismatch",
  );
}
// Andere Ziele (z. B. Traffic) werden nicht angefasst.
assert.equal(
  metaLaunchConversionEventIssue({ objective: "OUTCOME_TRAFFIC", optimizationGoal: "LINK_CLICKS", customEventType: "LEAD" }),
  null,
);
assert.equal(
  metaLaunchConversionEventIssue({ objective: "OUTCOME_LEADS", optimizationGoal: "OFFSITE_CONVERSIONS", customEventType: "FOO" })?.code,
  "unknown_conversion_event",
);

// Launch-Parser: gespiegelte Liste == Tabelle.
const input = read("src/lib/meta/customer-control-input.ts");
const launchList = input.match(/const LAUNCH_CUSTOM_EVENT_TYPES = \[([\s\S]*?)\] as const;/);
assert.ok(launchList, "LAUNCH_CUSTOM_EVENT_TYPES fehlt");
assert.deepEqual(
  [...launchList[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]),
  META_CONVERSION_EVENTS.map((e) => e.customEventType),
);
assert.match(input, /custom_event_type: requiredLaunchCustomEventType\(body\.customEventType\)/);
// Pixel-Bestätigung bleibt unverändert (Regex, Default LEAD).
assert.match(input, /customEventType: requiredCustomEventType\(body\.customEventType\)/);

// Service: Prüfung vor dem Freeze, LEAD liest nichts zusätzlich.
const service = read("src/lib/meta/customer-control-service.ts");
assert.match(service, /if \(!eventType \|\| eventType === "LEAD"\) return;/);
const launchFn = service.slice(service.indexOf("export async function materializeCustomerLaunch("));
assert.ok(
  launchFn.indexOf("assertLaunchConversionEventFitsBlueprint") <
    launchFn.indexOf("ensureFreezeWritesForLaunch(readyCustomer)"),
  "Ereignisprüfung muss vor dem Freeze laufen",
);

// UI: Default LEAD, Ziel aus Tabelle, QUALITY_LEAD nur bei LEAD.
const ui = read("src/components/LeadLaunchCanary.tsx");
assert.match(ui, /DEFAULT_META_CONVERSION_EVENT_TYPE,\n\s*\);/);
assert.match(ui, /objective: launchObjective,/);
assert.match(ui, /metaOptimizationGoal\(effectivePerformanceGoal\)/);
assert.match(ui, /const effectivePerformanceGoal: LeadPerformanceGoal = isLeadEvent/);
assert.match(ui, /customEventType: selectedConversionEvent\.customEventType,\n\s*reason: PROTOCOL_APPROVE_REASON/);

// Migration: Lead-Underperformer nur für LEAD-Launches, Rest unverändert.
const windowSql = read("supabase/migrations/20261104120000_meta_lead_window_conversion_event.sql");
const originalSql = read("supabase/migrations/20261026120000_meta_customer_campaign_status.sql");
const fnBody = (sql) => {
  const start = sql.indexOf("create or replace function public.meta_lead_campaign_window(");
  return sql.slice(start, sql.indexOf("$$;", start));
};
const before = fnBody(originalSql);
const after = fnBody(windowSql);
const guardStart = after.indexOf("    -- lead_window_lead_event_only");
const guardEnd = after.indexOf("  group by");
assert.ok(guardStart > 0 && guardEnd > guardStart);
assert.equal(after.slice(0, guardStart) + after.slice(guardEnd), before, "nur die Ereignis-Bedingung darf neu sein");
assert.match(after, /'LEAD'\n\s*\)\)\) <> 'LEAD'/);

// ---- Teil 3: Reporting ----

// Altkampagnen ohne Ereignis: kein Report (Anzeige wie bisher).
assert.equal(metaConversionReport({ customEventType: null, spend: 10, leads: 2 }), null);
assert.equal(metaConversionReport({ customEventType: "FOO", spend: 10, leads: 2 }), null);

// LEAD: exakt die bisherige Lead-Zahl, kein Wert.
assert.deepEqual(
  metaConversionReport({ customEventType: "LEAD", spend: "50", leads: "4", actions: { lead: 99 } }),
  {
    customEventType: "LEAD",
    pixelEventName: "Lead",
    labelDe: "Lead",
    conversions: 4,
    costPerConversion: 12.5,
    conversionValue: null,
    roas: null,
  },
);

// COMPLETE_REGISTRATION: Registrierungen + Kosten pro Registrierung, keine Doppelzählung.
const registration = metaConversionReport({
  customEventType: "COMPLETE_REGISTRATION",
  spend: 60,
  leads: 1,
  actions: {
    complete_registration: 5,
    "offsite_conversion.fb_pixel_complete_registration": 3,
    lead: 1,
  },
});
assert.equal(registration.conversions, 5);
assert.equal(registration.costPerConversion, 12);
assert.equal(registration.conversionValue, null);
assert.equal(registration.roas, null);
// Keine Aktionen gemeldet → 0; keine Daten → null.
assert.equal(metaConversionReport({ customEventType: "COMPLETE_REGISTRATION", spend: 5, actions: {} }).conversions, 0);
assert.equal(metaConversionReport({ customEventType: "COMPLETE_REGISTRATION", spend: 5, actions: null }).conversions, null);
assert.equal(metaConversionReport({ customEventType: "COMPLETE_REGISTRATION", spend: 5, actions: {} }).costPerConversion, null);

// PURCHASE: bisherige Kauf-Spalten, Umsatz und ROAS.
const purchase = metaConversionReport({
  customEventType: "PURCHASE",
  spend: 100,
  purchases: 4,
  purchaseValue: 350,
});
assert.equal(purchase.conversions, 4);
assert.equal(purchase.costPerConversion, 25);
assert.equal(purchase.conversionValue, 350);
assert.equal(purchase.roas, 3.5);

// SUBSCRIBE: aus Roh-Aktionen inkl. Wert.
const subscribe = metaConversionReport({
  customEventType: "SUBSCRIBE",
  spend: 40,
  actions: { subscribe_total: 2, subscribe_website: 2 },
  actionValues: { subscribe_total: 198 },
});
assert.equal(subscribe.conversions, 2);
assert.equal(subscribe.conversionValue, 198);
assert.equal(subscribe.roas, 4.95);

// Übersicht: Ereignis kommt aus dem Launch-Plan, Beitrag-Push bleibt ohne.
const overview = read("src/lib/meta/campaign-ad-overview.ts");
assert.match(overview, /record\(record\(payload\.ad_set\)\?\.promoted_object\)\?\.custom_event_type/);
assert.match(overview, /optimizationEventType: plan\?\.isOrganicBoost \? null/);
const loader = read("src/lib/dashboard/load-campaign-ad-overview.ts");
assert.match(loader, /COLUMN_BACKED_EVENTS = new Set\(\["LEAD", "PURCHASE"\]\)/);
assert.match(loader, /catch \(error\) \{\n\s*console\.warn\("\[campaign-ad-overview\] conversion actions unavailable"/);
const card = read("src/components/CampaignAdOverview.tsx");
assert.match(card, /item\.conversion && item\.conversion\.customEventType !== "LEAD"/);

// View: rein additiv, gleiches Fenster wie meta_campaign_performance_30d.
const viewSql = read("supabase/migrations/20261104140000_meta_campaign_conversion_actions_30d.sql");
assert.match(viewSql, /create or replace view public\.meta_campaign_conversion_actions_30d/);
assert.match(viewSql, /pd\.date between anchor\.window_end - 29 and anchor\.window_end/);
assert.match(viewSql, /security_invoker = true/);
assert.doesNotMatch(viewSql, /meta_campaign_performance_30d\s+(with|as)/);
assert.doesNotMatch(viewSql, /\b(insert|update|delete|alter table|drop)\b/i);

console.log("meta conversion events: ok");
