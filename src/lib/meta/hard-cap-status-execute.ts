import "server-only";

import { randomUUID } from "node:crypto";

import { processNextMetaMutation } from "@/lib/meta/executor";
import { healOrganicBoostDeliveryTree } from "@/lib/meta/organic-boost-delivery-heal";
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
  linked: number;
  activeLocal: number;
  adsetPausedOnly: number;
  targetsRepaired: number;
  remainingUnder24h: number;
  missingCurrent: number;
  error: string | null;
};

function emptyForceResume(
  outcome: string,
  error: string | null,
  reason: string | null = null,
): OrganicBoostHardCapForceResumeResult {
  return {
    outcome,
    reason,
    created: 0,
    existing: 0,
    blocked: 0,
    revived: 0,
    exposuresCleared: 0,
    scheduleEnded: 0,
    candidates: 0,
    linked: 0,
    activeLocal: 0,
    adsetPausedOnly: 0,
    targetsRepaired: 0,
    remainingUnder24h: 0,
    missingCurrent: 0,
    error,
  };
}

function parseForceResumeRow(
  data: unknown,
  errorMessage: string | null,
): OrganicBoostHardCapForceResumeResult {
  if (errorMessage) {
    return emptyForceResume("ERROR", errorMessage);
  }

  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : Array.isArray(data) && data[0] && typeof data[0] === "object"
        ? (data[0] as Record<string, unknown>)
        : null;

  if (!row) {
    return emptyForceResume("ERROR", "force_resume_result_empty", "empty_result");
  }

  const outcome = typeof row.outcome === "string" ? row.outcome : "OK";
  const reason = typeof row.reason === "string" ? row.reason : null;

  return {
    outcome,
    reason,
    created: Number(row.created ?? 0) || 0,
    existing: Number(row.existing ?? 0) || 0,
    blocked: Number(row.blocked ?? 0) || 0,
    revived: Number(row.revived ?? 0) || 0,
    exposuresCleared: Number(row.exposures_cleared ?? 0) || 0,
    scheduleEnded: Number(row.schedule_ended ?? 0) || 0,
    candidates: Number(row.candidates ?? 0) || 0,
    linked: Number(row.linked ?? 0) || 0,
    activeLocal: Number(row.active_local ?? 0) || 0,
    adsetPausedOnly: Number(row.adset_paused_only ?? 0) || 0,
    targetsRepaired: Number(row.targets_repaired ?? 0) || 0,
    remainingUnder24h: Number(row.remaining_under_24h ?? 0) || 0,
    missingCurrent: Number(row.missing_current ?? 0) || 0,
    error:
      outcome.toUpperCase() === "BLOCKED" || outcome.toUpperCase() === "ERROR"
        ? reason || "force_reactivate_blocked"
        : null,
  };
}

/**
 * Aggressive recovery: ACTIVATE every current PAUSED Beitrag-Push campaign
 * with remaining schedule — no prior SAFETY_PAUSE required.
 * Also heals PAUSED ads/ad sets (campaign ACTIVE alone is not delivery).
 */
export async function forceReactivatePausedOrganicBoostCampaigns(input: {
  platformAccountId: string;
  userId: string;
  marketingSyncId: string;
  plannedAt?: string;
  /** When Meta already reported these as PAUSED, reactivate by id (hard path). */
  pausedPlatformCampaignIds?: string[];
}): Promise<OrganicBoostHardCapForceResumeResult> {
  const result = await forceReactivatePausedOrganicBoostCampaignsInner(input);

  const heal = await healOrganicBoostDeliveryTree({
    userId: input.userId,
    platformAccountId: input.platformAccountId,
  }).catch((error) => ({
    adSetsActivated: 0,
    adsActivated: 0,
    error:
      error instanceof Error
        ? error.message
        : "organic_boost_delivery_heal_failed",
  }));

  if (
    (heal.adSetsActivated ?? 0) > 0 ||
    (heal.adsActivated ?? 0) > 0 ||
    ("error" in heal && heal.error)
  ) {
    console.error("organic_boost_delivery_heal", {
      platformAccountId: input.platformAccountId,
      adSetsActivated: heal.adSetsActivated ?? 0,
      adsActivated: heal.adsActivated ?? 0,
      error: "error" in heal ? heal.error : null,
    });
  }

  if (("error" in heal && heal.error) && !result.error) {
    return { ...result, error: heal.error };
  }
  return result;
}

