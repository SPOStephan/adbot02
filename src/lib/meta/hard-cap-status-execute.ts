import "server-only";

import { randomUUID } from "node:crypto";

import { processNextMetaMutation } from "@/lib/meta/executor";
import { createAdminClient } from "@/lib/supabase/admin";

export type HardCapStatusDrainResult = {
  duePlans: number;
  runs: number;
  succeeded: number;
  failed: number;
  lastOutcome: string | null;
  divertedToOtherAccount: boolean;
  lastError: string | null;
};

const HARD_CAP_RULE_KEYS = [
  "hard_cap_day_resume",
  "hard_cap_exposure_breach",
] as const;

async function countDueHardCapStatusPlans(input: {
  platformAccountId: string;
  userId: string;
}): Promise<{ count: number; error: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mutation_plans")
    .select("id")
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .in("source_rule_key", [...HARD_CAP_RULE_KEYS])
    .in("action_type", ["ACTIVATE", "SAFETY_PAUSE"])
    .in("status", [
      "PENDING",
      "RETRYABLE",
      "CLAIMED",
      "EXECUTING",
      "RECONCILING",
    ])
    .lte("not_before", new Date().toISOString())
    .limit(20);

  if (error) {
    return { count: 0, error: error.message || "due_plan_count_failed" };
  }
  return { count: data?.length ?? 0, error: null };
}

/**
 * Drains hard-cap SAFETY_PAUSE / day-resume ACTIVATE plans for one account.
 * Dashboard + cron use this so Meta status writes do not depend solely on a
 * single plan per minute when Beitrag-Push drain is idle.
 */
export async function drainHardCapStatusExecutionsForAccount(input: {
  platformAccountId: string;
  userId: string;
  maxRuns?: number;
}): Promise<HardCapStatusDrainResult> {
  const maxRuns = Math.max(1, Math.min(8, input.maxRuns ?? 4));
  let runs = 0;
  let succeeded = 0;
  let failed = 0;
  let lastOutcome: string | null = null;
  let divertedToOtherAccount = false;
  let lastError: string | null = null;
  let duePlans = 0;

  const admin = createAdminClient();
  try {
    await admin.rpc("heal_meta_account_operation_lease", {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
    });
  } catch {
    // Heal is best-effort; claim may still succeed if the lease is already idle.
  }

  for (let index = 0; index < maxRuns; index += 1) {
    const due = await countDueHardCapStatusPlans(input);
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
        `hard-cap-status-drain:${input.platformAccountId}:${randomUUID()}`,
      );
      runs += 1;
      lastOutcome = result.outcome;

      if (!result.processed || result.outcome === "idle") {
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
        error instanceof Error ? error.message : "hard_cap_status_drain_failed";
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
  };
}
