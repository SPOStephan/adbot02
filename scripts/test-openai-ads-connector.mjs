import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const root = join(scriptsDirectory, "..");
const read = (path) => readFile(join(root, path), "utf8");

const [
  migration,
  client,
  connection,
  input,
  sync,
  launch,
  routeHelper,
  connectRoute,
  disconnectRoute,
  syncRoute,
  activationRoute,
  cronRoute,
  connectionForm,
  launchForm,
  workspace,
  catalog,
  navigation,
  environment,
  openAIEnvironment,
  vercel,
] = await Promise.all([
  read("supabase/migrations/20260910100000_openai_ads_connector_foundation.sql"),
  read("src/lib/openai-ads/client.ts"),
  read("src/lib/openai-ads/connection.ts"),
  read("src/lib/openai-ads/input.ts"),
  read("src/lib/openai-ads/sync.ts"),
  read("src/lib/openai-ads/launch.ts"),
  read("src/lib/openai-ads/route.ts"),
  read("src/app/api/connectors/openai-ads/connect/route.ts"),
  read("src/app/api/connectors/openai-ads/disconnect/route.ts"),
  read("src/app/api/connectors/openai-ads/sync/route.ts"),
  read("src/app/api/openai-ads/launch/activate/route.ts"),
  read("src/app/api/cron/openai-ads-sync/route.ts"),
  read("src/components/OpenAIAdsConnectionForm.tsx"),
  read("src/components/OpenAIAdsLaunchForm.tsx"),
  read("src/components/OpenAIAdsWorkspace.tsx"),
  read("src/lib/platforms/catalog.ts"),
  read("src/lib/dashboard/navigation.ts"),
  read(".env.example"),
  read("src/lib/openai-ads/env.ts"),
  read("vercel.json"),
]);

// Credentials stay server-side, verified before storage, and never enter URLs.
assert.match(client, /Authorization.*Bearer/);
assert.match(client, /cache:\s*"no-store"/);
assert.match(client, /REQUEST_TIMEOUT_MS/);
assert.match(openAIEnvironment, /https:\/\/api\.ads\.openai\.com\/v1/);
assert.match(connection, /client\.getAdAccount\(\)/);
assert.match(connection, /encryptCredential\(/);
assert.match(connection, /access_token:\s*null/);
assert.match(connection, /refresh_token:\s*null/);
assert.doesNotMatch(connection, /console\.(?:log|error)\([^\n]*apiKey/);
assert.doesNotMatch(connectionForm, /localStorage|sessionStorage|URLSearchParams/);
assert.match(connectionForm, /type="password"/);
assert.match(connectionForm, /setApiKey\(""\)/);
assert.match(routeHelper, /origin !== request\.nextUrl\.origin/);
assert.match(routeHelper, /MAX_BODY_BYTES/);
assert.match(connectRoute, /authenticateOpenAIAdsUser\(\)/);
assert.match(connectRoute, /connectOpenAIAdsAccount/);
assert.match(disconnectRoute, /parseOpenAIAdsDisconnectInput/);
assert.match(input, /disconnect_openai_ads/);
assert.match(syncRoute, /userId:\s*user\.id/);

// Full cursor pagination only advances using the provider's opaque last_id.
assert.match(client, /response\.last_id/);
assert.match(client, /query\.set\("after", after\)/);
assert.match(client, /response\.last_id === after/);
assert.match(client, /MAX_PAGES/);
assert.doesNotMatch(client, /next_url|paging\.next/);

// A completed provider read is persisted through one atomic snapshot RPC.
assert.match(sync, /listCampaigns\(\)/);
assert.match(sync, /listAdGroups\(campaign\.id\)/);
assert.match(sync, /listAds\(item\.id\)/);
assert.match(sync, /listDailyCampaignInsights/);
assert.match(client, /\/conversions\/insights/);
assert.match(sync, /listDailyCampaignConversions/);
assert.match(sync, /conversionsAvailable/);
assert.match(sync, /replace_openai_ads_snapshot/);
assert.ok(
  sync.indexOf("listDailyCampaignInsights") <
    sync.indexOf('"replace_openai_ads_snapshot"'),
  "Snapshot write must happen only after the full provider read",
);

// Every remote object is created paused; campaign activation is deliberately last.
assert.ok((launch.match(/status:\s*"paused"/g) ?? []).length >= 3);
assert.match(launch, /Idempotency|idempotency/i);
const activateAd = launch.indexOf("activateAd(launch.remote_ad_id)");
const activateGroup = launch.indexOf("activateAdGroup(launch.remote_ad_group_id)");
const activateCampaign = launch.indexOf(
  "activateCampaign(launch.remote_campaign_id)",
);
assert.ok(activateAd >= 0 && activateAd < activateGroup && activateGroup < activateCampaign);
assert.match(launch, /pauseCampaign\(launch\.remote_campaign_id\)/);
assert.match(launch, /activation_uncertain_manual_check_required/);
assert.match(activationRoute, /parseOpenAIAdsActivationInput/);
assert.match(input, /activate_openai_ads_campaign/);
assert.match(workspace, /window\.confirm\(/);
assert.match(launchForm, /create_paused_openai_ads_campaign/);
assert.match(launchForm, /weltweites Targeting/);

// Multi-account support must not break the existing Meta singleton/reconnect RPC.
assert.match(migration, /drop index if exists public\.platform_accounts_user_platform_uidx/i);
assert.match(migration, /platform_accounts_user_platform_remote_uidx/i);
assert.match(migration, /platform_accounts_user_meta_singleton_uidx/i);
assert.match(migration, /create or replace function public\.replace_meta_connection/i);
assert.doesNotMatch(
  migration,
  /^\s*on conflict\s*\(user_id,\s*platform\)/im,
);
assert.match(migration, /create or replace function public\.claim_ad_platform_sync/i);
assert.match(migration, /create or replace function public\.replace_openai_ads_snapshot/i);
assert.match(migration, /security definer/gi);
assert.match(migration, /revoke all on function public\.replace_openai_ads_snapshot/i);
assert.match(migration, /cross_platform_account_performance_daily/i);
assert.match(migration, /cross_platform_campaign_performance_30d/i);

// Product integration and scheduled refresh are explicit.
assert.match(catalog, /openai_ads/);
assert.match(catalog, /OPENAI_ADS_TOKEN_ENCRYPTION_KEY/);
assert.match(navigation, /ChatGPT Ads/);
assert.match(environment, /OPENAI_ADS_TOKEN_ENCRYPTION_KEY=/);
assert.match(environment, /Do not reuse OPENAI_API_KEY/);
assert.match(vercel, /\/api\/cron\/openai-ads-sync/);
assert.match(cronRoute, /constantTimeEqual/);
assert.match(cronRoute, /CRON_SECRET/);

console.log("OpenAI Ads connector contract checks passed");
