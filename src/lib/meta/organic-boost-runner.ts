import "server-only";

import {
  runMetaOrganicBoostPlannerAfterSnapshot,
  type MetaOrganicBoostPlannerResult,
} from "@/lib/meta/planner";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function organicBoostForStorage(result: MetaOrganicBoostPlannerResult) {
  return {
    status: result.status,
    plans_created: result.plansCreated,
    plans_existing: result.plansExisting,
    candidates_skipped: result.candidatesSkipped,
    candidates_failed: result.candidatesFailed,
    candidates_considered: result.candidatesConsidered,
    last_error: result.lastError,
  };
}

async function persistOrganicBoostResult(input: {
  platformAccountId: string;
  userId: string;
  result: MetaOrganicBoostPlannerResult;
}): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_accounts")
    .select("sync_usage")
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new Error("organic_boost_status_persist_failed");
  }

  const usage = asRecord(data?.sync_usage);
  const { error: updateError } = await admin
    .from("platform_accounts")
    .update({
      sync_usage: {
        ...usage,
        observed_at: new Date().toISOString(),
        organic_boost: organicBoostForStorage(input.result),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId);

  if (updateError) {
    throw new Error("organic_boost_status_persist_failed");
  }
}

/**
 * Runs Beitrag-Push planning for already-recognized is_new candidates.
 * Independent of content Abruf and of the shared Abruf/Executor account lease;
 * the planner RPC serializes via advisory lock.
 */
export async function runOrganicBoostPlannerForAccount(input: {
  platformAccountId: string;
  userId: string;
  ownerPrefix?: string;
}): Promise<MetaOrganicBoostPlannerResult> {
  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("platform_accounts")
    .select("id,marketing_sync_id,marketing_sync_status")
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .eq("platform", "meta")
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !account) {
    return {
      status: "ACCOUNT_UNAVAILABLE",
      plansCreated: 0,
      plansExisting: 0,
      candidatesSkipped: 0,
      candidatesFailed: 0,
      candidatesConsidered: 0,
      lastError: "platform_account_unavailable",
    };
  }

  const marketingSyncId =
    account.marketing_sync_status === "success" &&
    typeof account.marketing_sync_id === "string" &&
    UUID_PATTERN.test(account.marketing_sync_id)
      ? account.marketing_sync_id
      : null;

  if (!marketingSyncId) {
    const result: MetaOrganicBoostPlannerResult = {
      status: "ACCOUNT_UNAVAILABLE",
      plansCreated: 0,
      plansExisting: 0,
      candidatesSkipped: 0,
      candidatesFailed: 0,
      candidatesConsidered: 0,
      lastError: "marketing_sync_required",
    };
    await persistOrganicBoostResult({
      platformAccountId: input.platformAccountId,
      userId: input.userId,
      result,
    }).catch(() => undefined);
    return result;
  }

  let result: MetaOrganicBoostPlannerResult;
  try {
    result = await runMetaOrganicBoostPlannerAfterSnapshot({
      platformAccountId: input.platformAccountId,
      userId: input.userId,
      marketingSyncId,
      readLeaseToken: null,
      plannedAt: new Date().toISOString(),
    });
  } catch {
    result = {
      status: "PLANNER_RPC_FAILED",
      plansCreated: 0,
      plansExisting: 0,
      candidatesSkipped: 0,
      candidatesFailed: 0,
      candidatesConsidered: 0,
      lastError: "run_meta_organic_boost_planner failed",
    };
  }

  await persistOrganicBoostResult({
    platformAccountId: input.platformAccountId,
    userId: input.userId,
    result,
  });

  return result;
}
