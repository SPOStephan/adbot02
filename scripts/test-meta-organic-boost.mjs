import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const settingsMigration = read(
  "supabase/migrations/20260803180000_meta_organic_post_boost.sql",
);
const materializerMigration = read(
  "supabase/migrations/20260803180100_meta_organic_boost_materializer.sql",
);
const inputSource = read("src/lib/meta/customer-control-input.ts");
const serviceSource = read("src/lib/meta/customer-control-service.ts");
const plannerSource = read("src/lib/meta/planner.ts");
const syncSource = read("src/lib/meta/sync.ts");

assert.match(settingsMigration, /create table if not exists public\.meta_boost_settings/);
assert.match(settingsMigration, /create table if not exists public\.meta_content_boost_overrides/);
assert.match(settingsMigration, /put_meta_boost_settings_version/);
assert.match(settingsMigration, /upsert_meta_content_boost_override/);
assert.match(settingsMigration, /source_rule_key = 'organic-boost'/);

const modeMigration = read(
  "supabase/migrations/20260804090000_meta_boost_mode_selection.sql",
);
assert.match(modeMigration, /boost_mode in \('OFF', 'REVIEW', 'AUTO'\)/);
assert.match(modeMigration, /p_boost_mode text/);
assert.match(modeMigration, /Automatic boost mode requires a daily budget/);

assert.match(materializerMigration, /materialize_meta_organic_boost_plan/);
assert.match(materializerMigration, /object_story_id/);
assert.match(materializerMigration, /run_meta_organic_boost_planner/);
assert.match(materializerMigration, /approve_meta_organic_boost_canary_plan/);
assert.match(materializerMigration, /unsupported_object_story_id/);
assert.match(materializerMigration, /call_to_action_type/);

const instagramMigration = read(
  "supabase/migrations/20260804100000_meta_organic_boost_instagram.sql",
);
assert.match(instagramMigration, /source_instagram_media_id/);
assert.match(instagramMigration, /unsupported_instagram_media_id/);
assert.match(instagramMigration, /v_boost_source = 'instagram'/);

assert.match(inputSource, /parseBoostSettingsCommand/);
assert.match(inputSource, /parseBoostOverrideCommand/);
assert.match(inputSource, /parseOrganicBoostApprovalCommand/);
assert.match(inputSource, /BEITRAG BEWERBEN/);

assert.match(serviceSource, /saveCustomerBoostSettings/);
assert.match(serviceSource, /materializeCustomerOrganicBoost/);
assert.match(serviceSource, /approveCustomerOrganicBoost/);

assert.match(plannerSource, /runMetaOrganicBoostPlannerAfterSnapshot/);
assert.match(syncSource, /runMetaOrganicBoostPlannerAfterSnapshot/);
assert.match(
  syncSource,
  /Beitrag-Push planning is DB-only/,
);

assert.match(
  read("src/app/api/meta/automation/boost-settings/route.ts"),
  /parseBoostSettingsCommand/,
);
assert.match(
  read("src/app/api/meta/automation/boost/route.ts"),
  /materializeCustomerOrganicBoost/,
);
assert.match(
  read("src/components/AutomationBoostSettings.tsx"),
  /Vollautomatisch/,
);
assert.match(
  read("src/components/AutomationBoostSettings.tsx"),
  /Einzeln freigeben/,
);
assert.match(
  read("src/components/AutomationBoostSettings.tsx"),
  /Facebook und Instagram/,
);
assert.match(
  read("src/components/AutomationBoostSettings.tsx"),
  /sourceFilter/,
);
assert.match(
  read("src/components/AutomationBoostSettings.tsx"),
  /assetScope/,
);
assert.match(
  read("src/components/AutomationBoostSettings.tsx"),
  /Nur ausgewählte Assets/,
);
assert.match(
  read("src/components/AutomationBoostSettings.tsx"),
  /Tagesbudget \(optional\)/,
);
assert.match(inputSource, /boostMode/);
assert.match(inputSource, /assetScope/);
assert.match(inputSource, /assetSettings/);
assert.match(serviceSource, /p_asset_scope/);
assert.match(serviceSource, /p_asset_settings/);

const assetScopeMigration = read(
  "supabase/migrations/20260806120000_meta_boost_asset_scope_campaigns.sql",
);
assert.match(assetScopeMigration, /meta_boost_asset_settings/);
assert.match(assetScopeMigration, /asset_scope in \('ALL', 'SELECTED'\)/);
assert.match(assetScopeMigration, /asset_not_selected_for_boost/);
assert.match(assetScopeMigration, /list_meta_organic_boost_campaigns/);
assert.match(assetScopeMigration, /post_engagements/);

assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Von Adbot gestartete Push-Kampagnen/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /organicBoostCampaigns/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /list_meta_organic_boost_campaigns/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /boostEligibleAssets/,
);

assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Bewerbung startet automatisch/,
);
assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /unabh[^"]*ngig vom Abruf/,
);
assert.doesNotMatch(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Bitte erneut abrufen/,
);
assert.doesNotMatch(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Bitte Abruf erneut auslösen/,
);
assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Beitrag-Push startet automatisch/,
);
assert.match(
  read("src/components/MetaSyncButton.tsx"),
  /Beitrag-Push:/,
);
assert.match(
  read("src/components/MetaSyncButton.tsx"),
  /NoticeKind/,
);
assert.match(
  read("src/app/api/connectors/meta/sync/route.ts"),
  /organicBoost/,
);
assert.match(read("src/lib/meta/sync.ts"), /organicBoostFields/);
assert.match(read("src/lib/meta/sync.ts"), /organic_boost:/);
assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Bewerbung konnte nicht starten/,
);
assert.doesNotMatch(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Beim nächsten Abruf startet Adbot/,
);

