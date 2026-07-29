import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const inputSource = await readFile(
  path.join(root, "src/lib/meta/customer-control-input.ts"),
  "utf8",
);
const transpiledInput = ts.transpileModule(inputSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const inputModuleUrl = `data:text/javascript;base64,${Buffer.from(
  transpiledInput,
).toString("base64")}`;
const {
  CustomerControlInputError,
  parseBrandCommand,
  parseEuroAmountToMinor,
  parseKillSwitchCommand,
  parsePolicyCommand,
} = await import(inputModuleUrl);

function expectInputError(callback, expectedCode) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof CustomerControlInputError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

assert.equal(parseEuroAmountToMinor("100", "Limit"), "10000");
assert.equal(parseEuroAmountToMinor("100,25", "Limit"), "10025");
assert.equal(parseEuroAmountToMinor("0.01", "Limit"), "1");
assert.equal(
  parseEuroAmountToMinor("92233720368547758.07", "Limit"),
  "9223372036854775807",
);
expectInputError(() => parseEuroAmountToMinor(100, "Limit"), "invalid_amount");
expectInputError(() => parseEuroAmountToMinor("1e3", "Limit"), "invalid_amount");
expectInputError(() => parseEuroAmountToMinor("-1", "Limit"), "invalid_amount");
expectInputError(
  () => parseEuroAmountToMinor("92233720368547758.08", "Limit"),
  "invalid_amount",
);

assert.deepEqual(
  parsePolicyCommand({
    accountDailyHardCap: "250,00",
    campaignDailyHardCap: "75.00",
    allowBudgetChanges: true,
    allowStatusChanges: true,
    allowNewLaunches: true,
    enableAutomation: true,
  }),
  {
    accountDailyHardCapMinor: "25000",
    campaignDailyHardCapMinor: "7500",
    allowBudgetChanges: true,
    allowStatusChanges: true,
    allowNewLaunches: true,
    enableAutomation: true,
  },
);
expectInputError(
  () =>
    parsePolicyCommand({
      accountDailyHardCap: "50",
      campaignDailyHardCap: "75",
      allowBudgetChanges: true,
      allowStatusChanges: true,
      allowNewLaunches: false,
      enableAutomation: true,
    }),
  "campaign_cap_above_account_cap",
);
expectInputError(
  () =>
    parsePolicyCommand({
      accountDailyHardCap: "100",
      campaignDailyHardCap: "50",
      allowBudgetChanges: true,
      allowStatusChanges: false,
      allowNewLaunches: true,
      enableAutomation: true,
    }),
  "launch_requires_status_changes",
);

assert.deepEqual(
  parseKillSwitchCommand({
    mode: "PAUSE_MANAGED",
    reason: "Kundenseitiger Sicherheitsstopp",
  }),
  {
    mode: "PAUSE_MANAGED",
    reason: "Kundenseitiger Sicherheitsstopp",
  },
);
expectInputError(
  () => parseKillSwitchCommand({ mode: "DELETE_ALL", reason: "Nicht erlaubt" }),
  "invalid_kill_switch_mode",
);
expectInputError(
  () => parseKillSwitchCommand({ mode: "ALLOW", reason: "kurz" }),
  "invalid_text",
);

assert.deepEqual(
  parseBrandCommand({
    displayName: "Primäre Brand",
    brandName: "Beispiel GmbH",
    toneOfVoice: "Kompetent und direkt",
    visualStyle: "Klare Flächen, authentische Produktbilder",
    colorPalette: "#0F172A, #2563EB; #FFFFFF, #2563EB",
    forbiddenContent: "Unbelegte Versprechen\nSensible Merkmale",
    callToActionStyle: "Sachlich und konkret",
    preferredFormat: "1:1 Feed",
    generatedAssetApprovalMode: "AUTONOMOUS_POLICY",
  }),
  {
    displayName: "Primäre Brand",
    brandName: "Beispiel GmbH",
    guidelines: {
      toneOfVoice: "Kompetent und direkt",
      visualStyle: "Klare Flächen, authentische Produktbilder",
      colorPalette: ["#0F172A", "#2563EB", "#FFFFFF"],
    },
    forbiddenContent: ["Unbelegte Versprechen", "Sensible Merkmale"],
    generationDefaults: {
      callToActionStyle: "Sachlich und konkret",
      preferredFormat: "1:1 Feed",
    },
    generatedAssetApprovalMode: "AUTONOMOUS_POLICY",
  },
);
expectInputError(
  () =>
    parseBrandCommand({
      displayName: "Brand",
      brandName: "Brand",
      generatedAssetApprovalMode: "AUTO_WITHOUT_POLICY",
    }),
  "invalid_approval_mode",
);

const [
  componentSource,
  pageSource,
  serviceSource,
  routeHelperSource,
  policyRouteSource,
  brandRouteSource,
  killRouteSource,
  migrationSource,
] = await Promise.all([
  readFile(path.join(root, "src/components/AutomationControlCenter.tsx"), "utf8"),
  readFile(path.join(root, "src/app/dashboard/page.tsx"), "utf8"),
  readFile(path.join(root, "src/lib/meta/customer-control-service.ts"), "utf8"),
  readFile(path.join(root, "src/lib/meta/customer-control-route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/policy/route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/brand/route.ts"), "utf8"),
  readFile(path.join(root, "src/app/api/meta/automation/kill-switch/route.ts"), "utf8"),
  readFile(
    path.join(
      root,
      "supabase/migrations/20260729240000_meta_customer_controls.sql",
    ),
    "utf8",
  ),
]);

assert.match(serviceSource, /import "server-only";/);
assert.match(serviceSource, /authenticateMetaCustomer/);
assert.match(serviceSource, /createAdminClient/);
assert.match(serviceSource, /meta_scopes/);
assert.match(serviceSource, /command\.enableAutomation && !customer\.writeScopeGranted/);
assert.match(serviceSource, /command\.mode === "ALLOW" && !customer\.writeScopeGranted/);
assert.match(serviceSource, /\.eq\("user_id", customer\.userId\)/);
assert.match(routeHelperSource, /origin !== request\.nextUrl\.origin/);
assert.match(routeHelperSource, /MAX_BODY_BYTES/);
assert.match(routeHelperSource, /private, no-store/);
assert.match(policyRouteSource, /parsePolicyCommand/);
assert.match(brandRouteSource, /parseBrandCommand/);
assert.match(killRouteSource, /parseKillSwitchCommand/);
assert.match(pageSource, /AutomationControlCenter/);
assert.match(pageSource, /meta_scopes\.includes\("ads_management"\)/);
assert.match(pageSource, /writeScopeGranted/);
assert.match(pageSource, /\.eq\("is_current", true\)/);
assert.match(componentSource, /\/api\/meta\/automation\/policy/);
assert.match(componentSource, /\/api\/meta\/automation\/brand/);
assert.match(componentSource, /\/api\/meta\/automation\/kill-switch/);
assert.match(componentSource, /Max\. 20 % \/ 24 h/);
assert.match(componentSource, /12 h Cooldown/);
assert.match(componentSource, /Minimaler Meta-Schreibscope fehlt/);
assert.match(componentSource, /Meta sicher neu verbinden/);
assert.match(componentSource, /mode === "ALLOW" && !readiness\.writeScopeGranted/);
assert.doesNotMatch(
  componentSource,
  /SUPABASE_SERVICE_ROLE_KEY|createAdminClient|platformAccountId|access_token/i,
);
assert.match(migrationSource, /budget_change_limit_bps[\s\S]*2000/);
assert.match(migrationSource, /cooldown_seconds[\s\S]*43200/);
assert.match(migrationSource, /marketing_currency = 'EUR'/);
assert.match(
  migrationSource,
  /p_enable_automation[\s\S]*'ads_management' = any\(pa\.meta_scopes\)/,
);
assert.match(
  migrationSource,
  /p_mode = 'ALLOW'[\s\S]*'ads_management' = any\(pa\.meta_scopes\)/,
);
assert.match(
  migrationSource,
  /revoke all on function public\.put_meta_customer_policy_version/,
);
assert.match(
  migrationSource,
  /grant execute on function public\.set_meta_customer_kill_switch[\s\S]*to service_role/,
);
assert.doesNotMatch(
  migrationSource,
  /grant execute on function public\.(put_meta_customer_policy_version|set_meta_customer_kill_switch)[\s\S]*to authenticated/,
);

console.log("Meta customer control validation, API boundary and dashboard checks passed");
