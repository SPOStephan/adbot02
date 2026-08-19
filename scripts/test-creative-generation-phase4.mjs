import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260819140000_creative_generation_phase4_media_ui.sql",
);
const phase4DocPath = join(
  root,
  "docs/meta-automation/CREATIVE_GENERATION_PHASE4.md",
);
const packagePath = join(root, "package.json");
const clientPath = join(root, "src/components/MediaLibraryClient.tsx");
const pagePath = join(root, "src/app/dashboard/creatives/page.tsx");
const configRoutePath = join(
  root,
  "src/app/api/meta/automation/creative-assets/config/route.ts",
);
const trainingRoutePath = join(
  root,
  "src/app/api/media-library/training-status/route.ts",
);
const lockedRoutePath = join(
  root,
  "src/app/api/media-library/locked-photo/route.ts",
);
const envPath = join(root, "src/lib/creative-assets/env.ts");

const migration = await readFile(migrationPath, "utf8");
const phase4Doc = await readFile(phase4DocPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const client = await readFile(clientPath, "utf8");
const page = await readFile(pagePath, "utf8");
const configRoute = await readFile(configRoutePath, "utf8");
const trainingRoute = await readFile(trainingRoutePath, "utf8");
const lockedRoute = await readFile(lockedRoutePath, "utf8");
const envSource = await readFile(envPath, "utf8");
const migrationSha256 = createHash("sha256").update(migration).digest("hex");

assert.match(migration, /set_brand_asset_locked_photo_role/);
assert.match(migration, /LOCKED_PHOTO/);
assert.match(migration, /UPLOAD_EDITABLE/);
assert.match(migration, /grant execute on function public\.set_brand_asset_locked_photo_role/);
assert.match(migration, /to authenticated, service_role/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /materialize_meta_launch_chain_plan/);

assert.match(phase4Doc, /Media Library/);
assert.match(phase4Doc, /locked_photo|LOCKED_PHOTO/);
assert.match(phase4Doc, /marked_good/);

assert.match(client, /KI-Creative erzeugen/);
assert.match(client, /creative-assets\/enqueue/);
assert.match(client, /media-library\/training-status/);
assert.match(client, /media-library\/locked-photo/);
assert.match(client, /mode: genMode/);
assert.match(client, /locked_photo/);

assert.match(page, /assetRole:/);
assert.match(page, /trainingStatus:/);
assert.match(page, /asset_role/);
assert.match(page, /training_status/);

assert.match(configRoute, /getPublicCreativeGenerationConfig/);
assert.match(configRoute, /authenticateMetaCustomer/);
assert.doesNotMatch(configRoute, /OPENROUTER_API_KEY|apiKey/);

assert.match(trainingRoute, /mark_brand_asset_training_status/);
assert.match(lockedRoute, /set_brand_asset_locked_photo_role/);

assert.match(envSource, /getPublicCreativeGenerationConfig/);

assert.equal(
  packageJson.scripts["test:creative-generation-phase4"],
  "node scripts/test-creative-generation-phase4.mjs",
);
assert.match(
  packageJson.scripts["test:meta-all"],
  /test:creative-generation-phase4/,
);

// Transpile env helper snippet for configured=false behavior without secrets.
const stubbed = envSource
  .replace('import "server-only";', "")
  .replace(
    /import type \{[^}]+\} from "\.\/http-provider";/,
    "",
  )
  .replace(
    /import type \{[^}]+\} from "\.\/providers\/openrouter";/,
    "",
  );

const transpiled = ts.transpileModule(stubbed, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

assert.match(transpiled, /getPublicCreativeGenerationConfig/);
assert.match(client, /assetRole/);
assert.match(client, /trainingStatus/);

console.log(
  JSON.stringify({
    ok: true,
    migrationSha256,
    migration:
      "supabase/migrations/20260819140000_creative_generation_phase4_media_ui.sql",
  }),
);
