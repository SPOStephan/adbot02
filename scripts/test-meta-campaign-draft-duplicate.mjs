import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(new URL("..", import.meta.url).pathname);
const read = (path) => readFile(join(root, path), "utf8");

const duplicate = await import(
  join(root, "src/lib/meta/campaign-draft-duplicate.ts")
);

const ASSET_A = "11111111-1111-4111-8111-111111111111";
const ASSET_B = "22222222-2222-4222-8222-222222222222";
const PIXEL_ROW = "33333333-3333-4333-8333-333333333333";

assert.equal(
  duplicate.stripLaunchTrackingSuffix("Boncred Vertrieb Immo02_01 [0123456789ab-c]"),
  "Boncred Vertrieb Immo02_01",
);
assert.equal(
  duplicate.duplicateCampaignName("Boncred Vertrieb Immo02_01"),
  "Boncred Vertrieb Immo02_01 (Kopie)",
);
assert.equal(
  duplicate.duplicateCampaignName("Boncred (Kopie)"),
  "Boncred (Kopie)",
  "a copy of a copy keeps one suffix",
);

const dcoPlan = {
  destination_url: "https://funnel.adbot.one/f/immo02",
  daily_budget_minor: 2500,
  brand_asset_ids: [ASSET_A, ASSET_B, "not-a-uuid"],
  campaign: {
    name: "Boncred Vertrieb Immo02_01 [0123456789ab-c]",
    special_ad_categories: [],
  },
  ad_set: {
    optimization_goal: "OFFSITE_CONVERSIONS",
    promoted_object: { pixel_id: "1234567890" },
  },
  creative: {
    object_story_spec: { page_id: "998877" },
    asset_feed_spec: {
      bodies: [{ text: "Text A" }, { text: "Text B" }],
      titles: [{ text: "Titel A" }],
      descriptions: [{ text: "Beschreibung" }],
    },
  },
};

const rebuilt = duplicate.draftPayloadFromLaunchPlan(dcoPlan, { pixelRowId: PIXEL_ROW });
assert.equal(rebuilt.campaignName, "Boncred Vertrieb Immo02_01");
assert.equal(rebuilt.destinationUrl, dcoPlan.destination_url);
assert.equal(rebuilt.adCategory, "standard");
assert.equal(rebuilt.dailyBudget, "25.00");
assert.equal(rebuilt.facebookPageId, "998877");
assert.deepEqual(rebuilt.primaryTexts, ["Text A", "Text B"]);
assert.deepEqual(rebuilt.headlines, ["Titel A"]);
assert.deepEqual(rebuilt.descriptions, ["Beschreibung"]);
assert.equal(rebuilt.structuralMode, "off");
assert.equal(rebuilt.dynamicCreativeImages, true);
assert.equal(rebuilt.assetId, ASSET_A);
assert.deepEqual(rebuilt.extraAssetIds, [ASSET_B]);
assert.equal(rebuilt.pixelRowId, PIXEL_ROW);
assert.equal(rebuilt.performanceGoal, "volume");
assert.equal(rebuilt.geo, null, "the copy must not silently reuse the source targeting");

const structuralPlan = {
  destination_url: "https://funnel.adbot.one/f/a",
  variant_destination_url: "https://funnel.adbot.one/f/b",
  daily_budget_minor: 1000,
  brand_asset_ids: [ASSET_A],
  structural_ad_count: 2,
  structural_ad_set_count: 2,
  use_meta_experiment: true,
  campaign: { name: "Jobs", special_ad_categories: ["EMPLOYMENT"] },
  ad_set: { optimization_goal: "QUALITY_LEAD" },
  creatives: [
    { object_story_spec: { link_data: { message: "Eins", name: "H1", description: "" } } },
    { object_story_spec: { link_data: { message: "Zwei", name: "H2", description: "D2" } } },
  ],
};
const structural = duplicate.draftPayloadFromLaunchPlan(structuralPlan);
assert.equal(structural.adCategory, "employment");
assert.equal(structural.structuralMode, "funnel_split");
assert.equal(structural.variantDestinationUrl, structuralPlan.variant_destination_url);
assert.equal(structural.useMetaExperiment, true);
assert.deepEqual(structural.primaryTexts, ["Eins"]);
assert.equal(structural.ad2Primary, "Zwei");
assert.equal(structural.ad2Headline, "H2");
assert.equal(structural.ad2Description, "D2");
assert.equal(structural.performanceGoal, "quality");
assert.equal(structural.pixelRowId, "");
assert.deepEqual(structural.extraAssetIds, []);

