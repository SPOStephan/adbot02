import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

function transpile(paths) {
  const source = paths
    .map((path) => read(path))
    .join("\n")
    .replace(/^import[\s\S]*?;\n/gm, "");
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

const adapters = await import(
  `data:text/javascript;base64,${Buffer.from(
    transpile([
      "src/lib/campaign-geo/types.ts",
      "src/lib/campaign-geo/adapters.ts",
    ]),
  ).toString("base64")}`
);

const speyer = adapters.parseCampaignGeoTarget({
  placeLabel: "Speyer, Rheinland-Pfalz, Deutschland",
  placeKind: "city",
  countryCode: "DE",
  latitude: 49.317,
  longitude: 8.431,
  radiusKm: 40,
});
assert.ok(speyer);
assert.equal(adapters.effectiveRadiusKm(speyer), 40);
assert.deepEqual(adapters.toMetaAdSetTargeting(speyer), {
  geo_locations: {
    custom_locations: [
      {
        latitude: 49.317,
        longitude: 8.431,
        radius: 40,
        distance_unit: "kilometer",
      },
    ],
    location_types: ["home"],
  },
});
assert.deepEqual(adapters.toGoogleAdsProximity(speyer), {
  supported: true,
  mode: "proximity",
  latitude: 49.317,
  longitude: 8.431,
  radiusKm: 40,
});
assert.equal(adapters.toTikTokLocation(speyer).mode, "proximity");

const cityNoRadius = adapters.parseCampaignGeoTarget({
  place_label: "Speyer",
  place_kind: "city",
  country_code: "de",
  latitude: 49.317,
  longitude: 8.431,
  radius_km: null,
});
assert.equal(adapters.effectiveRadiusKm(cityNoRadius), 25);
assert.equal(
  adapters.toMetaAdSetTargeting(cityNoRadius).geo_locations.custom_locations[0]
    .radius,
  25,
);

const germany = adapters.parseCampaignGeoTarget({
  placeLabel: "Deutschland",
  placeKind: "country",
  countryCode: "DE",
  latitude: 51.165,
  longitude: 10.451,
  radiusKm: null,
});
assert.equal(adapters.effectiveRadiusKm(germany), null);
assert.deepEqual(adapters.toMetaAdSetTargeting(germany), {
  geo_locations: { countries: ["DE"] },
});
assert.deepEqual(adapters.toGoogleAdsProximity(germany), {
  supported: true,
  mode: "country",
  countryCode: "DE",
});

assert.deepEqual(adapters.toMetaAdSetTargeting(null), {
  geo_locations: { countries: ["DE"] },
});
assert.equal(adapters.fallbackCountryCode(null), "DE");
assert.equal(adapters.fallbackCountryCode(speyer), "DE");

assert.equal(adapters.parseRadiusKm(200), null);
assert.equal(adapters.parseRadiusKm(0), null);
assert.equal(adapters.parseRadiusKm("40"), 40);

const picked = adapters.pickOpenAILocationId(speyer, [
  { id: "loc-berlin", name: "Berlin", country_code: "DE" },
  { id: "loc-speyer", name: "Speyer", canonical_name: "Speyer, Germany", country_code: "DE" },
  { id: "loc-at", name: "Speyer", country_code: "AT" },
]);
assert.equal(picked, "loc-speyer");
assert.equal(
  adapters.pickOpenAILocationId(
    { ...speyer, openaiLocationId: "loc-saved" },
    [{ id: "loc-speyer", name: "Speyer" }],
  ),
  "loc-saved",
);

const migration = read(
  "supabase/migrations/20260925140000_customer_campaign_geo.sql",
);
assert.match(migration, /create table if not exists public\.customer_campaign_geo/);
assert.match(migration, /radius_km integer/);
assert.match(migration, /user_id = auth\.uid\(\)/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /kill_switch/);
assert.doesNotMatch(migration, /launch_freeze|FREEZE_WRITES/);

const nav = read("src/lib/dashboard/navigation.ts");
assert.match(nav, /href: "\/dashboard\/zielgruppen"/);

const pageCopy = read("src/lib/dashboard/page-copy.ts");
assert.match(pageCopy, /zielgruppen:/);

const traffic = read("src/components/TrafficLaunchCanary.tsx");
assert.match(traffic, /toMetaAdSetTargeting\(await fetchCampaignGeoTarget\(\)\)/);
assert.doesNotMatch(traffic, /materialize_meta_organic_boost_plan/);

const lead = read("src/components/LeadLaunchCanary.tsx");
assert.match(lead, /toMetaAdSetTargeting\(await fetchCampaignGeoTarget\(\)\)/);

const openaiForm = read("src/components/OpenAIAdsLaunchForm.tsx");
assert.match(openaiForm, /pickOpenAILocationId/);
assert.match(openaiForm, /fetchCampaignGeoTarget/);

const boost = read("src/components/AutomationBoostSettings.tsx");
assert.match(boost, /fallbackCountryCode\(geo\)/);

const launchPage = read("src/app/dashboard/traffic-launch/page.tsx");
assert.match(launchPage, /CampaignGeoTargetCard/);

const chatgptPage = read("src/app/dashboard/chatgpt-ads/page.tsx");
assert.match(chatgptPage, /CampaignGeoTargetCard/);

const zielgruppen = read("src/app/dashboard/zielgruppen/page.tsx");
assert.match(zielgruppen, /CampaignGeoTargetCard/);
assert.match(zielgruppen, /DASHBOARD_PAGE_COPY\.zielgruppen/);

const capabilities = adapters.PLATFORM_GEO_CAPABILITIES;
assert.equal(capabilities.find((item) => item.id === "meta").supportsRadius, true);
assert.equal(capabilities.find((item) => item.id === "openai_ads").supportsRadius, false);
assert.equal(capabilities.find((item) => item.id === "google").launchWired, false);
assert.equal(capabilities.find((item) => item.id === "tiktok").supportsRadius, true);

console.log("campaign-geo: ok");
