import "server-only";

import { randomUUID } from "node:crypto";

import { processNextMetaMutation } from "@/lib/meta/executor";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrganicBoostExecuteDrainResult = {
  runs: number;
  succeeded: number;
  failed: number;
  lastOutcome: string | null;
};

/**
 * Immediately drains pending organic-boost mutation plans for one account
 * instead of waiting solely on the minutely cron. Stops on idle or when the
 * next claimed plan belongs to a different account.
 */
export async function drainOrganicBoostExecutionsForAccount(input: {
  platformAccountId: string;
  userId: string;
  maxRuns?: number;
}): Promise<OrganicBoostExecuteDrainResult> {
  const maxRuns = Math.max(1, Math.min(8, input.maxRuns ?? 4));
  const admin = createAdminClient();
  let runs = 0;
  let succeeded = 0;
  let failed = 0;
  let lastOutcome: string | null = null;

  for (let index = 0; index < maxRuns; index += 1) {
    const { count, error } = await admin
      .from("mutation_plans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("source_rule_key", "organic-boost")
      .eq("action_type", "LAUNCH_CHAIN")
      .in("status", ["PENDING", "RETRYABLE", "CLAIMED", "EXECUTING", "RECONCILING"])
      .lte("not_before", new Date().toISOString());

    if (error || !count || count < 1) {
      break;
    }

    const result = await processNextMetaMutation(
      `organic-boost-drain:${input.platformAccountId}:${randomUUID()}`,
    );
    runs += 1;
    lastOutcome = result.outcome;

    if (!result.processed || result.outcome === "idle") {
      break;
    }
    if (result.outcome === "succeeded") {
      succeeded += 1;
    } else if (result.outcome === "failed" || result.outcome === "mismatch") {
      failed += 1;
    }
  }

  return { runs, succeeded, failed, lastOutcome };
}
