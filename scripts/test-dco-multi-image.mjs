import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260923160000_launch_dco_multi_image.sql",
);
const migration = await readFile(migrationPath, "utf8");

assert.equal(
  (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan\(/g) || []).length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan_v3\(/g) || []).length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.approve_meta_launch_canary_plan\(/g) || []).length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.approve_meta_lifetime_launch_canary_plan_v3\(/g) || []).length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.reconcile_meta_launch_mutation_plan\(/g) || []).length,
  1,
);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.match(migration, /use_dynamic_creative_images/);
assert.match(migration, /dynamic_creative_asset_ids/);
assert.match(migration, /meta_launch_collect_brand_asset_ids/);
assert.match(migration, /v_dco_image_refs/);
assert.match(migration, /upload-image-/);
assert.match(migration, /Launch Chain v1 requires exactly one unique brand asset/);
assert.match(migration, /Dynamic Creative erlaubt höchstens 10 Bilder/);
assert.match(
  migration,
  /Dynamic Creative mit mehreren Bildern ist nicht mit Struktur-Test kombinierbar/,
);
assert.match(migration, /v_base_step_count \+ v_upload_step_count/);
assert.doesNotMatch(
  migration,
  /jsonb_array_length\(v_plan.planned_payload->'brand_asset_ids'\) = 1/,
);

const traffic = await readFile(
  join(root, "src/components/TrafficLaunchCanary.tsx"),
  "utf8",
);
assert.match(traffic, /DynamicCreativeImagesField/);
assert.match(traffic, /useDynamicCreativeImages/);
assert.match(traffic, /includeFormatSiblings/);

const lead = await readFile(
  join(root, "src/components/LeadLaunchCanary.tsx"),
  "utf8",
);
assert.match(lead, /DynamicCreativeImagesField/);
assert.match(lead, /useDynamicCreativeImages/);

