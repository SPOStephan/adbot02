import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");

const dashboardSource = await readFile(
  join(projectRoot, "src/app/dashboard/page.tsx"),
  "utf8",
);
const cardSource = await readFile(
  join(projectRoot, "src/components/PlatformStatusCard.tsx"),
  "utf8",
);
const syncButtonSource = await readFile(
  join(projectRoot, "src/components/MetaSyncButton.tsx"),
  "utf8",
);
const callbackSource = await readFile(
  join(projectRoot, "src/app/api/connectors/meta/callback/route.ts"),
  "utf8",
);
const manualSyncRouteSource = await readFile(
  join(projectRoot, "src/app/api/connectors/meta/sync/route.ts"),
  "utf8",
);

assert.match(dashboardSource, /actionHref:[\s\S]*"\/api\/connectors\/meta\/start"/);
assert.match(dashboardSource, /actionLabel:[\s\S]*"Meta verbinden"/);
assert.match(dashboardSource, /badge:[\s\S]*"Nur Lesezugriff"/);
assert.match(
  dashboardSource,
  /Keine Kampagnen-, Publishing- oder Messaging-Rechte\./,
);
assert.match(dashboardSource, /meta === "connected" && metaConnected/);
assert.match(dashboardSource, /Meta wurde erfolgreich verbunden\./);
assert.match(dashboardSource, /Meta-Verbindung noch nicht bestätigt\./);
assert.match(dashboardSource, /Meta konnte nicht verbunden werden\./);
assert.match(dashboardSource, /invalid_state/);
assert.match(dashboardSource, /scope_validation/);
assert.match(dashboardSource, /token_validation/);
assert.match(dashboardSource, /no_assets/);
assert.match(dashboardSource, /storage/);
assert.doesNotMatch(dashboardSource, /ads_management|business_management/);
assert.doesNotMatch(
  dashboardSource,
  /access_token_encrypted|token_iv|token_auth_tag|sync_backoff_until|sync_usage/,
);

assert.match(dashboardSource, /Meta Content Sync/);
assert.match(dashboardSource, /Letzter Abruf/);
assert.match(dashboardSource, /Nächster Abruf/);
assert.match(dashboardSource, /Sicherer Ausgangsbestand/);
assert.match(dashboardSource, /Wieder verbunden/);
assert.match(dashboardSource, /Der gespeicherte Ausgangsbestand bleibt erhalten/);
assert.match(
  dashboardSource,
  /syncStatus === "idle" && metaAccount\?\.baseline_completed_at/,
);
assert.match(dashboardSource, /Verbindung erneuern/);
assert.match(dashboardSource, /Meta neu verbinden/);
assert.match(dashboardSource, /Beitragskandidaten/);
assert.match(dashboardSource, /Neu seit dem Ausgangsbestand/);
assert.match(dashboardSource, /Gespeichert/);
assert.match(dashboardSource, /select\("id", \{ count: "exact", head: true \}\)/);
assert.match(dashboardSource, /storedCandidateCount \?\? 0/);
assert.match(dashboardSource, /Originalbeitrag ansehen/);
assert.match(dashboardSource, /\.eq\("is_new", true\)/);
assert.match(dashboardSource, /\.limit\(8\)/);
assert.match(dashboardSource, /<MetaSyncButton/);

assert.match(cardSource, /href=\{actionHref!\}/);
assert.match(cardSource, /prefetch=\{false\}/);
assert.match(cardSource, /Aktiv verbunden/);
assert.match(cardSource, /In Vorbereitung/);
assert.match(cardSource, /focus-visible:outline-blue-600/);

assert.match(syncButtonSource, /"use client"/);
assert.match(syncButtonSource, /method: "POST"/);
assert.match(syncButtonSource, /\/api\/connectors\/meta\/sync/);
assert.match(syncButtonSource, /MANUAL_COOLDOWN_SECONDS = 60/);
assert.match(syncButtonSource, /Beiträge werden abgerufen/);
assert.match(syncButtonSource, /Erneut in \$\{remainingSeconds\} s/);
assert.match(syncButtonSource, /router\.refresh\(\)/);
assert.doesNotMatch(
  syncButtonSource,
  /access_token|pageAccessToken|appSecret|service_role/,
);

assert.match(manualSyncRouteSource, /supabase\.auth\.getUser\(\)/);
assert.match(manualSyncRouteSource, /\.eq\("user_id", user\.id\)/);
assert.match(manualSyncRouteSource, /mode: "manual"/);
assert.match(manualSyncRouteSource, /"Retry-After"/);
assert.match(manualSyncRouteSource, /private, no-store/);
assert.doesNotMatch(
  manualSyncRouteSource,
  /access_token_encrypted|token_iv|token_auth_tag|sync_usage/,
);

assert.match(callbackSource, /dashboardRedirect\("connected"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "storage"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "invalid_state"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "scope_validation"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "token_validation"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "no_assets"\)/);

console.log("Dashboard Meta connector checks passed");
