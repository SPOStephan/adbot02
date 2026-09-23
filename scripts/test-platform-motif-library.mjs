import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function loadTs(path, aliases = {}) {
  const source = read(path).replace(
    /from\s+"(@\/[^"]+)"/g,
    (_, spec) => `from ${JSON.stringify(aliases[spec] ?? spec)}`,
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const fn = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    outputText,
  );
  fn(module.exports, require, module, join(root, path), join(root, dirname(path)));
  return module.exports;
}

const migration = read("supabase/migrations/20260923170000_platform_motif_library.sql");
assert.match(migration, /library_scope in \('CUSTOMER', 'INSPIRATION', 'PLATFORM'\)/);
assert.match(migration, /register_platform_library_asset/);
assert.match(migration, /update_platform_library_asset_metadata/);
assert.match(migration, /brand_assets_platform_sha256_uidx/);
assert.match(migration, /v_path not like 'platform\/%'/);
assert.match(migration, /Platform library upload requires a site admin/);
assert.match(migration, /ba\.library_scope = 'PLATFORM'/);
assert.match(migration, /in \('INSPIRATION', 'PLATFORM'\)/);
assert.match(migration, /Launch uses a CUSTOMER clone/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /get_effective_meta_kill_switch/);
assert.doesNotMatch(migration, /ensureFreezeWritesForLaunch/);

const rls = read("supabase/migrations/20260809190000_media_library_and_inspiration_vault.sql");
assert.match(rls, /library_scope = 'CUSTOMER'/);
assert.match(rls, /brand_assets_select_own/);

const types = read("src/lib/platform-library/types.ts");
assert.match(types, /usable_one_to_one: true/);
assert.match(types, /usable_as_inspiration: true/);
assert.match(types, /never_launch_directly: true/);
assert.match(types, /clone_to_customer_for_launch: true/);

