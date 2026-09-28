import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const root = process.cwd();
const helperSource = await readFile(
  join(root, "src/lib/meta/launch-policy-budget.ts"),
  "utf8",
);
const helperUrl = `data:text/javascript;base64,${Buffer.from(
  ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText,
).toString("base64")}`;
const {
  classifyLaunchBudgetCapFailure,
  isNonDeliveringMetaStatus,
  LAUNCH_BUDGET_CAP_MESSAGE,
  suggestLaunchPolicyLimits,
} = await import(helperUrl);

assert.equal(
  LAUNCH_BUDGET_CAP_MESSAGE,
  "Das Tagesbudget liegt über dem aktuell freigegebenen Tageslimit.",
);
assert.deepEqual(
  suggestLaunchPolicyLimits({
    dailyBudget: "50.00",
    currentAccountDailyHardCapMinor: 10_000,
    currentCampaignDailyHardCapMinor: 5_000,
  }),
  {
    accountDailyHardCap: "100.00",
    campaignDailyHardCap: "87.50",
    requiredCampaignDailyHardCap: "87.50",
  },
);
assert.deepEqual(
  suggestLaunchPolicyLimits({
    dailyBudget: "50,00",
    currentAccountDailyHardCapMinor: 5_000,
    currentCampaignDailyHardCapMinor: 5_000,
  }),
  {
    accountDailyHardCap: "87.50",
    campaignDailyHardCap: "87.50",
    requiredCampaignDailyHardCap: "87.50",
  },
);
assert.equal(
  suggestLaunchPolicyLimits({
    dailyBudget: "ungültig",
    currentAccountDailyHardCapMinor: 10_000,
    currentCampaignDailyHardCapMinor: 5_000,
  }),
  null,
);

const campaignCapFailure = classifyLaunchBudgetCapFailure(
  "Campaign daily hard cap would be exceeded (reserved 8750 / cap 5000 minor units)",
);
assert.equal(campaignCapFailure?.code, "launch_campaign_budget_cap_exceeded");
assert.match(campaignCapFailure?.message ?? "", /87,50\s*€/);
assert.match(campaignCapFailure?.message ?? "", /50,00\s*€/);
assert.doesNotMatch(campaignCapFailure?.message ?? "", /hard cap|minor units/i);

const accountCapFailure = classifyLaunchBudgetCapFailure(
  "Account daily hard cap would be exceeded (reserved 43750 / cap 40000 minor units)",
);
assert.equal(accountCapFailure?.code, "launch_account_budget_cap_exceeded");
assert.match(accountCapFailure?.message ?? "", /437,50\s*€/);
assert.match(accountCapFailure?.message ?? "", /400,00\s*€/);
assert.match(accountCapFailure?.message ?? "", /von Adbot gesteuerte Kampagnen/);
assert.match(accountCapFailure?.message ?? "", /Eigenständig in Meta verwaltete Kampagnen werden nicht eingerechnet/);
assert.equal(classifyLaunchBudgetCapFailure("anderer Fehler"), null);
assert.equal(isNonDeliveringMetaStatus("PAUSED", "CAMPAIGN_PAUSED"), true);
assert.equal(isNonDeliveringMetaStatus("ARCHIVED", null), true);
assert.equal(isNonDeliveringMetaStatus("ACTIVE", "ACTIVE"), false);

