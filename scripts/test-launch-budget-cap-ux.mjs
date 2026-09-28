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
assert.match(accountCapFailure?.message ?? "", /nicht allein zu hoch/);
assert.equal(classifyLaunchBudgetCapFailure("anderer Fehler"), null);

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
assert.match(service, /serviceError\(budgetFailure\.code, 409, budgetFailure\.message\)/);
assert.match(service, /releaseSupersededCustomerLaunchReservations/);
assert.match(service, /source_rule_key", "active-launch-chain"/);
assert.match(service, /meta_launch_canary_approvals/);
assert.match(service, /mutation_executions/);
assert.match(service, /remote_object_bindings/);
assert.match(service, /\.eq\("source", "PLAN"\)/);
assert.match(service, /CUSTOMER_LAUNCH_PLAN_SUPERSEDED/);
assert.ok(
  service.indexOf("await releaseSupersededCustomerLaunchReservations") <
    service.indexOf('admin.rpc("materialize_meta_customer_launch_plan"'),
);
assert.match(
  service,
  /function withLaunchFailureDetail\(message: string, _error: unknown\): string \{\s*return message;/,
);

console.log("launch-budget-cap-ux: ok");
