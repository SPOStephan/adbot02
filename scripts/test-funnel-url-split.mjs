import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260923180000_launch_funnel_url_split.sql",
);
const migration = await readFile(migrationPath, "utf8");

assert.equal(
  (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan\(/g) || [])
    .length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan_v3\(/g) || [])
    .length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.approve_meta_launch_canary_plan\(/g) || [])
    .length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.approve_meta_lifetime_launch_canary_plan_v3\(/g) || [])
    .length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.reconcile_meta_launch_mutation_plan\(/g) || [])
    .length,
  1,
);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.match(migration, /v_variant_destination_url/);
assert.match(migration, /variant_destination_url muss HTTPS sein/);
assert.match(migration, /Funnel-Splittest erfordert 2 Ad Sets/);
assert.match(migration, /Meta-Experiment erfordert 2 Ad Sets/);
assert.match(migration, /Funnel B braucht eine andere URL als Funnel A/);
assert.match(migration, /variant_allowed_domain_id/);
assert.match(migration, /use_meta_experiment/);
assert.match(
  migration,
  /\{object_story_spec,link_data,link\}/,
);
assert.match(migration, /\{asset_feed_spec,link_urls\}/);
assert.match(migration, /website_url', v_variant_destination_url/);
assert.match(migration, /\{conversion_domain\}/);
assert.match(migration, /v_variant_domain.registrable_domain/);
assert.match(migration, /'variant_destination_url', v_variant_destination_url/);
assert.match(migration, /'use_meta_experiment', v_use_meta_experiment/);
assert.match(migration, /create-ad-set-paused-2/);

const traffic = await readFile(
  join(root, "src/components/TrafficLaunchCanary.tsx"),
  "utf8",
);
assert.match(traffic, /funnel_split/);
assert.match(traffic, /Funnel-Splittest/);
assert.match(traffic, /variantDestinationUrl/);
assert.match(traffic, /useMetaExperiment/);
assert.match(traffic, /\/api\/meta\/automation\/ad-study/);
assert.match(traffic, /Meta-Experiment erneut versuchen/);

const lead = await readFile(
  join(root, "src/components/LeadLaunchCanary.tsx"),
  "utf8",
);
assert.match(lead, /funnel_split/);
assert.match(lead, /Funnel-Splittest/);
assert.match(lead, /variantDestinationUrl/);
assert.match(lead, /useMetaExperiment/);
assert.match(lead, /\/api\/meta\/automation\/ad-study/);

const adStudyRoute = await readFile(
  join(root, "src/app/api/meta/automation/ad-study/route.ts"),
  "utf8",
);
assert.match(adStudyRoute, /readControlJson/);
assert.match(adStudyRoute, /parseAdStudyCommand/);
assert.match(adStudyRoute, /authenticateMetaCustomer/);
assert.match(adStudyRoute, /createFunnelSplitAdStudy/);
assert.doesNotMatch(adStudyRoute, /materialize_meta_organic_boost_plan/);

const adStudyService = await readFile(
  join(root, "src/lib/meta/ad-study.ts"),
  "utf8",
);
assert.match(adStudyService, /append_meta_mutation_audit_event/);
assert.match(adStudyService, /META_AD_STUDY_CREATED/);
assert.match(adStudyService, /\/ad_studies/);
assert.match(adStudyService, /create-ad-set-paused-2/);
assert.doesNotMatch(adStudyService, /event_type: "meta_ad_study_created"/);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-funnel-split-"));
try {
  const payloadSource = await readFile(
    join(root, "src/lib/meta/ad-study-payload.ts"),
    "utf8",
  );
  const payloadPath = join(temporaryDirectory, "ad-study-payload.mjs");
  await writeFile(payloadPath, transpile(payloadSource), "utf8");
  const payload = await import(pathToFileURL(payloadPath).href);

  const study = payload.buildSplitTestAdStudyPayload({
    name: "Sommer Funnel",
    description: "A vs B",
    startTimeUnix: 1_700_000_000,
    endTimeUnix: 1_700_000_000 + 7 * 24 * 60 * 60,
    adSetA: "111",
    adSetB: "222",
  });
  assert.equal(study.type, "SPLIT_TEST");
  assert.equal(study.cells.length, 2);
  assert.equal(study.cells[0].treatment_percentage, 50);
  assert.equal(study.cells[1].treatment_percentage, 50);
  assert.deepEqual(study.cells[0].adsets, ["111"]);
  assert.deepEqual(study.cells[1].adsets, ["222"]);

  assert.throws(
    () =>
      payload.buildSplitTestAdStudyPayload({
        name: "X",
        startTimeUnix: 10,
        endTimeUnix: 20,
        adSetA: "111",
        adSetB: "111",
      }),
    /zwei verschiedene Ad Sets/,
  );
  assert.throws(
    () =>
      payload.buildSplitTestAdStudyPayload({
        name: "X",
        startTimeUnix: 20,
        endTimeUnix: 10,
        adSetA: "111",
        adSetB: "222",
      }),
    /Zeitfenster/,
  );

  const inputSource = await readFile(
    join(root, "src/lib/meta/customer-control-input.ts"),
    "utf8",
  );
  const inputPath = join(temporaryDirectory, "customer-control-input.mjs");
  await writeFile(inputPath, transpile(inputSource), "utf8");
  const input = await import(pathToFileURL(inputPath).href);

  const ads = [
    { message: "Text A", name: "Headline A", description: "" },
    { message: "Text B", name: "Headline B", description: "Desc" },
  ];
  const baseDaily = {
    blueprintId: "11111111-1111-4111-8111-111111111111",
    brandAssetId: "22222222-2222-4222-8222-222222222222",
    allowedDomainId: "33333333-3333-4333-8333-333333333333",
    budgetOwnerType: "AD_SET",
    budgetType: "DAILY",
    dailyBudget: "20.00",
    destinationUrl: "https://example.com/funnel-a",
    reason: "Funnel-Splittest Vertrag prüfen",
    confirmation: "AKTIV-LAUNCH VORBEREITEN",
  };

  const omitted = input.parseLaunchCommand(baseDaily);
  assert.equal(omitted.launchInputs.variant_destination_url, undefined);
  assert.equal(omitted.launchInputs.use_meta_experiment, undefined);

  const split = input.parseLaunchCommand({
    ...baseDaily,
    structuralAdCount: 2,
    structuralAdSetCount: 2,
    structuralAds: ads,
    variantDestinationUrl: "https://example.com/funnel-b",
    useMetaExperiment: true,
  });
  assert.equal(split.launchInputs.structural_ad_set_count, 2);
  assert.equal(
    split.launchInputs.variant_destination_url,
    "https://example.com/funnel-b",
  );
  assert.equal(split.launchInputs.use_meta_experiment, true);

  const otherDomain = input.parseLaunchCommand({
    ...baseDaily,
    structuralAdCount: 2,
    structuralAdSetCount: 2,
    structuralAds: ads,
    variantDestinationUrl: "https://andere-domain.de/funnel-b",
    variantAllowedDomainId: "44444444-4444-4444-8444-444444444444",
  });
  assert.equal(
    otherDomain.launchInputs.variant_allowed_domain_id,
    "44444444-4444-4444-8444-444444444444",
  );

  const experimentOnly = input.parseLaunchCommand({
    ...baseDaily,
    structuralAdCount: 2,
    structuralAdSetCount: 2,
    structuralAds: ads,
    useMetaExperiment: true,
  });
  assert.equal(experimentOnly.launchInputs.use_meta_experiment, true);
  assert.equal(experimentOnly.launchInputs.variant_destination_url, undefined);

  assert.throws(
    () =>
      input.parseLaunchCommand({
        ...baseDaily,
        variantDestinationUrl: "https://example.com/funnel-b",
      }),
    /2 Ad Sets/,
  );
  assert.throws(
    () =>
      input.parseLaunchCommand({
        ...baseDaily,
        structuralAdCount: 2,
        structuralAds: ads,
        useMetaExperiment: true,
      }),
    /2 Ad Sets/,
  );
  assert.throws(
    () =>
      input.parseLaunchCommand({
        ...baseDaily,
        structuralAdCount: 2,
        structuralAdSetCount: 2,
        structuralAds: ads,
        variantDestinationUrl: "https://example.com/funnel-a",
      }),
    /andere URL/,
  );
  assert.throws(
    () =>
      input.parseLaunchCommand({
        ...baseDaily,
        structuralAdCount: 2,
        structuralAdSetCount: 2,
        structuralAds: ads,
        variantAllowedDomainId: "44444444-4444-4444-8444-444444444444",
      }),
    /Funnel-B-URL/,
  );

  const studyCommand = input.parseAdStudyCommand({
    planId: "55555555-5555-4555-8555-555555555555",
  });
  assert.equal(studyCommand.planId, "55555555-5555-4555-8555-555555555555");
  assert.throws(
    () =>
      input.parseAdStudyCommand({
        planId: "55555555-5555-4555-8555-555555555555",
        extra: true,
      }),
    /nicht erlaubtes Feld|nicht erlaubt/,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Funnel URL split contract tests passed.");
