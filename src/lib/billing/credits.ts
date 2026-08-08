import "server-only";

import { createAdminClient } from "../supabase/admin";

/** Billable product actions — prices live in credit_action_costs. */
export const CREDIT_ACTION_KEYS = [
  "creative.generate_copy_set",
  "creative.generate_image_master",
  "creative.render_placement",
  "creative.inspire_from_upload",
  "organic_boost.plan_candidate",
  "organic_boost.execute_plan",
  "campaign.launch_chain",
  "credits.top_up_pack",
] as const;

export type CreditActionKey = (typeof CREDIT_ACTION_KEYS)[number];

export type CreditBalance = {
  balance: number;
  periodStart: string | null;
  periodEnd: string | null;
  periodGranted: number;
  carryoverApplied: number;
  planKey: string | null;
  planName: string | null;
  subscriptionStatus: string | null;
};

export type CreditReservation = {
  reservationId: string;
  amount: number;
  balanceAfter: number;
  alreadyExisted: boolean;
};

export class InsufficientCreditsError extends Error {
  readonly code = "INSUFFICIENT_CREDITS" as const;

  constructor() {
    super("INSUFFICIENT_CREDITS");
    this.name = "InsufficientCreditsError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function isCreditActionKey(value: string): value is CreditActionKey {
  return (CREDIT_ACTION_KEYS as readonly string[]).includes(value);
}

/** Map RPC / PostgREST errors to typed insufficient-credits failures. */
export function creditErrorFromUnknown(error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.message === "string"
        ? error.message
        : String(error ?? "credit_operation_failed");

  if (message.includes("INSUFFICIENT_CREDITS")) {
    return new InsufficientCreditsError();
  }

  return error instanceof Error ? error : new Error(message);
}

export async function getCreditBalanceForUser(
  userId: string,
): Promise<CreditBalance | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("credit_wallets")
    .select(
      "balance, period_start, period_end, period_granted, carryover_applied",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw creditErrorFromUnknown(error);
  }

  const { data: sub, error: subError } = await admin
    .from("billing_subscriptions")
    .select("status, billing_plans(plan_key, display_name)")
    .eq("user_id", userId)
    .in("status", ["TRIALING", "ACTIVE", "PAST_DUE"])
    .maybeSingle();

  if (subError) {
    throw creditErrorFromUnknown(subError);
  }

  const plan = isRecord(sub?.billing_plans) ? sub.billing_plans : null;

  if (!data && !sub) {
    return null;
  }

  return {
    balance: asInt(data?.balance),
    periodStart:
      typeof data?.period_start === "string" ? data.period_start : null,
    periodEnd: typeof data?.period_end === "string" ? data.period_end : null,
    periodGranted: asInt(data?.period_granted),
    carryoverApplied: asInt(data?.carryover_applied),
    planKey: typeof plan?.plan_key === "string" ? plan.plan_key : null,
    planName: typeof plan?.display_name === "string" ? plan.display_name : null,
    subscriptionStatus: typeof sub?.status === "string" ? sub.status : null,
  };
}

export async function assignBillingPlan(input: {
  userId: string;
  planKey: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_assign_billing_plan", {
    p_user_id: input.userId,
    p_plan_key: input.planKey,
    ...(input.periodStart ? { p_period_start: input.periodStart } : {}),
    ...(input.periodEnd ? { p_period_end: input.periodEnd } : {}),
  });

  if (error) {
    throw creditErrorFromUnknown(error);
  }

  if (typeof data !== "string" || !data) {
    throw new Error("Billing plan assignment returned no subscription id");
  }

  return data;
}

export async function topUpCredits(input: {
  userId: string;
  credits: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("top_up_credits", {
    p_user_id: input.userId,
    p_credits: input.credits,
    p_idempotency_key: input.idempotencyKey,
    p_metadata: input.metadata ?? {},
  });

  if (error) {
    throw creditErrorFromUnknown(error);
  }

  return asInt(data);
}

export async function reserveCredits(input: {
  userId: string;
  actionKey: CreditActionKey | string;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  ttlSeconds?: number;
}): Promise<CreditReservation> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_credits", {
    p_user_id: input.userId,
    p_action_key: input.actionKey,
    p_idempotency_key: input.idempotencyKey,
    p_reference_type: input.referenceType ?? null,
    p_reference_id: input.referenceId ?? null,
    p_ttl_seconds: input.ttlSeconds ?? 900,
  });

  if (error) {
    throw creditErrorFromUnknown(error);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!isRecord(row) || typeof row.reservation_id !== "string") {
    throw new Error("Credit reservation returned an invalid payload");
  }

  return {
    reservationId: row.reservation_id,
    amount: asInt(row.amount),
    balanceAfter: asInt(row.balance_after),
    alreadyExisted: row.already_existed === true,
  };
}

export async function commitCreditReservation(input: {
  userId: string;
  reservationId: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("commit_credit_reservation", {
    p_user_id: input.userId,
    p_reservation_id: input.reservationId,
  });

  if (error) {
    throw creditErrorFromUnknown(error);
  }

  return data === true;
}

export async function releaseCreditReservation(input: {
  userId: string;
  reservationId: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("release_credit_reservation", {
    p_user_id: input.userId,
    p_reservation_id: input.reservationId,
  });

  if (error) {
    throw creditErrorFromUnknown(error);
  }

  return data === true;
}

/**
 * Reserve → run work → commit on success / release on failure.
 * Does not yet gate Meta paths; call from new billable features when ready.
 */
export async function withCreditReservation<T>(input: {
  userId: string;
  actionKey: CreditActionKey | string;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  run: (reservation: CreditReservation) => Promise<T>;
}): Promise<T> {
  const reservation = await reserveCredits({
    userId: input.userId,
    actionKey: input.actionKey,
    idempotencyKey: input.idempotencyKey,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
  });

  try {
    const result = await input.run(reservation);
    await commitCreditReservation({
      userId: input.userId,
      reservationId: reservation.reservationId,
    });
    return result;
  } catch (error) {
    try {
      await releaseCreditReservation({
        userId: input.userId,
        reservationId: reservation.reservationId,
      });
    } catch (releaseError) {
      console.error("credit_reservation_release_failed", {
        reservationId: reservation.reservationId,
        message:
          releaseError instanceof Error
            ? releaseError.message
            : "release_failed",
      });
    }
    throw error;
  }
}
