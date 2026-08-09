import "server-only";

import {
  drainOrganicBoostExecutionsForAccount,
  type OrganicBoostExecuteDrainResult,
} from "@/lib/meta/organic-boost-execute";
import { runOrganicBoostPlannerForAccount } from "@/lib/meta/organic-boost-runner";
import type { MetaOrganicBoostPlannerResult } from "@/lib/meta/planner";
import { createAdminClient } from "@/lib/supabase/admin";

async function reviveOrganicBoostPlans(input: {
  userId: string;
  platformAccountId: string;
}): Promise<void> {
  const admin = createAdminClient();
  try {
    await admin.rpc("rebind_meta_organic_boost_plans_to_current_policy", {
      p_user_id: input.userId,
      p_platform_account_id: input.platformAccountId,
    });
  } catch {
    // Optional until migration is applied.
  }
  try {
    await admin.rpc("revive_meta_organic_boost_superseded_plans", {
      p_user_id: input.userId,
      p_platform_account_id: input.platformAccountId,
    });
  } catch {
    // Optional until migration is applied.
  }
}

/**
 * Plan Beitrag-Push for is_new candidates and immediately drain Meta writes
 * for this account. Used on detect (Abruf), dashboard load, and Autonomie
 * changes so campaigns are created without waiting on the minutely cron or a
 * client-only AutoPlanner island.
 */
export async function planAndDrainOrganicBoostForAccount(input: {
  platformAccountId: string;
  userId: string;
  ownerPrefix?: string;
  maxRuns?: number;
  /** When true, skip planner and only revive + drain existing plans. */
  drainOnly?: boolean;
}): Promise<{
  planner: MetaOrganicBoostPlannerResult | null;
  drain: OrganicBoostExecuteDrainResult | null;
}> {
  let planner: MetaOrganicBoostPlannerResult | null = null;

  if (!input.drainOnly) {
    try {
      planner = await runOrganicBoostPlannerForAccount({
        platformAccountId: input.platformAccountId,
        userId: input.userId,
        ownerPrefix: input.ownerPrefix ?? "organic-boost-ensure",
      });
    } catch (error) {
      planner = {
        status: "PLANNER_RPC_FAILED",
        plansCreated: 0,
        plansExisting: 0,
        candidatesSkipped: 0,
        candidatesFailed: 0,
        candidatesConsidered: 0,
        lastError:
          error instanceof Error
            ? error.message
            : "organic_boost_planner_exception",
      };
    }
  }

  await reviveOrganicBoostPlans({
    userId: input.userId,
    platformAccountId: input.platformAccountId,
  });

  const planned =
    (planner?.plansCreated ?? 0) + (planner?.plansExisting ?? 0);
  const maxRuns = Math.max(
    1,
    Math.min(8, input.maxRuns ?? Math.max(4, planned || 4)),
  );

  let drain: OrganicBoostExecuteDrainResult | null = null;
  try {
    drain = await drainOrganicBoostExecutionsForAccount({
      platformAccountId: input.platformAccountId,
      userId: input.userId,
      maxRuns,
    });
  } catch (error) {
    drain = {
      duePlans: 0,
      runs: 0,
      succeeded: 0,
      failed: 0,
      lastOutcome: null,
      divertedToOtherAccount: false,
      lastError:
        error instanceof Error
          ? error.message
          : "organic_boost_drain_exception",
      leaseHealed: false,
      prepareDetail: null,
      preflightOkCount: null,
      killSwitchMode: null,
    };
  }

  return { planner, drain };
}