const lead = await readFile(
  join(root, "src/components/LeadLaunchCanary.tsx"),
  "utf8",
);
assert.match(lead, /action: "adjust_budget_cap"/);
assert.match(lead, /Tageslimit direkt anpassen/);
assert.match(lead, /Limit speichern und Kampagne erneut starten/);
assert.match(lead, /await startCampaign\(\)/);
assert.match(lead, /Das geplante Tagesbudget selbst bleibt unverändert/);
assert.match(lead, /Dabei wird kein Budget reserviert und nichts an Meta übertragen/);
assert.match(lead, /onSubmit=\{showAdPreview\}/);
assert.match(lead, /await campaignDraft\.saveNow\(\)/);
assert.match(lead, /campaignDraftId/);
const localPreviewFlow = lead.slice(
  lead.indexOf("function showAdPreview"),
  lead.indexOf("async function startCampaign"),
);
assert.ok(localPreviewFlow.length > 0);
assert.doesNotMatch(localPreviewFlow, /apiJson\(|ensureCampaignLaunchPolicy/);
assert.match(localPreviewFlow, /setPreviewRequested\(true\)/);
assert.match(lead, /budgetNoticeRef\.current\?\.scrollIntoView\(\{/);
assert.match(lead, /behavior: "smooth"/);
assert.match(lead, /block: "center"/);
assert.match(lead, /budgetNoticeRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
assert.match(lead, /role=\{notice\.action === "adjust_budget_cap" \? "alert" : "status"\}/);

const service = await readFile(
  join(root, "src/lib/meta/customer-control-service.ts"),
  "utf8",
);
assert.doesNotMatch(service, /Technik:/);
assert.match(service, /classifyLaunchBudgetCapFailure\(/);
assert.match(service, /`\$\{budgetFailure\.message\}\$\{breakdown\}`/);
assert.match(service, /releaseUnstartedCustomerLaunchReservations/);
assert.doesNotMatch(service, /releaseStaleAcrossAccount/);
assert.doesNotMatch(service, /STALE_UNAPPROVED_LAUNCH_AGE_MS/);
assert.match(service, /sameDraft \|\| legacySameDestination/);
assert.match(service, /\[executions\.data, bindings\.data\]/);
assert.match(service, /releaseNonDeliveringSnapshotExposures/);
assert.match(service, /isNonDeliveringMetaStatus/);
assert.match(service, /currentBudgetExposureBreakdown/);
assert.match(service, /aktive, von Adbot gestartete Kampagnen/);
assert.match(service, /noch nicht gestartete Adbot-Vorbereitungen/);
assert.match(service, /adbotCampaignScopes/);
assert.match(service, /activePlanIds/);
assert.match(service, /\.eq\("object_type", "CAMPAIGN"\)/);
assert.match(service, /source_rule_key", "active-launch-chain"/);
assert.match(service, /mutation_executions/);
assert.match(service, /remote_object_bindings/);
assert.match(service, /\.eq\("source", "PLAN"\)/);
assert.match(service, /CUSTOMER_LAUNCH_PLAN_SUPERSEDED/);
assert.ok(
  service.indexOf("await releaseUnstartedCustomerLaunchReservations") <
    service.indexOf('admin.rpc("materialize_meta_customer_launch_plan"'),
);
assert.ok(
  service.indexOf("await releaseNonDeliveringSnapshotExposures") <
    service.indexOf('admin.rpc("materialize_meta_customer_launch_plan"'),
);
assert.match(
  service,
  /function withLaunchFailureDetail\(message: string, _error: unknown\): string \{\s*return message;/,
);

const ownedOnlyMigration = await readFile(
  join(
    root,
    "supabase/migrations/20260928103000_meta_budget_cap_adbot_owned_only.sql",
  ),
  "utf8",
);
assert.match(ownedOnlyMigration, /create or replace function public\.reserve_meta_daily_budget_exposure/);
assert.match(ownedOnlyMigration, /dbe\.source = 'PLAN'/);
assert.match(ownedOnlyMigration, /from public\.mutation_plans plan/);
assert.match(ownedOnlyMigration, /plan\.status in \(/);
assert.match(ownedOnlyMigration, /from public\.remote_object_bindings binding/);
assert.match(ownedOnlyMigration, /binding\.object_type = 'CAMPAIGN'/);
assert.match(
  ownedOnlyMigration,
  /dbe\.campaign_scope_key = 'campaign:' \|\| binding\.remote_object_id/,
);
assert.doesNotMatch(
  ownedOnlyMigration,
  /into v_account_total[\s\S]*?where dbe\.platform_account_id = p_platform_account_id\s+and dbe\.account_day = p_account_day\s*;/,
);

const externalMetaReservedMinor = 30_100;
const staleAdbotPlanMinor = 8_750;
const newAdbotPlanMinor = 8_750;
const adbotControlledTotalMinor = staleAdbotPlanMinor + newAdbotPlanMinor;
assert.equal(externalMetaReservedMinor + adbotControlledTotalMinor, 47_600);
assert.equal(adbotControlledTotalMinor, 17_500);
assert.ok(adbotControlledTotalMinor < 40_000);

console.log("launch-budget-cap-ux: ok");
