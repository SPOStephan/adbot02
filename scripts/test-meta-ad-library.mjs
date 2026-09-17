import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function stripImports(source) {
  return source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm, "");
}

async function loadMap() {
  const combined = [
    read("src/lib/meta-ad-library/types.ts"),
    stripImports(read("src/lib/meta-ad-library/map.ts")),
  ].join("\n");
  const transpiled = ts.transpileModule(combined, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return import(url);
}

const {
  archivedAdToCollectorRecord,
  classifyArchivedAd,
  officialLibraryUrl,
  parseArchivedAd,
} = await loadMap();

const now = Date.parse("2026-09-17T00:00:00Z");
const commercial = parseArchivedAd(
  {
    id: "111",
    page_name: "Alpenhof",
    ad_creative_bodies: ["Zimmer ohne OTA-Gebühr."],
    ad_creative_link_titles: ["Direkt buchen"],
    ad_creative_link_captions: ["Jetzt prüfen"],
    ad_delivery_start_time: "2026-04-01T00:00:00+0000",
    languages: ["de"],
    publisher_platforms: ["facebook", "instagram"],
    eu_total_reach: 12000,
  },
  now,
);
assert.equal(commercial.kind, "commercial");
assert.equal(commercial.daysRunning, 169);
assert.equal(classifyArchivedAd({ bylines: "Partei X", spend: { lower: 100 } }), "political");

const draft = archivedAdToCollectorRecord(commercial, {
  industry: "Hotels & Reisen",
  objective: "sales",
  country: "DE",
  collectorBatchId: "batch-1",
  searchTerms: "Hotel",
  longRunningDays: 90,
});
assert.equal(draft.provider, "meta");
assert.equal(draft.use_for_generation, false);
assert.equal(draft.rights_basis, "reference_only");
assert.equal(draft.evidence_level, "public_transparency");
assert.equal(draft.source_url, officialLibraryUrl("111"));
assert.match(draft.hook_text, /Direkt buchen/);
assert.ok(draft.tags.includes("long-running"));
assert.equal(draft.raw_payload.snapshot_url, null);

const env = read("src/lib/meta-ad-library/env.ts");
assert.match(env, /META_AD_LIBRARY_APP_ID/);
assert.match(env, /META_AD_LIBRARY_APP_SECRET/);
assert.match(env, /shared_product_app/);
assert.match(env, /META_APP_ID/);
assert.doesNotMatch(env, /getMetaSyncEnv/);

const client = read("src/lib/meta-ad-library/client.ts");
assert.match(client, /ads_archive/);
assert.match(client, /ad_type/);
assert.match(client, /token_wrong_app/);
assert.doesNotMatch(client, /facebook\.com\/ads\/library\/\?q=/);
assert.doesNotMatch(client, /getMetaCallbackEnv/);

const service = read("src/lib/meta-ad-library/service.ts");
assert.match(service, /enqueueCollectorDrafts/);
assert.match(service, /META_AD_LIBRARY_DAILY_CAP/);
assert.match(service, /probeMetaAdLibrary/);

const api = read("src/app/api/admin/meta-ad-library/route.ts");
assert.match(api, /isSiteAdmin/);
assert.match(api, /isDashboardSameOriginRequest/);
assert.match(api, /action === "probe"/);
assert.match(api, /action === "fetch"/);
assert.match(api, /usesProductMetaApp: false/);

const start = read("src/app/api/admin/meta-ad-library/start/route.ts");
assert.match(start, /createLibraryLoginUrl/);
assert.match(start, /isSiteAdmin/);

const callback = read("src/app/api/admin/meta-ad-library/callback/route.ts");
assert.match(callback, /exchangeLibraryCode/);
assert.match(callback, /saveLibraryConnection/);

const page = read("src/app/dashboard/inspiration/page.tsx");
assert.match(page, /MetaAdLibraryCollector/);

const ui = read("src/components/MetaAdLibraryCollector.tsx");
assert.match(ui, /META_AD_LIBRARY_APP_ID/);
assert.match(ui, /META_AD_LIBRARY_APP_SECRET/);
assert.match(ui, /Probe-Fetch/);
assert.match(ui, /In Sandbox holen/);
assert.match(ui, /Getrennt von META_APP_ID/);

const migration = read("supabase/migrations/20260917120000_meta_ad_library_connection.sql");
assert.match(migration, /create table if not exists public\.meta_ad_library_connections/);
assert.match(migration, /grant select, insert, update, delete on table public\.meta_ad_library_connections to service_role/);
assert.match(migration, /enable row level security/);
assert.doesNotMatch(migration, /grant .+ to (anon|authenticated)/);

const example = read(".env.example");
assert.match(example, /META_AD_LIBRARY_APP_ID/);
assert.match(example, /Never reuse META_APP_ID/);

console.log("test-meta-ad-library: ok");
