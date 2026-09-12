import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const [runner, sync, migration, executor, decision] = await Promise.all([
  readFile(join(root, "src/lib/meta/creative-format-optimizer.ts"), "utf8"),
  readFile(join(root, "src/lib/meta/sync.ts"), "utf8"),
  readFile(join(root, "supabase/migrations/20260912130000_meta_creative_format_optimizer.sql"), "utf8"),
  readFile(join(root, "src/lib/meta/executor.ts"), "utf8"),
  readFile(join(root, "src/lib/meta/creative-format-decision.ts"), "utf8"),
]);

assert.match(runner, /getMetaCreativeOptimizationInsights/);
assert.match(runner, /META_CREATIVE_ATTRIBUTION_CONTRACT/);
assert.match(runner, /measurement_start_date/);
assert.match(runner, /activeCycle\.baseline_ad_id/);
assert.match(runner, /complete_meta_creative_optimization_cycle_no_winner/);
assert.match(runner, /p_evidence: decision\.evidence/);
assert.match(runner, /count !== data\.length/);
assert.match(runner, /\{ count: "exact" \}/);
assert.match(runner, /\.eq\("target_type", "AD"\)/);
assert.match(runner, /\.eq\("status", "MANAGED"\)/);
assert.match(runner, /decision\.status === "START_TEST"[\s\S]*contexts\.length === 1/);
assert.match(runner, /materialize_meta_creative_format_optimizer_plan/);
assert.match(runner, /queue_meta_creative_evidence_pause_internal/);
assert.doesNotMatch(runner, /invokeLLM|openai|together/i);
assert.doesNotMatch(runner, /createMetaAd|createMetaCreative|updateMetaAdStatus/);

assert.match(sync, /runMetaCreativeFormatOptimizerAfterSnapshot/);
assert.match(sync, /marketingSyncId: marketingResult\.syncId/);
assert.match(sync, /readLeaseToken/);
assert.match(sync, /mergeMetaUsage\(usage, creativeOptimizer\.usage\)/);

assert.match(decision, /META_CREATIVE_FIXED_TEST_DAYS = 7/);
assert.match(decision, /META_CREATIVE_MIN_DELIVERY_BALANCE = 0\.5/);
assert.match(decision, /META_CREATIVE_MIN_RELATIVE_LIFT = 0\.1/);
assert.match(decision, /META_CREATIVE_MIN_DAILY_WINS = 6/);
assert.match(decision, /incomplete_daily_metrics/);
assert.doesNotMatch(decision, /zScore|oneSidedP|7d_click|1d_view|lead|purchase/);

assert.match(executor, /needsMetaCreativeFreshPreflight/);
assert.match(executor, /await input\.dependencies\.freshPreflight/);
assert.match(executor, /creative_optimizer_fresh_preflight_required/);

assert.match(migration, /disabled_legacy_no_minimum/);
assert.match(migration, /read_lease_required/);
assert.match(migration, /meta_existing_adset_creative_test_v1/);
assert.match(migration, /meta_creative_evidence_pause_v1/);
assert.match(migration, /meta_creative_format_operational_evidence_v2/);
assert.match(migration, /active_test_cycle_required/);
assert.match(migration, /fixed_window_mismatch/);
assert.match(migration, /operational_dominance_not_proven/);
assert.match(migration, /evidence_valid_until/);
assert.match(migration, /imbalanced_delivery/);
assert.match(migration, /organic_boost_auto_pause_forbidden/);
assert.match(migration, /organic_boost_creative_test_forbidden/);
assert.match(migration, /v_rule <> 'organic-boost'/);
assert.match(migration, /status = 'PAUSE_PLANNED'/);
assert.match(migration, /operational_traffic_dominance_pending/);
assert.match(migration, /decision_evidence = p_evidence/);
assert.match(migration, /META_CREATIVE_OPTIMIZER_NO_WINNER/);
assert.match(migration, /baseline_ad_id = p_baseline_ad_id/);
assert.match(migration, /candidate_asset_id = p_candidate_asset_id/);
assert.match(migration, /budget_fields_forbidden/);
assert.doesNotMatch(
  migration.slice(
    migration.indexOf("create or replace function public.materialize_meta_creative_format_optimizer_plan"),
    migration.indexOf("create or replace function public.reconcile_meta_creative_format_optimizer_plan"),
  ),
  /'operation',\s*'(CREATE_CAMPAIGN|CREATE_AD_SET|UPDATE_BUDGET)'/,
);

console.log("test-meta-creative-format-optimizer: ok");
