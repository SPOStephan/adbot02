import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const sourcePath = join(root, "src/lib/meta/success-control-rank.ts");
const source = await readFile(sourcePath, "utf8");

const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-success-control-rank-"),
);
try {
  const modulePath = join(temporaryDirectory, "success-control-rank.mjs");
  await writeFile(
    modulePath,
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    "utf8",
  );
  const mod = await import(pathToFileURL(modulePath).href);

  assert.equal(mod.objectiveSuccessKind("OUTCOME_TRAFFIC"), "traffic");
  assert.equal(mod.objectiveSuccessKind("LINK_CLICKS"), "traffic");
  assert.equal(mod.objectiveSuccessKind("OUTCOME_LEADS"), "leads");
  assert.equal(mod.objectiveSuccessKind("LEAD_GENERATION"), "leads");
  assert.equal(mod.objectiveSuccessKind("OUTCOME_SALES"), "sales");
  assert.equal(mod.objectiveSuccessKind("CONVERSIONS"), "sales");
  assert.equal(mod.objectiveSuccessKind("OUTCOME_AWARENESS"), "unsupported");

  const ranked = mod.rankSiblingAdSets([
    {
      adGroupId: "b",
      platformAdGroupId: "222",
      spend: 50,
      primaryResults: 10,
    },
    {
      adGroupId: "a",
      platformAdGroupId: "111",
      spend: 40,
      primaryResults: 10,
    },
    {
      adGroupId: "c",
      platformAdGroupId: "333",
      spend: 20,
      primaryResults: 0,
    },
  ]);
  // Same primary: lower CPC wins (a: 4.0 < b: 5.0). Zero+spend is worst.
  assert.deepEqual(
    ranked.map((row) => row.adGroupId),
    ["a", "b", "c"],
  );
  assert.equal(ranked[0].tieBreakCost, 4);
  assert.equal(ranked[2].primaryResults, 0);

  const zeroVsResults = mod.rankSiblingAdSets([
    {
      adGroupId: "burn",
      platformAdGroupId: "001",
      spend: 100,
      primaryResults: 0,
    },
    {
      adGroupId: "winner",
      platformAdGroupId: "999",
      spend: 5,
      primaryResults: 1,
    },
  ]);
  assert.equal(zeroVsResults[0].adGroupId, "winner");
  assert.equal(zeroVsResults[1].adGroupId, "burn");

  const pureTie = mod.rankSiblingAdSets([
    {
      adGroupId: "z",
      platformAdGroupId: "z-id",
      spend: 10,
      primaryResults: 5,
    },
    {
      adGroupId: "a",
      platformAdGroupId: "a-id",
      spend: 10,
      primaryResults: 5,
    },
  ]);
  assert.deepEqual(
    pureTie.map((row) => row.platformAdGroupId),
    ["a-id", "z-id"],
  );

  const proposal = mod.proposeSiblingReallocation({
    ranked,
    budgetsByAdGroupId: { a: 10000, b: 10000, c: 10000 },
    changeBps: 1000,
  });
  assert.ok(proposal);
  assert.equal(proposal.winnerAdGroupId, "a");
  assert.equal(proposal.loserAdGroupId, "c");
  assert.equal(proposal.deltaMinor, 1000);
  assert.equal(proposal.winnerBudgetAfter, 11000);
  assert.equal(proposal.loserBudgetAfter, 9000);
  assert.equal(proposal.sumBefore, proposal.sumAfter);

  assert.equal(
    mod.proposeSiblingReallocation({
      ranked: pureTie,
      budgetsByAdGroupId: { a: 5000, z: 5000 },
      changeBps: 1000,
    }),
    null,
  );

  assert.equal(
    mod.proposeSiblingReallocation({
      ranked,
      budgetsByAdGroupId: { a: 5, b: 5, c: 5 },
      changeBps: 1000,
    }),
    null,
  );

  const migration = await readFile(
    join(
      root,
      "supabase/migrations/20260818210000_meta_abo_sibling_success_reallocate.sql",
    ),
    "utf8",
  );
  assert.match(migration, /abo_sibling_success_rank_7d/);
  assert.match(migration, /abo_sibling_reallocate_v1/);
  assert.match(migration, /queue_meta_sibling_budget_reallocate_internal/);
  assert.match(migration, /meta_ad_set_performance_7d/);
  assert.match(migration, /sum of sibling ABO ad-set daily budgets stays constant/i);
  assert.match(migration, /run_meta_budget_planner/);
  assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
  assert.doesNotMatch(migration, /minimum_results_per_window/);
  assert.doesNotMatch(
    migration,
    /current_results\s*>=\s*5/,
  );

  console.log("test-success-control-rank: ok");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
