import "server-only";

import { randomUUID } from "node:crypto";

import { processNextMetaMutation } from "@/lib/meta/executor";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostExecuteDrainResult = {
  duePlans: number;
  runs: number;
  succeeded: number;
  failed: number;
  lastOutcome: string | null;
  divertedToOtherAccount: boolean;
  lastError: string | null;
  leaseHealed: boolean;
};

async function healAccountOperationLease(input: {
  platformAccountId: string;
  userId: string;
}): Promise<{ healed: boolean; error: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("heal_meta_account_operation_lease", {
    p_platform_account_id: input.platformAccountId,
    p_user_id: input.userId,
  });

  if (error) {
    // Migration may not be applied yet; claim_meta_account_operation heal still helps after SQL.
    return { healed: false, error: error.message || "lease_heal_failed" };
  }

  return { healed: data === true, error: null };
}

async function countDueOrganicBoostPlans(input: {
  platformAccountId: string;
  userId: string;
}): Promise<{ count: number; error: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mutation_plans")
    .select("id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("source_rule_key", "organic-boost")
    .eq("action_type", "LAUNCH_CHAIN")
    .in("status", ["PENDING", "RETRYABLE", "CLAIMED", "EXECUTING", "RECONCILING"])
    .lte("not_before", new Date().toISOString())
    .limit(20);

  if (error) {
    return { count: 0, error: error.message || "due_plan_count_failed" };
  }
  return { count: data?.length ?? 0, error: null };
}

/**
 * Immediately drains pending organic-boost mutation plans for one account
 * instead of waiting solely on the minutely cron. Stops on idle, when claim
 * returns a different account, or after maxRuns.
 */
export async function drainOrganicBoostExecutionsForAccount(input: {
  platformAccountId: string;
  userId: string;
  maxRuns?: number;
}): Promise<OrganicBoostExecuteDrainResult> {
  const maxRuns = Math.max(1, Math.min(8, input.maxRuns ?? 4));
  let runs = 0;
  let succeeded = 0;
  let failed = 0;
  let lastOutcome: string | null = null;
  let divertedToOtherAccount = false;
  let lastError: string | null = null;
  let duePlans = 0;

  const heal = await healAccountOperationLease(input);
  const leaseHealed = heal.healed;
  if (heal.error && !heal.error.includes("Could not find the function")) {
    // Non-missing-function errors are diagnostic only; still attempt claim.
    lastError = heal.error;
  }

  for (let index = 0; index < maxRuns; index += 1) {
    const due = await countDueOrganicBoostPlans(input);
    duePlans = due.count;
    if (due.error) {
      lastError = due.error;
      break;
    }
    if (due.count < 1) {
      break;
    }

    try {
      const result = await processNextMetaMutation(
        `organic-boost-drain:${input.platformAccountId}:${randomUUID()}`,
      );
      runs += 1;
      lastOutcome = result.outcome;

      if (!result.processed || result.outcome === "idle") {
        // Claim returned nothing despite due plans — surface for diagnosis.
        if (result.outcome === "idle") {
          lastError = "claim_idle_with_due_plans";
        }
        break;
      }

      if (
        result.platformAccountId &&
        result.platformAccountId !== input.platformAccountId
      ) {
        divertedToOtherAccount = true;
        lastError = "claim_diverted_other_account";
        break;
      }

      if (result.outcome === "succeeded") {
        succeeded += 1;
      } else if (result.outcome === "failed" || result.outcome === "mismatch") {
        failed += 1;
      }
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "organic_boost_drain_failed";
      break;
    }
  }

  return {
    duePlans,
    runs,
    succeeded,
    failed,
    lastOutcome,
    divertedToOtherAccount,
    lastError,
    leaseHealed,
  };
}
