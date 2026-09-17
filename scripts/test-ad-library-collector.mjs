import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function stripImports(source) {
  return source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm, "");
}

async function loadPure() {
  const stubs = `
    function parseAdExampleInput(source) { return source; }
    export class AdExampleInputError extends Error {}
  `;
  const combined = [
    read("src/lib/ad-learning/types.ts"),
    stripImports(read("src/lib/ad-learning/context.ts")),
    read("src/lib/ad-library-collector/types.ts"),
    stripImports(read("src/lib/ad-library-collector/status.ts")),
    stubs,
    stripImports(read("src/lib/ad-library-collector/normalize.ts"))
      .replace(/\bfunction text\(/g, "function collectorText(")
      .replace(/\btext\(/g, "collectorText(")
      .replace(/\bfunction record\(/g, "function collectorRecord(")
      .replace(/\brecord\(/g, "collectorRecord(")
      .replace(/\bfunction pick\(/g, "function collectorPick(")
      .replace(/\bpick\(/g, "collectorPick("),
    stripImports(read("src/lib/ad-library-collector/preview.ts")),
  ].join("\n");
  const transpiled = ts.transpileModule(combined, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return import(url);
}

const {
  assertReadyForImport,
  buildCollectorMemoryPreview,
  canTransitionCollectorStatus,
  CollectorInputError,
  collectorDraftHasUsableCopy,
  normalizeCollectorDraft,
} = await loadPure();

assert.equal(canTransitionCollectorStatus("fetched", "reviewed"), true);
assert.equal(canTransitionCollectorStatus("reviewed", "ready_for_import"), true);
assert.equal(canTransitionCollectorStatus("ready_for_import", "imported"), true);
assert.equal(canTransitionCollectorStatus("imported", "fetched"), false);
assert.equal(canTransitionCollectorStatus("rejected", "fetched"), true);

const draft = normalizeCollectorDraft({
  provider: "meta",
  external_id: "lib-99",
  title: "Direktbuchung ohne OTA",
  advertiser_name: "Alpenhof",
  platform: "meta",
  industry: "Hotels & Reisen",
  objective: "sales",
  hook_text: "Zimmerpreis ohne Buchungsgebühr",
  body_text: "Jetzt direkt im Haus buchen.",
  source_url: "https://www.facebook.com/ads/library/?id=99",
  image_url: "https://img.example.com/ad.jpg",
  rights_confirmed: true,
});
assert.equal(draft.provider, "meta");
assert.equal(draft.evidenceLevel, "public_transparency");
assert.equal(draft.rightsBasis, "reference_only");
assert.equal(draft.useForGeneration, false);
assert.equal(collectorDraftHasUsableCopy(draft), true);

assert.throws(
  () =>
    normalizeCollectorDraft({
      provider: "meta",
      external_id: "x",
      title: "A",
      advertiser_name: "B",
      evidence_level: "first_party_performance",
    }),
  CollectorInputError,
);

assert.throws(
  () =>
    assertReadyForImport({
      draft: normalizeCollectorDraft({
        title: "Nur Text",
        advertiserName: "Marke",
        provider: "manual",
        rightsConfirmed: true,
      }),
      hasImage: false,
    }),
  CollectorInputError,
);

assertReadyForImport({
  draft: normalizeCollectorDraft({
    title: "Mit Copy",
    advertiserName: "Marke",
    provider: "manual",
    sourceKind: "user_upload",
    hookText: "Hook",
    bodyText: "Body",
    rightsConfirmed: true,
    imageUrl: "https://cdn.example.com/ad.jpg",
  }),
  hasImage: false,
});

const preview = buildCollectorMemoryPreview({
  platform: "meta",
  objective: "sales",
  industry: "Hotels",
  livePatterns: [
    {
      brandAssetId: "live-1",
      platform: "meta",
      objective: "sales",
      industry: "Hotels & Reisen",
      hookText: "Live-Hook",
      bodyText: "Live-Body",
      whyItWorks: "",
      evidenceLevel: "visual_only",
      triggeringPrompts: [],
      qualityRating: 4,
    },
  ],
  stagedItems: [
    {
      ...draft,
      id: "sandbox-1",
      status: "ready_for_import",
      imageStorageBucket: null,
      imageStoragePath: null,
      brandAssetId: null,
      lastError: null,
      createdBy: null,
      createdAt: "2026-09-16T00:00:00Z",
      updatedAt: "2026-09-16T00:00:00Z",
      hasImage: true,
    },
  ],
});
assert.equal(preview.liveMatches.length, 1);
assert.equal(preview.sandboxMatches.length, 1);
assert.equal(preview.sandboxMatches[0].wouldEnterLiveMemory, true);
assert.match(preview.livePromptBlock, /Live-Hook/);
assert.match(preview.mergedPromptIfImported, /Zimmerpreis ohne Buchungsgebühr/);

const migration = read("supabase/migrations/20260916120000_ad_library_collector_items.sql");
assert.match(migration, /create table if not exists public.ad_library_collector_items/);
assert.match(migration, /unique \(provider, external_id\)/);
assert.match(migration, /grant select, insert, update, delete on table public.ad_library_collector_items to service_role/);
assert.match(migration, /enable row level security/);

const api = read("src/app/api/admin/ad-library-collector/route.ts");
assert.match(api, /isSiteAdmin/);
assert.match(api, /isDashboardSameOriginRequest/);
assert.match(api, /action === "preview"/);

const importApi = read("src/app/api/admin/ad-library-collector/import/route.ts");
assert.match(importApi, /CRON_SECRET/);
assert.match(importApi, /importReadyCollectorItems/);
assert.match(importApi, /customerVisible: false/);

const service = read("src/lib/ad-library-collector/service.ts");
assert.match(service, /library_scope/);
assert.match(service, /INSPIRATION/);
assert.match(service, /use_for_internal_intelligence: true/);
assert.match(service, /customer_visible: false/);
assert.match(service, /uploadInspirationVaultImage/);

const retrieve = read("src/lib/ad-learning/retrieve.ts");
assert.match(retrieve, /loadInspirationLearningPreview/);

const page = read("src/app/dashboard/inspiration/page.tsx");
assert.match(page, /AdLibraryCollectorSandbox/);
assert.match(page, /MetaAdLibraryCollector/);

const client = read("src/components/AdLibraryCollectorSandbox.tsx");
assert.match(client, /Korpus-Sandbox/);
assert.match(client, /Gedächtnis-Probe/);
assert.match(client, /ad_library_collector_items/);

console.log("test-ad-library-collector: ok");
