import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(new URL("..", import.meta.url).pathname);
const read = (path) => readFile(join(root, path), "utf8");

const validPayload = {
  campaignName: "Boncred Vertrieb",
  destinationUrl: "https://funnel.adbot.one/f/vertrieb01",
  adCategory: "employment",
  dailyBudget: "20.",
  facebookPageId: "123456789",
  instagramActorId: "987654321",
  primaryTexts: ["Jetzt bewerben."],
  headlines: ["Vertrieb gesucht"],
  descriptions: [""],
  structuralMode: "off",
  variantDestinationUrl: "",
  useMetaExperiment: false,
  dynamicCreativeImages: true,
  includeFormatSiblings: true,
  assetId: "11111111-1111-4111-8111-111111111111",
  extraAssetIds: ["22222222-2222-4222-8222-222222222222"],
  ad2Primary: "Variante B",
  ad2Headline: "Mehr erfahren",
  ad2Description: "",
  pixelRowId: "33333333-3333-4333-8333-333333333333",
  performanceGoal: "volume",
  geo: {
    placeLabel: "Speyer",
    placeKind: "city",
    countryCode: "de",
    latitude: 49.3173,
    longitude: 8.4412,
    radiusKm: 17,
    openaiLocationId: null,
    metaLocationKey: null,
  },
};

const temp = await mkdtemp(join(tmpdir(), "adbot-campaign-draft-"));
try {
  const source = (await read("src/lib/meta/campaign-draft.ts")).replace(
    /import \{\s*CAMPAIGN_GEO_PLACE_KINDS,[\s\S]*?\} from "@\/lib\/campaign-geo\/types";/,
    'const CAMPAIGN_GEO_PLACE_KINDS = ["country", "region", "city", "other"] as const;',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modulePath = join(temp, "campaign-draft.mjs");
  await writeFile(modulePath, compiled);
  const draft = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

  const normalized = draft.normalizeMetaCampaignDraftPayload(validPayload);
  assert.equal(normalized.dailyBudget, "20.", "unfinished numeric input must remain resumable");
  assert.equal(normalized.geo.countryCode, "DE");
  assert.equal(normalized.extraAssetIds.length, 1);
  assert.throws(
    () => draft.normalizeMetaCampaignDraftPayload({ ...validPayload, facebookPageId: "not-meta" }),
    /Facebook-Seite/,
  );
  assert.throws(
    () => draft.normalizeMetaCampaignDraftPayload({
      ...validPayload,
      extraAssetIds: Array.from({ length: 10 }, (_, index) =>
        `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
      ),
    }),
    /weiteren Motive/,
  );

  const assetSource = await read("src/lib/meta/campaign-draft-assets.ts");
  const assetCompiled = ts.transpileModule(assetSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const assetModulePath = join(temp, "campaign-draft-assets.mjs");
  await writeFile(assetModulePath, assetCompiled);
  const draftAssets = await import(
    `${pathToFileURL(assetModulePath).href}?v=${Date.now()}`
  );
  const preferredIds = draftAssets.campaignDraftAssetIds(validPayload);
  assert.deepEqual(preferredIds, [validPayload.assetId, ...validPayload.extraAssetIds]);
  const recovered = [
    {
      id: validPayload.extraAssetIds[0],
      original_filename: "story.png",
      width: 1080,
      height: 1920,
      metadata: { meta_format_key: "story_9_16" },
    },
    {
      id: validPayload.assetId,
      original_filename: "feed.png",
      width: 1080,
      height: 1080,
      metadata: { meta_format_key: "feed_1_1" },
    },
  ].map(draftAssets.toReadyBrandAssetView);
  const rehydrated = draftAssets.mergeDraftAssetsIntoLibrary(
    [],
    recovered,
    preferredIds,
  );
  assert.deepEqual(
    rehydrated.map((asset) => asset.id),
    preferredIds,
    "all selected draft assets must reappear in their saved order after reload",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}

const migration = await read("supabase/migrations/20260928072000_meta_campaign_drafts.sql");
assert.match(migration, /create table if not exists public\.meta_campaign_drafts/);
assert.match(migration, /and d\.revision < p_revision/);
assert.match(migration, /and d\.user_id = p_user_id/);
assert.match(migration, /and d\.platform_account_id = p_platform_account_id/);
assert.match(migration, /p_status not in \('LAUNCHED', 'ARCHIVED'\)/);

const hook = await read("src/lib/meta/use-campaign-draft-autosave.ts");
assert.match(hook, /window\.setTimeout\(\(\) => \{/);
assert.match(hook, /\}, 700\)/);
assert.match(hook, /queueRef\.current\.then\(perform, perform\)/);
assert.match(hook, /const markLaunched/);

const launch = await read("src/components/LeadLaunchCanary.tsx");
assert.match(launch, /useCampaignDraftAutosave/);
assert.equal((launch.match(/Entwurf sichern/g) ?? []).length, 2);
assert.equal((launch.match(/onClick=\{saveCampaignDraftManually\}/g) ?? []).length, 2);
assert.match(launch, /await ensureCampaignLaunchPolicy\(\)/);
assert.doesNotMatch(launch, />Kampagnenstart freigeben</);

const campaigns = await read("src/app/dashboard/kampagnen/page.tsx");
assert.match(campaigns, /id="entwuerfe"/);
assert.match(campaigns, /MetaCampaignDraftActions/);
assert.match(campaigns, /draftId=\{draft\.id\}/);

const draftActions = await read("src/components/MetaCampaignDraftActions.tsx");
assert.match(draftActions, /Bearbeitung fortsetzen/);
assert.match(draftActions, /Entwurf löschen/);
assert.match(draftActions, /window\.confirm/);
assert.match(draftActions, /status: "ARCHIVED"/);
assert.match(draftActions, /router\.refresh\(\)/);

const draftRoute = await read(
  "src/app/api/meta/automation/campaign-draft/route.ts",
);
assert.match(draftRoute, /getMetaCampaignDraftDestination/);
assert.match(draftRoute, /releaseUnstartedCustomerLaunchReservations/);
assert.doesNotMatch(draftRoute, /releaseStaleAcrossAccount/);

const dashboard = await read("src/lib/dashboard/load-customer-dashboard.ts");
assert.match(
  dashboard,
  /createAdminClient\(\)\s*\.from\("brand_assets"\)\s*\.select\([\s\S]*?metadata/,
  "server-side library load must not use the browser role for the restricted metadata column",
);

const launchPage = await read("src/app/dashboard/traffic-launch/page.tsx");
assert.match(launchPage, /campaignDraftAssetIds\(initialDraft\.payload\)/);
assert.match(launchPage, /\.in\("id", draftAssetIds\)/);
assert.match(launchPage, /data=\{draftOnboardingData\}/);

console.log("meta-campaign-drafts: ok");
