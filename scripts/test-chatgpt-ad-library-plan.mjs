import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function stripImports(source) {
  return source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\n/gm, "");
}

async function loadPlan() {
  const combined = [
    read("src/lib/chatgpt-ad-library/scrape-constants.ts"),
    read("src/lib/chatgpt-ad-library/system-ids.ts"),
    stripImports(read("src/lib/chatgpt-ad-library/plan.ts")),
  ].join("\n");
  const transpiled = ts.transpileModule(combined, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return import(url);
}

const {
  compactPendingIds,
  isUnlockerProviderBlockError,
  mapPool,
  selectScrapeBatch,
  shouldSkipScrapeError,
  CHATGPT_AD_LIBRARY_SYSTEM_IDS,
} = await loadPlan();

assert.equal(shouldSkipScrapeError("parse_failed"), true);
assert.equal(shouldSkipScrapeError("parse_copy_missing"), true);
assert.equal(shouldSkipScrapeError("http_404"), true);
assert.equal(shouldSkipScrapeError("unlocker_404"), true);
assert.equal(shouldSkipScrapeError("unlocker_checkpoint"), false);
assert.equal(shouldSkipScrapeError("unlocker_429"), false);
assert.equal(shouldSkipScrapeError("bot_checkpoint_429"), false);
assert.equal(shouldSkipScrapeError("unlocker_400"), false);
assert.equal(shouldSkipScrapeError("unlocker_401"), false);
assert.equal(shouldSkipScrapeError("unlocker_credits"), false);
assert.equal(shouldSkipScrapeError("unlocker_empty_html"), false);
assert.equal(isUnlockerProviderBlockError("unlocker_credits"), true);
assert.equal(isUnlockerProviderBlockError("unlocker_400"), true);
assert.equal(isUnlockerProviderBlockError("parse_copy_missing"), false);

const pendingFirst = selectScrapeBatch({
  pending: ["9001", "9002", "18", "21"],
  skipped: ["18"],
  imported: ["21"],
  limit: 2,
});
assert.equal(pendingFirst.source, "pending");
assert.deepEqual(pendingFirst.ids, ["9001", "9002"]);
assert.deepEqual(pendingFirst.remainingPending, []);

const starvedBefore = selectScrapeBatch({
  pending: ["9001", "9002"],
  imported: [],
  systemIds: CHATGPT_AD_LIBRARY_SYSTEM_IDS,
  limit: 5,
});
assert.equal(starvedBefore.source, "pending");
assert.ok(!starvedBefore.ids.includes("18"));
assert.ok(starvedBefore.remainingPending.includes("9002") || starvedBefore.ids.includes("9002"));

const catalogOnly = selectScrapeBatch({
  pending: [],
  imported: [],
  skipped: [],
  systemIds: ["18", "21", "7341"],
  limit: 2,
});
assert.equal(catalogOnly.source, "catalog");
assert.deepEqual(catalogOnly.ids, ["18", "21"]);
assert.deepEqual(catalogOnly.remainingPending, []);

const compacted = compactPendingIds({
  pending: ["18", "9001", "9001", "21"],
  skipped: ["18"],
  imported: ["21"],
});
assert.deepEqual(compacted, ["9001"]);

const probe = selectScrapeBatch({
  pending: [],
  imported: new Set(["1", "2"]),
  skipped: ["3"],
  systemIds: [],
  nextProbeId: 1,
  limit: 2,
});
assert.equal(probe.source, "probe");
assert.deepEqual(probe.ids, ["4", "5"]);
assert.equal(probe.nextProbeId, 6);

const productionStall = selectScrapeBatch({
  pending: ["9001", ...Array.from({ length: 16_602 }, (_, i) => String(10_000 + i))],
  skipped: ["18", "21", "22", "43"],
  imported: ["7341"],
  systemIds: CHATGPT_AD_LIBRARY_SYSTEM_IDS,
  limit: 10,
});
assert.equal(productionStall.source, "pending");
assert.deepEqual(productionStall.ids, [
  "9001",
  "10000",
  "10001",
  "10002",
  "10003",
  "10004",
  "10005",
  "10006",
  "10007",
  "10008",
]);
assert.equal(productionStall.remainingPending.length, 16_593);
assert.ok(!productionStall.ids.some((id) => CHATGPT_AD_LIBRARY_SYSTEM_IDS.includes(id)));

const biggerPending = selectScrapeBatch({
  pending: Array.from({ length: 80 }, (_, i) => String(20_000 + i)),
  limit: 40,
});
assert.equal(biggerPending.source, "pending");
assert.equal(biggerPending.ids.length, 40);
assert.equal(biggerPending.remainingPending.length, 40);

const seen = [];
const pooled = await mapPool(["a", "b", "c", "d"], 2, async (item, index) => {
  seen.push(item);
  return `${item}-${index}`;
});
assert.deepEqual(pooled, ["a-0", "b-1", "c-2", "d-3"]);
assert.equal(seen.length, 4);

console.log("test-chatgpt-ad-library-plan: ok");
