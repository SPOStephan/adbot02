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
  join(root, "src/app/dashboard/page.tsx"),
  "utf8",
);

assert.match(overview, /abo_sibling_success_rank_7d/);
assert.match(overview, /ad_sibling_success_pause_7d/);
assert.match(overview, /Automatik: Umschichtung/);
assert.match(overview, /Automatik: Anzeige pausieren/);
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

console.log("test-success-control-dashboard: ok");
