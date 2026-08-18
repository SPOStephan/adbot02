import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260818220000_meta_ad_sibling_success_pause.sql",
);
const migration = await readFile(migrationPath, "utf8");

assert.match(migration, /ad_sibling_success_pause_7d/);
assert.match(migration, /queue_meta_ad_sibling_success_pause_internal/);
assert.match(migration, /queue_meta_ad_sibling_success_pause_scan_internal/);
assert.match(migration, /Erfolgssteuerung: schwächste Anzeige pausieren/);
assert.match(migration, /severity,\s*priority,\s*title/);
assert.match(migration, /'opportunity'/);
assert.match(migration, /\b54\b/);
assert.match(migration, /stronger_ad/);
assert.match(migration, /weaker_ad/);
assert.match(migration, /relative_ranking/);
assert.match(migration, /no_min_volume_stop/);
assert.match(migration, /keep_at_least_one_active_ad/);
assert.match(migration, /would_leave_zero_active_ads/);
assert.match(migration, /kill_switch_blocks_status_write/);
assert.match(migration, /allow_status_changes/);
assert.match(migration, /coalesce\(v_kill_mode, 'ALLOW'\) <> 'ALLOW'/);
assert.match(migration, /action_type,/);
assert.match(migration, /'PAUSE'/);
assert.match(migration, /target_type = 'AD'/);
assert.match(migration, /safety_action,/);
assert.match(migration, /false,/);
assert.match(migration, /'validate-ad-sibling-pause', 'VALIDATE'/);
assert.match(migration, /'execute-ad-sibling-pause', 'UPDATE'/);
assert.match(migration, /'read-after-ad-sibling-pause', 'READ'/);
assert.match(migration, /'reconcile-ad-sibling-pause', 'RECONCILE'/);
assert.match(migration, /active_ad_set_count/);
assert.match(
  migration,
  /coalesce\(v_active_ad_set_count, 0\) <> 1/,
);
assert.match(migration, /run_meta_budget_planner/);
assert.match(
  migration,
  /queue_meta_ad_sibling_success_pause_scan_internal/,
);
assert.match(
  migration,
  /grant execute on function public\.queue_meta_ad_sibling_success_pause_internal/,
);
assert.match(
  migration,
  /grant execute on function public\.queue_meta_ad_sibling_success_pause_scan_internal/,
);
assert.match(
  migration,
  /grant execute on function public\.rebuild_meta_campaign_recommendations/,
);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.match(migration, /'PAUSE',\s*'AD'/);
assert.doesNotMatch(migration, /'SAFETY_PAUSE'/);
assert.match(migration, /abo_sibling_success_rank_7d/);

// Planner hook must prefer running after sibling reallocate when present.
assert.match(
  migration,
  /queue_meta_sibling_budget_reallocate_internal[\s\S]*queue_meta_ad_sibling_success_pause_scan_internal|after ABO sibling reallocate/i,
);

console.log("test-ad-sibling-success-pause: ok");
