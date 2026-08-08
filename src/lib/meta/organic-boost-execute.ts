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
  prepareDetail: string | null;
  preflightOkCount: number | null;
  killSwitchMode: string | null;
};

async function prepareOrganicBoostWriteNow(input: {
  platformAccountId: string;
  userId: string;
}): Promise<{
  duePlans: number;
  leaseHealed: boolean;
  preflightOkCount: number | null;
  killSwitchMode: string | null;
  detail: string | null;
  error: string | null;
}> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("prepare_meta_organic_boost_write_now", {
    p_platform_account_id: input.platformAccountId,
    p_user_id: input.userId,
  });

  if (error) {
    // Fall back to heal-only when 06280000 is not applied yet.
    const heal = await admin.rpc("heal_meta_account_operation_lease", {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
    });
    return {
      duePlans: -1,
      leaseHealed: heal.data === true,
      preflightOkCount: null,
      killSwitchMode: null,
      detail: null,
      error: error.message || "prepare_write_now_failed",
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return {
      duePlans: 0,
      leaseHealed: false,
      preflightOkCount: null,
      killSwitchMode: null,
      detail: "prepare_result_empty",
      error: null,
    };
  }

  const record = row as Record<string, unknown>;
  const duePlans = Number(record.due_plans ?? 0);
  const preflightOkCount = Number(record.preflight_ok_count ?? 0);
  const reboundPlans = Number(record.rebound_plans ?? 0);
  const killSwitchMode =
    typeof record.kill_switch_mode === "string" ? record.kill_switch_mode : null;
  const leaseMatches = record.lease_user_matches === true;
  const leaseIdle = record.lease_idle === true;
  const preflightBlocker =
    typeof record.preflight_blocker === "string" && record.preflight_blocker.trim()
      ? record.preflight_blocker.trim()
      : null;
  const rebindDetail =
    typeof record.rebind_detail === "string" && record.rebind_detail.trim()
      ? record.rebind_detail.trim()
      : null;

  return {
    duePlans: Number.isFinite(duePlans) ? duePlans : 0,
    leaseHealed: leaseMatches && leaseIdle,
    preflightOkCount: Number.isFinite(preflightOkCount) ? preflightOkCount : null,
    killSwitchMode,
    detail: [
      `due=${duePlans}`,
      `preflight_ok=${preflightOkCount}`,
      `kill=${killSwitchMode ?? "?"}`,
      `lease_idle=${leaseIdle}`,
      `lease_match=${leaseMatches}`,
      Number.isFinite(reboundPlans) ? `rebound=${reboundPlans}` : null,
      preflightBlocker ? `blocker=${preflightBlocker}` : null,
      rebindDetail ? `rebind=${rebindDetail}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" "),
    error: null,
  };
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

  const prepared = await prepareOrganicBoostWriteNow(input);
  if (
    prepared.error &&
    !prepared.error.includes("Could not find the function") &&
    !prepared.error.includes("prepare_write_now_failed")
  ) {
    lastError = prepared.error;
  }
  if (prepared.duePlans >= 0) {
    duePlans = prepared.duePlans;
  }
  if (
    prepared.preflightOkCount === 0 &&
    prepared.duePlans > 0 &&
    !lastError
  ) {
    lastError = "preflight_zero_with_due_plans";
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
    leaseHealed: prepared.leaseHealed,
    prepareDetail: prepared.detail,
    preflightOkCount: prepared.preflightOkCount,
    killSwitchMode: prepared.killSwitchMode,
  };
}
