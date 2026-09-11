import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dir = join(root, "training/ad-intelligence/v1");

function readJsonl(name) {
  return readFileSync(join(dir, name), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${name}:${index + 1}: ${error.message}`);
      }
    });
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateConversation(row, source) {
  assert.equal(Array.isArray(row.messages), true, `${source}: messages missing`);
  assert.equal(row.messages.length, 3, `${source}: exactly 3 messages required`);
  assert.deepEqual(
    row.messages.map((message) => message.role),
    ["system", "user", "assistant"],
    `${source}: role order`,
  );
  assert.match(row.messages[0].content, /Adbot-Kreativkern/);
  assert.doesNotMatch(row.messages[0].content, /Trainingsbeispiele/);
  const brief = JSON.parse(row.messages[1].content);
  const output = JSON.parse(row.messages[2].content);
  assert.equal(brief.data_origin, "synthetic_first_party", `${source}: provenance`);
  assert.equal(output.contract_version, "adbot-ad-intelligence-v1", `${source}: contract`);
  assert.equal(output.platform, brief.platform, `${source}: platform mismatch`);
  if (brief.platform === "google") {
    assert.ok(output.copy.search_headlines.length >= 3, `${source}: Google headlines`);
    assert.ok(output.copy.search_headlines.every((item) => [...item].length <= 30));
    assert.ok(output.copy.search_descriptions.length >= 2, `${source}: Google descriptions`);
    assert.ok(output.copy.search_descriptions.every((item) => [...item].length <= 90));
  } else if (brief.platform === "meta" || brief.platform === "openai_ads") {
    assert.ok(output.copy.primary_text.length > 0, `${source}: primary text`);
    assert.ok(output.copy.headline.length > 0, `${source}: headline`);
  } else {
    assert.ok(output.copy.primary_text.length > 0, `${source}: primary text`);
    assert.ok(output.copy.video_hook.length > 0, `${source}: video hook`);
  }
  if (brief.platform === "meta") {
    assert.ok([...output.copy.primary_text].length <= 125, `${source}: Meta primary text`);
    assert.ok([...output.copy.headline].length <= 40, `${source}: Meta headline`);
    assert.ok([...output.copy.description].length <= 25, `${source}: Meta description`);
  }
  if (brief.platform === "openai_ads") {
    assert.ok([...output.copy.primary_text].length <= 100, `${source}: OpenAI body`);
    assert.ok([...output.copy.headline].length <= 50, `${source}: OpenAI title`);
  }
  if (brief.platform === "tiktok") {
    assert.ok([...output.copy.primary_text].length <= 100, `${source}: TikTok ad text`);
    assert.doesNotMatch(output.copy.primary_text, /[@#\p{Extended_Pictographic}]/u);
  }
  assert.ok(output.creative.concept.length > 0, `${source}: creative concept`);
  if (brief.platform !== "google") {
    assert.ok(output.creative.image_prompt.length > 0, `${source}: image prompt`);
  }
  assert.ok(Array.isArray(output.compliance.claims_to_verify), `${source}: claims`);
  assert.doesNotMatch(
    JSON.stringify(row),
    /chatgptadlibrary\.com|facebook\.com\/ads\/library|adstransparency\.google\.com/i,
    `${source}: third-party library content is forbidden`,
  );
  return { brief, output };
}

const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const train = readJsonl("train.jsonl");
const evaluation = readJsonl("eval.jsonl");
const preferences = readJsonl("preferences.jsonl");
const records = readJsonl("records.jsonl");

assert.equal(manifest.source, "synthetic_first_party");
assert.equal(manifest.contains_customer_data, false);
assert.equal(manifest.contains_third_party_ads, false);
assert.equal(manifest.records, records.length);
assert.equal(manifest.train_records, train.length);
assert.equal(manifest.eval_records, evaluation.length);
assert.equal(manifest.preference_records, preferences.length);
assert.equal(train.length + evaluation.length, records.length);
assert.equal(preferences.length, train.length);

const trainKeys = new Set();
const evalKeys = new Set();
const trainGroups = new Set();
const evalGroups = new Set();
for (const [index, row] of train.entries()) {
  const value = validateConversation(row, `train:${index + 1}`);
  trainKeys.add(hash(value.brief));
  trainGroups.add(`${value.brief.industry}|${value.brief.objective}`);
}
for (const [index, row] of evaluation.entries()) {
  const value = validateConversation(row, `eval:${index + 1}`);
  const key = hash(value.brief);
  assert.equal(trainKeys.has(key), false, `eval:${index + 1}: split leakage`);
  evalKeys.add(key);
  evalGroups.add(`${value.brief.industry}|${value.brief.objective}`);
}
assert.equal(trainKeys.size, train.length, "duplicate train briefs");
assert.equal(evalKeys.size, evaluation.length, "duplicate eval briefs");
for (const group of evalGroups) {
  assert.equal(trainGroups.has(group), false, `group leakage: ${group}`);
}

for (const [index, row] of preferences.entries()) {
  assert.equal(Array.isArray(row.input?.messages), true, `preferences:${index + 1}`);
  assert.equal(row.preferred_output?.[0]?.role, "assistant");
  assert.equal(row.non_preferred_output?.[0]?.role, "assistant");
  assert.notEqual(
    row.preferred_output[0].content,
    row.non_preferred_output[0].content,
    `preferences:${index + 1}: identical pair`,
  );
}

const platforms = Object.keys(manifest.platform_distribution).sort();
assert.deepEqual(platforms, ["google", "meta", "openai_ads", "tiktok"]);
const counts = Object.values(manifest.platform_distribution);
assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, "platform imbalance");

console.log(
  JSON.stringify(
    {
      ok: true,
      records: records.length,
      train: train.length,
      eval: evaluation.length,
      preferences: preferences.length,
      platforms: manifest.platform_distribution,
    },
    null,
    2,
  ),
);
