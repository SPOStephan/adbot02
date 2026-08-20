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
assert.match(creditsTs, /reserveCreditsAmount/);
assert.match(creditsTs, /topUpCredits/);
assert.match(creditsTs, /assignBillingPlan/);
assert.match(creditsTs, /getCreditBalanceForUser/);

const creditsUi = readFileSync(
  join(root, "src/components/CreditsSidebarBalance.tsx"),
  "utf8",
);
const dashboardChrome = [
  readFileSync(join(root, "src/app/dashboard/layout.tsx"), "utf8"),
  readFileSync(join(root, "src/components/DashboardShell.tsx"), "utf8"),
  readFileSync(join(root, "src/components/DashboardAsideChrome.tsx"), "utf8"),
  readFileSync(join(root, "src/components/DashboardHeaderChrome.tsx"), "utf8"),
].join("\n");
assert.match(creditsUi, /CreditsSidebarBalance/);
assert.match(creditsUi, /Noch kein Guthaben/);
assert.match(creditsUi, /Guthaben wird knapp/);
assert.doesNotMatch(creditsUi, /providerCost|€0\.01/i);
assert.doesNotMatch(creditsUi, /\bactionKey\b/);
assert.match(dashboardChrome, /getCreditBalanceForUser/);
assert.match(dashboardChrome, /CreditsSidebarBalance/);

console.log("test-billing-credits-foundation: ok");
