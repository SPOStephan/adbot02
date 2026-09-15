import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const crawlState = read("src/lib/chatgpt-ad-library/crawl-state.ts");
const scrape = read("src/lib/chatgpt-ad-library/scrape.ts");
const parseHtml = read("src/lib/chatgpt-ad-library/parse-html.ts");
const uploader = read("src/lib/chatgpt-ad-library/uploader.ts");
const cron = read("src/app/api/cron/chatgpt-ad-library-scrape/route.ts");
const adminCrawl = read("src/app/api/admin/chatgpt-ad-library/crawl/route.ts");
const panel = read("src/components/ChatGPTAdLibraryImportPanel.tsx");
const workflow = read(".github/workflows/chatgpt-ad-library-scrape.yml");
const script = read("scripts/chatgpt-ad-library-scrape-playwright.mjs");
const vercel = read("vercel.json");
const migration = read(
  "supabase/migrations/20260915140000_chatgpt_ad_library_crawl_state.sql",
);
const docs = read("docs/ad-examples/CHATGPT_AD_LIBRARY.md");
const constants = read("src/lib/chatgpt-ad-library/scrape-constants.ts");
const systemIdsTs = read("src/lib/chatgpt-ad-library/system-ids.ts");
const systemIdsJson = JSON.parse(read("fixtures/chatgpt-ad-library/system-ids.json"));

assert.match(constants, /CHATGPT_AD_LIBRARY_SCRAPE_BATCH_MAX = 5/);
assert.match(constants, /CHATGPT_AD_LIBRARY_PROBE_MAX_ID = 30_000/);
assert.match(crawlState, /planChatGPTAdLibraryScrapeBatch/);
assert.match(crawlState, /CHATGPT_AD_LIBRARY_SYSTEM_IDS/);
assert.match(crawlState, /next_probe_id/);
assert.match(crawlState, /pending_ids/);
assert.match(scrape, /bot_checkpoint_429/);
assert.match(scrape, /skippedPlan/);
assert.match(scrape, /discoverChatGPTAdLibraryIds/);
assert.match(scrape, /ingestChatGPTAdLibraryScrapeRecords/);
assert.match(parseHtml, /vercel security checkpoint/i);
assert.match(parseHtml, /extractAdIdsFromSitemapXml/);
assert.match(uploader, /CHATGPT_AD_LIBRARY_UPLOADER_USER_ID/);
assert.match(uploader, /site_admins/);
assert.match(cron, /CRON_SECRET/);
assert.match(cron, /mode=plan/);
assert.match(cron, /action === "ingest"/);
assert.match(cron, /action === "discover"/);
assert.doesNotMatch(cron, /xml_required/);
assert.match(adminCrawl, /isSiteAdmin/);
assert.match(adminCrawl, /set_enabled/);
assert.match(panel, /Wiederkehrender Scrape/);
assert.match(panel, /Auto-Scrape an/);
assert.match(panel, /In Queue legen/);
assert.match(panel, /nie kundensichtbar/);
assert.match(panel, /Systemkatalog/);
assert.match(panel, /Importierte ChatGPT-Ads/);
assert.match(adminCrawl, /isDashboardSameOriginReadRequest/);
assert.match(workflow, /17 \*\/2 \* \* \*/);
assert.match(workflow, /chatgpt-ad-library-scrape-playwright/);
assert.match(workflow, /ADBOT_APP_URL/);
assert.match(workflow, /CRON_SECRET/);
assert.match(workflow, /actions\/checkout@v5/);
assert.match(workflow, /actions\/setup-node@v5/);
assert.match(script, /BATCH_MAX = 5/);
assert.match(script, /chromium\.launch/);
assert.match(script, /action: "ingest"/);
assert.match(script, /loadSystemIds/);
assert.match(script, /discoverIdsHttp/);
assert.match(script, /mode=status/);
assert.match(script, /phase: "discover"/);
assert.match(script, /bot_checkpoint/);
assert.doesNotMatch(script, /discoverLibraryIds/);
assert.match(panel, /Systemkatalog/);
assert.match(vercel, /chatgpt-ad-library-scrape/);
assert.match(migration, /chatgpt_ad_library_crawl_state/);
assert.match(docs, /GitHub Action/);
assert.match(docs, /max\. 5|≤5/);
assert.match(docs, /skippedPlan|keine.*Queue-Entnahme/);

const fromTs = [...systemIdsTs.matchAll(/"(\d{1,12})"/g)].map((m) => m[1]);
assert.ok(fromTs.includes("7341"));
assert.deepEqual(fromTs, systemIdsJson);
assert.ok(systemIdsJson.length >= 40);

console.log("test-chatgpt-ad-library-scrape: ok");