const service = await readFile(
  join(root, "src/lib/meta/customer-control-service.ts"),
  "utf8",
);
assert.match(service, /resolveDynamicCreativeAssetIds/);
assert.match(service, /dynamic_creative_asset_ids/);
assert.doesNotMatch(service, /materialize_meta_organic_boost_plan/);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-dco-images-"));
try {
  const variantsSource = await readFile(
    join(root, "src/lib/meta/creative-image-variants.ts"),
    "utf8",
  );
  const formatsSource = await readFile(
    join(root, "src/lib/media-library/meta-formats.ts"),
    "utf8",
  );
  await writeFile(
    join(temporaryDirectory, "meta-formats.mjs"),
    transpile(formatsSource),
    "utf8",
  );
  const rewrittenVariants = variantsSource.replace(
    "@/lib/media-library/meta-formats",
    "./meta-formats.mjs",
  );
  const variantsPath = join(temporaryDirectory, "creative-image-variants.mjs");
  await writeFile(variantsPath, transpile(rewrittenVariants), "utf8");
  const variants = await import(pathToFileURL(variantsPath).href);

  const parent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const feed = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const story = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const other = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const library = [
    { id: parent, width: 1200, height: 800, metaFormatKey: null, parentAssetId: null },
    {
      id: feed,
      width: 1080,
      height: 1080,
      metaFormatKey: "meta_feed_1x1",
      parentAssetId: parent,
    },
    {
      id: story,
      width: 1080,
      height: 1920,
      metaFormatKey: "meta_story_9x16",
      parentAssetId: parent,
    },
    { id: other, width: 1080, height: 1080, metaFormatKey: "meta_feed_1x1" },
  ];

  const siblings = variants.suggestFormatSiblingIds([parent], library);
  assert.deepEqual(siblings.sort(), [feed, story].sort());

  const resolved = variants.resolveDynamicCreativeAssetIds({
    primaryId: parent,
    extraIds: [other],
    library,
    includeFormatSiblings: true,
  });
  assert.equal(resolved.assetIds[0], parent);
  assert.ok(resolved.assetIds.includes(other));
  assert.ok(resolved.assetIds.includes(feed));
  assert.ok(resolved.assetIds.includes(story));
  assert.equal(variants.usesDynamicCreativeImages(resolved.assetIds), true);

  const primaryOnly = variants.resolveDynamicCreativeAssetIds({
    primaryId: parent,
    extraIds: [other],
    library,
    includeFormatSiblings: false,
  });
  assert.deepEqual(primaryOnly.assetIds, [parent, other]);

  const inputSource = await readFile(
    join(root, "src/lib/meta/customer-control-input.ts"),
    "utf8",
  );
  const inputPath = join(temporaryDirectory, "customer-control-input.mjs");
  await writeFile(inputPath, transpile(inputSource), "utf8");
  const input = await import(pathToFileURL(inputPath).href);

  const baseDaily = {
    blueprintId: "11111111-1111-4111-8111-111111111111",
    brandAssetId: "22222222-2222-4222-8222-222222222222",
    allowedDomainId: "33333333-3333-4333-8333-333333333333",
    budgetOwnerType: "AD_SET",
    budgetType: "DAILY",
    dailyBudget: "20.00",
    destinationUrl: "https://example.com/landing",
    reason: "Dynamic Creative Motive prüfen",
    confirmation: "AKTIV-LAUNCH VORBEREITEN",
  };

  const omitted = input.parseLaunchCommand(baseDaily);
  assert.equal(omitted.launchInputs.use_dynamic_creative_images, undefined);
  assert.equal(omitted.launchInputs.dynamic_creative_asset_ids, undefined);

  const opted = input.parseLaunchCommand({
    ...baseDaily,
    useDynamicCreativeImages: true,
    extraBrandAssetIds: [other, other],
  });
  assert.equal(opted.launchInputs.use_dynamic_creative_images, true);
  assert.deepEqual(opted.launchInputs.dynamic_creative_asset_ids, [other]);
  assert.equal(opted.launchInputs.include_format_siblings, true);

  assert.throws(
    () =>
      input.parseLaunchCommand({
        ...baseDaily,
        structuralAdCount: 2,
        structuralAds: [
          { message: "Text A", name: "Headline A", description: "" },
          { message: "Text B", name: "Headline B", description: "" },
        ],
        useDynamicCreativeImages: true,
        extraBrandAssetIds: [other],
      }),
    /nicht mit dem Struktur-Test/,
  );

  assert.throws(
    () =>
      input.parseLaunchCommand({
        ...baseDaily,
        useDynamicCreativeImages: false,
        extraBrandAssetIds: [other],
      }),
    /erfordern useDynamicCreativeImages/,
  );

  const prepareSource = await readFile(
    join(root, "src/lib/meta/launch-prepare-result.ts"),
    "utf8",
  );
  const preparePath = join(temporaryDirectory, "launch-prepare-result.mjs");
  await writeFile(preparePath, transpile(prepareSource), "utf8");
  const prepare = await import(pathToFileURL(preparePath).href);
  const enriched = prepare.enrichCustomerLaunchRpcData(
    {
      outcome: "CREATED",
      plan_id: "11111111-1111-4111-8111-111111111111",
      status: "HELD",
      payload_hash: "a".repeat(64),
      objective: "OUTCOME_TRAFFIC",
      destination_url: "https://example.com/landing",
      target_status: "ACTIVE",
      budget_owner_type: "AD_SET",
      daily_budget_minor: "2000",
      campaign_name: "C",
      ad_set_name: "S",
      creative_name: "R",
      ad_name: "A",
    },
    {
      brandAssetId: parent,
      brandAssetIds: [parent, feed, story],
      budgetType: "DAILY",
      preparedAt: "2026-09-23T12:00:00.000Z",
    },
  );
  assert.deepEqual(enriched.brand_asset_ids, [parent, feed, story]);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Dynamic Creative multi-image contract tests passed.");
