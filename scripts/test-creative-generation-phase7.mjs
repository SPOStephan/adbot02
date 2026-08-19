import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260819200000_creative_generation_phase7_format_slots.sql",
);
const phase7DocPath = join(
  root,
  "docs/meta-automation/CREATIVE_GENERATION_PHASE7.md",
);
const packagePath = join(root, "package.json");
const helperPath = join(
  root,
  "src/lib/creative-assets/generated-meta-crops.ts",
);
const workerPath = join(root, "src/lib/creative-assets/worker.ts");
const formatSlotsTestPath = join(root, "scripts/test-meta-format-slots.mjs");
const providerDocPath = join(
  root,
  "docs/meta-automation/CREATIVE_ASSET_PROVIDER.md",
);

const migration = await readFile(migrationPath, "utf8");
const phase7Doc = await readFile(phase7DocPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const helper = await readFile(helperPath, "utf8");
const worker = await readFile(workerPath, "utf8");
const formatSlotsTest = await readFile(formatSlotsTestPath, "utf8");
const providerDoc = await readFile(providerDocPath, "utf8");
const migrationSha256 = createHash("sha256").update(migration).digest("hex");

assert.match(migration, /register_generated_meta_crop_asset/);
assert.match(migration, /generated_meta_crop/);
assert.match(migration, /meta_feed_1x1/);
assert.match(migration, /meta_feed_4x5/);
assert.match(migration, /meta_story_9x16/);
assert.match(migration, /parent_asset_id/);
assert.match(migration, /CREATIVE_ASSET_META_CROP_REGISTERED/);
assert.match(migration, /asset_role = 'GENERATED'/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);

assert.match(phase7Doc, /format-slot/);
assert.match(phase7Doc, /register_generated_meta_crop_asset/);
assert.match(phase7Doc, /performance_winner/);

assert.match(helper, /generateMetaCropsFromOriginal/);
assert.match(helper, /register_generated_meta_crop_asset/);
assert.match(helper, /presetsNeedingCrop/);

assert.match(worker, /registerGeneratedMetaFormatSlots/);
assert.match(worker, /format_slots/);
assert.match(worker, /crops_planned/);

assert.match(formatSlotsTest, /generated-meta-crops|format_slots|Phase 7/);
assert.match(providerDoc, /Phase 7|format.slot|Format-Slot/i);

assert.equal(
  packageJson.scripts["test:creative-generation-phase7"],
  "node scripts/test-creative-generation-phase7.mjs",
);
assert.match(
  packageJson.scripts["test:meta-all"],
  /test:creative-generation-phase7/,
);

console.log(
  JSON.stringify({
    ok: true,
    migrationSha256,
    migration:
      "supabase/migrations/20260819200000_creative_generation_phase7_format_slots.sql",
  }),
);
