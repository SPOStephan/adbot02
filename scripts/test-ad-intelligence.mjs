import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

async function loadContract() {
  const source = read("src/lib/ad-intelligence/contract.ts");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return import(url);
}

async function loadAdapters() {
  const source = read("src/lib/ad-intelligence/adapters.ts").replace(
    /import \{[\s\S]*?\} from "@\/lib\/ad-intelligence\/contract";/,
    "class AdIntelligenceContractError extends Error {}",
  );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return import(url);
}

const contract = await loadContract();
const adapterModule = await loadAdapters();
assert.deepEqual(contract.AD_INTELLIGENCE_PLATFORMS, [
  "meta",
  "openai_ads",
  "google",
  "tiktok",
]);
assert.deepEqual(contract.AD_INTELLIGENCE_OBJECTIVES, [
  "awareness",
  "traffic",
  "engagement",
  "leads",
  "app_promotion",
  "sales",
]);

const valid = {
  contract_version: "adbot-ad-intelligence-v1",
  platform: "meta",
  strategy: {
    audience_insight: "Ein klarer Bedarf.",
    big_idea: "Klar vergleichen.",
    value_proposition: "Nachvollziehbare Auswahl.",
    proof_angle: "Nur belegte Merkmale.",
    funnel_stage: "consideration",
  },
  copy: {
    primary_text: "Eine sachliche und konkrete Botschaft.",
    headline: "Klar entscheiden",
    description: "Mehr erfahren",
    cta: "Mehr erfahren",
    search_headlines: [],
    search_descriptions: [],
    video_hook: "Worauf kommt es wirklich an?",
    voiceover: "Eine kurze, belegbare Erklärung.",
  },
  creative: {
    concept: "Das Angebot im Nutzungskontext.",
    image_prompt: "Eigenständige dokumentarische Szene ohne Markenimitation.",
    visual_hierarchy: ["Nutzen", "Angebot", "CTA"],
    format_notes: "Placementgerecht adaptieren.",
  },
  compliance: {
    claims_to_verify: [],
    prohibited_assumptions: ["Keine sensiblen Eigenschaften annehmen."],
  },
};
assert.deepEqual(contract.assertAdIntelligencePackage(valid), valid);
assert.throws(
  () =>
    contract.assertAdIntelligencePackage({
      ...valid,
      contract_version: "unknown",
    }),
  /Vertragsversion/,
);
assert.throws(
  () =>
    contract.assertAdIntelligencePackage({
      ...valid,
      platform: "unknown",
    }),
  /Plattform/,
);

const adapterContext = {
  destinationUrl: "https://example.com/angebot",
  brandName: "Adbot Demo",
};
const adaptedMeta = adapterModule.adaptAdIntelligencePackage(
  {
    ...valid,
    copy: {
      ...valid.copy,
      primary_text: "A".repeat(180),
      headline: "B".repeat(60),
      description: "C".repeat(40),
    },
  },
  adapterContext,
);
assert.equal([...adaptedMeta.primaryText].length, 125);
assert.equal([...adaptedMeta.headline].length, 40);
assert.equal([...adaptedMeta.description].length, 25);

const adaptedOpenAI = adapterModule.adaptAdIntelligencePackage(
  {
    ...valid,
    platform: "openai_ads",
    copy: {
      ...valid.copy,
      primary_text: "D".repeat(140),
      headline: "E".repeat(70),
    },
  },
  adapterContext,
);
assert.equal([...adaptedOpenAI.creative.body].length, 100);
assert.equal([...adaptedOpenAI.creative.title].length, 50);

const adaptedGoogle = adapterModule.adaptAdIntelligencePackage(
  {
    ...valid,
    platform: "google",
    copy: {
      ...valid.copy,
      primary_text: "",
      headline: "",
      description: "",
      search_headlines: ["A".repeat(40), "Zweiter Titel", "Dritter Titel"],
      search_descriptions: ["D".repeat(120), "Zweite Beschreibung"],
    },
    creative: { ...valid.creative, image_prompt: "" },
  },
  adapterContext,
);
assert.equal(adaptedGoogle.responsiveSearchAd.headlines.length, 3);
assert.equal([...adaptedGoogle.responsiveSearchAd.headlines[0]].length, 30);
assert.equal([...adaptedGoogle.responsiveSearchAd.descriptions[0]].length, 90);

