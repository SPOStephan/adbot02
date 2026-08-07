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
  /MAX_RETRY_DELAY_MS/,
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
  /Manuell erneut prüfen/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /OrganicBoostPlanButton/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Kein Extra-Klick nötig/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Meta-Versand/,
);
assert.match(
  read("src/components/OrganicBoostLiveRefresh.tsx"),
  /router\.refresh/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /OrganicBoostLiveRefresh/,
);

const executorPreflightMigration = read(
  "supabase/migrations/20260806170000_meta_organic_boost_executor_preflight.sql",
);
assert.match(
  executorPreflightMigration,
  /meta_organic_boost_executor_preflight_ok/,
);
assert.match(
  executorPreflightMigration,
  /launch_canary_preflight_drift/,
);
assert.match(
  executorPreflightMigration,
  /meta_organic_boost_canary_approvals/,
);
assert.match(
  executorPreflightMigration,
  /source_rule_key is distinct from 'organic-boost'/,
);
assert.match(
  read("src/lib/meta/executor.ts"),
  /marketing_meta_ad_account_id/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /eligiblePendingBoostCandidates/,
);

const unblockMigration = read(
  "supabase/migrations/20260806180000_meta_organic_boost_unblock.sql",
);
assert.match(unblockMigration, /meta_launch_chain_preflight_action/);
assert.match(unblockMigration, /source_filter = 'both'/);
assert.match(unblockMigration, /parent_meta_asset_id/);
assert.match(
  read("src/lib/meta/organic-boost-execute.ts"),
  /drainOrganicBoostExecutionsForAccount/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /drainOrganicBoostExecutionsForAccount/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /repairOrphanInstagramPageLinks/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /organic_boost_planner_status/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /pendingBoostCandidateCount/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /organic-boost-policy/,
);
assert.match(
  read("src/app/api/meta/automation/policy/route.ts"),
  /organicBoost/,
);
assert.doesNotMatch(
  read("src/lib/meta/organic-boost-runner.ts"),
  /claimMetaReadOperation/,
);
assert.match(
  read("src/lib/meta/organic-boost-runner.ts"),
  /readLeaseToken: null/,
);
assert.match(
  read("src/components/AutomationControlCenter.tsx"),
  /Beitrag-Push wird automatisch nachgeholt/,
);
assert.match(
  read("src/components/AutomationControlCenter.tsx"),
  /letzten gültigen Marketing-Stand/,
);
assert.match(
  read("src/lib/meta/organic-boost-runner.ts"),
  /resolveLastGoodMarketingSyncId/,
);
assert.match(
  read("src/lib/meta/organic-boost-runner.ts"),
  /daily_budget_exposure_snapshots/,
);
assert.doesNotMatch(
  read("src/lib/meta/organic-boost-runner.ts"),
  /marketing_sync_status === "success"/,
);
assert.match(
  read("src/lib/meta/sync.ts"),
  /Keep the last good marketing snapshot usable/,
);

const lastGoodMarketingMigration = read(
  "supabase/migrations/20260806210000_meta_organic_boost_last_good_marketing_sync.sql",
);
assert.match(
  lastGoodMarketingMigration,
  /last good marketing sync/,
);
assert.match(
  lastGoodMarketingMigration,
  /marketing_last_success_at >= now\(\) - interval '48 hours'/,
);
assert.match(
  lastGoodMarketingMigration,
  /meta_organic_boost_executor_preflight_ok/,
);
assert.match(
  lastGoodMarketingMigration,
  /organic_preflight_marketing_sync_stale/,
);
assert.match(
  lastGoodMarketingMigration,
  /a later Abruf error must not block Autonomie/,
);
assert.match(
  lastGoodMarketingMigration,
  /not current marketing_sync_status=success/,
);

