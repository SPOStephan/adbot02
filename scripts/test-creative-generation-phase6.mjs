import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260819180000_creative_generation_phase6_credits.sql",
);
const phase6DocPath = join(
  root,
  "docs/meta-automation/CREATIVE_GENERATION_PHASE6.md",
);
const packagePath = join(root, "package.json");
const enqueuePath = join(root, "src/lib/creative-assets/enqueue.ts");
const workerPath = join(root, "src/lib/creative-assets/worker.ts");
const routePath = join(
  root,
  "src/app/api/meta/automation/creative-assets/enqueue/route.ts",
);
const typesPath = join(root, "src/lib/creative-assets/types.ts");
const clientPath = join(root, "src/components/MediaLibraryClient.tsx");

const migration = await readFile(migrationPath, "utf8");
const phase6Doc = await readFile(phase6DocPath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const enqueue = await readFile(enqueuePath, "utf8");
const worker = await readFile(workerPath, "utf8");
const route = await readFile(routePath, "utf8");
const types = await readFile(typesPath, "utf8");
const client = await readFile(clientPath, "utf8");
const migrationSha256 = createHash("sha256").update(migration).digest("hex");

assert.match(migration, /credit_reservation_id/);
assert.match(migration, /p_credit_reservation_id/);
assert.match(migration, /claim_creative_asset_job/);
assert.match(migration, /creative\.generate_image_master/);
assert.match(migration, /CREATIVE_ASSET_JOB_QUEUED/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);

assert.match(phase6Doc, /creative\.generate_image_master/);
assert.match(phase6Doc, /commit/);
assert.match(phase6Doc, /release/);

assert.match(enqueue, /reserveCredits/);
assert.match(enqueue, /CREATIVE_IMAGE_CREDIT_ACTION/);
assert.match(enqueue, /p_credit_reservation_id/);
assert.match(enqueue, /releaseCreditReservation/);

assert.match(worker, /settleCreativeJobCredits/);
assert.match(worker, /commitCreditReservation/);
assert.match(worker, /creditReservationId/);
assert.match(worker, /billing/);

assert.match(route, /InsufficientCreditsError/);
assert.match(route, /402/);
assert.match(route, /creditsReserved/);

assert.match(types, /creditReservationId/);
assert.match(client, /Credits reserviert|INSUFFICIENT_CREDITS/);

assert.equal(
  packageJson.scripts["test:creative-generation-phase6"],
  "node scripts/test-creative-generation-phase6.mjs",
);
assert.match(
  packageJson.scripts["test:meta-all"],
  /test:creative-generation-phase6/,
);

console.log(
  JSON.stringify({
    ok: true,
    migrationSha256,
    migration:
      "supabase/migrations/20260819180000_creative_generation_phase6_credits.sql",
  }),
);
