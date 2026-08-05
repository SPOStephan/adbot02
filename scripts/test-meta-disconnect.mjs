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
]);

assert.match(dashboardSource, /showMetaConnectionActions:/);
assert.match(dashboardSource, /Boolean\(account\)/);
assert.match(dashboardSource, /\.is\("revoked_at", null\)/);

assert.match(cardSource, /<MetaConnectionActions/);
assert.match(cardSource, /reconnectHref="\/api\/connectors\/meta\/start"/);
assert.match(cardSource, /connected && showMetaConnectionActions/);

assert.match(actionsSource, /"use client"/);
assert.match(actionsSource, /Meta neu verbinden/);
assert.match(actionsSource, /Meta trennen/);
assert.match(actionsSource, /window\.confirm\(/);
assert.match(actionsSource, /\/api\/connectors\/meta\/disconnect/);
assert.match(actionsSource, /method: "POST"/);
assert.match(actionsSource, /confirmation: "disconnect_meta"/);
assert.match(actionsSource, /router\.refresh\(\)/);
assert.match(actionsSource, /Gespeicherte Daten und Einstellungen bleiben erhalten\./);
assert.doesNotMatch(
  actionsSource,
  /access_token|refresh_token|token_iv|token_auth_tag|service_role/i,
);

assert.match(disconnectRouteSource, /supabase\.auth\.getUser\(\)/);
assert.match(disconnectRouteSource, /body\.confirmation !== "disconnect_meta"/);
assert.match(disconnectRouteSource, /createAdminClient\(\)/);
assert.match(disconnectRouteSource, /\.eq\("user_id", user\.id\)/);
assert.match(disconnectRouteSource, /\.eq\("platform", "meta"\)/);
assert.match(disconnectRouteSource, /\.is\("revoked_at", null\)/);
assert.match(disconnectRouteSource, /revoked_at: disconnectedAt/);
assert.match(disconnectRouteSource, /access_token_encrypted: null/);
assert.match(disconnectRouteSource, /token_iv: null/);
assert.match(disconnectRouteSource, /token_auth_tag: null/);
assert.match(disconnectRouteSource, /sync_status: "reconnect_required"/);
assert.match(disconnectRouteSource, /revalidatePath\("\/dashboard", "page"\)/);
assert.match(disconnectRouteSource, /private, no-store/);
assert.doesNotMatch(disconnectRouteSource, /\.delete\(\)/);
assert.doesNotMatch(disconnectRouteSource, /\.from\("meta_assets"\)/);
assert.doesNotMatch(disconnectRouteSource, /\.from\("campaigns"\)/);

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
