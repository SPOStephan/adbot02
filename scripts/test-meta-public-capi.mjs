// Conversions API (erweitert): statische Leitplanken-Tests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261104180000_meta_public_capi_foundation.sql");
const code = sql.replace(/--.*$/gm, "");

// Rein additiv: keine Änderung an bestehenden Tabellen, keine Trigger.
assert.ok(!/\balter\s+table\s+public\.(?!meta_public_capi_pixels|meta_capi_event_keys|meta_conversion_events_log|meta_capi_rate_limits)\w+/i.test(code), "nur neue Tabellen dürfen per ALTER angefasst werden");
assert.ok(!/\bcreate\s+(or\s+replace\s+)?trigger\b/i.test(code), "keine Trigger");
assert.ok(!/\bdrop\s+(table|function|column|trigger)\b/i.test(code), "nichts wird gelöscht");
assert.ok(!/\bmeta_conversion_events\s*\(/i.test(code.replace(/meta_conversion_events_log/g, "")), "zentrale Ereignis-Tabelle bleibt unverändert");
assert.ok(!/(insert|update)\s+(into\s+)?public\.meta_confirmed_pixels/i.test(code), "meta_confirmed_pixels bleibt unverändert");

// Standard aus.
assert.match(code, /enabled boolean not null default false/);

// Schlüssel nur als Hash, Hash nicht für authenticated lesbar.
assert.match(code, /key_hash text not null/);
assert.ok(!/\bkey(_plain|_secret|_raw)\b/i.test(code), "kein Klartext-Schlüssel");
const keyGrant = code.match(/grant select \(([^)]*)\) on table public\.meta_capi_event_keys to authenticated/);
assert.ok(keyGrant, "Spalten-Grant für Schlüssel fehlt");
assert.ok(!keyGrant[1].includes("key_hash"), "key_hash darf für Kunden nicht lesbar sein");

// Protokoll ohne personenbezogene Rohdaten.
const logTable = code.match(/create table if not exists public\.meta_conversion_events_log \(([\s\S]*?)\n\);/)[1];
for (const pii of ["email", "phone", "first_name", "last_name", "client_ip", "user_agent", "ip_address", "external_id", "payload"]) {
  assert.ok(!logTable.includes(pii), `Protokoll enthält ${pii}`);
}
assert.match(code, /interval '90 days'/);

