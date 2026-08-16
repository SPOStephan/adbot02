import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "adbot-content-candidate-lifecycle-"),
);

try {
  const source = await readFile(
    join(root, "src/lib/meta/content-candidate-lifecycle.ts"),
    "utf8",
  );
  const modulePath = join(temporaryDirectory, "lifecycle.mjs");
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

  const {
    isHeldOrganicBoostPlan,
    shouldListAsContentCandidate,
  } = await import(pathToFileURL(modulePath).href);

  assert.equal(isHeldOrganicBoostPlan({ status: "HELD", notBefore: null }), true);
  assert.equal(
    isHeldOrganicBoostPlan({ status: "PENDING", notBefore: "infinity" }),
    true,
  );
  assert.equal(
    isHeldOrganicBoostPlan({
      status: "PENDING",
      notBefore: new Date().toISOString(),
    }),
    false,
  );
  assert.equal(shouldListAsContentCandidate({ heldPlan: null }), true);
  assert.equal(
    shouldListAsContentCandidate({
      heldPlan: { status: "PENDING", notBefore: "infinity" },
    }),
    true,
  );
  assert.equal(
    shouldListAsContentCandidate({
      heldPlan: { status: "SUCCEEDED", notBefore: new Date().toISOString() },
    }),
    false,
  );
  assert.equal(
    shouldListAsContentCandidate({
      heldPlan: { status: "PENDING", notBefore: new Date().toISOString() },
    }),
    false,
  );

  const migration = await readFile(
    join(
      root,
      "supabase/migrations/20260816060000_clear_content_candidate_is_new_after_boost.sql",
    ),
    "utf8",
  );
  assert.match(migration, /clear_meta_content_candidate_is_new/);
  assert.match(migration, /trg_clear_candidate_is_new_on_boost_progress/);
  assert.match(migration, /is_new = false/);

  const snapshot = await readFile(
    join(root, "src/lib/meta/content-sync-snapshot.ts"),
    "utf8",
  );
  assert.match(snapshot, /shouldListAsContentCandidate/);
  assert.match(snapshot, /CANDIDATE_FETCH_LIMIT/);

  console.log("Content candidate lifecycle tests passed.");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