async function forceReactivatePausedOrganicBoostCampaignsInner(input: {
  platformAccountId: string;
  userId: string;
  marketingSyncId: string;
  plannedAt?: string;
  pausedPlatformCampaignIds?: string[];
}): Promise<OrganicBoostHardCapForceResumeResult> {
  const admin = createAdminClient();
  const plannedAt = input.plannedAt ?? new Date().toISOString();
  const pausedIds = [
    ...new Set(
      (input.pausedPlatformCampaignIds ?? []).filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
    ),
  ];

  // Prefer explicit Meta-PAUSED ids — this is the path that must work when the
  // scan RPC still reports candidates=0 despite status refresh finding PAUSED.
  let byIdsResult: OrganicBoostHardCapForceResumeResult | null = null;
  let byIdsError: string | null = null;

  if (pausedIds.length > 0) {
    const byIds = await admin.rpc("force_reactivate_meta_organic_boost_by_ids", {
      p_platform_account_id: input.platformAccountId,
      p_user_id: input.userId,
      p_source_marketing_sync_id: input.marketingSyncId,
      p_platform_campaign_ids: pausedIds,
      p_planned_at: plannedAt,
    });

    if (byIds.error) {
      byIdsError = byIds.error.message || "by_ids_rpc_failed";
    } else {
      byIdsResult = parseForceResumeRow(byIds.data, null);
      if (byIdsResult.created + byIdsResult.existing > 0) {
        return byIdsResult;
      }
      if (byIdsResult.candidates > 0) {
        return byIdsResult;
      }
    }
  }

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
    const scanned = parseForceResumeRow(primary.data, null);
    if (scanned.created + scanned.existing + scanned.candidates > 0) {
      return scanned;
    }
    if (byIdsResult) {
      return {
        ...byIdsResult,
        error:
          byIdsResult.error ||
          (pausedIds.length > 0
            ? "meta_paused_but_no_activate_queued"
            : null),
      };
    }
    return scanned;
  }

  // Fallback while newer migrations are not applied yet.
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
      [
        byIdsError ? `by_ids: ${byIdsError}` : null,
        primary.error.message,
        fallback.error.message,
      ]
        .filter(Boolean)
        .join("; ") || "force_reactivate_rpc_failed",
    );
  }

  const fallbackParsed = parseForceResumeRow(fallback.data, null);
  if (
    fallbackParsed.created + fallbackParsed.existing < 1 &&
    pausedIds.length > 0
  ) {
    return {
      ...fallbackParsed,
      error:
        byIdsError ||
        "meta_paused_but_sql_20260809150000_required",
    };
  }

  return fallbackParsed;
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

/** Resume drain must never execute SAFETY_PAUSE / hard_cap_exposure_breach. */
const STATUS_REACTIVATE_RULE_KEYS = [
  "hard_cap_day_resume",
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
    .eq("action_type", "ACTIVATE")
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

async function prepareStatusActivateWriteNow(input: {
  platformAccountId: string;
  userId: string;
}): Promise<{ duePlans: number | null; detail: string | null }> {
  const admin = createAdminClient();

  const primary = await admin.rpc("prepare_meta_status_activate_write_now", {
    p_user_id: input.userId,
    p_platform_account_id: input.platformAccountId,
  });

  if (!primary.error) {
    const row =
      primary.data && typeof primary.data === "object" && !Array.isArray(primary.data)
        ? (primary.data as Record<string, unknown>)
        : null;
    return {
      duePlans: Number(row?.due_plans ?? 0) || 0,
      detail: row
        ? `activate_prep due=${row.due_plans ?? 0} revived=${row.revived ?? 0} lease_forced=${row.lease_forced === true}`
        : null,
    };
  }

  // Fallbacks while 20260809170000 is not applied.
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
      // best-effort
    }
  }

  return {
    duePlans: null,
    detail: `activate_prep_fallback:${primary.error.message || "rpc_missing"}`,
  };
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
  let idleRetries = 0;

  const prepared = await prepareStatusActivateWriteNow(input);
  if (prepared.duePlans != null) {
    duePlans = prepared.duePlans;
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
        if (result.outcome === "idle" && idleRetries < 1) {
          idleRetries += 1;
          await prepareStatusActivateWriteNow(input);
          continue;
        }
        if (result.outcome === "idle") {
          lastError = prepared.detail
            ? `claim_idle_with_due_plans (${prepared.detail})`
            : "claim_idle_with_due_plans";
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