// Idempotenz + RLS.
assert.match(code, /meta_conversion_events_log_idem_uidx[\s\S]*?\(pixel_id, event_id, event_name, is_test\)[\s\S]*?where status in \('pending', 'sent'\)/);
for (const table of ["meta_public_capi_pixels", "meta_capi_event_keys", "meta_conversion_events_log", "meta_capi_rate_limits"]) {
  assert.match(code, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(code, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
}
assert.match(code, /revoke all on function public\.meta_capi_rate_limit_hit\(uuid, integer, integer\) from public, anon, authenticated/);
assert.match(code, /revoke all on function public\.meta_conversion_events_cleanup\(\) from public, anon, authenticated/);

console.log("meta public capi: ok");

// ---------------------------------------------------------------------------
// Teil 2: Sendelogik (src/lib/meta/public-capi.ts)
// ---------------------------------------------------------------------------
const lib = await import("../src/lib/meta/public-capi.ts");
const { META_CONVERSION_EVENTS } = await import("../src/lib/meta/conversion-events.ts");
const { createHash } = await import("node:crypto");
const sha = (v) => createHash("sha256").update(v).digest("hex");

// Schlüssel: Format, Hash, nur Hash vergleichbar.
const generated = lib.generatePublicCapiKey("live");
assert.match(generated.key, /^adb_ev_live_[0-9a-f]{64}$/);
assert.match(generated.prefix, /^adb_ev_live_[0-9a-f]{8}$/);
assert.ok(/^adb_ev_(live|test)_[A-Za-z0-9]{4,12}$/.test(generated.prefix), "Präfix passt zum DB-Check");
assert.equal(generated.hash, sha(generated.key));
assert.notEqual(generated.hash, generated.key);
const parsedKey = lib.parsePublicCapiAuthorization(`Bearer ${generated.key}`);
assert.equal(parsedKey.mode, "live");
assert.ok(lib.publicCapiKeyHashEquals(parsedKey.hash, generated.hash));
assert.ok(!lib.publicCapiKeyHashEquals(parsedKey.hash, sha("x")));
assert.equal(lib.parsePublicCapiAuthorization("Bearer abc"), null);
assert.equal(lib.parsePublicCapiAuthorization(generated.key), null);
assert.equal(lib.parsePublicCapiAuthorization(null), null);
assert.equal(lib.generatePublicCapiKey("test").mode, "test");

// Domains inkl. Subdomains, keine Suffix-Tricks.
assert.ok(lib.publicCapiHostAllowed("kiready.co", ["kiready.co"]));
assert.ok(lib.publicCapiHostAllowed("www.kiready.co", ["kiready.co"]));
assert.ok(!lib.publicCapiHostAllowed("evilkiready.co", ["kiready.co"]));
assert.ok(!lib.publicCapiHostAllowed("kiready.co.evil.com", ["kiready.co"]));
assert.ok(!lib.publicCapiHostAllowed("kiready.co", []));

// Erlaubte Namen: zentrale Tabelle + DisqualifiedLead.
const allowedEventNames = lib.publicCapiAllowedEventNames(META_CONVERSION_EVENTS.map((e) => e.pixelEventName));
for (const name of ["Lead", "CompleteRegistration", "Purchase", "Subscribe", "DisqualifiedLead"]) {
  assert.ok(allowedEventNames.has(name), name);
}
assert.ok(!allowedEventNames.has("PageView"), "PageView nur Browser");

const now = 1_793_772_425;
const ctx = { nowSeconds: now, keyMode: "live", allowedEventNames, allowedHostnames: ["kiready.co"] };
const baseEvent = () => ({
  event_name: "Lead",
  event_id: "11111111-2222-3333-4444-555555555555",
  event_time: now - 60,
  action_source: "website",
  event_source_url: "https://kiready.co/ki-readiness",
  consent: { marketing: true },
  user_data: {
    email: "  Max.Muster@Example.COM ",
    phone: "+49 171 1234567",
    first_name: "Max",
    last_name: "Müster",
    external_id: "crm-42",
    client_ip_address: "203.0.113.7",
    client_user_agent: "Mozilla/5.0",
    fbp: "fb.1.1700000000000.123456789",
    fbc: "fb.1.1700000000000.AbCdEf",
  },
  custom_data: { value: "22.61", currency: "eur", content_name: "KI-Check" },
});
const one = (event, c = ctx) => lib.parsePublicCapiRequest({ events: [event] }, c);

// Gültiges Lead: gehasht, normalisiert, keine Rohdaten.
const ok = one(baseEvent());
assert.equal(ok.ok, true);
const [valid] = ok.events;
assert.equal(valid.status, "valid");
const ud = valid.metaEvent.user_data;
assert.deepEqual(ud.em, [sha("max.muster@example.com")]);
assert.deepEqual(ud.ph, [sha("491711234567")]);
assert.deepEqual(ud.fn, [sha("max")]);
assert.deepEqual(ud.ln, [sha("müster")]);
assert.deepEqual(ud.external_id, [sha("crm-42")]);
assert.equal(ud.client_ip_address, "203.0.113.7");
assert.equal(valid.metaEvent.custom_data.value, 22.61);
assert.equal(valid.metaEvent.custom_data.currency, "EUR");
const serialized = JSON.stringify(valid.metaEvent);
for (const raw of ["Max.Muster", "example.com", "1711234567", "Müster", "crm-42"]) {
  assert.ok(!serialized.includes(raw), `Rohwert ${raw} im Meta-Ereignis`);
}
assert.ok(!("consent" in valid.metaEvent), "consent geht nicht an Meta");

// Bereits gehashte Werte bleiben unverändert (lowercase).
const preHashed = sha("a@b.de");
const hashedEvent = baseEvent();
hashedEvent.user_data = { em: preHashed.toUpperCase(), client_user_agent: "UA" };
assert.deepEqual(one(hashedEvent).events[0].metaEvent.user_data.em, [preHashed]);

// Einwilligung (Abnahme 3).
for (const consent of [undefined, null, {}, { marketing: false }, { marketing: "true" }]) {
  const event = baseEvent();
  event.consent = consent;
  const result = one(event).events[0];
  assert.equal(result.status, "skipped_no_consent");
  assert.ok(!("metaEvent" in result));
}

// Duplikat in derselben Anfrage (Abnahme 4, Teil im Request).
const dupe = lib.parsePublicCapiRequest({ events: [baseEvent(), baseEvent()] }, ctx);
assert.deepEqual(dupe.events.map((e) => e.status), ["valid", "duplicate"]);

// Ungültige Fälle.
const invalidCases = [
  [(e) => { e.event_name = "PageView"; }, "event_name_not_allowed"],
  [(e) => { e.event_name = "Lead!"; }, "event_name_invalid"],
  [(e) => { delete e.event_id; }, "event_id_missing"],
  [(e) => { e.action_source = "fax"; }, "action_source_invalid"],
  [(e) => { e.event_time = now - 8 * 24 * 3600; }, "event_time_too_old"],
  [(e) => { e.event_time = now + 3600; }, "event_time_in_future"],
  [(e) => { e.event_time = 1.5; }, "event_time_invalid"],
  [(e) => { e.event_source_url = "https://evil.com/x"; }, "event_source_url_domain_not_allowed"],
  [(e) => { e.event_source_url = "javascript:alert(1)"; }, "event_source_url_invalid"],
  [(e) => { delete e.event_source_url; }, "event_source_url_missing"],
  [(e) => { delete e.user_data.client_user_agent; }, "client_user_agent_missing"],
  [(e) => { e.user_data = { client_user_agent: "UA" }; }, "user_data_missing"],
  [(e) => { e.custom_data = { value: 5 }; }, "custom_data_currency_missing"],
  [(e) => { e.custom_data = { value: -1, currency: "EUR" }; }, "custom_data_value_invalid"],
  [(e) => { e.custom_data = { currency: "EURO" }; }, "custom_data_currency_invalid"],
  [(e) => { e.custom_data = { big: "x".repeat(9000) }; }, "custom_data_too_large"],
  [(e) => { e.original_event_data = { event_name: "" }; }, "original_event_data_event_name_invalid"],
];
for (const [mutate, reason] of invalidCases) {
  const event = baseEvent();
  mutate(event);
  const result = one(event).events[0];
  assert.equal(result.status, "invalid", reason);
  assert.equal(result.reason, reason);
}

// Folgeereignis ohne Browser + Qualitäts-Rückmeldung.
const feedback = one({
  event_name: "DisqualifiedLead",
  event_id: "fb-1",
  action_source: "system_generated",
  consent: { marketing: true },
  user_data: { email: "max@example.com" },
  original_event_data: { event_name: "Lead", event_id: "11111111-2222-3333-4444-555555555555" },
}).events[0];
assert.equal(feedback.status, "valid");
assert.equal(feedback.metaEvent.event_time, now, "event_time Standard = jetzt");
assert.deepEqual(feedback.metaEvent.original_event_data, {
  event_name: "Lead",
  event_id: "11111111-2222-3333-4444-555555555555",
});

// Anfrage-Ebene.
assert.equal(lib.parsePublicCapiRequest(null, ctx).error, "body_invalid");
assert.equal(lib.parsePublicCapiRequest({ events: [] }, ctx).error, "events_missing");
assert.equal(
  lib.parsePublicCapiRequest({ events: Array.from({ length: 101 }, baseEvent) }, ctx).error,
  "too_many_events",
);
assert.equal(lib.parsePublicCapiRequest({ events: Array.from({ length: 100 }, baseEvent) }, ctx).ok, true);
assert.equal(
  lib.parsePublicCapiRequest({ events: [baseEvent()] }, { ...ctx, keyMode: "test" }).error,
  "test_event_code_required",
);
const testOk = lib.parsePublicCapiRequest({ test_event_code: "TEST123", events: [baseEvent()] }, { ...ctx, keyMode: "test" });
assert.equal(testOk.testEventCode, "TEST123");
assert.equal(lib.parsePublicCapiRequest({ test_event_code: "bad code", events: [baseEvent()] }, ctx).error, "test_event_code_invalid");

// Protokollzeile: nur Metadaten (Abnahme 5).
const row = lib.publicCapiLogRow({
  keyId: "k", userId: "u", pixelId: "123456", eventName: "Lead", eventId: "e1",
  actionSource: "website", isTest: false, status: "meta_error", errorCode: 100,
  errorReason: "OAuthException\nmax@example.com".slice(0, 14), fbtraceId: "AbC123",
});
assert.deepEqual(Object.keys(row).sort(), [
  "action_source", "error_code", "error_reason", "event_id", "event_name", "fbtrace_id",
  "is_test", "key_id", "pixel_id", "status", "user_id",
]);
assert.equal(row.error_code, "100");

// Retry-Regel: nicht bei 4xx.
assert.equal(lib.publicCapiShouldRetry(400), false);
assert.equal(lib.publicCapiShouldRetry(403), false);
assert.equal(lib.publicCapiShouldRetry(429), true);
assert.equal(lib.publicCapiShouldRetry(503), true);
assert.equal(lib.publicCapiShouldRetry(undefined), true);
assert.equal(lib.publicCapiStatusFromSend({ status: "sent", attempts: 1 }), "sent");
assert.equal(lib.publicCapiStatusFromSend({ status: "failed", attempts: 1 }), "meta_error");

// Bestehender Einzelversand (Funnel-Relay, Probe) bleibt unverändert.
const connectionCapi = read("src/lib/meta/connection-capi.ts");
assert.match(connectionCapi, /export async function sendConnectionCapiEvent\(input: \{\n  credentials: ConnectionCapiCredentials;\n  pixelId: string;\n  event: Record<string, unknown>;/);
assert.match(connectionCapi, /export async function sendConnectionCapiEvents\(/);
assert.ok(!read("src/app/api/internal/funnel-capi/route.ts").includes("sendConnectionCapiEvents"), "Funnel-Relay unverändert");

console.log("meta public capi send logic: ok");

// ---------------------------------------------------------------------------
// Teil 3: Endpunkt, Cron, OpenAPI (statisch)
// ---------------------------------------------------------------------------
const route = read("src/app/api/v1/conversions/events/route.ts");
const service = read("src/lib/meta/public-capi-service.ts");
// Ebene 1: ohne Env-Flag 404 vor jeder Verarbeitung.
assert.match(service, /process\.env\.ADBOT_PUBLIC_CAPI_ENABLED === "true"/);
assert.match(route, /export async function POST[\s\S]*?if \(!publicCapiEndpointEnabled\(\)\) return notFound\(\);/);
assert.ok(!/Access-Control-Allow/i.test(route), "kein CORS");
// Ebene 2: Schalter je Pixel + bestätigter Pixel.
assert.match(service, /toggle\.enabled !== true/);
assert.match(service, /pixel\.status !== "CONFIRMED"/);
assert.match(service, /\.is\("revoked_at", null\)/);
// Bestehender Versandweg, kein zweiter.
assert.match(service, /sendConnectionCapiEvents\(/);
assert.ok(!service.includes("graph.facebook.com"), "kein eigener Graph-Aufruf");
// Keine Rohdaten in Logs/DB: Protokoll nur über publicCapiLogRow, kein Logging von Body/Schlüssel.
for (const call of (service + route).match(/console\.\w+\([^;]*\);/g) ?? []) {
  assert.match(call, /^console\.\w+\("[^"]*"\);$/, `Logging nur mit festem Text: ${call}`);
}
assert.ok(!/insert\((?!row\)|auditRows\))/.test(service), "Protokoll nur aus publicCapiLogRow");
// Idempotenz + Rate-Limit.
assert.match(service, /error\?\.code !== "23505"/);
assert.match(service, /meta_capi_rate_limit_hit/);
// Cron.
const vercel = JSON.parse(read("vercel.json"));
assert.ok(vercel.crons.some((c) => c.path === "/api/cron/conversion-events-cleanup"));
assert.match(read("src/app/api/cron/conversion-events-cleanup/route.ts"), /constantTimeEqual\(supplied, `Bearer \$\{cronSecret\}`\)/);
// OpenAPI passt zur Logik.
const spec = JSON.parse(read("public/api-docs/conversions-v1.openapi.json"));
const op = spec.paths["/api/v1/conversions/events"].post;
assert.equal(op.requestBody.content["application/json"].schema.properties.events.maxItems, lib.PUBLIC_CAPI_MAX_EVENTS_PER_REQUEST);
assert.deepEqual(
  op.responses["200"].content["application/json"].schema.properties.events.items.properties.status.enum,
  ["sent", "skipped_no_consent", "duplicate", "invalid", "meta_error"],
);
assert.deepEqual(
  spec.components.schemas.Event.properties.action_source.enum,
  [...lib.PUBLIC_CAPI_ACTION_SOURCES],
);

console.log("meta public capi endpoint: ok");

// ---------------------------------------------------------------------------
// Teil 4: Tracking-UI + Verwaltung
// ---------------------------------------------------------------------------
assert.deepEqual(lib.parsePublicCapiHostnameList("kiready.co, https://www.kiready.co/x ; KIREADY.co"), { ok: true, hostnames: ["kiready.co", "www.kiready.co"] });
assert.equal(lib.parsePublicCapiHostnameList("").ok, false);
assert.equal(lib.parsePublicCapiHostnameList("not a domain").ok, false);
assert.equal(lib.parsePublicCapiHostnameList(Array.from({ length: 21 }, (_, i) => `d${i}.de`)).ok, false);
assert.equal(lib.parsePublicCapiKeyLabel("  kiready.co Produktion\n "), "kiready.co Produktion");

const nowMs = Date.parse("2026-11-05T12:00:00Z");
const stats = lib.summarizePublicCapiLog([
  { event_name: "Lead", status: "sent", created_at: "2026-11-05T11:00:00Z", error_code: null, error_reason: null },
  { event_name: "Lead", status: "meta_error", created_at: "2026-11-03T11:00:00Z", error_code: "100", error_reason: "OAuthException" },
  { event_name: "Lead", status: "pending", created_at: "2026-11-05T11:30:00Z", error_code: null, error_reason: null },
  { event_name: "Purchase", status: "sent", created_at: "2026-10-20T11:00:00Z", error_code: null, error_reason: null },
], nowMs);
assert.equal(stats.length, 1, "älter als 7 Tage und pending zählen nicht");
assert.equal(stats[0].eventName, "Lead");
assert.equal(stats[0].last24h, 1);
assert.equal(stats[0].last7d, 2);
assert.equal(stats[0].errorRate7d, 0.5);
assert.equal(stats[0].lastError.code, "100");
assert.equal(stats[0].lastReceivedAt, "2026-11-05T11:00:00.000Z");

const admin = read("src/lib/meta/public-capi-admin.ts");
const uiRoute = read("src/app/api/meta/automation/pixel/conversions-api/route.ts");
const ui = read("src/components/PublicCapiSettings.tsx");
// Same-Origin-Prüfung + Anmeldung wie die übrigen Dashboard-Aktionen.
assert.match(uiRoute, /readControlJson\(request\)/);
assert.match(uiRoute, /authenticateMetaCustomer\(\)/);
// Jede Abfrage ist auf den Kunden beschränkt.
for (const table of ["meta_public_capi_pixels", "meta_capi_event_keys", "meta_conversion_events_log"]) {
  const uses = admin.split(`.from("${table}")`).slice(1);
  assert.ok(uses.length > 0, table);
  for (const use of uses) {
    const stmt = use.split(/;\n/)[0];
    if (/\.insert\(/.test(stmt) || /\.upsert\(/.test(stmt)) {
      assert.match(stmt, /user_id: customer\.userId|userId: customer\.userId/, `${table} insert ohne user_id`);
    } else {
      assert.match(stmt, /\.eq\("user_id", customer\.userId\)/, `${table} ohne user_id-Filter`);
    }
  }
}
// Schlüssel: nur Hash speichern, Klartext nur in der Erzeugungs-Antwort.
assert.match(admin, /key_hash: generated\.hash/);
assert.ok(!/key: generated\.key,\n\s*key_prefix/.test(admin));
assert.ok(!/select\([^)]*key_hash/.test(admin), "key_hash wird nie gelesen");
// Standard aus: Schalter nur durch Kundenaktion, UI zeigt Schlüssel nur, wenn zugeschaltet.
assert.match(admin, /const enabled = input\.enabled === true;/);
assert.match(ui, /\{pixel\.enabled \? \(/);
assert.match(read("src/app/dashboard/tracking/page.tsx"), /<PublicCapiSettings \/>/);

console.log("meta public capi tracking ui: ok");

// ---------------------------------------------------------------------------
// Teil 5: Kunden-Doku
// ---------------------------------------------------------------------------
const customerDoc = read("docs/customer/CONVERSIONS_API_ERWEITERT.md");
const guidePage = read("src/app/dashboard/tracking/erweiterte-messung/page.tsx");
for (const text of [customerDoc, guidePage]) {
  assert.ok(text.includes("/api/v1/conversions/events"));
  assert.ok(text.includes("consent"));
  assert.ok(text.includes("eventID"), "Deduplizierung erklärt");
  assert.ok(text.includes("DisqualifiedLead"));
  for (const status of ["sent", "skipped_no_consent", "duplicate", "invalid", "meta_error"]) {
    assert.ok(text.includes(status), status);
  }
}
// Doku nennt genau die erlaubten Ereignisnamen.
for (const name of allowedEventNames) assert.ok(customerDoc.includes(`\`${name}\``), `Doku: ${name}`);
assert.match(read("src/components/PublicCapiSettings.tsx"), /href="\/dashboard\/tracking\/erweiterte-messung"/);
assert.match(guidePage, /redirect\("\/login\?next=\/dashboard\/tracking\/erweiterte-messung"\)/);

console.log("meta public capi docs: ok");
