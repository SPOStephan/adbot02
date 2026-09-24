import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  commitCreditReservation,
  releaseCreditReservation,
} from "./credits";
import { parseCreditProvider, type CreditProvider } from "./credit-contract";

const SETTLEMENT_LEASE_SECONDS = 60;

type SettlementClaim = {
  jobId: string;
  userId: string;
  provider: CreditProvider;
  reservationId: string;
  outcome: "capture" | "release";
  leaseToken: string;
  attemptCount: number;
};

export type CreativeCreditSettlementResult = {
  processed: boolean;
  jobId: string | null;
  status: "IDLE" | "SETTLED" | "RETRYABLE" | "DEAD";
};

function parseClaim(value: unknown): SettlementClaim | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  const provider = parseCreditProvider(record.credit_provider);
  const outcome = record.settlement_outcome;
  if (
    typeof record.job_id !== "string" ||
    typeof record.user_id !== "string" ||
    !provider ||
    typeof record.credit_reservation_id !== "string" ||
    (outcome !== "capture" && outcome !== "release") ||
    typeof record.lease_token !== "string"
  ) {
    throw new Error("Creative credit settlement claim returned an invalid payload");
  }
  return {
    jobId: record.job_id,
    userId: record.user_id,
    provider,
    reservationId: record.credit_reservation_id,
    outcome,
    leaseToken: record.lease_token,
    attemptCount:
      typeof record.attempt_count === "number" ? record.attempt_count : 0,
  };
}

function safeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}:${error.message}`.slice(0, 500);
  }
  return "credit_settlement_failed";
}

async function finishClaim(input: {
  claim: SettlementClaim;
  succeeded: boolean;
  error?: unknown;
}): Promise<"SETTLED" | "PENDING_CAPTURE" | "PENDING_RELEASE" | "DEAD"> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "complete_creative_credit_settlement",
    {
      p_job_id: input.claim.jobId,
      p_lease_token: input.claim.leaseToken,
      p_succeeded: input.succeeded,
      p_safe_error: input.succeeded ? null : safeError(input.error),
    },
  );
  if (
    error ||
    !["SETTLED", "PENDING_CAPTURE", "PENDING_RELEASE", "DEAD"].includes(
      String(data),
    )
  ) {
    throw new Error("Creative credit settlement result could not be persisted");
  }
  return data as "SETTLED" | "PENDING_CAPTURE" | "PENDING_RELEASE" | "DEAD";
}

export async function processNextCreativeCreditSettlement(): Promise<CreativeCreditSettlementResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "claim_next_creative_credit_settlement",
    { p_lease_seconds: SETTLEMENT_LEASE_SECONDS },
  );
  if (error) {
    throw new Error("Creative credit settlement claim failed");
  }
  const claim = parseClaim(data);
  if (!claim) {
    return { processed: false, jobId: null, status: "IDLE" };
  }

  try {
    if (claim.outcome === "capture") {
      await commitCreditReservation({
        userId: claim.userId,
        reservationId: claim.reservationId,
        provider: claim.provider,
      });
    } else {
      await releaseCreditReservation({
        userId: claim.userId,
        reservationId: claim.reservationId,
        provider: claim.provider,
      });
    }
    await finishClaim({ claim, succeeded: true });
    return { processed: true, jobId: claim.jobId, status: "SETTLED" };
  } catch (settlementError) {
    const persisted = await finishClaim({
      claim,
      succeeded: false,
      error: settlementError,
    });
    console.error("creative_credit_settlement_retry_scheduled", {
      jobId: claim.jobId,
      provider: claim.provider,
      outcome: claim.outcome,
      attemptCount: claim.attemptCount,
      status: persisted,
      message: safeError(settlementError),
    });
    return {
      processed: true,
      jobId: claim.jobId,
      status: persisted === "DEAD" ? "DEAD" : "RETRYABLE",
    };
  }
}
