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
  "supabase/migrations/20260819160000_creative_generation_phase5_style_refs.sql",
);
const phase5DocPath = join(
  root,
  "docs/meta-automation/CREATIVE_GENERATION_PHASE5.md",
);
const packagePath = join(root, "package.json");
const clientPath = join(root, "src/components/MediaLibraryClient.tsx");
const openrouterPath = join(
  root,
  "src/lib/creative-assets/providers/openrouter.ts",
);
const mapPath = join(root, "src/lib/creative-assets/map-generation-input.ts");
const sourceRoot = join(root, "src/lib/creative-assets");

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

const migration = await readFile(migrationPath, "utf8");
const phase5Doc = await readFile(phase5DocPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const client = await readFile(clientPath, "utf8");
const openrouter = await readFile(openrouterPath, "utf8");
const mapSource = await readFile(mapPath, "utf8");
const migrationSha256 = createHash("sha256").update(migration).digest("hex");

assert.match(migration, /creative_generation_style_references_allowed/);
assert.match(migration, /marked_good/);
assert.match(migration, /performance_winner/);
assert.match(migration, /INSPIRATION/);
assert.match(migration, /style reference_asset_ids are missing or not allowed/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);

assert.match(phase5Doc, /input_references/);
assert.match(phase5Doc, /reference_asset_ids/);
assert.match(client, /Style-Referenzen/);
assert.match(client, /genStyleIds/);
assert.match(openrouter, /input_references/);
assert.match(openrouter, /loadVerifiedStyleReferenceAssets/);
assert.match(mapSource, /PHASE5_MAX_STYLE_REFERENCES/);
assert.doesNotMatch(
  mapSource,
  /Style-Wiring sind noch nicht freigeschaltet/,
);

assert.equal(
  packageJson.scripts["test:creative-generation-phase5"],
  "node scripts/test-creative-generation-phase5.mjs",
);
assert.match(
  packageJson.scripts["test:meta-all"],
  /test:creative-generation-phase5/,
);

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-creative-generation-phase5-"),
);

try {
  const files = [
    ["types.ts", "types.mjs"],
    ["generation-contract.ts", "generation-contract.mjs"],
    ["locked-photo-constants.ts", "locked-photo-constants.mjs"],
    ["style-reference-constants.ts", "style-reference-constants.mjs"],
    ["map-generation-input.ts", "map-generation-input.mjs"],
  ];

  for (const [relative, outName] of files) {
    let source = await readFile(join(sourceRoot, relative), "utf8");
    source = source
      .replace('import "server-only";', "")
      .replaceAll('from "./types";', 'from "./types.mjs";')
      .replaceAll(
        'from "./generation-contract";',
        'from "./generation-contract.mjs";',
      )
      .replaceAll(
        'from "./locked-photo-constants";',
        'from "./locked-photo-constants.mjs";',
      )
      .replaceAll(
        'from "./style-reference-constants";',
        'from "./style-reference-constants.mjs";',
      );
    await writeFile(
      join(temporaryDirectory, outName),
      transpile(source),
      "utf8",
    );
  }

  const mapMod = await import(
    pathToFileURL(join(temporaryDirectory, "map-generation-input.mjs")).href
  );

  const refId = "10000000-0000-4000-8000-000000000088";
  const job = {
    jobId: "10000000-0000-4000-8000-000000000001",
    providerKey: "openrouter",
    providerModel: "google/gemini-2.5-flash-image",
    inputPayload: {
      contract_version: "adbot-creative-generation-v1",
      mode: "free",
      provider_key: "openrouter",
      model_id: "google/gemini-2.5-flash-image",
      prompt: "style transfer",
      reference_asset_ids: [refId],
      locked_photo_asset_ids: [],
      output: { mime_type: "image/png", aspect_hint: "1:1" },
    },
  };

  const mapped = mapMod.mapCreativeGenerationInputForExecution(job);
  assert.equal(mapped.reference_asset_ids.length, 1);

  await assert.rejects(
    async () =>
      mapMod.mapCreativeGenerationInputForExecution({
        ...job,
        inputPayload: {
          ...job.inputPayload,
          reference_asset_ids: [
            refId,
            "10000000-0000-4000-8000-000000000081",
            "10000000-0000-4000-8000-000000000082",
            "10000000-0000-4000-8000-000000000083",
            "10000000-0000-4000-8000-000000000084",
          ],
        },
      }),
    (error) => /Style-Referenzen|style_reference_limit/i.test(error.message),
  );

  console.log(
    JSON.stringify({
      ok: true,
      migrationSha256,
      migration:
        "supabase/migrations/20260819160000_creative_generation_phase5_style_refs.sql",
    }),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