const surviveSnapshotMigration = read(
  "supabase/migrations/20260806220000_meta_organic_boost_survive_marketing_snapshot.sql",
);
assert.match(
  surviveSnapshotMigration,
  /source_rule_key is distinct from 'organic-boost'/,
);
assert.match(
  surviveSnapshotMigration,
  /revive_meta_organic_boost_superseded_plans/,
);
assert.match(
  surviveSnapshotMigration,
  /superseded_by_marketing_snapshot/,
);
assert.match(
  surviveSnapshotMigration,
  /permanent candidate_already_linked dead-ends|must survive marketing Abruf/,
);
assert.match(
  surviveSnapshotMigration,
  /never auto-freeze Freigeben/,
);
assert.doesNotMatch(
  surviveSnapshotMigration,
  /source_marketing_sync_id = coalesce/,
);
const reviveNoIntentMigration = read(
  "supabase/migrations/20260806221000_meta_organic_boost_revive_no_intent_mutate.sql",
);
assert.match(
  reviveNoIntentMigration,
  /Does not mutate immutable plan intent/,
);
assert.doesNotMatch(
  reviveNoIntentMigration,
  /source_marketing_sync_id =/,
);
assert.match(
  surviveSnapshotMigration,
  /set_meta_customer_budget_autonomy/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /writesAllowed/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Meta-Versand wird gestartet/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /killSwitchMode !== "ALLOW"/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Wird automatisch neu angestoßen/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /killSwitchMode=\{killSwitchView\?\.mode/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /reviveAndDrainOrganicBoost/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /countPendingOrganicBoostPlans/,
);
assert.match(
  read("src/components/AutomationControlCenter.tsx"),
  /Meta-Versand läuft automatisch/,
);
assert.match(
  read("src/components/AutomationControlCenter.tsx"),
  /killSwitch\?\.mode/,
);

const autonomieAllowMigration = read(
  "supabase/migrations/20260806230000_meta_autonomie_ensures_writes_allow.sql",
);
assert.match(
  autonomieAllowMigration,
  /never auto-FREEZE/,
);
assert.match(
  autonomieAllowMigration,
  /Autonomie mit Launches aktiv/,
);
assert.match(
  autonomieAllowMigration,
  /revive_meta_organic_boost_superseded_plans/,
);
assert.match(
  autonomieAllowMigration,
  /kein erneutes Speichern nötig/,
);
assert.match(
  autonomieAllowMigration,
  /Freigeben wiederhergestellt/,
);
assert.match(
  read("src/app/api/meta/automation/policy/route.ts"),
  /pendingPlans/,
);

const noReadLeaseMigration = read(
  "supabase/migrations/20260806194500_meta_organic_boost_no_read_lease.sql",
);
assert.match(noReadLeaseMigration, /pg_advisory_xact_lock/);
assert.match(noReadLeaseMigration, /READ_SYNC optional/);
assert.match(
  noReadLeaseMigration,
  /must not compete with Abruf READ_SYNC/,
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
assert.match(writeClient, /call_to_action_type/);
assert.match(writeClient, /destination_type: "ON_POST"/);
assert.match(writeClient, /is_adset_budget_sharing_enabled/);
assert.match(writeClient, /value \? "1" : "0"/);
assert.match(writeClient, /coerceMinorUnits/);

const adsetBudgetSharingMigration = read(
  "supabase/migrations/20260806200000_meta_organic_boost_adset_budget_sharing.sql",
);
assert.match(adsetBudgetSharingMigration, /is_adset_budget_sharing_enabled/);
assert.match(adsetBudgetSharingMigration, /validate-campaign/);
assert.match(adsetBudgetSharingMigration, /create-campaign-paused/);
assert.match(
  read("src/lib/meta/executor.ts"),
  /meta_graph_adset_budget_sharing/,
);

const payloadFixMigration = read(
  "supabase/migrations/20260806190000_meta_organic_boost_meta_payload_fix.sql",
);
assert.match(payloadFixMigration, /destination_type', 'ON_POST'/);
assert.match(
  payloadFixMigration,
  /Organic post boosts must not attach top-level CTA\/link fields/,
);
assert.match(payloadFixMigration, /create-ad-set-paused/);
assert.match(payloadFixMigration, /plan_blocked_reason/);
assert.match(payloadFixMigration, /failed_step_error_code/);
assert.match(payloadFixMigration, /organic_preflight_kill_switch/);
assert.match(payloadFixMigration, /drop function if exists public\.list_meta_organic_boost_campaigns/);
assert.match(
  payloadFixMigration,
  /disable trigger guard_meta_mutation_plan_update/,
);
assert.match(
  payloadFixMigration,
  /disable trigger guard_meta_mutation_step_update/,
);
assert.match(
  payloadFixMigration,
  /enable trigger guard_meta_mutation_plan_update/,
);
assert.doesNotMatch(
  payloadFixMigration,
  /v_creative_payload := v_creative_payload \|\| jsonb_build_object\(\s*'call_to_action_type'/,
);

assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /formatOrganicBoostFailureDetail/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Fehlgeschlagen/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Freigeben/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /#automation-control-center/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Sicherheitsschranke/,
);
assert.match(
  read("src/app/dashboard/page.tsx"),
  /formatOrganicBoostFailureDetail/,
);

const killSwitchSoftMigration = read(
  "supabase/migrations/20260806193000_meta_organic_boost_kill_switch_soft.sql",
);
assert.match(killSwitchSoftMigration, /meta_claim_apply_kill_switch_gate/);
assert.match(killSwitchSoftMigration, /never terminal-BLOCK organic/);
assert.match(killSwitchSoftMigration, /organic_preflight_kill_switch/);
assert.match(killSwitchSoftMigration, /set_meta_customer_kill_switch/);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /drainOrganicBoostExecutionsForAccount/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /command\.mode === "ALLOW"/,
);

const executor = read("src/lib/meta/executor.ts");
assert.match(executor, /step\.operation === "VALIDATE" \? "validate_only"/);

assert.match(
  read("docs/meta-automation/ORGANIC_POST_BOOST_LIVE_TEST.md"),
  /Vollautomatisch/,
);

console.log("test-meta-organic-boost: ok");