const service = read("src/lib/platform-library/service.ts");
assert.match(service, /clonePlatformMotifForCustomer/);
assert.match(service, /library_scope", "CUSTOMER"/);
assert.match(service, /adopted_from_platform_asset_id/);
assert.match(service, /uploadCustomerLibraryImage/);
assert.match(service, /captionPlatformMotif/);

const storage = read("src/lib/platform-library/storage.ts");
assert.match(storage, /"platform"/);
assert.match(storage, /input\.sha256\.slice\(0, 2\)/);

const caption = read("src/lib/platform-library/caption.ts");
assert.match(caption, /openai\/gpt-4o-mini/);
assert.match(caption, /Kurze Inhaltsangabe/);

const select = read("src/lib/platform-library/select.ts");
assert.match(select, /library_scope", "PLATFORM"/);
assert.match(select, /attachPlatformMotifStyleRefs/);

const api = read("src/app/api/admin/platform-library/route.ts");
assert.match(api, /isSiteAdmin/);
assert.match(api, /isDashboardSameOriginRequest/);
assert.match(api, /uploadPlatformMotif/);
assert.match(api, /updatePlatformMotif/);
assert.match(api, /revokePlatformMotif/);
assert.match(api, /captionPlatformMotif/);

const page = read("src/app/dashboard/motifs/page.tsx");
assert.match(page, /isSiteAdmin/);
assert.match(page, /PlatformMotifLibraryAdmin/);
assert.match(page, /eins zu eins/);

const adminUi = read("src/components/PlatformMotifLibraryAdmin.tsx");
assert.match(adminUi, /\/api\/admin\/platform-library/);
assert.match(adminUi, /Tags \(kommagetrennt\)/);
assert.match(adminUi, /KI-Kurzinfo/);
assert.match(adminUi, /Neu analysieren/);

const preview = read("src/app/api/media-library/preview/route.ts");
assert.match(preview, /library_scope === "PLATFORM" && siteAdmin/);
assert.match(preview, /library_scope === "CUSTOMER" && asset\.user_id === user\.id/);
assert.doesNotMatch(preview, /isCustomerOwn \|\| siteAdmin/);

const styleRefs = read("src/lib/creative-assets/style-reference-load.ts");
assert.match(styleRefs, /platform_motif_library/);
assert.match(styleRefs, /libraryScope === "PLATFORM"/);
assert.match(styleRefs, /ownerUserId === input\.userId/);
assert.match(styleRefs, /ownerPlatformAccountId === input\.platformAccountId/);

const attach = read("src/lib/ad-learning/style-refs.ts");
assert.match(attach, /attachPlatformMotifStyleRefs/);
assert.match(attach, /attachCustomerWinnerStyleRefs/);

const enqueue = read("src/lib/creative-assets/enqueue.ts");
assert.match(enqueue, /attachCustomerWinnerStyleRefs/);
assert.match(enqueue, /prompt: input\.generation\.prompt/);

const executor = read("src/lib/meta/executor.ts");
assert.match(executor, /\.eq\("library_scope", "CUSTOMER"\)/);

const creatives = read("src/app/dashboard/creatives/page.tsx");
assert.match(creatives, /library_scope", "CUSTOMER"/);
assert.match(creatives, /niemals im Account[\s\S]*eines anderen Kunden/);

const client = read("src/components/MediaLibraryClient.tsx");
assert.match(client, /kein anderes Kundenkonto erhält Zugriff/);
assert.match(client, /1:1 übernehmen oder nach Bedarf anpassen/);

const nav = read("src/lib/dashboard/navigation.ts");
assert.match(nav, /\/dashboard\/motifs/);
assert.match(nav, /Motivbibliothek/);

const docs = read("docs/meta-automation/MEDIA_LIBRARY_AND_INSPIRATION_VAULT.md");
assert.match(docs, /PLATFORM/);
assert.match(docs, /clonePlatformMotifForCustomer/);
assert.match(docs, /Nie.*Account-übergreifend|niemals im Account/i);
assert.match(docs, /20260923170000_platform_motif_library/);

const packageJson = JSON.parse(read("package.json"));
assert.equal(
  packageJson.scripts["test:platform-motif-library"],
  "node scripts/test-platform-motif-library.mjs",
);
assert.match(packageJson.scripts["test:meta-all"], /test:platform-motif-library/);

const scoreMod = loadTs("src/lib/platform-library/score.ts");
const hotelScore = scoreMod.scorePlatformMotifMatch({
  tags: ["hotel", "abendstimmung"],
  contentSummary: "Hotelterrasse bei Sonnenuntergang",
  filename: "terrace.jpg",
  queryTags: ["hotel", "abendstimmung"],
  queryText: "Hotel Abendstimmung Terrasse",
});
assert.ok(hotelScore >= 6, `expected hotel motif score >= 6, got ${hotelScore}`);
assert.equal(scoreMod.shouldAdoptPlatformMotifOneToOne(hotelScore), true);
assert.equal(
  scoreMod.scorePlatformMotifMatch({
    tags: ["auto"],
    contentSummary: "Sportwagen",
    filename: "car.jpg",
    queryTags: ["hotel"],
    queryText: "Spa Wellness",
  }),
  0,
);

const tagStub = join(root, "scripts", "test-platform-motif-library-tags-stub.cjs");
const metaMod = loadTs("src/lib/platform-library/metadata.ts", {
  "@/lib/ad-examples/structure": tagStub,
});
const empty = metaMod.emptyPlatformMotifMetadata(["Hotel", "Hotel", "  Abend  "]);
assert.deepEqual(empty.tags, ["hotel", "abend"]);
assert.equal(empty.never_launch_directly, true);
assert.equal(empty.usable_one_to_one, true);
const readMeta = metaMod.readPlatformMotifMetadata({
  tags: ["Pool"],
  content_summary: "  Blaue Fliesen  ",
});
assert.deepEqual(readMeta.tags, ["pool"]);
assert.equal(readMeta.content_summary, "Blaue Fliesen");
assert.equal(readMeta.caption_status, "ready");

console.log("test-platform-motif-library: ok");
