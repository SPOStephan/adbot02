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
const { LAUNCH_BUDGET_CAP_MESSAGE, suggestLaunchPolicyLimits } = await import(
  helperUrl
);

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

const lead = await readFile(
  join(root, "src/components/LeadLaunchCanary.tsx"),
  "utf8",
);
assert.match(lead, /action: "adjust_budget_cap"/);
assert.match(lead, /Tageslimit direkt anpassen/);
assert.match(lead, /Limit speichern und Vorschau erneut erstellen/);
assert.match(lead, /campaignFormRef\.current\?\.requestSubmit\(\)/);
assert.match(lead, /Das geplante Tagesbudget selbst bleibt unverändert/);
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
assert.match(
  service,
  /function withLaunchFailureDetail\(message: string, _error: unknown\): string \{\s*return message;/,
);

console.log("launch-budget-cap-ux: ok");
