import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260820200000_creative_generation_phase8_performance_winners.sql",
);
const phase8DocPath = join(
  root,
  "docs/meta-automation/CREATIVE_GENERATION_PHASE8.md",
);
const phase7DocPath = join(
  root,
  "docs/meta-automation/CREATIVE_GENERATION_PHASE7.md",
);
const packagePath = join(root, "package.json");
const syncPath = join(root, "src/lib/meta/marketing-sync.ts");
const providerDocPath = join(
  root,
  "docs/meta-automation/CREATIVE_ASSET_PROVIDER.md",
);
const phase1Path = join(
  root,
  "supabase/migrations/20260818230000_creative_generation_phase1_contract.sql",
);

const migration = await readFile(migrationPath, "utf8");
const phase8Doc = await readFile(phase8DocPath, "utf8");
const phase7Doc = await readFile(phase7DocPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const sync = await readFile(syncPath, "utf8");
const providerDoc = await readFile(providerDocPath, "utf8");
const phase1 = await readFile(phase1Path, "utf8");
const migrationSha256 = createHash("sha256").update(migration).digest("hex");

assert.match(migration, /merge_meta_creative_media_fields/);
assert.match(migration, /apply_brand_asset_performance_winners/);
assert.match(migration, /image_hash/);
assert.match(migration, /performance_winner/);
assert.match(migration, /marked_good/);
assert.match(migration, /BRAND_ASSET_PERFORMANCE_WINNERS_APPLIED/);
assert.match(migration, /meta_image_hash/);
assert.match(migration, /source_meta_asset_id/);
assert.match(migration, /inline_link_clicks/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /mark_brand_asset_training_status/);

assert.match(phase1, /Customers may only set marked_good or clear to none/);

assert.match(phase8Doc, /performance_winner/);
assert.match(phase8Doc, /merge_meta_creative_media_fields/);
assert.match(phase8Doc, /top \*\*5\*\*|top 5|Top \*\*5\*\*/i);

assert.match(phase7Doc, /Phase 8|performance_winner/);

assert.match(sync, /merge_meta_creative_media_fields/);
assert.match(sync, /apply_brand_asset_performance_winners/);
assert.match(sync, /serializeCreatives/);

assert.match(providerDoc, /Phase 8|performance_winner/i);

assert.equal(
  packageJson.scripts["test:creative-generation-phase8"],
  "node scripts/test-creative-generation-phase8.mjs",
);
assert.match(
  packageJson.scripts["test:meta-all"],
  /test:creative-generation-phase8/,
);

console.log(
  JSON.stringify({
    ok: true,
    migrationSha256,
    migration:
      "supabase/migrations/20260820200000_creative_generation_phase8_performance_winners.sql",
  }),
);
