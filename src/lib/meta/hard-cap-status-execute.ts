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

export type OrganicBoostHardCapForceResumeResult = {
  outcome: string;
  reason: string | null;
  created: number;
  existing: number;
  blocked: number;
  revived: number;
  exposuresCleared: number;
  scheduleEnded: number;
  candidates: number;
  error: string | null;
};

function parseForceResumeRow(
  data: unknown,
  errorMessage: string | null,
): OrganicBoostHardCapForceResumeResult {
  if (errorMessage) {
    return {
      outcome: "ERROR",
      reason: null,
      created: 0,
      existing: 0,
      blocked: 0,
      revived: 0,
      exposuresCleared: 0,
      scheduleEnded: 0,
      candidates: 0,
      error: errorMessage,
    };
  }

  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : Array.isArray(data) && data[0] && typeof data[0] === "object"
        ? (data[0] as Record<string, unknown>)
        : null;

  if (!row) {
    return {
      outcome: "ERROR",
      reason: "empty_result",
      created: 0,
      existing: 0,
      blocked: 0,
      revived: 0,
      exposuresCleared: 0,
      scheduleEnded: 0,
      candidates: 0,
      error: "force_resume_result_empty",
    };
  }

  return {
    outcome: typeof row.outcome === "string" ? row.outcome : "OK",
    reason: typeof row.reason === "string" ? row.reason : null,
    created: Number(row.created ?? 0) || 0,
    existing: Number(row.existing ?? 0) || 0,
    blocked: Number(row.blocked ?? 0) || 0,
    revived: Number(row.revived ?? 0) || 0,
    exposuresCleared: Number(row.exposures_cleared ?? 0) || 0,
    scheduleEnded: Number(row.schedule_ended ?? 0) || 0,
    candidates: Number(row.candidates ?? 0) || 0,
    error: null,
  };
}

/**
 * Aggressive recovery: ACTIVATE every current PAUSED Beitrag-Push campaign
 * with remaining schedule — no prior SAFETY_PAUSE required.
 */
export async function forceReactivatePausedOrganicBoostCampaigns(input: {
  platformAccountId: string;
  userId: string;
  marketingSyncId: string;
  plannedAt?: string;
}): Promise<OrganicBoostHardCapForceResumeResult> {
  const admin = createAdminClient();
  const plannedAt = input.plannedAt ?? new Date().toISOString();

  const primary = await admin.rpc(
    "force_reactivate_paused_meta_organic_boost_campaigns",
    {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
      p_source_marketing_sync_id: input.marketingSyncId,
      p_planned_at: plannedAt,
    },
  );

  if (!primary.error) {
    return parseForceResumeRow(primary.data, null);
  }

  // Fallback while 20260809130000 is not applied yet.
  const fallback = await admin.rpc(
    "force_resume_meta_organic_boost_hard_cap_pauses",
    {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
      p_source_marketing_sync_id: input.marketingSyncId,
      p_planned_at: plannedAt,
    },
  );

  if (fallback.error) {
    return parseForceResumeRow(
      null,
      primary.error.message ||
        fallback.error.message ||
        "force_reactivate_rpc_failed",
    );
  }

  return parseForceResumeRow(fallback.data, null);
}

/** @deprecated Prefer forceReactivatePausedOrganicBoostCampaigns */
export async function forceResumeOrganicBoostHardCapPauses(input: {
  platformAccountId: string;
  userId: string;
  marketingSyncId: string;
  plannedAt?: string;
}): Promise<OrganicBoostHardCapForceResumeResult> {
  return forceReactivatePausedOrganicBoostCampaigns(input);
}

const STATUS_REACTIVATE_RULE_KEYS = [
  "hard_cap_day_resume",
  "hard_cap_exposure_breach",
  "organic_boost_reactivate",
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
    .in("source_rule_key", [...STATUS_REACTIVATE_RULE_KEYS])
    .in("action_type", ["ACTIVATE", "SAFETY_PAUSE"])
    .in("status", [
      "PENDING",
      "RETRYABLE",
      "CLAIMED",
      "EXECUTING",
      "RECONCILING",
    ])
    .lte("not_before", new Date().toISOString())
    .limit(40);

  if (error) {
    return { count: 0, error: error.message || "due_plan_count_failed" };
  }
  return { count: data?.length ?? 0, error: null };
}

/**
 * Drains hard-cap / organic-boost ACTIVATE plans for one account.
 * Forces the account WRITE lease idle via prepare_write_now when available.
 */
export async function drainHardCapStatusExecutionsForAccount(input: {
  platformAccountId: string;
  userId: string;
  maxRuns?: number;
}): Promise<HardCapStatusDrainResult> {
  const maxRuns = Math.max(1, Math.min(20, input.maxRuns ?? 12));
  let runs = 0;
  let succeeded = 0;
  let failed = 0;
  let lastOutcome: string | null = null;
  let divertedToOtherAccount = false;
  let lastError: string | null = null;
  let duePlans = 0;

  const admin = createAdminClient();
  try {
    await admin.rpc("prepare_meta_organic_boost_write_now", {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
    });
  } catch {
    try {
      await admin.rpc("heal_meta_account_operation_lease", {
        p_platform_account_id: input.platformAccountId,
        p_user_id: input.userId,
      });
    } catch {
      // Lease heal is best-effort.
    }
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
