import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(root, "supabase/migrations/20260808190000_billing_credits_foundation.sql"),
  "utf8",
);
const creditsTs = readFileSync(join(root, "src/lib/billing/credits.ts"), "utf8");

assert.match(migration, /create table if not exists public\.billing_plans/);
assert.match(migration, /create table if not exists public\.credit_wallets/);
assert.match(migration, /create table if not exists public\.credit_ledger/);
assert.match(migration, /create table if not exists public\.credit_reservations/);
assert.match(migration, /create table if not exists public\.credit_action_costs/);
assert.match(migration, /carryover_max_months/);
assert.match(migration, /admin_assign_billing_plan/);
assert.match(migration, /reserve_credits/);
assert.match(migration, /commit_credit_reservation/);
assert.match(migration, /release_credit_reservation/);
assert.match(migration, /top_up_credits/);
assert.match(migration, /expire_stale_credit_reservations/);
assert.match(migration, /INSUFFICIENT_CREDITS/);
assert.match(migration, /organic_boost\.execute_plan/);
assert.match(migration, /creative\.generate_image_master/);
assert.match(migration, /'starter'/);
assert.match(migration, /get_my_credit_balance/);

assert.match(creditsTs, /CREDIT_ACTION_KEYS/);
assert.match(creditsTs, /withCreditReservation/);
assert.match(creditsTs, /InsufficientCreditsError/);
assert.match(creditsTs, /reserveCredits/);
assert.match(creditsTs, /topUpCredits/);
assert.match(creditsTs, /assignBillingPlan/);

console.log("test-billing-credits-foundation: ok");
