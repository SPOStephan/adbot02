import "server-only";

import { randomUUID } from "node:crypto";

import { processMetaMutationPlan } from "@/lib/meta/executor";
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
  nextStepKey: string | null;
  nextStepStatus: string | null;
  planErrorClass: string | null;
  blockedReason: string | null;
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
  nextStepKey: string | null;
  nextStepStatus: string | null;
  planErrorClass: string | null;
  blockedReason: string | null;
}> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("mutation_plans")
    .select("status,error_class,blocked_reason")
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

  const { data: nextStep } = await admin
    .from("mutation_plan_steps")
    .select("step_key,status")
    .eq("plan_id", input.planId)
    .eq("user_id", input.userId)
    .in("status", ["PENDING", "RETRYABLE", "CLAIMED", "EXECUTING"])
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
    nextStepKey:
      typeof nextStep?.step_key === "string" ? nextStep.step_key : null,
    nextStepStatus:
      typeof nextStep?.status === "string" ? nextStep.status : null,
    planErrorClass:
      typeof plan?.error_class === "string" ? plan.error_class : null,
    blockedReason:
      typeof plan?.blocked_reason === "string" ? plan.blocked_reason : null,
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
 * Unlike organic drain, this claims exactly one planId. A customer click must
 * never be diverted to an older mutation from the global executor queue.
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

  for (let index = 0; index < maxRuns; index += 1) {
    const progress = await readLaunchPlanProgress(input);
    if (
      progress.planStatus === "SUCCEEDED" ||
      progress.planStatus === "FAILED" ||
      progress.planStatus === "STALE" ||
      progress.planStatus === "BLOCKED" ||
      progress.planStatus === "PREFLIGHT_FAILED" ||
      progress.planStatus === "COMPENSATED"
    ) {
      return {
        planStatus: progress.planStatus,
        duePlans: 0,
        runs,
        succeeded: progress.planStatus === "SUCCEEDED",
        failed: progress.planStatus !== "SUCCEEDED",
        lastOutcome,
        failedStepKey: progress.failedStepKey,
        failedErrorCode: progress.failedErrorCode,
        failedErrorDetail: progress.failedErrorDetail,
        nextStepKey: progress.nextStepKey,
        nextStepStatus: progress.nextStepStatus,
        planErrorClass: progress.planErrorClass,
        blockedReason: progress.blockedReason,
        lastError,
      };
    }

    const due = await countDueLaunchPlans(input);
    if (due < 1) {
      break;
    }

    try {
      const result = await processMetaMutationPlan(
        input.planId,
        `customer-launch-drain:${input.platformAccountId}:${randomUUID()}`,
      );
      runs += 1;
      lastOutcome = result.outcome;

      if (!result.processed || result.outcome === "idle") {
        lastError = lastError ?? "claim_idle_with_due_launch";
        break;
      }

      if (result.planId && result.planId !== input.planId) {
        lastError = "targeted_claim_returned_wrong_plan";
        break;
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
    failed:
      finalProgress.planStatus === "FAILED" ||
      finalProgress.planStatus === "STALE" ||
      finalProgress.planStatus === "BLOCKED" ||
      finalProgress.planStatus === "PREFLIGHT_FAILED" ||
      finalProgress.planStatus === "COMPENSATED",
    lastOutcome,
    failedStepKey: finalProgress.failedStepKey,
    failedErrorCode: finalProgress.failedErrorCode,
    failedErrorDetail: finalProgress.failedErrorDetail,
    nextStepKey: finalProgress.nextStepKey,
    nextStepStatus: finalProgress.nextStepStatus,
    planErrorClass: finalProgress.planErrorClass,
    blockedReason: finalProgress.blockedReason,
    lastError,
  };
}

function launchStepLabel(stepKey: string | null): string {
  if (!stepKey) return "Meta-Start";
  if (stepKey.includes("activate")) return "Kampagne aktivieren";
  if (stepKey.includes("reconcile")) return "Meta-Ergebnis bestätigen";
  if (stepKey.includes("campaign")) return "Kampagne bei Meta anlegen";
  if (stepKey.includes("ad-set")) return "Anzeigengruppe bei Meta anlegen";
  if (stepKey.includes("image")) return "Werbemittel zu Meta übertragen";
  if (stepKey.includes("creative")) return "Meta-Creative anlegen";
  if (stepKey.includes("ad")) return "Anzeige bei Meta anlegen";
  return "Meta-Start";
}

function planBlockMessage(reason: string | null): string | null {
  if (reason === "ads_management_reconnect_required") {
    return "Der Meta-Schreibzugriff für das gewählte Werbekonto ist nicht mehr gültig.";
  }
  if (reason === "writes_frozen") {
    return "Der Meta-Schreibschutz ist noch aktiv.";
  }
  if (reason === "policy_inactive" || reason === "action_not_allowed") {
    return "Der Kampagnenstart ist in der aktuellen Launch-Policy nicht freigegeben.";
  }
  if (reason === "launch_canary_preflight_drift") {
    return "Die vorbereiteten Kampagnendaten haben sich vor der Meta-Ausführung verändert.";
  }
  return null;
}

export function describeLaunchChainDrainFailure(
  drain: LaunchChainDrainResult,
): string | null {
  if (drain.succeeded) {
    return null;
  }
  const blocked = planBlockMessage(drain.blockedReason);
  if (blocked) {
    return `${blocked} Der Startplan bleibt gespeichert; es wurde keine zweite Kampagne angelegt.`;
  }
  if (
    drain.planStatus === "STALE" ||
    drain.planStatus === "BLOCKED" ||
    drain.planStatus === "PREFLIGHT_FAILED"
  ) {
    return `Der Meta-Start wurde vor dem Schritt „${launchStepLabel(drain.nextStepKey)}“ sicher gestoppt. Der Startplan bleibt gespeichert; es wurde keine zweite Kampagne angelegt.`;
  }
  if (drain.failed) {
    const step = launchStepLabel(drain.failedStepKey);
    const detail =
      drain.failedErrorDetail && drain.failedErrorDetail.trim()
        ? ` Meta meldet: ${drain.failedErrorDetail.trim().slice(0, 180)}`
        : "";
    return `Der Schritt „${step}“ ist fehlgeschlagen.${detail} Der Startplan bleibt gespeichert und kann nach der Korrektur erneut ausgeführt werden.`;
  }
  if (drain.duePlans > 0 || drain.lastError) {
    const step = launchStepLabel(drain.nextStepKey);
    return `Adbot konnte den freigegebenen Plan beim Schritt „${step}“ nicht abschließen. Der Startplan bleibt gespeichert und derselbe Plan kann erneut ausgeführt werden; es wird keine zweite Kampagne angelegt.`;
  }
  return `Adbot konnte den Abschluss des Meta-Starts nicht bestätigen. Der Startplan bleibt gespeichert; es wird keine zweite Kampagne angelegt.`;
}
