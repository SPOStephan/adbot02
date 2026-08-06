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
  /Boost vorbereiten/,
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
