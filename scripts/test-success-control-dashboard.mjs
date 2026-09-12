import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const overview = await readFile(
  join(root, "src/components/MetaCampaignOverview.tsx"),
  "utf8",
);
const dashboard = await readFile(
  join(root, "src/app/dashboard/kampagnen/page.tsx"),
  "utf8",
);

assert.match(overview, /abo_sibling_success_rank_7d/);
assert.match(overview, /ad_sibling_success_pause_7d/);
assert.match(overview, /Automatik: Umschichtung/);
assert.doesNotMatch(overview, /Automatik: Anzeige pausieren/);
assert.match(overview, /Autonome Creative-Optimierung/);
assert.match(overview, /vorab festen Sieben-Tage-Fenster/);
assert.match(overview, /Traffic-Dominanz/);
assert.match(overview, /kein randomisierter/);
assert.match(overview, /1\.000 Impressionen/);
assert.match(overview, /50 EUR Spend/);
assert.match(overview, /100 Link-Klicks/);
assert.match(overview, /mindestens 0,5/);
assert.match(overview, /mindestens zehn Prozent/);
assert.match(overview, /Kampagnen-, Ad-Set- und Budgetwerte bleiben unverändert/);
assert.match(overview, /insufficient_volume/);
assert.match(overview, /Mindestvolumen nicht erreicht/);
assert.match(overview, /no_consistent_lift/);
assert.match(overview, /Vorsprung nicht über sechs Tage stabil/);
assert.match(overview, /creativeOptimizationCycles/);
assert.match(overview, /allowBudgetChanges/);
assert.match(overview, /allowStatusChanges/);
assert.match(overview, /recommendationEvidence/);
assert.match(overview, /stronger_ad|weaker_ad|winner|loser/);
assert.match(overview, /proposed_delta_minor|Umschichtung/);

// Must not blanket-label every recommendation as analysis-only.
assert.match(overview, /SUCCESS_CONTROL_RULE_KEYS/);
assert.match(overview, /recommendationAutomationBadge/);
assert.match(overview, /Nur Analyse/);
assert.ok(
  overview.includes("Automatik: Umschichtung"),
  "success-control ABO path must show Automatik: Umschichtung when writes ready",
);

assert.match(
  dashboard,
  /allowBudgetChanges=\{Boolean\(policyView\?\.allowBudgetChanges\)\}/,
);
assert.match(
  dashboard,
  /allowStatusChanges=\{Boolean\(policyView\?\.allowStatusChanges\)\}/,
);
assert.match(dashboard, /meta_creative_optimization_cycles/);
assert.match(dashboard, /creativeOptimizationCycles=\{creativeOptimizationCycles\}/);

console.log("test-success-control-dashboard: ok");
