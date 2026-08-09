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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function lastSuccessfulEnsureAtMs(input: {
  userId: string;
  platformAccountId: string;
}): Promise<number | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_accounts")
    .select("sync_usage")
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .maybeSingle();

  // Only the success marker — planner_last_run_at also updates on MATERIALIZE_FAILED
  // and must not suppress retries.
  const usage = asRecord(data?.sync_usage);
  const boost = asRecord(usage.organic_boost);
  const raw = boost.ensured_at;
  if (typeof raw !== "string") return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

async function repairOrphanInstagramPageLinks(input: {
  userId: string;
  platformAccountId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const [{ data: pages }, { data: orphans }] = await Promise.all([
    admin
      .from("meta_assets")
      .select("meta_asset_id")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("asset_type", "facebook_page")
      .limit(5),
    admin
      .from("meta_assets")
      .select("id,parent_meta_asset_id")
      .eq("user_id", input.userId)
      .eq("platform_account_id", input.platformAccountId)
      .eq("asset_type", "instagram_account")
      .limit(20),
  ]);

  if (!pages || pages.length !== 1 || !orphans?.length) {
    return;
  }

  const pageId = String(pages[0]?.meta_asset_id ?? "");
  if (!pageId || pageId.length < 5) {
    return;
  }

  const orphanIds = orphans
    .filter((row) => {
      const parent = row.parent_meta_asset_id;
      return parent == null || String(parent).length < 5;
    })
    .map((row) => String(row.id));

  if (!orphanIds.length) {
    return;
  }

  await admin
    .from("meta_assets")
    .update({
      parent_meta_asset_id: pageId,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .in("id", orphanIds);
}

async function markEnsureTimestamp(input: {
  userId: string;
  platformAccountId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_accounts")
    .select("sync_usage")
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const usage = asRecord(data?.sync_usage);
  const boost = asRecord(usage.organic_boost);
  await admin
    .from("platform_accounts")
    .update({
      sync_usage: {
        ...usage,
        observed_at: new Date().toISOString(),
        organic_boost: {
          ...boost,
          ensured_at: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.platformAccountId)
    .eq("user_id", input.userId);
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
  /**
   * Skip heavy plan+drain when an ensure ran recently (dashboard LiveRefresh
   * must not re-enter Meta WRITE every 15s).
   */
  skipIfRecentMs?: number;
}): Promise<{
  planner: MetaOrganicBoostPlannerResult | null;
  drain: OrganicBoostExecuteDrainResult | null;
  skippedRecent: boolean;
}> {
  if (input.skipIfRecentMs && input.skipIfRecentMs > 0) {
    const lastAt = await lastSuccessfulEnsureAtMs({
      userId: input.userId,
      platformAccountId: input.platformAccountId,
    });
    if (lastAt != null && Date.now() - lastAt < input.skipIfRecentMs) {
      return { planner: null, drain: null, skippedRecent: true };
    }
  }

  await repairOrphanInstagramPageLinks({
    userId: input.userId,
    platformAccountId: input.platformAccountId,
  }).catch(() => undefined);

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

  const ensureSucceeded =
    planned > 0 || (drain?.succeeded ?? 0) > 0 || (drain?.runs ?? 0) > 0;
  if (ensureSucceeded) {
    await markEnsureTimestamp({
      userId: input.userId,
      platformAccountId: input.platformAccountId,
    }).catch(() => undefined);
  }

  return { planner, drain, skippedRecent: false };
}
