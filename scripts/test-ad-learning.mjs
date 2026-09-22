import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadContext() {
  const combined = `${read("src/lib/ad-learning/types.ts")}\n${read("src/lib/ad-learning/context.ts").replace(
    /import \{[\s\S]*?\} from "\.\/types";\n/,
    "",
  )}`;
  const transpiled = ts.transpileModule(combined, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return import(url);
}

const {
  customerSignalFromAsset,
  formatAdLearningPromptBlock,
  inspirationPatternFromMetadata,
  inspirationRowHasImage,
  isInspirationLearningEligible,
  mergeStyleReferenceIds,
  scoreInspirationMatch,
  summarizeInspirationCorpus,
} = await loadContext();
void root;

assert.equal(
  isInspirationLearningEligible({
    libraryScope: "CUSTOMER",
    library: "ad_example_library",
    customerVisible: false,
    hookText: "Hook",
    bodyText: "Body",
    whyItWorks: "",
    triggeringPrompts: [],
  }),
  false,
);
assert.equal(
  isInspirationLearningEligible({
    libraryScope: "INSPIRATION",
    library: "ad_example_library",
    customerVisible: true,
    hookText: "Hook",
    bodyText: "Body",
    whyItWorks: "",
    triggeringPrompts: [],
  }),
  false,
);
assert.equal(
  isInspirationLearningEligible({
    libraryScope: "INSPIRATION",
    library: "ad_example_library",
    customerVisible: false,
    hookText: "",
    bodyText: "Scheduling, payments, and admin.",
    whyItWorks: "",
    triggeringPrompts: [],
  }),
  true,
);

const pattern = inspirationPatternFromMetadata({
  brandAssetId: "asset-1",
  libraryScope: "INSPIRATION",
  metadata: {
    library: "ad_example_library",
    ad_example: {
      platform: "openai_ads",
      objective: "traffic",
      industry: "SaaS",
      hook_text: "One system",
      body_text: "Scheduling, payments, and admin.",
      evidence_level: "public_transparency",
      quality_rating: 3,
    },
    external_source: {
      customer_visible: false,
      triggering_prompts: ["best shift scheduling app for a hair salon"],
    },
  },
});
assert.ok(pattern);
assert.equal(pattern.platform, "openai_ads");
assert.ok(pattern.triggeringPrompts.includes("best shift scheduling app for a hair salon"));
assert.equal(
  inspirationPatternFromMetadata({
    brandAssetId: "cust",
    libraryScope: "CUSTOMER",
    metadata: { library: "ad_example_library", ad_example: { body_text: "nope" } },
  }),
  null,
);

assert.ok(
  scoreInspirationMatch(pattern, { platform: "openai_ads", objective: "traffic" }) >
    scoreInspirationMatch(pattern, { platform: "meta", objective: "leads" }),
);
assert.ok(
  scoreInspirationMatch(pattern, { platform: "openai_ads" }) >
    scoreInspirationMatch(pattern, { platform: "meta" }),
);
assert.equal(
  scoreInspirationMatch(pattern, {}),
  pattern.qualityRating,
);

const clinic = inspirationPatternFromMetadata({
  brandAssetId: "asset-clinic",
  libraryScope: "INSPIRATION",
  metadata: {
    library: "ad_example_library",
    ad_example: {
      platform: "openai_ads",
      objective: "leads",
      industry: "Zahnklinik",
      hook_text: "Termin noch diese Woche",
      body_text: "Erstberatung ohne Überweisung.",
      evidence_level: "public_transparency",
      quality_rating: 2,
    },
    external_source: { customer_visible: false },
  },
});
assert.ok(clinic);
assert.ok(
  scoreInspirationMatch(clinic, { industry: "klinik" }) >
    scoreInspirationMatch(pattern, { industry: "klinik" }),
);

assert.equal(
  inspirationRowHasImage({ storagePath: "inspiration/a.jpg", mimeType: "image/jpeg" }),
  true,
);
assert.equal(
  inspirationRowHasImage({
    metadata: { ad_example: { image_url: "https://cdn.example.com/ad.jpg" } },
  }),
  true,
);
assert.equal(inspirationRowHasImage({ metadata: { ad_example: {} } }), false);

const census = summarizeInspirationCorpus([
  { pattern, hasImage: true, industry: "SaaS", platform: "openai_ads", objective: "traffic" },
  { pattern: clinic, hasImage: true, industry: "Zahnklinik", platform: "openai_ads", objective: "leads" },
  { pattern: null, hasImage: true, industry: "Handwerk", platform: "meta", objective: "traffic" },
  { pattern: null, hasImage: false, industry: "", platform: "meta", objective: "" },
]);
assert.equal(census.scanned, 4);
assert.equal(census.learningEligible, 2);
assert.equal(census.imageAndText, 2);
assert.equal(census.textOnly, 0);
assert.equal(census.imageOnly, 1);
assert.equal(census.neither, 1);
assert.ok(census.industries.some((item) => item.name === "Zahnklinik" && item.imageAndText === 1));
assert.ok(census.industries.some((item) => item.name === "Handwerk" && item.total === 1 && item.imageAndText === 0));

const prompt = formatAdLearningPromptBlock({
  inspirationPatterns: [pattern],
  customerSignals: [
    {
      brandAssetId: "win-1",
      trainingStatus: "performance_winner",
      label: "hero-summer.jpg",
    },
  ],
});
assert.match(prompt, /Scheduling, payments/);
assert.match(prompt, /best shift scheduling/);
assert.match(prompt, /hero-summer/);
assert.match(prompt, /First-Party|first-party|relativ besser/i);
assert.doesNotMatch(prompt, /ChatGPT-Kontextanzeige/);
assert.equal(formatAdLearningPromptBlock({ inspirationPatterns: [], customerSignals: [], trainingSignals: [] }), "");

const trained = formatAdLearningPromptBlock({
  inspirationPatterns: [],
  customerSignals: [],
  trainingSignals: [
    {
      runId: "t1",
      verdict: "keep",
      platform: "meta",
      objective: "traffic",
      industry: "Hotels",
      landingHostname: "hotel.example",
      headline: "Zimmer ohne Portalgebühr",
      primaryText: "Direkt im Haus buchen.",
      note: "Klarer Preisanker",
    },
    {
      runId: "t2",
      verdict: "reject",
      platform: "meta",
      objective: "traffic",
      industry: "Hotels",
      landingHostname: "hotel.example",
      headline: "Beste Hotel-Deals der Welt!!!",
      primaryText: "Jetzt klicken.",
      note: "zu schreierisch",
    },
  ],
});
assert.match(trained, /Zimmer ohne Portalgebühr/);
assert.match(trained, /so nicht/);
assert.match(trained, /Beste Hotel-Deals/);

assert.deepEqual(
  mergeStyleReferenceIds(["aaa"], ["bbb", "aaa", "ccc"], 4),
  ["aaa", "bbb", "ccc"],
);
assert.equal(mergeStyleReferenceIds(["a", "b", "c", "d"], ["e"], 4).length, 4);

assert.equal(
  customerSignalFromAsset({
    brandAssetId: "x",
    libraryScope: "INSPIRATION",
    userId: "u1",
    ownerUserId: "u1",
    trainingStatus: "performance_winner",
  }),
  null,
);
assert.equal(
  customerSignalFromAsset({
    brandAssetId: "x",
    libraryScope: "CUSTOMER",
    userId: "u1",
    ownerUserId: "u2",
    trainingStatus: "performance_winner",
  }),
  null,
);
assert.equal(
  customerSignalFromAsset({
    brandAssetId: "x",
    libraryScope: "CUSTOMER",
    userId: "u1",
    ownerUserId: "u1",
    trainingStatus: "performance_winner",
    originalFilename: "winner.png",
  })?.label,
  "winner.png",
);

const suggest = read("src/lib/ad-copy/suggest.ts");
const openai = read("src/lib/ad-copy/providers/openai.ts");
const together = read("src/lib/ad-copy/providers/together.ts");
const enqueue = read("src/lib/creative-assets/enqueue.ts");
const retrieve = read("src/lib/ad-learning/retrieve.ts");
const docs = read("docs/ad-intelligence/LEARNING_SYSTEM.md");
assert.match(suggest, /loadAdLearningContext/);
assert.match(openai, /formatAdLearningPromptBlock/);
assert.match(together, /formatAdLearningPromptBlock/);
assert.match(enqueue, /attachCustomerWinnerStyleRefs/);
assert.match(retrieve, /INSPIRATION_LIBRARY_SCAN_PAGE_SIZE/);
assert.match(retrieve, /loadInspirationMemorySnapshot/);
assert.match(retrieve, /\.range\(/);
assert.doesNotMatch(retrieve, /\.limit\(500\)/);
assert.match(docs, /Phase 1/);
assert.match(docs, /Hunderttausenden/);
assert.match(docs, /nicht.*fine-getuned|nicht.*Fine-Tune/i);
assert.match(docs, /Tausenden echten ChatGPT Ads/);
assert.match(docs, /keine Aussage über Tausende \*\*eigene\*\* Kampagnen/i);
assert.match(docs, /branchenoffen/);
assert.match(docs, /ganzen.*Vault|ganzen Inspiration-Vault/i);

console.log("test-ad-learning: ok");
