import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const types = read("src/lib/ad-examples/types.ts");
const input = read("src/lib/ad-examples/input.ts");
const service = read("src/lib/ad-examples/service.ts");
const normalize = read("src/lib/chatgpt-ad-library/normalize.ts");
const importService = read("src/lib/chatgpt-ad-library/import.ts");
const retrieval = read("src/lib/chatgpt-ad-library/retrieval.ts");
const importApi = read("src/app/api/admin/chatgpt-ad-library/import/route.ts");
const intelligenceApi = read(
  "src/app/api/admin/chatgpt-ad-library/intelligence/route.ts",
);
const page = read("src/app/dashboard/inspiration/page.tsx");
const panel = read("src/components/ChatGPTAdLibraryImportPanel.tsx");
const client = read("src/components/AdExampleLibraryAdmin.tsx");
const docs = read("docs/ad-examples/CHATGPT_AD_LIBRARY.md");
const sourceStrategy = read("docs/ad-examples/SOURCE_STRATEGY.md");
const migration = read(
  "supabase/migrations/20260915120000_chatgpt_ad_library_external_id_index.sql",
);
const fixture = read("fixtures/chatgpt-ad-library/seed.jsonl");
const styleReferenceLoader = read("src/lib/creative-assets/style-reference-load.ts");

assert.match(types, /chatgpt_ad_library/);
assert.match(input, /chatgpt_ad_library/);
assert.match(normalize, /useForGeneration: false/);
assert.match(normalize, /use_for_internal_intelligence: true/);
assert.match(normalize, /customer_visible: false/);
assert.match(normalize, /reference_only/);
assert.match(normalize, /kein Placeholder/);
assert.match(importService, /server-only/);
assert.match(importService, /sharp/);
assert.match(importService, /jpeg/);
assert.match(importService, /skipped_duplicate/);
assert.match(importService, /external_id/);
assert.match(importService, /uploadInspirationVaultImage/);
assert.match(retrieval, /use_for_internal_intelligence/);
assert.match(retrieval, /customerVisible: false/);
assert.match(importApi, /isSiteAdmin/);
assert.match(importApi, /isDashboardSameOriginRequest/);
assert.match(importApi, /isDashboardSameOriginReadRequest/);
assert.match(importApi, /importChatGPTAdLibraryBatch/);
assert.match(intelligenceApi, /isSiteAdmin/);
assert.match(intelligenceApi, /loadChatGPTAdLibraryForInternalIntelligence/);
assert.match(page, /ChatGPTAdLibraryImportPanel/);
assert.match(page, /initialHits/);
assert.match(page, /getChatGPTAdLibraryCrawlStatus/);
assert.match(page, /loadChatGPTAdLibraryForInternalIntelligence/);
assert.match(panel, /Wiederkehrender Scrape/);
assert.match(panel, /nie kundensichtbar/);
assert.match(panel, /Auto-Scrape an/);
assert.match(panel, /Importierte ChatGPT-Ads/);
assert.match(panel, /Letzter Lauf/);
assert.match(panel, /GlossGenius-Seed jetzt importieren/);
assert.match(panel, /SCRAPINGBEE_API_KEY/);
assert.match(panel, /Unlocker-Probe #7341/);
assert.match(docs, /keine 50 USD/);
assert.match(docs, /Trial, 1000 Credits/);
const seedTs = read("src/lib/chatgpt-ad-library/seed-records.ts");
assert.match(seedTs, /14fdb811b3d1c4b284228434b2635206f04c8e55b21db949e0ccb3b82afd5cf9/);
assert.match(seedTs, /7341/);
assert.match(client, /chatgptadlibrary.com/);
assert.match(docs, /Niemals kunden/);
assert.match(docs, /chatgptadlibrary.com/);
assert.match(docs, /GitHub Action/);
assert.match(docs, /Systemkatalog/);
assert.match(client, /chatgptadlibrary\.com/);
assert.match(page, /ChatGPTAdLibraryImportPanel/);
assert.match(sourceStrategy, /chatgptadlibrary\.com/);
assert.match(sourceStrategy, /Scraping der öffentlichen Oberflächen ist kein Ersatz/);
assert.match(sourceStrategy, /first_party_performance/);
assert.match(sourceStrategy, /Meta Ad Library/);
assert.match(migration, /chatgptadlibrary\.com/);
assert.match(fixture, /GlossGenius/);
assert.match(fixture, /img\.chatgptadlibrary\.com/);
assert.match(styleReferenceLoader, /adExample\.use_for_generation === true/);
assert.match(service, /external_source/);

// Normalize fixture row shape
const seed = JSON.parse(fixture.trim().split("\n")[0]);
assert.equal(typeof seed.id, "number");
assert.match(seed.imageUrl, /^https:\/\/img\.chatgptadlibrary\.com\/c\/[0-9a-f]{2}\/[0-9a-f]+\.webp$/i);

console.log("test-chatgpt-ad-library: ok");