assert.equal(duplicate.draftPayloadFromLaunchPlan({ destination_url: "http://x" }), null);
assert.equal(duplicate.draftPayloadFromLaunchPlan(null), null);

const drafts = [
  { campaign_name: "Andere", destination_url: dcoPlan.destination_url, payload: 1 },
  { campaign_name: "Boncred Vertrieb Immo02_01", destination_url: dcoPlan.destination_url, payload: 2 },
  { campaign_name: "Boncred Vertrieb Immo02_01", destination_url: dcoPlan.destination_url, payload: 3 },
];
assert.equal(duplicate.matchLaunchedDraft(dcoPlan, drafts)?.payload, 2, "newest matching draft wins");
assert.equal(
  duplicate.matchLaunchedDraft({ ...dcoPlan, destination_url: "https://other.example/f/x" }, drafts),
  null,
);

const geo = {
  placeLabel: "Deutschland",
  placeKind: "country",
  countryCode: "DE",
  latitude: null,
  longitude: null,
  radiusKm: null,
  openaiLocationId: null,
  metaLocationKey: null,
};
const source = { ...rebuilt, geo };
const copy = duplicate.duplicateDraftPayload(source);
assert.equal(copy.campaignName, "Boncred Vertrieb Immo02_01 (Kopie)");
assert.deepEqual(copy.primaryTexts, source.primaryTexts);
assert.notEqual(copy.primaryTexts, source.primaryTexts, "copy must not share arrays");
assert.notEqual(copy.geo, source.geo);
assert.equal(source.campaignName, "Boncred Vertrieb Immo02_01", "source stays unchanged");

const service = await read("src/lib/meta/campaign-draft-service.ts");
assert.match(service, /export async function duplicateMetaCampaignAsDraft/);
assert.match(service, /\.eq\("object_type", "CAMPAIGN"\)/);
assert.match(service, /\.eq\("platform_account_id", customer\.platformAccountId\)/);
assert.match(service, /plan\.source_rule_key !== "active-launch-chain"/);
assert.match(service, /draftId: null,\s*revision: 1,/);
assert.doesNotMatch(
  service.slice(service.indexOf("duplicateMetaCampaignAsDraft")),
  /meta\/write-client|mutation_plans"\)\s*\.(insert|update)/,
  "duplicating must never write to Meta or create launch plans",
);

const route = await read("src/app/api/meta/automation/campaign-draft/duplicate/route.ts");
assert.match(route, /readControlJson\(request\)/);
assert.match(route, /authenticateMetaCustomer\(\)/);

const card = await read("src/components/CampaignAdOverview.tsx");
assert.match(card, /item\.launchedByAdbot && item\.kind === "lead"/);
assert.match(card, /MetaCampaignDuplicateButton/);

const button = await read("src/components/MetaCampaignDuplicateButton.tsx");
assert.match(button, /Als Vorlage duplizieren/);
assert.match(button, /draftId=\$\{encodeURIComponent\(result\.draftId\)\}&kopie=1/);

const launchPage = await read("src/app/dashboard/traffic-launch/page.tsx");
assert.match(launchPage, /query\.kopie === "1"/);

console.log("meta-campaign-draft-duplicate: ok");
