import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260818230000_creative_generation_phase1_contract.sql",
);
const contractPath = join(
  root,
  "src/lib/creative-assets/generation-contract.ts",
);
const columnsPath = join(
  root,
  "src/lib/media-library/customer-asset-columns.ts",
);
const packagePath = join(root, "package.json");

const migration = await readFile(migrationPath, "utf8");
const columnsSource = await readFile(columnsPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

const migrationSha256 = createHash("sha256").update(migration).digest("hex");

assert.match(migration, /add column if not exists asset_role/);
assert.match(migration, /LOCKED_PHOTO/);
assert.match(migration, /UPLOAD_EDITABLE/);
assert.match(migration, /GENERATED/);
assert.match(migration, /STYLE_REFERENCE/);
assert.match(migration, /training_status/);
assert.match(migration, /marked_good_at/);
assert.match(migration, /marked_good_by/);
assert.match(migration, /style_notes/);
assert.match(migration, /brand_assets_locked_photo_customer_check/);
assert.match(migration, /brand_assets_inspiration_style_reference_check/);
assert.match(
  migration,
  /create or replace function public\.creative_generation_input_contract_valid/,
);
assert.match(migration, /adbot-creative-generation-v1/);
assert.match(migration, /mark_brand_asset_training_status/);
assert.match(
  migration,
  /grant select \(\s*asset_role,\s*training_status,\s*marked_good_at,\s*marked_good_by,\s*style_notes\s*\) on table public\.brand_assets to authenticated/s,
);
assert.match(migration, /asset_role = 'STYLE_REFERENCE'/);
assert.doesNotMatch(migration, /openrouter\.ai|fetch\(|http\.request/i);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /materialize_meta_launch_chain_plan/);

assert.match(columnsSource, /"asset_role"/);
assert.match(columnsSource, /"training_status"/);
assert.match(columnsSource, /"marked_good_at"/);
assert.match(columnsSource, /"marked_good_by"/);
assert.match(columnsSource, /"style_notes"/);
assert.match(columnsSource, /asset_role/);
assert.match(columnsSource, /training_status/);

assert.equal(
  packageJson.scripts["test:creative-generation-phase1"],
  "node scripts/test-creative-generation-phase1.mjs",
);
assert.match(
  packageJson.scripts["test:meta-all"],
  /test:creative-generation-phase1/,
);

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-creative-generation-phase1-"),
);
try {
  const modulePath = join(temporaryDirectory, "generation-contract.mjs");
  const source = await readFile(contractPath, "utf8");
  await writeFile(
    modulePath,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf8",
  );
  const mod = await import(pathToFileURL(modulePath).href);

  assert.equal(
    mod.CREATIVE_GENERATION_CONTRACT_VERSION,
    "adbot-creative-generation-v1",
  );
  assert.deepEqual(mod.CREATIVE_GENERATION_MODES, ["free", "locked_photo"]);
  assert.ok(mod.BRAND_ASSET_ROLES.includes("LOCKED_PHOTO"));
  assert.ok(mod.BRAND_ASSET_TRAINING_STATUSES.includes("marked_good"));

  const free = mod.buildCreativeGenerationInput({
    mode: "free",
    provider_key: "openrouter",
    model_id: "google/gemini-2.5-flash-image",
    prompt: "clean product shot",
    reference_asset_ids: ["11111111-1111-1111-1111-111111111111"],
    output: { mime_type: "image/png", aspect_hint: "1:1" },
  });
  assert.equal(free.contract_version, "adbot-creative-generation-v1");
  assert.equal(free.locked_photo_asset_ids.length, 0);
  assert.equal(free.provider_key, "openrouter");

  const locked = mod.buildCreativeGenerationInput({
    mode: "locked_photo",
    provider_key: "http",
    model_id: "vendor/model-a",
    locked_photo_asset_ids: ["22222222-2222-2222-2222-222222222222"],
    output: { mime_type: "image/jpeg" },
  });
  assert.equal(locked.mode, "locked_photo");
  assert.equal(locked.locked_photo_asset_ids.length, 1);

  assert.throws(
    () =>
      mod.buildCreativeGenerationInput({
        mode: "locked_photo",
        provider_key: "openrouter",
        model_id: "x",
        output: { mime_type: "image/png" },
      }),
    /locked_photo/,
  );

  assert.throws(
    () =>
      mod.buildCreativeGenerationInput({
        mode: "free",
        provider_key: "OpenRouter",
        model_id: "x",
        output: { mime_type: "image/png" },
      }),
    /provider_key/,
  );

  assert.throws(
    () =>
      mod.assertCreativeGenerationInput({
        contract_version: "adbot-creative-generation-v1",
        mode: "free",
        provider_key: "openrouter",
        model_id: "x",
        reference_asset_ids: [],
        locked_photo_asset_ids: [],
        output: { mime_type: "image/png" },
        api_key: "secret",
      }),
    /sensitive/i,
  );

  assert.equal(
    mod.isCreativeGenerationInput({
      contract_version: "adbot-creative-generation-v1",
      mode: "free",
      provider_key: "openrouter",
      model_id: "m",
      reference_asset_ids: [],
      locked_photo_asset_ids: [],
      output: { mime_type: "image/png" },
    }),
    true,
  );

  console.log(
    `Creative generation phase1 contract tests passed. migration_sha256=${migrationSha256}`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
