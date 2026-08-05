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
const candidatePreviewSource = await readFile(
  join(projectRoot, "src/components/ContentCandidatePreview.tsx"),
  "utf8",
);
const campaignOverviewSource = await readFile(
  join(projectRoot, "src/components/MetaCampaignOverview.tsx"),
  "utf8",
);
const marketingMigrationSource = await readFile(
  join(
    projectRoot,
    "supabase/migrations/20260729090000_meta_marketing_readonly_sync.sql",
  ),
  "utf8",
);
const dashboardReadGrantMigrationSource = await readFile(
  join(
    projectRoot,
    "supabase/migrations/20260802060000_dashboard_authenticated_read_grants.sql",
  ),
  "utf8",
);
const dashboardReadGrantSql = dashboardReadGrantMigrationSource.replace(/--.*$/gm, "");
const platformAccountPrivilegeHardeningSource = await readFile(
  join(
    projectRoot,
    "supabase/migrations/20260802061000_platform_accounts_revoke_legacy_privileges.sql",
  ),
  "utf8",
);
const platformAccountPrivilegeHardeningSql =
  platformAccountPrivilegeHardeningSource.replace(/--.*$/gm, "");
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
assert.match(dashboardSource, /"Minimaler Schreibscope bestätigt"/);
assert.match(dashboardSource, /"Reconnect für Autonomie"/);
assert.match(
  dashboardSource,
  /Keine Messaging- oder Beitrags-Publishing-Rechte\./,
);
assert.match(dashboardSource, /export const dynamic = "force-dynamic"/);
assert.match(dashboardSource, /export const revalidate = 0/);
assert.match(dashboardSource, /meta === "connected"/);
assert.match(dashboardSource, /Meta wurde erfolgreich verbunden\./);
assert.match(
  dashboardSource,
  /Die verbundenen Kontodaten werden gerade aktualisiert\./,
);
assert.doesNotMatch(dashboardSource, /Meta-Verbindung noch nicht bestätigt\./);
assert.doesNotMatch(dashboardSource, /kein aktiver Connector gefunden/);
assert.match(dashboardSource, /Meta konnte nicht verbunden werden\./);
assert.match(dashboardSource, /invalid_state/);
assert.match(dashboardSource, /scope_validation/);
assert.match(dashboardSource, /token_validation/);
assert.match(dashboardSource, /no_assets/);
assert.match(dashboardSource, /storage/);
assert.match(dashboardSource, /meta_scopes\.includes\("ads_management"\)/);
assert.doesNotMatch(dashboardSource, /business_management/);
assert.match(
  dashboardSource,
  /das Instagram-Konto jeweils ausdrücklich aus/,
);
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
assert.match(dashboardSource, /preview_url/);
assert.match(dashboardSource, /<ContentCandidatePreview/);
assert.match(dashboardSource, /previewUrl=\{candidate\.preview_url\}/);
assert.match(dashboardSource, /\.eq\("is_new", true\)/);
assert.match(dashboardSource, /\.limit\(8\)/);
assert.match(dashboardSource, /<MetaSyncButton/);
assert.match(dashboardSource, /meta_account_performance_daily/);
assert.match(dashboardSource, /meta_campaign_performance_30d/);
assert.match(dashboardSource, /campaign_recommendations/);
assert.match(dashboardSource, /\.eq\("status", "active"\)/);
assert.match(dashboardSource, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
assert.match(dashboardSource, /recommendations=\{recommendationRows\}/);
assert.match(dashboardSource, /Ausführung nur mit aktiver Kunden-Policy/);
assert.match(dashboardSource, /writeScopeGranted/);
assert.match(dashboardSource, /minimale Schreibscope muss bestätigt werden/);
assert.match(dashboardSource, /error: connectedAccountsError/);
assert.match(dashboardSource, /platformAccountReadFailed/);
assert.match(dashboardSource, /Verbindungsdaten konnten nicht geladen werden\./);
assert.match(dashboardSource, /Bestehende Verbindung bleibt unverändert/);
assert.match(
  dashboardSource,
  /platform\.configured && !account && !platformAccountReadFailed/,
);
assert.doesNotMatch(
  dashboardSource,
  /connectedAccountsError[\s\S]{0,500}Noch keine Werbekonten verbunden/,
);

for (const table of [
  "platform_accounts",
  "meta_assets",
  "meta_content_candidates",
  "campaigns",
  "campaign_recommendations",
  "automation_policies",
  "kill_switch_state",
  "mutation_audit_events",
  "allowed_domains",
  "objective_blueprints",
  "brand_assets",
  "mutation_plans",
]) {
  assert.match(
    dashboardReadGrantSql,
    new RegExp(`on\\s+table\\s+public\\.${table}\\s+to\\s+authenticated`, "i"),
  );
}
assert.doesNotMatch(
  dashboardReadGrantSql,
  /grant\s+(?:all|insert|update|delete|truncate|references|trigger)/i,
);
assert.doesNotMatch(
  dashboardReadGrantSql,
  /grant\s+select\s+on\s+table\s+public\.platform_accounts/i,
);
assert.doesNotMatch(
  dashboardReadGrantSql,
  /access_token|refresh_token|access_token_encrypted|token_iv|token_auth_tag/i,
);
assert.match(
  platformAccountPrivilegeHardeningSql,
  /revoke\s+truncate\s*,\s*references\s*,\s*trigger\s+on\s+table\s+public\.platform_accounts\s+from\s+anon\s*,\s*authenticated\s*;/i,
);
assert.doesNotMatch(platformAccountPrivilegeHardeningSql, /grant\s+/i);

assert.match(cardSource, /href=\{actionHref!\}/);
assert.match(cardSource, /prefetch=\{false\}/);
assert.match(cardSource, /Aktiv verbunden/);
assert.match(cardSource, /In Vorbereitung/);
assert.match(cardSource, /focus-visible:outline-blue-600/);

assert.match(candidatePreviewSource, /loading="lazy"/);
assert.match(candidatePreviewSource, /decoding="async"/);
assert.match(candidatePreviewSource, /referrerPolicy="no-referrer"/);
assert.match(candidatePreviewSource, /onError=\{\(\) => setFailedUrl\(previewUrl\)\}/);
assert.match(candidatePreviewSource, /Keine Vorschau verfügbar/);
assert.match(candidatePreviewSource, /aspect-\[16\/9\]/);
assert.doesNotMatch(candidatePreviewSource, /dangerouslySetInnerHTML/);

assert.match(campaignOverviewSource, /Deterministische Empfehlungen/);
assert.match(campaignOverviewSource, /Prüfhilfen aus festen Schwellenwerten/);
assert.match(campaignOverviewSource, /Nur Analyse/);
assert.match(campaignOverviewSource, /ruleKey === "active_without_delivery_3d"/);
assert.match(campaignOverviewSource, /ruleKey === "cost_per_result_up_30pct"/);
assert.match(campaignOverviewSource, /ruleKey === "spend_without_results_14d"/);
assert.match(campaignOverviewSource, /ruleKey === "low_link_ctr_7d"/);
assert.doesNotMatch(
  campaignOverviewSource,
  /<button|<form|onClick=|fetch\(|method:\s*["'](?:POST|PATCH|PUT|DELETE)/,
);

for (const rule of [
  "active_without_delivery_3d",
  "cost_per_result_up_30pct",
  "spend_without_results_14d",
  "low_link_ctr_7d",
]) {
  assert.match(marketingMigrationSource, new RegExp(`'${rule}'`));
}
assert.match(
  marketingMigrationSource,
  /revoke all on function public\.rebuild_meta_campaign_recommendations\([\s\S]*from public, anon, authenticated/,
);
assert.match(
  marketingMigrationSource,
  /grant execute on function public\.rebuild_meta_campaign_recommendations\([\s\S]*to service_role/,
);
assert.doesNotMatch(marketingMigrationSource, /ads_management|POST\s+https?:\/\//);

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

assert.match(callbackSource, /revalidatePath\("\/dashboard", "page"\)/);
assert.match(callbackSource, /dashboardRedirect\("connected"\)/);
assert.doesNotMatch(callbackSource, /instagram-onboarding/);
assert.match(
  callbackSource,
  /getGranularTargetIds\(tokenDebug, "instagram_basic"\)/,
);
assert.match(callbackSource, /allowedInstagramAccountIds/);
assert.match(callbackSource, /systemUserId:\s*identity\.id/);
assert.doesNotMatch(
  callbackSource,
  /clientBusinessId|client_business_id|business_management/,
);
assert.match(callbackSource, /assets\.instagramAccounts/);
assert.doesNotMatch(
  callbackSource,
  /const instagramAccounts = assets\.pages\.flatMap/,
);
assert.match(callbackSource, /dashboardRedirect\("error", "storage"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "invalid_state"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "scope_validation",/);
assert.match(callbackSource, /dashboardRedirect\("error", "token_validation"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "no_assets"\)/);
assert.match(callbackSource, /classifyMetaGrantedScopes\(/);
assert.match(callbackSource, /compatibleSystemUserScopes/);

console.log("Dashboard Meta connector checks passed");
