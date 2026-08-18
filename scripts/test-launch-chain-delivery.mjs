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
assert.match(traffic, /executionWarning/);
assert.match(traffic, /executorSucceeded === 1/);

const execute = await readFile(
  join(root, "src/lib/meta/launch-chain-execute.ts"),
  "utf8",
);
assert.match(execute, /drainApprovedLaunchChainForAccount/);
assert.match(execute, /describeLaunchChainDrainFailure/);

const service = await readFile(
  join(root, "src/lib/meta/customer-control-service.ts"),
  "utf8",
);
assert.match(service, /drainApprovedLaunchChainForAccount/);
assert.match(service, /executionWarning/);

const writeClient = await readFile(
  join(root, "src/lib/meta/write-client.ts"),
  "utf8",
);
assert.match(writeClient, /LINK_CLICKS/);
assert.match(writeClient, /destination_type: "WEBSITE"/);

console.log("Launch chain delivery contract tests passed.");
