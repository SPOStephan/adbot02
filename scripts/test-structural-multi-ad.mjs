import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const migrationPath = join(
  root,
  "supabase/migrations/20260818190000_launch_structural_multi_ad.sql",
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

assert.match(migration, /structural_ad_count/);
assert.match(migration, /structural_ads/);
assert.match(migration, /validate-creative-2/);
assert.match(migration, /create-creative-2/);
assert.match(migration, /read-creative-2/);
assert.match(migration, /validate-ad-paused-2/);
assert.match(migration, /create-ad-paused-2/);
assert.match(migration, /read-ad-paused-2/);
assert.match(migration, /activate-ad-2/);
assert.match(migration, /read-ad-active-2/);
assert.match(migration, /-r2\]/);
assert.match(migration, /-a2\]/);
assert.match(migration, /not in \(20, 21, 28, 29\)/);
assert.match(migration, /step_key like 'create-ad-paused%'/);
assert.match(migration, /step_key like 'activate-ad%'/);
assert.match(migration, /v_structural_ad_count = 2/);
assert.match(migration, /asset_feed_spec/);
assert.match(migration, /is_dynamic_creative/);

const traffic = await readFile(
  join(root, "src/components/TrafficLaunchCanary.tsx"),
  "utf8",
);
assert.match(traffic, /Struktur-Test: 2 Anzeigen/);
assert.match(traffic, /structuralAdCount/);
assert.match(traffic, /structuralAds/);
assert.match(traffic, /Anzeige 1/);
assert.match(traffic, /Anzeige 2/);
assert.match(traffic, /structuralMultiAd/);

const lead = await readFile(
  join(root, "src/components/LeadLaunchCanary.tsx"),
  "utf8",
);
assert.match(lead, /Struktur-Test: 2 Anzeigen/);
assert.match(lead, /structuralAdCount/);
assert.match(lead, /structuralAds/);

const inputSourcePath = join(root, "src/lib/meta/customer-control-input.ts");
const inputSource = await readFile(inputSourcePath, "utf8");
assert.match(inputSource, /structuralAdCount/);
assert.match(inputSource, /structuralAds/);
assert.match(inputSource, /parseStructuralLaunchAds/);

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-structural-"));
try {
  const modulePath = join(temporaryDirectory, "customer-control-input.mjs");
  await writeFile(
    modulePath,
    ts.transpileModule(inputSource, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf8",
  );
  const mod = await import(pathToFileURL(modulePath).href);

  const baseDaily = {
    blueprintId: "11111111-1111-4111-8111-111111111111",
    brandAssetId: "22222222-2222-4222-8222-222222222222",
    allowedDomainId: "33333333-3333-4333-8333-333333333333",
    budgetOwnerType: "AD_SET",
    budgetType: "DAILY",
    dailyBudget: "20.00",
    destinationUrl: "https://example.com/landing",
    reason: "Struktur-Test Vertrag prüfen",
    confirmation: "AKTIV-LAUNCH VORBEREITEN",
  };

  const single = mod.parseLaunchCommand(baseDaily);
  assert.equal(single.launchInputs.structural_ad_count, undefined);
  assert.equal(single.launchInputs.structural_ads, undefined);

  const multi = mod.parseLaunchCommand({
    ...baseDaily,
    structuralAdCount: 2,
    structuralAds: [
      { message: "Text A", name: "Headline A", description: "" },
      { message: "Text B", name: "Headline B", description: "Desc" },
    ],
  });
  assert.equal(multi.launchInputs.structural_ad_count, 2);
  assert.equal(multi.launchInputs.structural_ads.length, 2);
  assert.equal(multi.launchInputs.structural_ads[1].description, "Desc");

  assert.throws(
    () =>
      mod.parseLaunchCommand({
        ...baseDaily,
        structuralAdCount: 2,
        structuralAds: [{ message: "only one", name: "H" }],
      }),
    /zwei Textgruppen/,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Structural multi-ad contract tests passed.");
