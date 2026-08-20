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
assert.match(
  read("supabase/migrations/20260808160000_organic_boost_planner_never_throws.sql"),
  /PLANNER_EXCEPTION/,
);
assert.match(
  read("supabase/migrations/20260808160000_organic_boost_planner_never_throws.sql"),
  /Policy was rotated/,
);
assert.match(
  read("src/lib/meta/organic-boost-runner.ts"),
  /error instanceof Error/,
);
assert.match(
  read("src/lib/meta/planner.ts"),
  /error\.message, error\.details, error\.hint/,
);
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
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /list_meta_organic_boost_campaigns/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /boostEligibleAssets/,
);

assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /startet die Bewerbung/,
);
assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Kampagne wird angelegt/,
);
assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /Adbot legt jetzt den Beitrag-Push-Plan an/,
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
  read("src/components/AutomationControlCenter.tsx"),
  /Beitrag-Push.*startet automatisch/,
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
  read("src/components/MetaSyncButton.tsx"),
  /hardCapResumeNotice/,
);
assert.match(
  read("src/lib/meta/hard-cap-resume-notice.ts"),
  /scheduleEnded/,
);
assert.match(
  read("src/lib/meta/hard-cap-resume-notice.ts"),
  /Laufzeit bereits beendet/,
);
const reactivateAllPausedBoostsMigration = read(
  "supabase/migrations/20260809130000_meta_reactivate_all_paused_organic_boost.sql",
);
assert.match(
  reactivateAllPausedBoostsMigration,
  /force_reactivate_paused_meta_organic_boost_campaigns/,
);
assert.match(
  reactivateAllPausedBoostsMigration,
  /organic_boost_reactivate/,
);
assert.match(
  read("src/lib/meta/hard-cap-status-execute.ts"),
  /forceReactivatePausedOrganicBoostCampaigns/,
);
assert.match(
  read("src/app/api/connectors/meta/sync/route.ts"),
  /forceReactivatePausedOrganicBoostCampaigns/,
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
  /ohne Dauer-Aktualisierung der ganzen Seite/,
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
  read("src/lib/dashboard/load-customer-dashboard.ts"),
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
  read("src/lib/meta/organic-boost-ensure.ts"),
  /repairOrphanInstagramPageLinks/,
);
assert.match(
  read("src/lib/meta/organic-boost-ensure.ts"),
  /ensureOrganicAutoWritesAllow/,
);
assert.match(
  read("src/lib/meta/organic-boost-ensure.ts"),
  /FREEZE darf AUTO nicht dauerhaft blockieren/,
);
assert.match(
  read("src/lib/meta/organic-boost-ensure.ts"),
  /recoverPausedOrganicBoostCampaigns/,
);
assert.match(
  read("src/lib/meta/organic-boost-ensure.ts"),
  /forceReactivatePausedOrganicBoostCampaigns/,
);
assert.match(
  read("src/app/dashboard/beitraege/page.tsx"),
  /organicBoostEnsure:\s*true/,
);
assert.match(
  read("src/components/ContentCandidateBoostControls.tsx"),
  /unter Autonomie/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /organicBoostEnsure/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /organic_boost_planner_status/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
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
  /Schreiben gestoppt \(Sicherheitsschranke\)/,
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
  read("src/app/dashboard/kampagnen/page.tsx"),
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
  /Meta-Versand noch nicht bestätigt/,
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

const noAccountRefreezeMigration = read(
  "supabase/migrations/20260806240000_meta_organic_boost_no_account_refreeze.sql",
);
assert.match(
  noAccountRefreezeMigration,
  /source_rule_key = 'organic-boost'/,
);
assert.match(
  noAccountRefreezeMigration,
  /never freeze ACCOUNT for organic-boost|never revokes account Freigeben/,
);
assert.match(
  noAccountRefreezeMigration,
  /organic-boost skips account refreeze after reconcile/,
);
assert.match(
  noAccountRefreezeMigration,
  /meta-organic-boost-no-account-refreeze/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Executor arbeitet — noch kein Meta-Versand/,
);
assert.doesNotMatch(
  read("src/components/MetaCampaignOverview.tsx"),
  /return "Meta-Versand wird gestartet"/,
);
assert.doesNotMatch(
  read("src/components/MetaCampaignOverview.tsx"),
  /Boost wird gestartet/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /In Warteschlange — noch kein Meta-Versand/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Meta-Versand läuft/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /hasRemoteCampaignBinding/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /anyStepDispatchStarted/,
);

const honestStatusMigration = read(
  "supabase/migrations/20260806250000_meta_organic_boost_honest_status.sql",
);
assert.match(honestStatusMigration, /has_remote_campaign_binding/);
assert.match(honestStatusMigration, /any_step_remote_applied/);
assert.match(honestStatusMigration, /any_step_dispatch_started/);
assert.match(
  honestStatusMigration,
  /Meta status\/spend only when a CAMPAIGN remote binding exists/,
);
assert.doesNotMatch(
  honestStatusMigration,
  /binding\.id is null\s+and campaign\.name =/,
);

const graphErrorDetailMigration = read(
  "supabase/migrations/20260806260000_meta_graph_error_detail.sql",
);
assert.match(graphErrorDetailMigration, /error_detail text/);
assert.match(graphErrorDetailMigration, /p_error_detail/);
assert.match(graphErrorDetailMigration, /failed_step_error_detail/);
assert.match(graphErrorDetailMigration, /meta_executor_safe_error_detail/);
assert.match(
  read("src/lib/meta/client.ts"),
  /error_user_msg/,
);
assert.match(
  read("src/lib/meta/client.ts"),
  /sanitizeMetaGraphDiagnosticDetail/,
);
assert.match(
  read("src/lib/meta/executor.ts"),
  /errorDetail: error\.diagnosticDetail/,
);
assert.match(
  read("src/lib/meta/executor.ts"),
  /p_error_detail: input\.failure\.errorDetail/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /failedStepErrorDetail/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /formatMetaGraphCodeLabel/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /failed_step_error_detail/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /planAndDrainOrganicBoostForAccount/,
);
assert.match(
  read("src/lib/meta/organic-boost-execute.ts"),
  /divertedToOtherAccount/,
);
assert.match(
  read("src/lib/meta/executor.ts"),
  /platformAccountId\?: string/,
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
  /Beitrag-Push läuft unabh[^"]*ngig/,
);
assert.match(
  read("src/components/MetaContentSyncPanel.tsx"),
  /OrganicBoostAutoPlanner/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
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
  read("src/lib/meta/organic-boost-ensure.ts"),
  /dashboard load/,
);
assert.match(
  read("src/lib/meta/organic-boost-ensure.ts"),
  /dashboard LiveRefresh/,
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
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /sync_usage/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /organic_boost/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
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
  read("src/lib/dashboard/navigation.ts"),
  /href: "\/dashboard\/kampagnen"/,
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
  read("src/lib/dashboard/load-customer-dashboard.ts"),
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

const idleLeaseReclaimMigration = read(
  "supabase/migrations/20260806270000_meta_operation_lease_idle_reclaim.sql",
);
assert.match(
  idleLeaseReclaimMigration,
  /Idle lease: always take it as the verified owner/,
);
assert.match(idleLeaseReclaimMigration, /heal_meta_account_operation_lease/);
assert.match(idleLeaseReclaimMigration, /account_operation_lease_busy/);
assert.match(
  read("src/lib/meta/organic-boost-execute.ts"),
  /heal_meta_account_operation_lease/,
);
assert.match(
  read("src/lib/meta/organic-boost-execute.ts"),
  /claim_idle_with_due_plans/,
);
assert.match(
  read("src/lib/meta/organic-boost-execute.ts"),
  /lastError: string \| null/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /executorLastError/,
);
assert.match(
  read("src/app/api/meta/automation/organic-boost/plan/route.ts"),
  /executorLastError/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /organic_boost_dashboard_ensure/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /account_operation_lease_busy/,
);

const campaignBidStrategyMigration = read(
  "supabase/migrations/20260806290000_meta_organic_boost_campaign_bid_strategy.sql",
);
assert.match(campaignBidStrategyMigration, /4834005/);
assert.match(
  campaignBidStrategyMigration,
  /''bid_strategy'', ''LOWEST_COST_WITHOUT_CAP''/,
);
assert.match(
  read("src/lib/meta/write-client.ts"),
  /ad-set budget sharing requires campaign bid_strategy/,
);
assert.match(
  read("src/lib/meta/executor.ts"),
  /meta_graph_adset_budget_sharing_bid_strategy/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /4834005/,
);

const attemptCollisionMigration = read(
  "supabase/migrations/20260806291000_meta_organic_boost_attempt_collision.sql",
);
assert.match(
  attemptCollisionMigration,
  /mutation_executions_plan_attempt_key/,
);
assert.match(attemptCollisionMigration, /max\(me\.attempt_number\)/);
assert.match(
  attemptCollisionMigration,
  /v_attempt := greatest/,
);

const rebindMigration = read(
  "supabase/migrations/20260808170000_meta_organic_boost_rebind_current_policy.sql",
);
assert.match(
  rebindMigration,
  /rebind_meta_organic_boost_plans_to_current_policy/,
);
assert.match(
  rebindMigration,
  /diagnose_meta_organic_boost_plan_preflight/,
);
assert.match(rebindMigration, /app\.meta_organic_rebind/);
assert.match(rebindMigration, /policy_inactive/);
assert.match(
  rebindMigration,
  /drop function if exists public\.prepare_meta_organic_boost_write_now/,
);
assert.match(
  rebindMigration,
  /drop function if exists public\.diagnose_meta_organic_boost_write_now/,
);
assert.match(
  rebindMigration,
  /preflight_blocker/,
);
assert.match(
  read("src/lib/meta/organic-boost-execute.ts"),
  /preflight_blocker|blocker=/,
);
assert.match(
  read("src/lib/meta/customer-control-service.ts"),
  /rebind_meta_organic_boost_plans_to_current_policy/,
);

const rebindHarderMigration = read(
  "supabase/migrations/20260808171000_meta_organic_boost_rebind_harder.sql",
);
assert.match(rebindHarderMigration, /disable trigger guard_meta_mutation_plan_update/);
assert.match(rebindHarderMigration, /rebind_detail/);
assert.match(rebindHarderMigration, /rebind_exception:/);
assert.match(rebindHarderMigration, /no_current_active_eur_policy/);
assert.match(
  read("src/lib/meta/organic-boost-execute.ts"),
  /rebind_detail/,
);

const rebindAttemptClampMigration = read(
  "supabase/migrations/20260808172000_meta_organic_boost_rebind_attempt_clamp.sql",
);
assert.match(
  rebindAttemptClampMigration,
  /mutation_plans_attempt_check/,
);
assert.match(rebindAttemptClampMigration, /max_attempts between 1 and 50/);
assert.match(rebindAttemptClampMigration, /v_max_attempts := least/);
assert.match(rebindAttemptClampMigration, /v_attempt_count := least/);
assert.match(rebindAttemptClampMigration, /v_skipped/);

const forceReleaseLeaseMigration = read(
  "supabase/migrations/20260808173000_meta_organic_boost_force_release_lease.sql",
);
assert.match(
  forceReleaseLeaseMigration,
  /force_release_meta_account_operation_lease/,
);
assert.match(forceReleaseLeaseMigration, /lease_forced/);
assert.match(
  forceReleaseLeaseMigration,
  /CLAIMED', 'EXECUTING', 'RECONCILING/,
);
assert.doesNotMatch(
  forceReleaseLeaseMigration,
  /claim_meta_account_operation\(\s*p_platform_account_id/,
);
assert.match(
  read("src/app/api/meta/automation/organic-boost/execute/route.ts"),
  /drainOrganicBoostExecutionsForAccount/,
);
assert.match(
  read("src/lib/meta/organic-boost-execute.ts"),
  /lease_forced/,
);

const spendByPlatformMigration = read(
  "supabase/migrations/20260808174000_meta_organic_boost_spend_by_platform_id.sql",
);
assert.match(spendByPlatformMigration, /platform_campaign_id/);
assert.match(
  spendByPlatformMigration,
  /c\.platform_campaign_id = bound\.platform_campaign_id/,
);
assert.match(
  read("src/components/OrganicBoostPlanButton.tsx"),
  /\/api\/meta\/automation\/organic-boost\/execute/,
);
assert.match(
  read("src/components/OrganicBoostPlanButton.tsx"),
  /Meta-Kennzahlen aktualisiert/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /Kampagnen-Insights und Budgetrest|Ad- \+ Kampagnen-Insights|geplantes Gesamtbudget/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /deriveOrganicBoostRemainingMinor/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /durationDaysFromWindow/,
);
assert.match(
  read("src/components/MetaCampaignOverview.tsx"),
  /plannedEnvelopeMinor/,
);
// daily × days − spend (EUR major → minor): 5€/Tag × 7 Tage − 12,50€ = 22,50€
assert.equal(Math.max(500 * 7 - Math.round(12.5 * 100), 0), 2250);

const finalizeActiveMigration = read(
  "supabase/migrations/20260808175000_meta_organic_boost_finalize_active.sql",
);
assert.match(
  finalizeActiveMigration,
  /finalize_meta_organic_boost_already_active_plans/,
);
assert.match(finalizeActiveMigration, /finalized_active=/);
assert.doesNotMatch(
  finalizeActiveMigration,
  /update public\.mutation_plan_steps/,
);

const finalizeActiveNoStepMigration = read(
  "supabase/migrations/20260808175100_meta_organic_boost_finalize_active_no_step_shape.sql",
);
assert.match(
  finalizeActiveNoStepMigration,
  /does not rewrite step dispatch shape/,
);
assert.doesNotMatch(
  finalizeActiveNoStepMigration,
  /update public\.mutation_plan_steps/,
);

const hardCapDayResumeMigration = read(
  "supabase/migrations/20260809080000_meta_hard_cap_day_resume.sql",
);
assert.match(
  hardCapDayResumeMigration,
  /finalize_meta_organic_boost_already_active_plans/,
);
assert.match(
  hardCapDayResumeMigration,
  /boost:adset:%/,
);
assert.match(
  hardCapDayResumeMigration,
  /queue_meta_hard_cap_resume_internal/,
);
const hardCapActivateConstraintMigration = read(
  "supabase/migrations/20260809090000_meta_hard_cap_activate_safety_constraint.sql",
);
assert.match(
  hardCapActivateConstraintMigration,
  /action_type in \('SAFETY_PAUSE', 'ACTIVATE'\)/,
);
assert.match(
  read("src/lib/meta/hard-cap-status-execute.ts"),
  /drainHardCapStatusExecutionsForAccount/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /drainHardCapStatusExecutionsForAccount/,
);
assert.match(
  read("src/app/api/connectors/meta/sync/route.ts"),
  /drainHardCapStatusExecutionsForAccount/,
);
const organicBoostHardCapExemptMigration = read(
  "supabase/migrations/20260809100000_meta_organic_boost_hard_cap_pause_exempt.sql",
);
assert.match(
  organicBoostHardCapExemptMigration,
  /organic_boost_hard_cap_exempt/,
);
assert.match(
  organicBoostHardCapExemptMigration,
  /queue_meta_hard_cap_pause_internal/,
);
assert.match(
  organicBoostHardCapExemptMigration,
  /source_rule_key = 'organic-boost'/,
);
const forceResumeBoostHardCapMigration = read(
  "supabase/migrations/20260809110000_meta_force_resume_organic_boost_hard_cap.sql",
);
assert.match(
  forceResumeBoostHardCapMigration,
  /force_resume_meta_organic_boost_hard_cap_pauses/,
);
assert.match(
  forceResumeBoostHardCapMigration,
  /ORGANIC_BOOST_HARD_CAP_FORCE_RESUME/,
);
const finishBoostHardCapResumeMigration = read(
  "supabase/migrations/20260809120000_meta_finish_organic_boost_hard_cap_resume.sql",
);
assert.match(
  finishBoostHardCapResumeMigration,
  /resume_without_last_seen_sync/,
);
assert.match(
  finishBoostHardCapResumeMigration,
  /v_revived/,
);
assert.match(
  finishBoostHardCapResumeMigration,
  /schedule_ended/,
);
assert.match(
  read("src/lib/meta/hard-cap-status-execute.ts"),
  /forceReactivatePausedOrganicBoostCampaigns/,
);
assert.match(
  read("src/app/api/connectors/meta/sync/route.ts"),
  /forceReactivatePausedOrganicBoostCampaigns/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /forceReactivatePausedOrganicBoostCampaigns/,
);
assert.match(
  finalizeActiveNoStepMigration,
  /prepare_meta_organic_boost_write_now/,
);
assert.match(finalizeActiveNoStepMigration, /finalized_active=/);
assert.match(
  read("src/app/api/meta/automation/organic-boost/execute/route.ts"),
  /syncMetaConnector/,
);
assert.match(
  read("src/app/api/meta/automation/organic-boost/execute/route.ts"),
  /marketingSync/,
);
assert.match(
  read("src/components/OrganicBoostPlanButton.tsx"),
  /idleOnly/,
);
assert.match(
  read("src/components/OrganicBoostPlanButton.tsx"),
  /Meta-Kennzahlen aktualisiert/,
);
assert.match(
  read("src/components/OrganicBoostPlanButton.tsx"),
  /spendTotal/,
);
assert.match(
  read("src/lib/meta/marketing-sync.ts"),
  /Include account-local "today"/,
);
assert.match(read("src/lib/meta/marketing-sync.ts"), /sumInsightSpend/);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /campaignRows\.find\(\(row\) => row\.id === campaign\.campaignId\)/,
);
assert.match(
  read("src/lib/dashboard/load-customer-dashboard.ts"),
  /marketing_spend_total/,
);

const realtimeSpendMigration = read(
  "supabase/migrations/20260808180000_meta_realtime_spend_sources.sql",
);
assert.match(realtimeSpendMigration, /apply_meta_campaign_insight_spend/);
assert.match(realtimeSpendMigration, /campaign_insights_spend/);
assert.match(realtimeSpendMigration, /derived_spend/);
assert.match(realtimeSpendMigration, /adset_live/);
assert.match(
  read("src/lib/meta/marketing-sync.ts"),
  /getMetaCampaignInsights/,
);
assert.match(
  read("src/lib/meta/marketing-sync.ts"),
  /getMetaAccountInsights/,
);
assert.match(
  read("src/lib/meta/client.ts"),
  /applyInsightsTimeRange/,
);

console.log("test-meta-organic-boost: ok");
