import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260916140000_adbot_training_runs.sql");
assert.match(migration, /create table if not exists public.adbot_training_runs/);
assert.match(migration, /verdict in \('keep', 'reject'\)/);
assert.match(migration, /grant select, insert, update, delete on table public.adbot_training_runs to service_role/);

const types = read("src/lib/ad-learning/types.ts");
assert.match(types, /trainingSignals/);
assert.match(types, /TrainingGroundSignal/);

const context = read("src/lib/ad-learning/context.ts");
assert.match(context, /scoreTrainingGroundMatch/);
assert.match(context, /Adbot-Training/);
assert.match(context, /so nicht/);

const retrieve = read("src/lib/ad-learning/retrieve.ts");
assert.match(retrieve, /adbot_training_runs/);
assert.match(retrieve, /landingHostname/);

const suggest = read("src/lib/ad-copy/suggest.ts");
assert.match(suggest, /skipCredits/);
assert.match(suggest, /landingHostname/);

const service = read("src/lib/ad-training/service.ts");
assert.match(service, /suggestAdCopyForDestination/);
assert.match(service, /skipCredits: true/);
assert.match(service, /generateTrainingAdImage/);
assert.match(service, /rateTrainingAd/);

const api = read("src/app/api/admin/training/route.ts");
assert.match(api, /isSiteAdmin/);
assert.match(api, /isDashboardSameOriginRequest/);
assert.match(api, /maxDuration = 180/);

const page = read("src/app/dashboard/training/page.tsx");
assert.match(page, /isSiteAdmin/);
assert.match(page, /AdbotTrainingGround/);

const client = read("src/components/AdbotTrainingGround.tsx");
assert.match(client, /Ad gestalten/);
assert.match(client, /landingUrl/);
assert.match(client, /Gut — so mehr/);
assert.match(client, /Schlecht — so nicht/);

const nav = read("src/lib/dashboard/navigation.ts");
assert.match(nav, /\/dashboard\/training/);
assert.match(nav, /KI-Training/);

const docs = read("docs/ad-intelligence/LEARNING_SYSTEM.md");
assert.match(docs, /\/dashboard\/training/);
assert.match(docs, /adbot_training_runs/);

console.log("test-ad-training: ok");
