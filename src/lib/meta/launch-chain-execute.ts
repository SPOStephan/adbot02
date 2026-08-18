import "server-only";

import { randomUUID } from "node:crypto";

import { processNextMetaMutation } from "@/lib/meta/executor";
import { createAdminClient } from "@/lib/supabase/admin";

export type LaunchChainDrainResult = {
  planStatus: string | null;
  duePlans: number;
  runs: number;
  succeeded: boolean;
  failed: boolean;
  lastOutcome: string | null;
  failedStepKey: string | null;
  failedErrorCode: string | null;
  failedErrorDetail: string | null;
  lastError: string | null;
};

async function readLaunchPlanProgress(input: {
  planId: string;
  userId: string;
  platformAccountId: string;
}): Promise<{
  planStatus: string | null;
  failedStepKey: string | null;
  failedErrorCode: string | null;
  failedErrorDetail: string | null;
}> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("mutation_plans")
    .select("status")
    .eq("id", input.planId)
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .maybeSingle();

  const { data: failedStep } = await admin
    .from("mutation_plan_steps")
    .select("step_key,error_code,error_detail,status")
    .eq("plan_id", input.planId)
    .eq("user_id", input.userId)
    .in("status", ["FAILED", "REMOTE_UNKNOWN"])
    .order("step_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    planStatus: typeof plan?.status === "string" ? plan.status : null,
    failedStepKey:
      typeof failedStep?.step_key === "string" ? failedStep.step_key : null,
    failedErrorCode:
      typeof failedStep?.error_code === "string" ? failedStep.error_code : null,
    failedErrorDetail:
      typeof failedStep?.error_detail === "string"
        ? failedStep.error_detail
        : null,
  };
}

async function countDueLaunchPlans(input: {
  planId: string;
  userId: string;
  platformAccountId: string;
}): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("mutation_plans")
    .select("id")
    .eq("id", input.planId)
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("action_type", "LAUNCH_CHAIN")
    .in("status", [
      "PENDING",
      "RETRYABLE",
      "CLAIMED",
      "EXECUTING",
      "RECONCILING",
    ])
    .lte("not_before", new Date().toISOString())
    .limit(1);

  if (error) {
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * Drain the just-approved Aktiv-Launch plan until it finishes or Meta fails.
 * Unlike organic drain, this stays focused on one planId and tolerates the
 * global claim queue briefly diverting to another account.
 */
export async function drainApprovedLaunchChainForAccount(input: {
  planId: string;
  userId: string;
  platformAccountId: string;
  maxRuns?: number;
}): Promise<LaunchChainDrainResult> {
  const maxRuns = Math.max(1, Math.min(12, input.maxRuns ?? 8));
  let runs = 0;
  let lastOutcome: string | null = null;
  let lastError: string | null = null;
  let divertedSkips = 0;

  for (let index = 0; index < maxRuns; index += 1) {
    const progress = await readLaunchPlanProgress(input);
    if (
      progress.planStatus === "SUCCEEDED" ||
      progress.planStatus === "FAILED" ||
      progress.planStatus === "STALE" ||
      progress.planStatus === "BLOCKED" ||
      progress.planStatus === "COMPENSATED"
    ) {
      return {
        planStatus: progress.planStatus,
        duePlans: 0,
        runs,
        succeeded: progress.planStatus === "SUCCEEDED",
        failed: progress.planStatus === "FAILED",
        lastOutcome,
        failedStepKey: progress.failedStepKey,
        failedErrorCode: progress.failedErrorCode,
        failedErrorDetail: progress.failedErrorDetail,
        lastError,
      };
    }

    const due = await countDueLaunchPlans(input);
    if (due < 1) {
      break;
    }

    try {
      const result = await processNextMetaMutation(
        `customer-launch-drain:${input.platformAccountId}:${randomUUID()}`,
      );
      runs += 1;
      lastOutcome = result.outcome;

      if (!result.processed || result.outcome === "idle") {
        lastError = lastError ?? "claim_idle_with_due_launch";
        break;
      }

      if (
        result.platformAccountId &&
        result.platformAccountId !== input.platformAccountId
      ) {
        divertedSkips += 1;
        if (divertedSkips >= 3) {
          lastError = "claim_diverted_other_account";
          break;
        }
        continue;
      }

      if (result.outcome === "failed" || result.outcome === "mismatch") {
        break;
      }
      if (result.outcome === "succeeded" && result.planId === input.planId) {
        break;
      }
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "launch_chain_drain_failed";
      break;
    }
  }

  const finalProgress = await readLaunchPlanProgress(input);
  return {
    planStatus: finalProgress.planStatus,
    duePlans: await countDueLaunchPlans(input),
    runs,
    succeeded: finalProgress.planStatus === "SUCCEEDED",
    failed: finalProgress.planStatus === "FAILED",
    lastOutcome,
    failedStepKey: finalProgress.failedStepKey,
    failedErrorCode: finalProgress.failedErrorCode,
    failedErrorDetail: finalProgress.failedErrorDetail,
    lastError,
  };
}

export function describeLaunchChainDrainFailure(
  drain: LaunchChainDrainResult,
): string | null {
  if (drain.succeeded) {
    return null;
  }
  if (drain.failed) {
    const step = drain.failedStepKey ? ` (${drain.failedStepKey})` : "";
    const code = drain.failedErrorCode ? `: ${drain.failedErrorCode}` : "";
    const detail =
      drain.failedErrorDetail && drain.failedErrorDetail.trim()
        ? ` — ${drain.failedErrorDetail.trim().slice(0, 160)}`
        : "";
    return `Die Kampagne wurde bei Meta nur teilweise angelegt${step}${code}${detail}. Bitte im Werbeanzeigenmanager die unvollständige Kampagne prüfen/löschen und erneut vorbereiten.`;
  }
  if (drain.duePlans > 0 || drain.lastError) {
    return "Der Meta-Start läuft noch oder wurde unterbrochen. Bitte in 1–2 Minuten den Werbeanzeigenmanager prüfen — die Anzeige sollte aktiv werden. Falls die Kampagne ohne Anzeige bleibt, erneut vorbereiten.";
  }
  return null;
}
