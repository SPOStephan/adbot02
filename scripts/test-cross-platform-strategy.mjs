import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

async function loadPlanner() {
  const source = [
    read("src/lib/cross-platform-strategy/catalog.ts"),
    read("src/lib/cross-platform-strategy/types.ts"),
    read("src/lib/cross-platform-strategy/planner.ts"),
  ]
    .join("\n")
    .replace(/^import[\s\S]*?;\n/gm, "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

async function loadInputParser() {
  const source = read("src/lib/cross-platform-strategy/input.ts")
    .replace(
      /import \{[\s\S]*?\} from "@\/lib\/cross-platform-strategy\/catalog";/,
      'const objectives = ["awareness","traffic","engagement","leads","app_promotion","sales"]; const platforms = ["meta","google","openai_ads","tiktok","pinterest","microsoft","linkedin","x","reddit","snapchat"]; const currencies = ["EUR","USD","GBP","CHF","CAD","AUD","NZD","SEK","NOK","DKK","PLN","CZK","HUF","RON","BGN","ZAR"]; const isStrategyObjective = (value) => objectives.includes(value); const isStrategyPlatformId = (value) => platforms.includes(value); const isStrategyCurrency = (value) => currencies.includes(value);',
    )
    .replace(
      /import type \{[\s\S]*?\} from "@\/lib\/cross-platform-strategy\/types";/,
      "",
    )
    .replace(
      /import \{ CustomerControlInputError \} from "@\/lib\/meta\/customer-control-input";/,
      "class CustomerControlInputError extends Error { constructor(code, message) { super(message); this.code = code; } }",
    );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

async function loadPerformanceNormalizer() {
  const source = [
    read("src/lib/cross-platform-strategy/types.ts"),
    read("src/lib/cross-platform-strategy/performance-data.ts"),
  ]
    .join("\n")
    .replace(/^import[\s\S]*?;\n/gm, "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

const planner = await loadPlanner();
const inputParser = await loadInputParser();
const performanceNormalizer = await loadPerformanceNormalizer();
const now = new Date("2026-09-11T12:00:00.000Z");
const account = (platform, accountId = `${platform}-1`) => ({
  accountId,
  platform,
  accountName: platform,
  connected: true,
});
const performance = (platform, overrides = {}) => ({
  accountId: `${platform}-1`,
  platform,
  currency: "EUR",
  spendMinor: 10_000,
  impressions: 10_000,
  clicks: 100,
  conversions: 10,
  leads: 10,
  purchases: 10,
  conversionValueMinor: 20_000,
  latestDataDate: "2026-09-11",
  ...overrides,
});
const request = (overrides = {}) => ({
  objective: "sales",
  currency: "EUR",
  dailyBudgetMinor: 10_000,
  selectedPlatforms: ["meta"],
  ...overrides,
});
const context = (overrides = {}) => ({
  now,
  accounts: [account("meta")],
  performance: [],
  performanceReadErrorCode: null,
  ...overrides,
});
const rawPerformance = (platform, overrides = {}) => ({
  platform_account_id: `${platform}-1`,
  platform,
  entity_type: platform === "meta" ? "ad" : "campaign",
  date: "2026-09-11",
  currency: "EUR",
  spend: "100.00",
  impressions: 10_000,
  clicks: 100,
  inline_link_clicks: platform === "meta" ? 80 : null,
  conversions: 10,
  leads: 10,
  purchases: 10,
  purchase_value: "200.00",
  ...overrides,
});

assert.equal(planner.STRATEGY_PLATFORM_CATALOG.length, 10);
assert.deepEqual(planner.STRATEGY_PLATFORM_IDS, [
  "meta",
  "google",
  "openai_ads",
  "tiktok",
  "pinterest",
  "microsoft",
  "linkedin",
  "x",
  "reddit",
  "snapchat",
]);
assert.deepEqual(performanceNormalizer.STRATEGY_CANONICAL_ENTITY_TYPE, {
  meta: "ad",
  openai_ads: "campaign",
});
assert.deepEqual(performanceNormalizer.STRATEGY_MEASURED_PERFORMANCE_PLATFORMS, [
  "meta",
]);

const scopedPerformanceAccounts = new Map([
  ["meta-1", "meta"],
  ["openai_ads-1", "openai_ads"],
]);
const canonicalOnly = performanceNormalizer.normalizeStrategyPerformanceRows(
  [
    rawPerformance("meta"),
    rawPerformance("meta", { entity_type: "campaign", spend: "999.00" }),
    rawPerformance("openai_ads"),
    rawPerformance("openai_ads", { platform_account_id: "not-scoped" }),
  ],
  scopedPerformanceAccounts,
);
assert.equal(canonicalOnly.length, 1);
assert.equal(canonicalOnly.find((row) => row.platform === "meta").spendMinor, 10_000);
assert.equal(canonicalOnly.find((row) => row.platform === "meta").clicks, 80);
assert.equal(canonicalOnly.find((row) => row.platform === "openai_ads"), undefined);

const rawNullsPreserved = performanceNormalizer.normalizeStrategyPerformanceRows(
  [
    rawPerformance("meta", {
      spend: null,
      impressions: null,
      clicks: null,
      inline_link_clicks: null,
      conversions: null,
      leads: null,
      purchases: null,
      purchase_value: null,
    }),
  ],
  scopedPerformanceAccounts,
)[0];
assert.equal(rawNullsPreserved.spendMinor, null);
assert.equal(rawNullsPreserved.impressions, null);
assert.equal(rawNullsPreserved.clicks, null);
assert.equal(rawNullsPreserved.conversions, null);
assert.equal(rawNullsPreserved.conversionValueMinor, null);

const metaLinkClickNull = performanceNormalizer.normalizeStrategyPerformanceRows(
  [rawPerformance("meta", { inline_link_clicks: null, clicks: 100 })],
  scopedPerformanceAccounts,
)[0];
assert.equal(metaLinkClickNull.clicks, null);

let requestedRange = null;
const completeSnapshot = await performanceNormalizer.readCompleteStrategyPerformanceRows(
  async (from, to) => {
    requestedRange = [from, to];
    return {
      rows: [rawPerformance("meta"), rawPerformance("meta")],
      count: 2,
      errorCode: null,
    };
  },
  10,
);
assert.equal(completeSnapshot.errorCode, null);
assert.equal(completeSnapshot.rows.length, 2);
assert.deepEqual(requestedRange, [0, 9]);

const unknownCount = await performanceNormalizer.readCompleteStrategyPerformanceRows(
  async () => ({
    rows: [rawPerformance("meta")],
    count: null,
    errorCode: null,
  }),
  10,
);
assert.equal(unknownCount.errorCode, "strategy_performance_row_limit");
assert.deepEqual(unknownCount.rows, []);

const incompleteSnapshot = await performanceNormalizer.readCompleteStrategyPerformanceRows(
  async () => ({ rows: [rawPerformance("meta")], count: 2, errorCode: null }),
  10,
);
assert.equal(
  incompleteSnapshot.errorCode,
  "strategy_performance_incomplete_read",
);
assert.deepEqual(incompleteSnapshot.rows, []);

const oversizedSnapshot = await performanceNormalizer.readCompleteStrategyPerformanceRows(
  async () => ({ rows: [], count: 11, errorCode: null }),
  10,
);
assert.equal(oversizedSnapshot.errorCode, "strategy_performance_row_limit");
assert.deepEqual(oversizedSnapshot.rows, []);

const failedSnapshot = await performanceNormalizer.readCompleteStrategyPerformanceRows(
  async () => ({ rows: [], count: null, errorCode: "provider_read_failed" }),
  10,
);
assert.equal(failedSnapshot.errorCode, "provider_read_failed");
assert.deepEqual(failedSnapshot.rows, []);

assert.deepEqual(
  inputParser.parseStrategyPlannerRequest({
    objective: "sales",
    currency: "eur",
    dailyBudget: "123,45",
    selectedPlatforms: ["meta", "google"],
  }),
  {
    objective: "sales",
    currency: "EUR",
    dailyBudgetMinor: 12_345,
    selectedPlatforms: ["meta", "google"],
  },
);
assert.throws(
  () =>
    inputParser.parseStrategyPlannerRequest({
      objective: "sales",
      currency: "EUR",
      dailyBudget: "100",
      selectedPlatforms: ["meta", "meta"],
    }),
  /mehrfach/,
);
assert.throws(
  () =>
    inputParser.parseStrategyPlannerRequest({
      objective: "sales",
      currency: "EUR",
      dailyBudget: "100",
      selectedPlatforms: ["meta"],
      execute: true,
    }),
  /unbekannte Felder/,
);
assert.throws(
  () =>
    inputParser.parseStrategyPlannerRequest({
      objective: "sales",
      currency: "JPY",
      dailyBudget: "100",
      selectedPlatforms: ["meta"],
    }),
  /nicht unterstützt/,
);

const priorOnly = planner.createCrossPlatformStrategyPlan(request(), context());
assert.equal(priorOnly.executionMode, "read_only");
assert.equal(priorOnly.guardrails.providerWritesCreated, false);
assert.equal(priorOnly.guardrails.maxBudgetChangeBpsPer24Hours, 2_000);
assert.equal(priorOnly.guardrails.cooldownHours, 12);
assert.equal(priorOnly.allocations[0].targetDailyBudgetMinor, 10_000);
assert.equal(priorOnly.allocations[0].exploration, true);
assert.equal(priorOnly.confidence, "low");

const measuredContext = context({
  accounts: [account("meta"), account("google"), account("openai_ads")],
  performance: [
    performance("meta", { conversionValueMinor: 20_000 }),
    performance("google", { conversionValueMinor: 40_000 }),
    performance("openai_ads", { conversionValueMinor: 10_000 }),
  ],
});
const measuredRequest = request({
  dailyBudgetMinor: 15_001,
  selectedPlatforms: ["meta", "google", "openai_ads"],
});
const measuredPlan = planner.createCrossPlatformStrategyPlan(
  measuredRequest,
  measuredContext,
);
assert.equal(
  measuredPlan.allocations.reduce((total, item) => total + item.shareBps, 0),
  10_000,
);
assert.equal(
  measuredPlan.allocations.reduce(
    (total, item) => total + item.targetDailyBudgetMinor,
    0,
  ),
  15_001,
);
assert.ok(measuredPlan.allocations.every((item) => item.shareBps >= 500));
assert.ok(measuredPlan.allocations.every((item) => item.shareBps <= 6_000));
assert.equal(measuredPlan.confidence, "medium");
assert.equal(
  measuredPlan.allocations.find((item) => item.platform === "openai_ads")
    .performanceScore,
  null,
);
assert.equal(
  measuredPlan.allocations.find((item) => item.platform === "openai_ads").signal,
  "prior",
);
assert.ok(
  measuredPlan.allocations.find((item) => item.platform === "google").shareBps >
    measuredPlan.allocations.find((item) => item.platform === "openai_ads")
      .shareBps,
);

const disconnected = planner.createCrossPlatformStrategyPlan(
  request({ selectedPlatforms: ["meta", "google"] }),
  context(),
);
const disconnectedGoogle = disconnected.allocations.find(
  (item) => item.platform === "google",
);
assert.equal(disconnectedGoogle.eligible, false);
assert.equal(disconnectedGoogle.targetDailyBudgetMinor, 0);
assert.equal(disconnected.status, "partial");

const unsupported = planner.createCrossPlatformStrategyPlan(
  request({
    objective: "app_promotion",
    selectedPlatforms: ["meta", "openai_ads"],
  }),
  context({
    accounts: [account("meta"), account("openai_ads")],
  }),
);
assert.equal(
  unsupported.allocations.find((item) => item.platform === "openai_ads").eligible,
  false,
);
assert.equal(
  unsupported.allocations.find((item) => item.platform === "meta").signal,
  "prior",
);

const multipleAccounts = planner.createCrossPlatformStrategyPlan(
  request(),
  context({ accounts: [account("meta", "meta-1"), account("meta", "meta-2")] }),
);
assert.equal(multipleAccounts.status, "blocked");
assert.equal(multipleAccounts.allocations[0].readiness, "account_selection_required");

const currencyMismatch = planner.createCrossPlatformStrategyPlan(
  request(),
  context({
    performance: [performance("meta", { currency: "USD" })],
  }),
);
assert.equal(currencyMismatch.status, "blocked");
assert.match(currencyMismatch.blockers.join(" "), /währung/i);

const stale = planner.createCrossPlatformStrategyPlan(
  request(),
  context({
    performance: [performance("meta", { latestDataDate: "2026-09-01" })],
  }),
);
assert.equal(stale.allocations[0].signal, "prior");
assert.equal(stale.allocations[0].exploration, true);

const awarenessMeasured = planner.createCrossPlatformStrategyPlan(
  request({ objective: "awareness" }),
  context({ performance: [performance("meta")] }),
);
assert.equal(awarenessMeasured.allocations[0].signal, "awareness_efficiency");
const awarenessIncomplete = planner.createCrossPlatformStrategyPlan(
  request({ objective: "awareness" }),
  context({ performance: [performance("meta", { impressions: null })] }),
);
assert.equal(awarenessIncomplete.allocations[0].signal, "prior");

const engagementMeasured = planner.createCrossPlatformStrategyPlan(
  request({ objective: "engagement" }),
  context({ performance: [performance("meta")] }),
);
assert.equal(engagementMeasured.allocations[0].signal, "traffic_efficiency");

const leadsMeasured = planner.createCrossPlatformStrategyPlan(
  request({ objective: "leads" }),
  context({ performance: [performance("meta")] }),
);
assert.equal(leadsMeasured.allocations[0].signal, "conversion_efficiency");
const leadsIncompleteButGenericPresent = planner.createCrossPlatformStrategyPlan(
  request({ objective: "leads" }),
  context({ performance: [performance("meta", { leads: null })] }),
);
assert.equal(leadsIncompleteButGenericPresent.allocations[0].signal, "prior");

const salesViaPurchases = planner.createCrossPlatformStrategyPlan(
  request(),
  context({
    performance: [performance("meta", { conversionValueMinor: null })],
  }),
);
assert.equal(salesViaPurchases.allocations[0].signal, "conversion_efficiency");

const salesViaValue = planner.createCrossPlatformStrategyPlan(
  request(),
  context({
    performance: [performance("meta", { purchases: null })],
  }),
);
assert.equal(salesViaValue.allocations[0].signal, "revenue_efficiency");

const priorOnlyProviderIgnoresInjectedCurrency = planner.createCrossPlatformStrategyPlan(
  request({ selectedPlatforms: ["openai_ads"] }),
  context({
    accounts: [account("openai_ads")],
    performance: [performance("openai_ads", { currency: "USD" })],
  }),
);
assert.equal(priorOnlyProviderIgnoresInjectedCurrency.status, "ready");
assert.equal(priorOnlyProviderIgnoresInjectedCurrency.allocations[0].eligible, true);
assert.equal(priorOnlyProviderIgnoresInjectedCurrency.allocations[0].signal, "prior");

const explorationMix = planner.createCrossPlatformStrategyPlan(
  request({ selectedPlatforms: ["meta", "google", "openai_ads"] }),
  context({
    accounts: [account("meta"), account("google"), account("openai_ads")],
    performance: [performance("meta"), performance("google")],
  }),
);
assert.ok(
  explorationMix.allocations.find((item) => item.platform === "openai_ads")
    .shareBps >= 1_000,
);

assert.deepEqual(
  planner.createCrossPlatformStrategyPlan(measuredRequest, measuredContext),
  planner.createCrossPlatformStrategyPlan(measuredRequest, measuredContext),
);

const scopedToActiveAccount = planner.createCrossPlatformStrategyPlan(
  request(),
  context({
    accounts: [account("meta", "meta-active")],
    performance: [performance("meta", { accountId: "meta-revoked" })],
  }),
);
assert.equal(scopedToActiveAccount.allocations[0].signal, "prior");
assert.equal(scopedToActiveAccount.allocations[0].exploration, true);

const incompleteAttribution = planner.createCrossPlatformStrategyPlan(
  request(),
  context({
    performance: [
      performance("meta", { conversionValueMinor: 20_000 }),
      performance("meta", {
        conversionValueMinor: null,
        conversions: null,
        purchases: null,
        latestDataDate: "2026-09-10",
      }),
    ],
  }),
);
assert.equal(incompleteAttribution.allocations[0].signal, "prior");
assert.equal(incompleteAttribution.allocations[0].exploration, true);

const mixedRawCurrencyRows = performanceNormalizer.normalizeStrategyPerformanceRows(
  [rawPerformance("meta"), rawPerformance("meta", { currency: "USD", date: "2026-09-10" })],
  scopedPerformanceAccounts,
);
const mixedRawCurrency = planner.createCrossPlatformStrategyPlan(
  request(),
  context({ performance: mixedRawCurrencyRows }),
);
assert.equal(mixedRawCurrency.status, "blocked");
assert.match(mixedRawCurrency.blockers.join(" "), /währung/i);

const partialRawAttributionRows = performanceNormalizer.normalizeStrategyPerformanceRows(
  [
    rawPerformance("meta"),
    rawPerformance("meta", {
      date: "2026-09-10",
      conversions: null,
      leads: null,
      purchases: null,
      purchase_value: null,
    }),
  ],
  scopedPerformanceAccounts,
);
const partialRawAttribution = planner.createCrossPlatformStrategyPlan(
  request(),
  context({ performance: partialRawAttributionRows }),
);
assert.equal(partialRawAttribution.allocations[0].signal, "prior");
assert.equal(partialRawAttribution.allocations[0].performanceScore, null);
assert.match(partialRawAttribution.allocations[0].reasons.join(" "), /unvollständig/i);

const targetedMetricMissingButGenericPresent = planner.createCrossPlatformStrategyPlan(
  request(),
  context({
    performance: [
      performance("meta"),
      performance("meta", {
        purchases: null,
        conversionValueMinor: null,
        latestDataDate: "2026-09-10",
      }),
    ],
  }),
);
assert.equal(targetedMetricMissingButGenericPresent.allocations[0].signal, "prior");
assert.equal(
  targetedMetricMissingButGenericPresent.allocations[0].performanceScore,
  null,
);

const metaMissingLinkClicks = planner.createCrossPlatformStrategyPlan(
  request({ objective: "traffic" }),
  context({ performance: [metaLinkClickNull] }),
);
assert.equal(metaMissingLinkClicks.allocations[0].signal, "prior");
assert.match(metaMissingLinkClicks.allocations[0].reasons.join(" "), /unvollständig/i);

const route = read("src/app/api/strategy/plan/route.ts");
const loader = read("src/lib/cross-platform-strategy/data.ts");
const component = read("src/components/CrossPlatformStrategyPlanner.tsx");
const navigation = read("src/lib/dashboard/navigation.ts");
assert.match(route, /readControlJson\(request\)/);
assert.match(route, /createCrossPlatformStrategyPlan/);
assert.match(route, /selectedPlatforms: command\.selectedPlatforms/);
assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
assert.match(loader, /id,platform,account_name,connected_at,revoked_at/);
assert.match(loader, /\.from\("performance_data"\)/);
assert.match(loader, /\.in\("platform_account_id", performanceAccountIds\)/);
assert.match(loader, /selectedPlatforms\.has\(platform\)/);
assert.match(loader, /readCompleteStrategyPerformanceRows/);
assert.match(loader, /\.range\(from, to\)/);
assert.match(loader, /\.lte\("date", windowEnd\)/);
assert.doesNotMatch(loader, /cross_platform_account_performance_daily/);
assert.doesNotMatch(loader, /\.from\("campaigns"\)/);
assert.doesNotMatch(loader, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
assert.doesNotMatch(
  loader.match(/from\("platform_accounts"\)[\s\S]*?\.order/)?.[0] ?? "",
  /provider_|marketing_/,
);
assert.match(component, /Keine Provider-Writes in diesem Schritt/);
assert.match(component, /maximal 10/i);
assert.match(navigation, /\/dashboard\/strategie/);

console.log("test-cross-platform-strategy: ok");
