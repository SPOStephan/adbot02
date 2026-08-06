import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");

const [
  migrationSource,
  pruneRouteSource,
  assetsComponentSource,
  dashboardSource,
  callbackSource,
] = await Promise.all([
  readFile(
    join(
      projectRoot,
      "supabase/migrations/20260806060000_prune_meta_connection_asset.sql",
    ),
    "utf8",
  ),
  readFile(
    join(
      projectRoot,
      "src/app/api/connectors/meta/assets/prune/route.ts",
    ),
    "utf8",
  ),
  readFile(
    join(projectRoot, "src/components/MetaConnectedAssets.tsx"),
    "utf8",
  ),
  readFile(join(projectRoot, "src/app/dashboard/page.tsx"), "utf8"),
  readFile(
    join(projectRoot, "src/app/api/connectors/meta/callback/route.ts"),
    "utf8",
  ),
]);

assert.match(migrationSource, /create or replace function public\.prune_meta_connection_asset/i);
assert.match(migrationSource, /prune_meta_asset_last_of_type/);
assert.match(migrationSource, /delete from public\.meta_assets/i);
assert.match(migrationSource, /is_new = false/);
assert.match(migrationSource, /grant execute on function public\.prune_meta_connection_asset/i);
assert.match(migrationSource, /to service_role/i);
assert.doesNotMatch(migrationSource, /revokeMetaAuthorization|access_token_encrypted\s*=\s*null/i);
assert.doesNotMatch(migrationSource, /delete from public\.platform_accounts/i);

assert.match(pruneRouteSource, /confirmation !== "prune_meta_asset"/);
assert.match(pruneRouteSource, /prune_meta_connection_asset/);
assert.match(pruneRouteSource, /createAdminClient/);
assert.match(pruneRouteSource, /supabase\.auth\.getUser\(\)/);
assert.match(pruneRouteSource, /revalidatePath\("\/dashboard", "page"\)/);
assert.doesNotMatch(pruneRouteSource, /resetStoredMetaAuthorization|revokeMetaAuthorization/);

assert.match(assetsComponentSource, /"use client"/);
assert.match(assetsComponentSource, /\/api\/connectors\/meta\/assets\/prune/);
assert.match(assetsComponentSource, /confirmation: "prune_meta_asset"/);
assert.match(assetsComponentSource, /router\.refresh\(\)/);
assert.match(assetsComponentSource, /zuvor verbundene Assets/);
assert.match(assetsComponentSource, /Weitere Seiten oder Konten hinzufügen/);
assert.match(assetsComponentSource, /extendHref/);

assert.match(dashboardSource, /MetaConnectedAssets/);
assert.match(dashboardSource, /showExtraAssetHint/);
assert.match(dashboardSource, /extendHref="\/api\/connectors\/meta\/start"/);
assert.match(dashboardSource, /removable: pageAssets\.length > 1/);
assert.match(dashboardSource, /removable: adAccountAssets\.length > 1/);

// Onboarding callback must stay untouched by prune work.
assert.doesNotMatch(callbackSource, /prune_meta_connection_asset|MetaConnectedAssets/);
assert.match(callbackSource, /getMetaConnectionAssets/);
assert.match(callbackSource, /business_integration_system_user/);

console.log("Meta asset prune checks passed");
