import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type LeadUnderperformerPauseResult = {
  outcome: string;
  reason: string | null;
  planId: string | null;
  campaignId: string | null;
};

/**
 * Queues at most one daily PAUSE for an Adbot Lead campaign whose 7-day cost
 * per lead is more than twice the account's best Lead campaign. The plan runs
 * through the normal executor queue (policy, kill switch, before-state).
 */
export async function runMetaLeadUnderperformerPause(input: {
  platformAccountId: string;
  userId: string;
}): Promise<LeadUnderperformerPauseResult> {
  const { data, error } = await createAdminClient().rpc(
    "run_meta_lead_underperformer_pause",
    {
      p_user_id: input.userId,
      p_platform_account_id: input.platformAccountId,
      p_planned_at: new Date().toISOString(),
    },
  );
  if (error) {
    throw new Error(error.message || "run_meta_lead_underperformer_pause failed");
  }
  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    outcome: text(row.outcome) ?? "UNKNOWN",
    reason: text(row.reason),
    planId: text(row.plan_id),
    campaignId: text(row.campaign_id),
  };
}
