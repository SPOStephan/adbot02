import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCreditAmount,
  billingReferenceFromPayload,
  creditActionCost,
  creditProviderFromEnvironment,
  waizrServiceCode,
  withBillingReference,
} from "../src/lib/billing/credit-contract.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

assert.equal(creditProviderFromEnvironment(undefined), "legacy");
assert.equal(creditProviderFromEnvironment(" WAIZR "), "waizr");
assert.throws(() => creditProviderFromEnvironment("other"), /legacy oder waizr/);
assert.equal(creditActionCost("creative.generate_copy_set"), 5);
assert.equal(creditActionCost("campaign.launch_chain"), 40);
assert.equal(
  waizrServiceCode("creative.generate_image_master"),
  "adbot.creative.generate_image_master",
);
assert.throws(() => waizrServiceCode("credits.top_up_pack"), /cannot be reserved/);
assert.equal(assertCreditAmount(1_000_000), 1_000_000);
assert.throws(() => assertCreditAmount(0), /invalid/);
assert.throws(() => assertCreditAmount(1.5), /invalid/);

const payload = withBillingReference(
  { contract_version: "adbot-creative-generation-v1" },
  { provider: "waizr", reservationId: "11111111-1111-4111-8111-111111111111" },
);
assert.deepEqual(billingReferenceFromPayload(payload), {
  provider: "waizr",
  reservationId: "11111111-1111-4111-8111-111111111111",
});
assert.equal(billingReferenceFromPayload({}), null);

const client = read("src/lib/billing/waizr-credit-client.ts");
assert.match(client, /https:\/\/credits\.waizr\.co/);
assert.match(client, /grant_type: "client_credentials"/);
assert.match(client, /WAIZR_CREDIT_CLIENT_SECRET/);
assert.match(client, /AbortSignal\.timeout/);
assert.match(client, /cache: "no-store"/);
assert.match(client, /response\.status === 401/);
assert.doesNotMatch(client, /console\.(log|info).*clientSecret/);
assert.doesNotMatch(client, /NEXT_PUBLIC_WAIZR_CREDIT_CLIENT_SECRET/);

const account = read("src/lib/billing/credit-account.ts");
assert.match(account, /adbot_organization_memberships/);
assert.match(account, /ownerType: "organization"/);
assert.match(account, /ownerType: "user"/);
assert.match(account, /hasActiveDirectAdbotSubscription/);
assert.match(account, /direct-user:/);
assert.match(account, /accountIdempotencyKey/);
assert.match(account, /createWaizrAccount/);
assert.match(account, /accountCache/);

const entitlement = read("src/lib/kiready/entitlement.ts");
assert.match(entitlement, /identityError/);
assert.match(entitlement, /membershipError/);
assert.match(entitlement, /organizationResult\.error/);
assert.match(entitlement, /if \(await hasActiveDirectAdbotSubscription\(userId\)\) return/);

const facade = read("src/lib/billing/credits.ts");
assert.match(facade, /assertAdbotPaidActionAllowed/);
assert.match(facade, /provider \?\? getCreditProvider/);
assert.match(facade, /provider: reservation\.provider/);

const waizrCredits = read("src/lib/billing/waizr-credits.ts");
assert.match(waizrCredits, /quote\.accountId !== accountId/);
assert.match(waizrCredits, /quote\.serviceCode !== serviceCode/);
assert.match(waizrCredits, /reservation\.accountId !== accountId/);
assert.match(waizrCredits, /reservation\.quoteId !== quote\.id/);
assert.match(waizrCredits, /reservation\.actionReference !== reference/);
assert.match(waizrCredits, /reservation\.status !== "reserved"/);
assert.match(waizrCredits, /reservation\.amountReserved !== amount/);
assert.match(waizrCredits, /reservation\.id !== input\.reservationId/g);

const waizrClient = read("src/lib/billing/waizr-credit-client.ts");
assert.match(waizrClient, /quoteId: string/);
assert.match(waizrClient, /actionReference: string/);
assert.match(waizrClient, /typeof payload\.quoteId !== "string"/);
assert.match(waizrClient, /typeof payload\.actionReference !== "string"/);

const enqueue = read("src/lib/creative-assets/enqueue.ts");
const worker = read("src/lib/creative-assets/worker.ts");
assert.match(enqueue, /withBillingReference/);
assert.match(enqueue, /reservation\.provider === "legacy"/);
assert.match(worker, /billingReferenceFromPayload/);
assert.match(worker, /externalBilling\?\.provider/);

const settlement = read("src/lib/billing/creative-credit-settlement.ts");
const settlementMigration = read(
  "supabase/migrations/20260924163000_creative_credit_settlement_outbox.sql",
);
const creativeCron = read("src/app/api/cron/creative-assets/route.ts");
assert.match(settlement, /claim_next_creative_credit_settlement/);
assert.match(settlement, /complete_creative_credit_settlement/);
assert.match(settlement, /provider: claim\.provider/);
assert.match(settlementMigration, /credit_settlement_status/);
assert.match(settlementMigration, /PENDING_CAPTURE/);
assert.match(settlementMigration, /PENDING_RELEASE/);
assert.match(settlementMigration, /for update skip locked/i);
assert.match(settlementMigration, /credit_settlement_lease_expires_at/);
assert.match(settlementMigration, /credit_settlement_attempt_count >= 10/);
assert.match(creativeCron, /processNextCreativeCreditSettlement/);

console.log("test-waizr-credit-adapter: ok");
