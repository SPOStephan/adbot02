import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const migration = await readFile(
  join(root, "supabase/migrations/20260818120000_launch_chain_delivery_payloads.sql"),
  "utf8",
);
assert.match(migration, /meta_enrich_launch_chain_delivery_payloads/);
assert.match(migration, /destination_type.*WEBSITE|\"WEBSITE\"/);
assert.match(migration, /promoted_object/);
assert.match(migration, /is_adset_budget_sharing_enabled/);
assert.equal(
  (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan\(/g) || []).length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan_v3\(/g) || []).length,
  1,
);
assert.equal(
  (migration.match(/from public\.meta_enrich_launch_chain_delivery_payloads\(/g) || []).length,
  2,
);

const traffic = await readFile(
  join(root, "src/components/TrafficLaunchCanary.tsx"),
  "utf8",
);
assert.match(traffic, /destination_type: "WEBSITE"/);
assert.match(traffic, /executionState/);
assert.match(traffic, /executorSucceeded === 1/);

const execute = await readFile(
  join(root, "src/lib/meta/launch-chain-execute.ts"),
  "utf8",
);
assert.match(execute, /drainApprovedLaunchChainForAccount/);
assert.match(execute, /describeLaunchChainDrainFailure/);
assert.match(execute, /processMetaMutationPlan\(\s*input\.planId/);
assert.doesNotMatch(execute, /processNextMetaMutation/);
assert.doesNotMatch(execute, /Der Meta-Start läuft noch oder wurde unterbrochen/);

const executor = await readFile(
  join(root, "src/lib/meta/executor.ts"),
  "utf8",
);
assert.match(executor, /claim_meta_mutation_execution_for_plan/);
assert.match(executor, /export async function processMetaMutationPlan/);
assert.match(executor, /META_EXECUTOR_MAX_STEPS_PER_RUN = 64/);
assert.doesNotMatch(executor, /step_limit_reached/);
assert.match(executor, /yield_meta_mutation_execution/);

const queueSafeFreeze = await readFile(
  join(
    root,
    "supabase/migrations/20260928190000_meta_launch_yield_and_queue_safe_freeze.sql",
  ),
  "utf8",
);
assert.match(queueSafeFreeze, /create or replace function public\.yield_meta_mutation_execution\(/);
assert.match(queueSafeFreeze, /max_attempts = greatest\(max_attempts, attempt_count \+ 1\)/);
assert.match(queueSafeFreeze, /meta_account_has_open_approved_launch\(\s*new\.user_id/);
assert.match(queueSafeFreeze, /meta_launch_refreeze_keeps_account_allow\(v_user,v_account,v_plan\)/);
assert.match(queueSafeFreeze, /account_write_gate_waiting/);
assert.match(queueSafeFreeze, /blocked_reason = 'writes_frozen'/);

const targetedClaim = await readFile(
  join(
    root,
    "supabase/migrations/20260928110500_meta_targeted_launch_execution.sql",
  ),
  "utf8",
);
assert.match(targetedClaim, /where \(p_plan_id is null or mp\.id = p_plan_id\)/);
assert.match(targetedClaim, /claim_meta_mutation_execution_for_plan/);
assert.match(targetedClaim, /meta_launch_canary_preflight_ok/);
assert.match(targetedClaim, /get_effective_meta_kill_switch/);
assert.match(targetedClaim, /claim_meta_account_operation/);

const service = await readFile(
  join(root, "src/lib/meta/customer-control-service.ts"),
  "utf8",
);
assert.match(service, /drainApprovedLaunchChainForAccount/);
assert.match(service, /executionState: "ACTIVE" \| "QUEUED"/);
assert.match(service, /terminalExecutionFailure/);
assert.doesNotMatch(service, /launch_execution_incomplete/);

const route = await readFile(
  join(root, "src/app/api/meta/automation/launch/route.ts"),
  "utf8",
);
assert.match(route, /export const maxDuration = 300/);

const recovery = await readFile(
  join(
    root,
    "supabase/migrations/20260928150000_meta_launch_completion_recovery.sql",
  ),
  "utf8",
);
assert.match(recovery, /recover_interrupted_meta_customer_launches/);
assert.match(recovery, /step\.status = 'CLAIMED'/);
assert.match(recovery, /step\.dispatch_state = 'NOT_DISPATCHED'/);
assert.match(recovery, /execution\.last_heartbeat_at > now\(\) - interval '30 seconds'/);
assert.match(recovery, /status = 'ABANDONED'/);
assert.match(recovery, /status = 'PENDING'/);
assert.doesNotMatch(recovery, /delete from public\.remote_object_bindings/);

const partialResume = await readFile(
  join(
    root,
    "supabase/migrations/20260928155500_meta_resume_partial_customer_launches.sql",
  ),
  "utf8",
);
assert.match(partialResume, /meta_launch_execution_preflight_action/);
assert.match(partialResume, /meta_launch_chain_preflight_action\(p_plan_id\)/);
assert.match(partialResume, /v_plan\.source_rule_key = 'active-launch-chain'/);
assert.match(partialResume, /from public\.remote_object_bindings binding/);
assert.match(partialResume, /step\.status in \('PENDING', 'RETRYABLE'\)/);
assert.match(partialResume, /step\.status in \('FAILED', 'COMPENSATION_REQUIRED'\)/);
assert.match(partialResume, /mp\.blocked_reason = 'launch_canary_preflight_drift'/);
assert.match(
  partialResume,
  /max_attempts = greatest\(plan\.max_attempts, plan\.attempt_count \+ 1\)/,
);
assert.match(partialResume, /step\.dispatch_state <> 'NOT_DISPATCHED'/);
assert.doesNotMatch(partialResume, /delete from public\.remote_object_bindings/);

const exhaustedPartialResume = await readFile(
  join(
    root,
    "supabase/migrations/20260928160500_meta_resume_exhausted_partial_launches.sql",
  ),
  "utf8",
);
assert.match(exhaustedPartialResume, /mp\.status = 'PENDING'/);
assert.match(
  exhaustedPartialResume,
  /mp\.attempt_count >= mp\.max_attempts/,
);
assert.match(
  exhaustedPartialResume,
  /max_attempts = greatest\(plan\.max_attempts, plan\.attempt_count \+ 1\)/,
);
assert.match(
  exhaustedPartialResume,
  /from public\.remote_object_bindings binding/,
);
assert.match(
  exhaustedPartialResume,
  /step\.dispatch_state <> 'NOT_DISPATCHED'/,
);
assert.match(
  exhaustedPartialResume,
  /step\.status in \('FAILED', 'COMPENSATION_REQUIRED'\)/,
);
assert.doesNotMatch(
  exhaustedPartialResume,
  /delete from public\.remote_object_bindings/,
);

const maintenance = await readFile(
  join(root, "src/lib/meta/launch-maintenance.ts"),
  "utf8",
);
assert.match(maintenance, /recover_interrupted_meta_customer_launches/);
assert.match(maintenance, /recoveredPlans/);

const writeClient = await readFile(
  join(root, "src/lib/meta/write-client.ts"),
  "utf8",
);
assert.match(writeClient, /LINK_CLICKS/);
assert.match(writeClient, /destination_type: "WEBSITE"/);

console.log("Launch chain delivery contract tests passed.");
