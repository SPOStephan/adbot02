import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-launch-prepare-result-"),
);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

try {
  const source = await readFile(
    join(root, "src/lib/meta/launch-prepare-result.ts"),
    "utf8",
  );
  const modulePath = join(temporaryDirectory, "launch-prepare-result.mjs");
  await writeFile(modulePath, transpile(source), "utf8");
  const {
    enrichCustomerLaunchRpcData,
    describeCustomerLaunchParseGaps,
  } = await import(pathToFileURL(modulePath).href);

  // Exact shape returned today by materialize_meta_launch_chain_plan (CREATED).
  const chainCreated = {
    outcome: "CREATED",
    reason: "eligible",
    plan_id: "11111111-1111-4111-8111-111111111111",
    idempotency_key: "k",
    step_count: 8,
    status: "HELD",
    payload_hash: "a".repeat(64),
    objective: "OUTCOME_TRAFFIC",
    destination_url: "https://example.com/landing",
    budget_owner_type: "AD_SET",
    daily_budget_minor: 1500,
    campaign_name: "Traffic Canary",
    ad_set_name: "Traffic AdSet",
    creative_name: "Traffic Creative",
    ad_name: "Traffic Ad",
    target_status: "ACTIVE",
  };

  assert.deepEqual(
    describeCustomerLaunchParseGaps(chainCreated).sort(),
    ["brand_asset_ids", "prepared_at"].sort(),
  );

  const enriched = enrichCustomerLaunchRpcData(chainCreated, {
    brandAssetId: "22222222-2222-4222-8222-222222222222",
    budgetType: "DAILY",
    preparedAt: "2026-08-17T12:00:00.000Z",
  });
  assert.deepEqual(describeCustomerLaunchParseGaps(enriched), []);
  assert.deepEqual(enriched.brand_asset_ids, [
    "22222222-2222-4222-8222-222222222222",
  ]);
  assert.equal(enriched.prepared_at, "2026-08-17T12:00:00.000Z");
  assert.equal(enriched.budget_type, "DAILY");

  const serviceSource = await readFile(
    join(root, "src/lib/meta/customer-control-service.ts"),
    "utf8",
  );
  assert.match(serviceSource, /enrichCustomerLaunchRpcData\(data/);
  assert.match(serviceSource, /describeCustomerLaunchParseGaps/);

  const migration = await readFile(
    join(
      root,
      "supabase/migrations/20260817140000_traffic_launch_prepare_result_contract.sql",
    ),
    "utf8",
  );
  assert.match(migration, /enrich_meta_customer_launch_prepare_result/);
  assert.match(migration, /brand_asset_ids/);
  assert.match(migration, /prepared_at/);
  assert.match(migration, /p_prepared_at::text/);
  assert.match(migration, /outcome' = 'CREATED'/);
  assert.doesNotMatch(
    migration,
    /v_result->>'outcome' = 'QUEUED'/,
  );

  console.log("Launch prepare result contract tests passed.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