const adaptedTikTok = adapterModule.adaptAdIntelligencePackage(
  {
    ...valid,
    platform: "tiktok",
    copy: {
      ...valid.copy,
      primary_text: `#Start @Marke ${"Text ".repeat(30)}🚀`,
    },
  },
  adapterContext,
);
assert.ok([...adaptedTikTok.adText].length <= 100);
assert.doesNotMatch(
  adaptedTikTok.adText,
  /[@#\p{Extended_Pictographic}]/u,
);

const spec = JSON.parse(read("training/ad-intelligence/seed-spec.json"));
assert.equal(spec.industries.length, 10);
assert.equal(spec.objectives.length, 4);
assert.equal(spec.platforms.length, 4);
assert.equal(spec.industries.length * spec.objectives.length * spec.platforms.length, 160);
const brands = spec.industries.map((industry) => industry.brand);
assert.equal(new Set(brands).size, brands.length);
assert.ok(brands.every((brand) => brand.startsWith("Adbot Demo ")));

const providerIndex = read("src/lib/ad-copy/providers/index.ts");
const together = read("src/lib/ad-copy/providers/together.ts");
const adapters = read("src/lib/ad-intelligence/adapters.ts");
const suggest = read("src/lib/ad-copy/suggest.ts");
const environment = read(".env.example");
const generator = read("scripts/generate-ad-intelligence-seed.py");
const robustGenerator = read(
  "scripts/generate-ad-intelligence-seed-robust.py",
);
const trainer = read("scripts/train-ad-intelligence-together.py");
const evaluator = read("scripts/evaluate-ad-intelligence.py");
const docs = read("docs/ad-intelligence/CROSS_PLATFORM_TRAINING.md");
const adminPage = read("src/app/dashboard/inspiration/page.tsx");
const corpusLoader = read("src/lib/ad-intelligence/corpus.ts");

assert.match(providerIndex, /key === "adbot_intelligence"/);
assert.match(providerIndex, /process\.env\.TOGETHER_API_KEY/);
assert.match(providerIndex, /process\.env\.AD_COPY_TOGETHER_MODEL/);
assert.match(together, /https:\/\/api-inference\.together\.ai\/v1/);
assert.match(together, /assertAdIntelligencePackage/);
assert.match(together, /Together-Kostenallokation fehlt/);
assert.doesNotMatch(together, /\?\? "0\.20"/);
assert.match(together, /redirect: "error"/);
assert.match(together, /platform: input\.platform \?\? "meta"/);
assert.match(together, /adaptAdIntelligencePackage/);
assert.match(together, /reuse_first_then_generate_missing/);
assert.match(adapters, /case "meta"/);
assert.match(adapters, /case "openai_ads"/);
assert.match(adapters, /case "google"/);
assert.match(adapters, /case "tiktok"/);
assert.match(adapters, /Google RSA benötigt 3–15 Headlines/);
assert.match(adapters, /tiktokChars\(adText\) > 100/);
assert.match(adapters, /Extended_Pictographic/);
assert.match(adapters, /aiGeneratedContentDisclosureRequired: true/);
assert.match(suggest, /togetherRatesFromEnv/);
assert.match(environment, /AD_COPY_PROVIDER=adbot_intelligence/);
assert.match(environment, /AD_COPY_TOGETHER_MODEL=/);

assert.match(generator, /TEACHER_MODEL = "gpt-5-mini"/);
assert.match(generator, /JUDGE_MODEL = "gpt-5"/);
assert.match(generator, /contains_customer_data/);
assert.match(generator, /contains_third_party_ads/);
assert.match(generator, /asset_policy.*reuse_first_then_generate_missing/s);
assert.match(generator, /preferred_score.*82/s);
assert.match(generator, /preferred_score.*rejected_score.*15/s);
assert.match(robustGenerator, /subprocess\.run/);
assert.match(robustGenerator, /timeout=timeout_seconds/);
assert.match(robustGenerator, /replace\(path\)/);
assert.match(robustGenerator, /--rounds/);
assert.match(trainer, /estimate_price/);
assert.match(trainer, /if not args\.submit/);
assert.match(trainer, /START_ADBOT_LORA_WITH_CHARGES/);
assert.match(trainer, /existing = client\.fine_tuning\.list\(\)/);
assert.match(evaluator, /BASELINE_MODEL = "gpt-5-mini"/);
assert.match(evaluator, /JUDGE_MODEL = "gpt-5"/);
assert.match(evaluator, /win_rate >= 0\.60/);
assert.match(evaluator, /mean_delta >= 5/);
assert.match(evaluator, /safety_failures == 0/);
assert.match(adminPage, /loadAdIntelligenceCorpusSummary/);
assert.match(adminPage, /keine Kundendaten und keine kopierten Fremdanzeigen/);
assert.match(corpusLoader, /contains_customer_data === false/);
assert.match(corpusLoader, /contains_third_party_ads === false/);
assert.match(docs, /einen gemeinsamen strategischen Kreativkern/i);
assert.match(docs, /deterministischer Code/);
assert.doesNotMatch(generator, /chatgptadlibrary\.com/i);

console.log("test-ad-intelligence: ok");
