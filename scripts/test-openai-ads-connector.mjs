import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const root = join(scriptsDirectory, "..");
const read = (path) => readFile(join(root, path), "utf8");

const [
  migration,
  integrityForwardMigration,
  client,
  connection,
  dashboard,
  input,
  sync,
  launch,
  routeHelper,
  connectRoute,
  disconnectRoute,
  syncRoute,
  activeLaunchRoute,
  activationRoute,
  cronRoute,
  connectionForm,
  launchForm,
  workspace,
  chatGPTAdsPage,
  guideService,
  guideAdminRoute,
  guideAdminPage,
  guideCustomerPage,
  connectorStatusRoute,
  catalog,
  navigation,
  environment,
  openAIEnvironment,
  vercel,
] = await Promise.all([
  read("supabase/migrations/20260910100000_openai_ads_connector_foundation.sql"),
  read("supabase/migrations/20260910115500_system_integrity_forward_fixes.sql"),
  read("src/lib/openai-ads/client.ts"),
  read("src/lib/openai-ads/connection.ts"),
  read("src/lib/openai-ads/dashboard.ts"),
  read("src/lib/openai-ads/input.ts"),
  read("src/lib/openai-ads/sync.ts"),
  read("src/lib/openai-ads/launch.ts"),
  read("src/lib/openai-ads/route.ts"),
  read("src/app/api/connectors/openai-ads/connect/route.ts"),
  read("src/app/api/connectors/openai-ads/disconnect/route.ts"),
  read("src/app/api/connectors/openai-ads/sync/route.ts"),
  read("src/app/api/openai-ads/launch/route.ts"),
  read("src/app/api/openai-ads/launch/activate/route.ts"),
  read("src/app/api/cron/openai-ads-sync/route.ts"),
  read("src/components/OpenAIAdsConnectionForm.tsx"),
  read("src/components/OpenAIAdsLaunchForm.tsx"),
  read("src/components/OpenAIAdsWorkspace.tsx"),
  read("src/app/dashboard/chatgpt-ads/page.tsx"),
  read("src/lib/openai-ads/guide.ts"),
  read("src/app/api/admin/openai-ads-guide/route.ts"),
  read("src/app/dashboard/chatgpt-ads-anleitung/page.tsx"),
  read("src/app/dashboard/chatgpt-ads/anleitung/page.tsx"),
  read("src/app/api/connectors/route.ts"),
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
assert.match(client, /deadlineAtMs/);
assert.match(client, /sync_deadline_exceeded/);
assert.match(openAIEnvironment, /https:\/\/api\.ads\.openai\.com\/v1/);
assert.match(openAIEnvironment, /OPENAI_ADS_ACTIVE_LAUNCH_ENABLED = false/);
assert.doesNotMatch(openAIEnvironment, /process\.env\.OPENAI_ADS_API_BASE_URL/);
assert.doesNotMatch(environment, /OPENAI_ADS_API_BASE_URL/);
assert.match(connection, /client\.getAdAccount\(\)/);
assert.match(connection, /encryptCredential\(/);
assert.match(connection, /id:\s*account\.id/);
assert.match(connection, /access_token:\s*null/);
assert.match(connection, /refresh_token:\s*null/);
assert.match(connection, /provider_next_sync_at:\s*now/);
assert.doesNotMatch(connection, /console\.(?:log|error)\([^\n]*apiKey/);
assert.doesNotMatch(connectionForm, /localStorage|sessionStorage|URLSearchParams/);
assert.match(connectionForm, /type="password"/);
assert.match(connectionForm, /setApiKey\(""\)/);
assert.match(connectionForm, /https:\/\/ads\.openai\.com/);
assert.match(connectionForm, /Einstellungen → API Keys/);
assert.match(connectionForm, /ChatGPT Ads jetzt verbinden/);
assert.match(connectionForm, /Verbindung erfolgreich/);
assert.match(connectionForm, /void startInitialSync\(account\)/);
assert.match(connectionForm, /\/api\/connectors\/openai-ads\/sync/);
assert.match(connectionForm, /Konto ist verbunden.*automatisch erneut versucht/s);
assert.match(connectionForm, /Kostenwirksame ChatGPT-Ads-Aktionen bleiben/);
assert.match(connectionForm, /guideAvailable/);
assert.match(connectionForm, /Anleitung mit Bildern öffnen/);
assert.match(connectionForm, /target="_blank"/);
const onboardingPanel = connectionForm.slice(
  connectionForm.indexOf('border border-slate-200 bg-white shadow-sm'),
);
assert.match(onboardingPanel, /from-blue-950 via-blue-900 to-blue-700/);
assert.match(onboardingPanel, /bg-blue-600/);
assert.doesNotMatch(onboardingPanel, /emerald/);
assert.match(chatGPTAdsPage, /hasOpenAIAdsEnv\(\)/);
assert.match(chatGPTAdsPage, /try\s*{[\s\S]*loadOpenAIAdsDashboard/);
assert.match(chatGPTAdsPage, /dashboardAvailable = false/);
assert.match(chatGPTAdsPage, /ChatGPT Ads wird technisch aktiviert/);
assert.match(chatGPTAdsPage, /Bestehende Meta-Verbindungen/);
assert.match(chatGPTAdsPage, /border-blue-200 bg-blue-50/);
assert.match(chatGPTAdsPage, /getPublishedOpenAIAdsGuide/);
assert.match(guideService, /SITE_BRANDING_BUCKET/);
assert.match(guideService, /openai-ads-guide\/manifest\.json/);
assert.match(guideService, /image\/webp/);
assert.match(guideService, /published:\s*manifest\.published/);
assert.match(guideAdminRoute, /isSiteAdmin/);
assert.match(guideAdminRoute, /isDashboardSameOriginRequest/);
assert.match(guideAdminPage, /redirect\("\/dashboard"\)/);
assert.match(guideCustomerPage, /getPublishedOpenAIAdsGuide/);
assert.match(guideCustomerPage, /target="_blank"/);
assert.match(
  connectorStatusRoute,
  /\.select\(\s*"id, platform, platform_account_id, account_name, expires_at",?\s*\)/,
);
assert.match(connectorStatusRoute, /if \(openAIAccountIds\.length > 0\)/);
assert.match(routeHelper, /origin !== request\.nextUrl\.origin/);
assert.match(routeHelper, /MAX_BODY_BYTES/);
assert.match(connectRoute, /authenticateOpenAIAdsUser\(\)/);
assert.match(connectRoute, /connectOpenAIAdsAccount/);
assert.doesNotMatch(connectRoute, /syncOpenAIAdsAccount/);
assert.match(disconnectRoute, /parseOpenAIAdsDisconnectInput/);
assert.match(input, /disconnect_openai_ads/);
assert.match(syncRoute, /userId:\s*user\.id/);
const dashboardAccountQuery = dashboard.slice(
  dashboard.indexOf('.from("platform_accounts")'),
  dashboard.indexOf("return Promise.all"),
);
assert.doesNotMatch(dashboardAccountQuery, /platform_account_id/);
assert.match(dashboard, /remoteAccountId:\s*text\(metadata\.id\)/);

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
const deliveryInsightMethod = client.slice(
  client.indexOf("async listDailyCampaignInsights"),
  client.indexOf("async searchGeoLocations"),
);
assert.match(deliveryInsightMethod, /metadata\.readable_time/);
assert.match(deliveryInsightMethod, /campaign\.spend/);
assert.doesNotMatch(deliveryInsightMethod, /metadata\.data_status/);
assert.match(sync, /listDailyCampaignConversions/);
assert.match(sync, /conversionsAvailable/);
const conversionMethod = client.slice(
  client.indexOf("async listDailyCampaignConversions"),
  client.indexOf("async uploadImageUrl"),
);
assert.match(conversionMethod, /date:\s*string/);
assert.match(conversionMethod, /parseConversionInsight\(item, input\.date\)/);
assert.doesNotMatch(conversionMethod, /time_granularity|group_by_entity|include_zero_rows/);
assert.match(sync, /windowsByDate/);
assert.match(sync, /conversion_insights_unavailable/);
assert.match(sync, /daily_budget_amount_micros/);
assert.match(sync, /replace_openai_ads_snapshot/);
assert.match(sync, /credential_decryption_failed/);
assert.match(sync, /access_token_encrypted:\s*null/);
assert.match(sync, /token_auth_tag:\s*null/);
assert.match(sync, /credential_kind:\s*null/);
assert.match(sync, /revoked_at:\s*now\.toISOString\(\)/);
assert.ok(
  sync.indexOf("listDailyCampaignInsights") <
    sync.indexOf('"replace_openai_ads_snapshot"'),
  "Snapshot write must happen only after the full provider read",
);

// Model A: all new remote objects are created ACTIVE after one explicit budget confirmation.
const directActiveLaunch = launch.slice(
  0,
  launch.indexOf("export async function activateOpenAIAdsLaunch"),
);
assert.ok((directActiveLaunch.match(/status:\s*"active"/g) ?? []).length >= 3);
assert.doesNotMatch(directActiveLaunch, /status:\s*"paused"/);
assert.doesNotMatch(directActiveLaunch, /daily_spend_limit_micros/);
assert.match(launch, /Idempotency|idempotency/i);
assert.ok(
  launch.indexOf("const loaded = await loadOpenAIAdsClient") <
    launch.indexOf("let launch = await loadOrCreateLaunch"),
  "Account ownership must be verified before launch persistence",
);
assert.match(launch, /\.eq\("user_id", input\.userId\)/);
assert.match(launch, /pauseAndVerifyLaunchChain/);
assert.match(launch, /Promise\.allSettled\(pauseOperations\)/);
assert.match(launch, /Promise\.allSettled\(verificationOperations\)/);
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
assert.match(workspace, /activeLaunchEnabled/);
assert.match(workspace, /ACTIVE-Launch vorübergehend gesperrt/);
assert.match(activeLaunchRoute, /OPENAI_ADS_ACTIVE_LAUNCH_ENABLED/);
assert.match(activeLaunchRoute, /active_launch_safety_pending/);
assert.match(launchForm, /create_active_openai_ads_campaign/);
assert.match(launchForm, /name="dailyBudget"/);
assert.doesNotMatch(workspace, /Prüfen & aktivieren/);
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
assert.match(migration, /daily_budget_amount_micros/i);
assert.match(migration, /launch\.status = 'in_review'.*'approved'/s);
assert.match(
  integrityForwardMigration,
  /invalidate_meta_marketing_state_on_connection_change/,
);
assert.match(integrityForwardMigration, /marketing_sync_id := null/);
assert.match(integrityForwardMigration, /status = 'STALE'/);
assert.match(integrityForwardMigration, /meta_authorization_changed/);
assert.match(
  integrityForwardMigration,
  /create or replace function public\.enrich_meta_customer_launch_prepare_result/,
);

// Product integration and scheduled refresh are explicit.
assert.match(catalog, /openai_ads/);
assert.match(catalog, /OPENAI_ADS_TOKEN_ENCRYPTION_KEY/);
assert.match(navigation, /ChatGPT Ads/);
assert.match(environment, /OPENAI_ADS_TOKEN_ENCRYPTION_KEY=/);
assert.match(environment, /Do not reuse OPENAI_API_KEY/);
assert.match(vercel, /\/api\/cron\/openai-ads-sync/);
assert.match(cronRoute, /constantTimeEqual/);
assert.match(cronRoute, /CRON_SECRET/);
assert.match(cronRoute, /connector_not_configured/);
assert.match(cronRoute, /deadlineAtMs = Date\.now\(\) \+ 150_000/);
assert.match(sync, /OPENAI_ADS_CRON_BATCH_SIZE = 1/);

console.log("OpenAI Ads connector contract checks passed");
