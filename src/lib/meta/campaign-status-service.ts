import "server-only";

import { randomUUID } from "node:crypto";

import {
  campaignStatusBlockedMessage,
  isTerminalPlanStatus,
  type CampaignStatusChangeRequest,
} from "@/lib/meta/campaign-status-change";
import {
  CustomerControlServiceError,
  type MetaCustomer,
} from "@/lib/meta/customer-control-service";
import { processMetaMutationPlan } from "@/lib/meta/executor";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_EXECUTOR_RUNS = 6;

export type CampaignStatusChangeResult = {
  status: "APPLIED" | "QUEUED" | "UNCHANGED";
  planId: string | null;
  planStatus: string | null;
};

async function readPlanStatus(
  customer: MetaCustomer,
  planId: string,
): Promise<{ status: string | null; blockedReason: string | null }> {
  const { data } = await createAdminClient()
    .from("mutation_plans")
    .select("status,blocked_reason")
    .eq("id", planId)
    .eq("user_id", customer.userId)
    .eq("platform_account_id", customer.platformAccountId)
    .maybeSingle();
  return {
    status: typeof data?.status === "string" ? data.status : null,
    blockedReason: typeof data?.blocked_reason === "string" ? data.blocked_reason : null,
  };
}

/**
 * Queues a customer PAUSE/ACTIVATE plan and runs it right away through the
 * normal executor (same gates as every other Meta write). When the account
 * write lease is busy, the plan stays queued and the executor cron finishes it.
 */
export async function changeMetaCampaignStatus(
  customer: MetaCustomer,
  input: CampaignStatusChangeRequest,
): Promise<CampaignStatusChangeResult> {
  if (!customer.writeScopeGranted) {
    throw new CustomerControlServiceError(
      "meta_write_scope_missing",
      403,
      "Adbot hat keine Meta-Schreibrechte. Bitte Meta neu verbinden.",
    );
  }

  const { data, error } = await createAdminClient().rpc(
    "queue_meta_customer_campaign_status_change",
    {
      p_user_id: customer.userId,
      p_platform_account_id: customer.platformAccountId,
      p_platform_campaign_id: input.platformCampaignId,
      p_status: input.status,
    },
  );
  if (error) {
    throw new CustomerControlServiceError(
      "campaign_status_queue_failed",
      500,
      "Die Statusänderung konnte nicht vorbereitet werden.",
    );
  }

  const queued =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  const outcome = typeof queued.outcome === "string" ? queued.outcome : "";
  const reason = typeof queued.reason === "string" ? queued.reason : null;
  if (outcome === "UNCHANGED") {
    return { status: "UNCHANGED", planId: null, planStatus: null };
  }
  const planId = typeof queued.plan_id === "string" ? queued.plan_id : null;
  if ((outcome !== "CREATED" && outcome !== "EXISTING") || !planId) {
    throw new CustomerControlServiceError(
      reason ?? "campaign_status_blocked",
      409,
      campaignStatusBlockedMessage(reason),
    );
  }

  let plan = await readPlanStatus(customer, planId);
  for (let run = 0; run < MAX_EXECUTOR_RUNS && !isTerminalPlanStatus(plan.status); run += 1) {
    const result = await processMetaMutationPlan(
      planId,
      `customer-status:${customer.platformAccountId}:${randomUUID()}`,
    );
    plan = await readPlanStatus(customer, planId);
    if (!result.processed || result.outcome === "idle") break;
  }

  if (plan.status === "SUCCEEDED") {
    return { status: "APPLIED", planId, planStatus: plan.status };
  }
  if (isTerminalPlanStatus(plan.status)) {
    throw new CustomerControlServiceError(
      plan.blockedReason ?? "campaign_status_failed",
      409,
      plan.blockedReason === "writes_frozen" || plan.blockedReason === "action_not_allowed"
        ? campaignStatusBlockedMessage(
            plan.blockedReason === "writes_frozen" ? "writes_frozen" : "status_changes_not_allowed",
          )
        : "Meta hat die Statusänderung nicht übernommen. Bitte Meta-Daten abrufen und erneut versuchen.",
    );
  }
  return { status: "QUEUED", planId, planStatus: plan.status };
}
