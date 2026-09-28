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

const writeClient = await readFile(
  join(root, "src/lib/meta/write-client.ts"),
  "utf8",
);
assert.match(writeClient, /LINK_CLICKS/);
assert.match(writeClient, /destination_type: "WEBSITE"/);

console.log("Launch chain delivery contract tests passed.");