assert.match(
  read("src/lib/meta/organic-boost-runner.ts"),
  /runOrganicBoostPlannerForAccount/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /planCustomerOrganicBoost/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /runOrganicBoostPlannerForAccount/,
);
assert.match(
  read("src/app/api/meta/automation/organic-boost/plan/route.ts"),
  /planCustomerOrganicBoost/,
);
assert.match(
  read("src/components/OrganicBoostAutoPlanner.tsx"),
  /organic-boost\/plan/,
);
assert.match(
  read("src/components/OrganicBoostAutoPlanner.tsx"),
  /START_DELAY_MS/,
);
assert.match(
  read("src/components/OrganicBoostAutoPlanner.tsx"),
  /MAX_ATTEMPTS/,
);
assert.match(
  read("src/components/OrganicBoostAutoPlanner.tsx"),
  /pendingCandidateCount/,
);
assert.doesNotMatch(
  read("src/components/OrganicBoostAutoPlanner.tsx"),
  /controller\.abort/,
);
assert.match(
  read("src/components/OrganicBoostPlanButton.tsx"),
  /Beitrag-Push jetzt starten/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /OrganicBoostPlanButton/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /pendingBoostCandidateCount/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /pendingBoostCandidateCount/,
);
assert.match(
  read("src/lib/meta/organic-boost-runner.ts"),
  /ORGANIC_BOOST_READ_LEASE_SECONDS/,
);
assert.match(
  read("src/lib/meta/sync.ts"),
  /preserveMarketingSuccess/,
);
assert.match(
  read("src/lib/meta/sync.ts"),
  /runOrganicBoostPlannerForAccount/,
);
assert.doesNotMatch(
  read("src/components/MetaCampaignOverview.tsx"),
  /Nach dem nächsten erfolgreichen Sync/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /unabh[^"]*ngig vom Abruf/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /OrganicBoostAutoPlanner/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /shouldAutoPlanOrganicBoost/,
);
assert.match(
  read("src/components/MetaSyncButton.tsx"),
  /text-slate-600/,
);
assert.doesNotMatch(
  read("src/components/MetaSyncButton.tsx"),
  /boostOk \|\| !body\.organicBoost\?\.status \? "success" : "error"/,
);

const ensureSnapshotMigration = read(
  "supabase/migrations/20260806150000_meta_organic_boost_ensure_snapshot_and_status.sql",
);
assert.match(ensureSnapshotMigration, /ensure_meta_organic_boost_exposure_snapshot/);
assert.match(ensureSnapshotMigration, /organic_boost_planner_status/);
assert.match(ensureSnapshotMigration, /MATERIALIZE_FAILED/);
assert.match(ensureSnapshotMigration, /NO_ELIGIBLE_CANDIDATES/);

const stableExposureMigration = read(
  "supabase/migrations/20260806160000_meta_organic_boost_stable_exposure_keys.sql",
);
assert.match(
  stableExposureMigration,
  /boost:campaign:' \|\| p_content_candidate_id::text/,
);
assert.match(
  stableExposureMigration,
  /cannot stack hard-cap reservations/,
);
assert.match(
  stableExposureMigration,
  /reserved % \/ cap % minor units/,
);
assert.match(
  stableExposureMigration,
  /Paused\/archived Meta campaigns must not block/,
);

assert.doesNotMatch(read("src/lib/meta/sync.ts"), /processNextMetaMutation/);
assert.match(
  read("src/lib/meta/sync.ts"),
  /Meta writes stay on the executor cron/,
);
assert.match(
  read("src/app/api/connectors/meta/sync/route.ts"),
  /maxDuration = 120/,
);
assert.match(
  read("src/components/MetaSyncButton.tsx"),
  /SYNC_FETCH_TIMEOUT_MS/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /sync_usage/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /organic_boost/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /organicPlannerStatus/,
);

const snapshotFallbackMigration = read(
  "supabase/migrations/20260806140000_meta_organic_boost_snapshot_fallback.sql",
);
assert.match(snapshotFallbackMigration, /run_meta_organic_boost_planner/);
assert.match(
  snapshotFallbackMigration,
  /Policy may have been rotated after the last budget snapshot/,
);
assert.match(
  snapshotFallbackMigration,
  /Do not require the current/,
);
assert.match(
  snapshotFallbackMigration,
  /Identity is the snapshot id from the planner/,
);
assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Details anpassen/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /href: "#kampagnen"/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /deriveOrganicBoostDelivery/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Wartet auf Freigabe durch Meta/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Boost aktiv/,
);

const writeClient = read("src/lib/meta/write-client.ts");
assert.match(writeClient, /isInstagramOrganicMediaCreative/);
assert.match(writeClient, /source_instagram_media_id/);

const executor = read("src/lib/meta/executor.ts");
assert.match(executor, /step\.operation === "VALIDATE" \? "validate_only"/);

assert.match(
  read("docs/meta-automation/ORGANIC_POST_BOOST_LIVE_TEST.md"),
  /Vollautomatisch/,
);

console.log("test-meta-organic-boost: ok");
