import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const migration = await readFile(
  join(root, "supabase/migrations/20260818133000_launch_creative_instagram_user_id.sql"),
  "utf8",
);

assert.equal(
  (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan\(/g) || []).length,
  1,
);
assert.equal(
  (migration.match(/create or replace function public\.materialize_meta_launch_chain_plan_v3\(/g) || []).length,
  1,
);

// Deprecated actor_id must be stripped; user_id only when IG asset is connected.
assert.match(migration, /v_object_story_spec := v_object_story_spec - 'instagram_actor_id'/);
assert.match(migration, /v_creative_payload := v_creative_payload - 'instagram_actor_id'/);
assert.match(
  migration,
  /ma\.asset_type = 'instagram_account'[\s\S]*?\{instagram_user_id\}/,
);
assert.equal(
  (migration.match(/\{instagram_actor_id\}/g) || []).length,
  0,
);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);

const writeClient = await readFile(
  join(root, "src/lib/meta/write-client.ts"),
  "utf8",
);
assert.match(writeClient, /sanitizeCreativeInstagramFields/);
assert.match(writeClient, /delete spec\.instagram_actor_id/);
assert.match(
  writeClient,
  /createMetaAdCreative[\s\S]*sanitizeCreativeInstagramFields/,
);

console.log("Launch creative Instagram user_id contract tests passed.");
