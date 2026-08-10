import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadTsModule(relativePath) {
  const source = readFileSync(join(root, relativePath), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  // Strip server-only side effect for unit import.
  const cleaned = transpiled.replace(
    /import\s+[\"']server-only[\"'];?/g,
    "",
  );
  const url = `data:text/javascript;base64,${Buffer.from(cleaned).toString("base64")}`;
  return import(url);
}

const { providerCostEur, creditsFromProviderCostEur, AI_COST_MARKUP, ADBOT_CREDIT_EUR_VALUE } =
  await loadTsModule("src/lib/ad-copy/pricing.ts");

assert.equal(AI_COST_MARKUP, 1.5);
assert.equal(ADBOT_CREDIT_EUR_VALUE, 0.01);

const cheap = providerCostEur(
  { inputTokens: 1000, outputTokens: 200 },
  { inputEurPerMillionTokens: 0.14, outputEurPerMillionTokens: 0.55 },
);
assert.ok(cheap > 0 && cheap < 0.01);

// Cheap calls still hit the catalog floor (5).
assert.equal(creditsFromProviderCostEur(cheap, 5), 5);

// 0.04 EUR provider → 0.06 marked up → 6 credits.
assert.equal(creditsFromProviderCostEur(0.04, 5), 6);

// Exactly 0.01 EUR after markup boundary: 0.02/1.5≈0.01333 → markup 0.02 → 2 credits, floor 1 → 2
assert.equal(creditsFromProviderCostEur(0.02 / 1.5, 1), 2);

const migration = readFileSync(
  join(root, "supabase/migrations/20260810160000_reserve_credits_amount.sql"),
  "utf8",
);
assert.match(migration, /reserve_credits_amount/);
assert.match(migration, /greatest\(v_floor, p_amount\)/);

const creditsTs = readFileSync(join(root, "src/lib/billing/credits.ts"), "utf8");
assert.match(creditsTs, /reserveCreditsAmount/);

const route = readFileSync(
  join(root, "src/app/api/meta/automation/ad-copy-suggest/route.ts"),
  "utf8",
);
assert.match(route, /suggestAdCopyForDestination/);
assert.match(route, /INSUFFICIENT_CREDITS/);

const traffic = readFileSync(
  join(root, "src/components/TrafficLaunchCanary.tsx"),
  "utf8",
);
assert.match(traffic, /ad-copy-suggest/);
assert.match(traffic, /Textvorschlag aus URL/);

console.log("test-ad-copy-pricing: ok");
