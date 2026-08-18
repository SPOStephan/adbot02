import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourcePath = join(root, "src/lib/meta/creative-text-variants.ts");
const source = await readFile(sourcePath, "utf8");

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-text-variants-"));
try {
  const modulePath = join(temporaryDirectory, "creative-text-variants.mjs");
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

  assert.equal(mod.MAX_CREATIVE_TEXT_VARIANTS, 5);
  assert.deepEqual(
    mod.normalizeCreativeTextVariants(["  A ", "A", "B", "", "C", "D", "E", "F"]),
    ["A", "B", "C", "D", "E"],
  );
  assert.deepEqual(
    mod.normalizeCreativeTextVariants([], { fallback: "Fallback" }),
    ["Fallback"],
  );

  const single = mod.buildLinkCreativeBlueprintParts({
    primaryTexts: ["Nur einer"],
    headlines: ["Titel"],
    descriptions: [""],
    callToActionType: "LEARN_MORE",
    defaultPrimary: "Mehr erfahren.",
    defaultHeadline: "Jetzt mehr erfahren",
  });
  assert.equal(single.useDynamicCreative, false);
  assert.equal(single.assetFeedSpec, null);
  assert.equal(single.objectStorySpec.link_data.message, "Nur einer");

  const multi = mod.buildLinkCreativeBlueprintParts({
    primaryTexts: ["Text 1", "Text 2"],
    headlines: ["H1", "H2", "H3"],
    descriptions: ["D1"],
    callToActionType: "LEARN_MORE",
    defaultPrimary: "Mehr erfahren.",
    defaultHeadline: "Jetzt mehr erfahren",
  });
  assert.equal(multi.useDynamicCreative, true);
  assert.ok(multi.assetFeedSpec);
  assert.deepEqual(multi.assetFeedSpec.ad_formats, ["SINGLE_IMAGE"]);
  assert.equal(multi.assetFeedSpec.bodies.length, 2);
  assert.equal(multi.assetFeedSpec.titles.length, 3);
  assert.equal(multi.assetFeedSpec.descriptions.length, 1);
  assert.deepEqual(multi.objectStorySpec, {});

  const traffic = await readFile(
    join(root, "src/components/TrafficLaunchCanary.tsx"),
    "utf8",
  );
  assert.match(traffic, /CreativeTextVariantFields/);
  assert.match(traffic, /buildLinkCreativeBlueprintParts/);
  assert.match(traffic, /is_dynamic_creative/);
  assert.match(traffic, /asset_feed_spec/);

  const lead = await readFile(
    join(root, "src/components/LeadLaunchCanary.tsx"),
    "utf8",
  );
  assert.match(lead, /CreativeTextVariantFields/);
  assert.match(lead, /asset_feed_spec/);

  const migration = await readFile(
    join(
      root,
      "supabase/migrations/20260818180000_launch_creative_text_variants.sql",
    ),
    "utf8",
  );
  assert.match(migration, /asset_feed_spec,images/);
  assert.match(migration, /asset_feed_spec,link_urls/);
  assert.match(migration, /is_dynamic_creative/);
  assert.equal(
    (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan\(/g) || []).length,
    1,
  );
  assert.equal(
    (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan_v3\(/g) || []).length,
    1,
  );
  assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);

  console.log("Creative text variants contract tests passed.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
