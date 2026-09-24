import "server-only";

import { assertAdbotPaidActionAllowed } from "@/lib/kiready/entitlement";
import {
  CREDIT_ACTION_KEYS,
  creditProviderFromEnvironment,
  isCreditActionKey,
  type CreditActionKey,
  type CreditBalance,
  type CreditProvider,
  type CreditReservation,
} from "./credit-contract";
import {
  CreditServiceContractError,
  CreditServiceUnavailableError,
  InsufficientCreditsError,
} from "./credit-errors";
import * as legacy from "./legacy-credits";
import * as waizr from "./waizr-credits";

export {
  CREDIT_ACTION_KEYS,
  CreditServiceContractError,
  CreditServiceUnavailableError,
  InsufficientCreditsError,
  isCreditActionKey,
};
export type {
  CreditActionKey,
  CreditBalance,
  CreditProvider,
  CreditReservation,
};

export function getCreditProvider(): CreditProvider {
  return creditProviderFromEnvironment(process.env.ADBOT_CREDIT_PROVIDER);
}

export async function getCreditBalanceForUser(
  userId: string,
): Promise<CreditBalance | null> {
  return getCreditProvider() === "waizr"
    ? waizr.getCreditBalanceForUser(userId)
    : legacy.getCreditBalanceForUser(userId);
}

export async function assignBillingPlan(input: {
  userId: string;
  planKey: string;
  periodStart?: string;
  periodEnd?: string;
}): Promise<string> {
  if (getCreditProvider() === "waizr") {
    throw new CreditServiceContractError(
      "Planwechsel müssen im waizr-Credit-Modus über den Abrechnungs-Fulfillment-Prozess gewährt werden.",
    );
  }
  return legacy.assignBillingPlan(input);
}

export async function topUpCredits(input: {
  userId: string;
  credits: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  return getCreditProvider() === "waizr"
    ? waizr.topUpCredits(input)
    : legacy.topUpCredits(input);
}

export async function reserveCredits(input: {
  userId: string;
  actionKey: CreditActionKey | string;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  ttlSeconds?: number;
}): Promise<CreditReservation> {
  await assertAdbotPaidActionAllowed(input.userId);
  if (getCreditProvider() === "waizr") {
    return waizr.reserveCredits(input);
  }
  return { provider: "legacy", ...(await legacy.reserveCredits(input)) };
}

export async function reserveCreditsAmount(input: {
  userId: string;
  actionKey: CreditActionKey | string;
  amount: number;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  ttlSeconds?: number;
}): Promise<CreditReservation> {
  await assertAdbotPaidActionAllowed(input.userId);
  if (getCreditProvider() === "waizr") {
    return waizr.reserveCreditsAmount(input);
  }
  return { provider: "legacy", ...(await legacy.reserveCreditsAmount(input)) };
}

export async function commitCreditReservation(input: {
  userId: string;
  reservationId: string;
  provider?: CreditProvider;
}): Promise<boolean> {
  const provider = input.provider ?? getCreditProvider();
  return provider === "waizr"
    ? waizr.commitCreditReservation({ reservationId: input.reservationId })
    : legacy.commitCreditReservation(input);
}

export async function releaseCreditReservation(input: {
  userId: string;
  reservationId: string;
  provider?: CreditProvider;
}): Promise<boolean> {
  const provider = input.provider ?? getCreditProvider();
  return provider === "waizr"
    ? waizr.releaseCreditReservation({ reservationId: input.reservationId })
    : legacy.releaseCreditReservation(input);
}

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
      provider: reservation.provider,
    });
    return result;
  } catch (error) {
    try {
      await releaseCreditReservation({
        userId: input.userId,
        reservationId: reservation.reservationId,
        provider: reservation.provider,
      });
    } catch (releaseError) {
      console.error("credit_reservation_release_failed", {
        reservationId: reservation.reservationId,
        provider: reservation.provider,
        message:
          releaseError instanceof Error ? releaseError.message : "release_failed",
      });
    }
    throw error;
  }
}
