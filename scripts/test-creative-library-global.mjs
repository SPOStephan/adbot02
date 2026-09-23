import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260923140000_creative_library_global.sql");
assert.match(migration, /register_unbound_customer_library_asset/);
assert.match(migration, /do not read kill-switch or launch policy/);
assert.match(migration, /funnel_creative_handoffs/);
assert.match(migration, /adbot_training_runs[\s\S]*tags text\[\]/);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /get_effective_meta_kill_switch/);

const page = read("src/app/dashboard/creatives/page.tsx");
assert.match(page, /connectedPlatforms/);
assert.match(page, /library_scope", "CUSTOMER"/);
assert.match(page, /connectedPlatforms/);

const client = read("src/components/MediaLibraryClient.tsx");
assert.match(client, /authenticateLibraryCustomer|describeFormatStep/);
assert.match(client, /describeFormatStep/);
assert.doesNotMatch(client, /Bitte zuerst ein Meta-Werbekonto verbinden/);

const enqueueRoute = read("src/app/api/meta/automation/creative-assets/enqueue/route.ts");
assert.match(enqueueRoute, /authenticateLibraryCustomer/);
assert.doesNotMatch(enqueueRoute, /authenticateMetaCustomer/);

const uploadRoute = read("src/app/api/meta/automation/asset-upload/route.ts");
assert.match(uploadRoute, /authenticateLibraryCustomer/);

const formats = read("src/lib/media-library/platform-formats.ts");
assert.match(formats, /google_landscape_191/);
assert.match(formats, /tiktok_vertical_9x16/);
assert.match(formats, /formatSlotsForConnectedPlatforms/);

const structure = read("src/lib/ad-examples/structure.ts");
assert.match(structure, /JOB_AD_STRUCTURE/);
assert.match(structure, /job_title/);

const handoff = read("src/lib/funnel-creative-handoff.ts");
assert.match(handoff, /adbot_funnel_creative_handoff/);

const funnel = read("apps/adbot-funnel/server/routers/funnel.ts");
assert.match(funnel, /pushFunnelCreativeHandoffToPortal/);
assert.match(funnel, /status === "published"/);

const sqlTest = read("scripts/test-meta-creative-assets.sql");
assert.match(sqlTest, /Creative claim must not depend on kill-switch/);
assert.match(sqlTest, /Creative job enqueue must not depend on kill-switch/);

console.log("test-creative-library-global: ok");
