import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const migrationPath = join(
  root,
  "supabase/migrations/20260818200000_launch_structural_two_adsets.sql",
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
assert.match(migration, /structural_ad_set_count/);
assert.match(migration, /structural_ads/);
assert.match(migration, /validate-ad-set-2/);
assert.match(migration, /create-ad-set-paused-2/);
assert.match(migration, /read-ad-set-paused-2/);
assert.match(migration, /activate-ad-set-2/);
assert.match(migration, /read-ad-set-active-2/);
assert.match(migration, /validate-creative-2/);
assert.match(migration, /create-creative-2/);
assert.match(migration, /create-ad-paused-2/);
assert.match(migration, /activate-ad-2/);
assert.match(migration, /-s2\]/);
assert.match(migration, /-r2\]/);
assert.match(migration, /-a2\]/);
assert.match(migration, /not in \(20, 21, 28, 29, 33, 34\)/);
assert.match(migration, /step_key like 'create-ad-set-paused%'/);
assert.match(migration, /step_key like 'activate-ad-set%'/);
assert.match(migration, /step_key like 'create-ad-paused%'/);
assert.match(migration, /step_key like 'activate-ad%'/);
assert.match(migration, /hälftige Verteilung/);
assert.match(migration, /v_structural_ad_set_count = 2/);
assert.match(migration, /ad_sets/);

const traffic = await readFile(
  join(root, "src/components/TrafficLaunchCanary.tsx"),
  "utf8",
);
assert.match(traffic, /2 Ad Sets/);
assert.match(traffic, /structuralAdSetCount/);
assert.match(traffic, /structuralMode/);
assert.match(
  traffic,
  /Startbudget wird zunächst aufgeteilt; danach schichtet Adbot nach/,
);
assert.match(traffic, /Summe bleibt gleich/);
assert.match(traffic, /Erfolgsumschichtung/);
assert.match(traffic, /Anzeige 1/);
assert.match(traffic, /Anzeige 2/);

const lead = await readFile(
  join(root, "src/components/LeadLaunchCanary.tsx"),
  "utf8",
);
assert.match(lead, /2 Ad Sets/);
assert.match(lead, /structuralAdSetCount/);
assert.match(lead, /structuralMode/);
assert.match(
  lead,
  /Startbudget wird zunächst aufgeteilt; danach schichtet Adbot nach/,
);
assert.match(lead, /Summe bleibt gleich/);
assert.match(lead, /Erfolgsumschichtung/);

const inputSourcePath = join(root, "src/lib/meta/customer-control-input.ts");
const inputSource = await readFile(inputSourcePath, "utf8");
assert.match(inputSource, /structuralAdCount/);
assert.match(inputSource, /structuralAdSetCount/);
assert.match(inputSource, /structuralAds/);
assert.match(inputSource, /parseStructuralLaunchAds/);

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-structural-2as-"));
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

  const ads = [
    { message: "Text A", name: "Headline A", description: "" },
    { message: "Text B", name: "Headline B", description: "Desc" },
  ];

  const single = mod.parseLaunchCommand(baseDaily);
  assert.equal(single.launchInputs.structural_ad_count, undefined);
  assert.equal(single.launchInputs.structural_ad_set_count, undefined);

  const twoAds = mod.parseLaunchCommand({
    ...baseDaily,
    structuralAdCount: 2,
    structuralAds: ads,
  });
  assert.equal(twoAds.launchInputs.structural_ad_count, 2);
  assert.equal(twoAds.launchInputs.structural_ad_set_count, 1);
  assert.equal(twoAds.launchInputs.structural_ads.length, 2);

  const twoAdSets = mod.parseLaunchCommand({
    ...baseDaily,
    structuralAdCount: 2,
    structuralAdSetCount: 2,
    structuralAds: ads,
  });
  assert.equal(twoAdSets.launchInputs.structural_ad_count, 2);
  assert.equal(twoAdSets.launchInputs.structural_ad_set_count, 2);

  assert.throws(
    () =>
      mod.parseLaunchCommand({
        ...baseDaily,
        structuralAdCount: 1,
        structuralAdSetCount: 2,
      }),
    /2 Anzeigengruppen|structuralAdCount=2/,
  );

  assert.throws(
    () =>
      mod.parseLaunchCommand({
        ...baseDaily,
        dailyBudget: "1.50",
        structuralAdCount: 2,
        structuralAdSetCount: 2,
        structuralAds: ads,
      }),
    /mindestens 2,00 EUR/,
  );

  assert.throws(
    () =>
      mod.parseLaunchCommand({
        ...baseDaily,
        budgetOwnerType: "CAMPAIGN",
        structuralAdCount: 2,
        structuralAdSetCount: 2,
        structuralAds: ads,
      }),
    /AD_SET/,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Structural two-adsets contract tests passed.");
