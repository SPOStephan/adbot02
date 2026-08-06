import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");

const [
  dashboardSource,
  cardSource,
  actionsSource,
  disconnectRouteSource,
  connectorStatusSource,
  reconnectMigrationSource,
  resetMigrationSource,
] = await Promise.all([
  readFile(join(projectRoot, "src/app/dashboard/page.tsx"), "utf8"),
  readFile(join(projectRoot, "src/components/PlatformStatusCard.tsx"), "utf8"),
  readFile(join(projectRoot, "src/components/MetaConnectionActions.tsx"), "utf8"),
  readFile(
    join(projectRoot, "src/app/api/connectors/meta/disconnect/route.ts"),
    "utf8",
  ),
  readFile(join(projectRoot, "src/app/api/connectors/route.ts"), "utf8"),
  readFile(
    join(
      projectRoot,
      "supabase/migrations/20260729070000_preserve_meta_history_on_reconnect.sql",
    ),
    "utf8",
  ),
  readFile(
    join(
      projectRoot,
      "supabase/migrations/20260805154000_reset_meta_connection_for_reauthorization.sql",
    ),
    "utf8",
  ),
]);

assert.match(dashboardSource, /showMetaConnectionActions:/);
assert.match(dashboardSource, /Boolean\(account\)/);
assert.match(dashboardSource, /\.is\("revoked_at", null\)/);

assert.match(cardSource, /<MetaConnectionActions/);
assert.match(cardSource, /reconnectHref="\/api\/connectors\/meta\/start"/);
assert.match(cardSource, /connected && showMetaConnectionActions/);
assert.match(cardSource, /<form action=\{actionHref\} method="post">/);

assert.match(actionsSource, /"use client"/);
assert.match(actionsSource, /Assets erweitern/);
assert.match(actionsSource, /bestehende und neue Assets gemeinsam auswählen/);
assert.match(actionsSource, /Meta trennen/);
assert.match(actionsSource, /window\.confirm\(/);
assert.match(actionsSource, /\/api\/connectors\/meta\/disconnect/);
assert.match(actionsSource, /method: "POST"/);
assert.match(actionsSource, /confirmation: "disconnect_meta"/);
assert.match(actionsSource, /router\.refresh\(\)/);
assert.match(actionsSource, /Meta wurde vollständig widerrufen/);
assert.match(actionsSource, /alle aktuell verbundenen Assets vollständig entfernt/);
assert.match(actionsSource, /action=\{reconnectHref\}/);
assert.match(actionsSource, /onSubmit=\{confirmExtend\}/);
assert.doesNotMatch(actionsSource, /Gespeicherte Daten und Einstellungen bleiben erhalten\./);
assert.doesNotMatch(
  actionsSource,
  /access_token|refresh_token|token_iv|token_auth_tag|service_role/i,
);

assert.match(disconnectRouteSource, /supabase\.auth\.getUser\(\)/);
assert.match(disconnectRouteSource, /body\.confirmation !== "disconnect_meta"/);
assert.match(disconnectRouteSource, /resetStoredMetaAuthorization/);
assert.match(disconnectRouteSource, /userId: user\.id/);
assert.match(disconnectRouteSource, /disconnect_failed/);
assert.match(disconnectRouteSource, /revalidatePath\("\/dashboard", "page"\)/);
assert.match(disconnectRouteSource, /private, no-store/);
assert.doesNotMatch(disconnectRouteSource, /createAdminClient|\.from\(|\.delete\(\)/);
assert.doesNotMatch(disconnectRouteSource, /\.from\("campaigns"\)/);

assert.match(resetMigrationSource, /delete from public\.meta_assets/i);
assert.match(resetMigrationSource, /access_token_encrypted = null/i);
assert.match(resetMigrationSource, /page_ids = '\[\]'::jsonb/i);
assert.match(resetMigrationSource, /instagram_account_ids = '\[\]'::jsonb/i);
assert.match(resetMigrationSource, /ad_account_ids = '\[\]'::jsonb/i);
assert.match(resetMigrationSource, /revoke all on function public\.reset_meta_connection_for_reauthorization/i);
assert.match(resetMigrationSource, /grant execute on function public\.reset_meta_connection_for_reauthorization/i);
assert.doesNotMatch(resetMigrationSource, /delete from public\.(campaigns|meta_content_candidates)/i);

assert.match(connectorStatusSource, /\.is\("revoked_at", null\)/);

assert.match(reconnectMigrationSource, /revoked_at = null/);
assert.match(
  reconnectMigrationSource,
  /baseline_completed_at = existing\.baseline_completed_at/,
);
assert.match(
  reconnectMigrationSource,
  /last_sync_seen_count = existing\.last_sync_seen_count/,
);
assert.match(
  reconnectMigrationSource,
  /last_sync_new_count = existing\.last_sync_new_count/,
);

console.log("Meta disconnect and reconnect checks passed");
