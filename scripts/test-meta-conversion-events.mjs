import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_META_CONVERSION_EVENT_TYPE,
  META_CONVERSION_EVENTS,
  findMetaConversionEvent,
  isKnownMetaCustomEventType,
  metaPixelEventNameForCustomEventType,
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

console.log("meta conversion events: ok");
