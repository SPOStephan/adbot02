import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const types = read("src/lib/ad-examples/types.ts");
const input = read("src/lib/ad-examples/input.ts");
const service = read("src/lib/ad-examples/service.ts");
const api = read("src/app/api/admin/ad-examples/route.ts");
const page = read("src/app/dashboard/inspiration/page.tsx");
const client = read("src/components/AdExampleLibraryAdmin.tsx");
const upload = read("src/lib/media-library/upload.ts");
const preview = read("src/app/api/media-library/preview/route.ts");
const styleReferenceLoader = read("src/lib/creative-assets/style-reference-load.ts");
const sourceStrategy = read("docs/ad-examples/SOURCE_STRATEGY.md");

assert.match(types, /AD_EXAMPLE_PLATFORMS/);
assert.match(types, /AD_EXAMPLE_OBJECTIVES/);
assert.match(types, /AD_EXAMPLE_FUNNEL_STAGES/);
assert.match(types, /AD_EXAMPLE_EVIDENCE_LEVELS/);
assert.match(types, /AD_EXAMPLE_RIGHTS_BASES/);

assert.match(input, /rightsConfirmed/);
assert.match(input, /öffentliche HTTPS-URL/);
assert.match(input, /never_launch: true/);
assert.match(input, /use_for_generation/);
assert.match(input, /objective_detail/);
assert.match(types, /first_party_performance/);
assert.match(input, /rein visueller Evidenz dürfen keine Performancewerte/);

assert.match(api, /isSiteAdmin/);
assert.match(api, /isDashboardSameOriginRequest/);
assert.match(api, /uploadInspirationVaultImage/);
assert.match(api, /updateAdExample/);
assert.match(api, /removeAdExample/);
assert.match(service, /library_scope/);
assert.match(service, /INSPIRATION/);
assert.match(service, /status: "REVOKED"/);
assert.match(upload, /sanitizeAssetMetadata/);
assert.match(preview, /asset\.status === "REVOKED"/);
assert.match(styleReferenceLoader, /metadata\.library === "ad_example_library"/);
assert.match(styleReferenceLoader, /adExample\.use_for_generation === true/);

assert.match(page, /isSiteAdmin/);
assert.match(page, /AdExampleLibraryAdmin/);
assert.match(client, /Werbeziel/);
assert.match(client, /Branche/);
assert.match(client, /Zieldefinition/);
assert.match(client, /Evidenzniveau/);
assert.match(client, /Für Creative-Vorschläge freigeben/);
assert.match(client, /Nur die abstrahierten Muster/);
assert.match(client, /method: "PATCH"/);
assert.match(client, /method: "DELETE"/);

assert.match(sourceStrategy, /keine eigene öffentliche, durchsuchbare Bibliothek/);
assert.match(sourceStrategy, /chatgptadlibrary.com/);
assert.match(sourceStrategy, /Scraping der öffentlichen Oberflächen ist kein Ersatz/);
assert.match(sourceStrategy, /first_party_performance/);
assert.match(sourceStrategy, /Meta Ad Library/);
assert.match(sourceStrategy, /Google Ads Transparency Center/);
assert.match(sourceStrategy, /TikTok Commercial Content Library/);
assert.match(types, /chatgpt_ad_library/);
assert.match(client, /chatgptadlibrary.com/);
assert.match(client, /ExampleInsight/);
assert.match(client, /triggeringPrompts/);
assert.match(types, /isGenericAdExampleObjectiveDetail/);
assert.match(service, /triggering_prompts/);
assert.match(page, /ChatGPTAdLibraryImportPanel/);
assert.match(page, /AdLibraryCollectorSandbox/);
console.log("test-ad-example-library: ok");
