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
