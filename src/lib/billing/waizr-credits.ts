import "server-only";

import {
  assertCreditAmount,
  creditActionCost,
  type CreditBalance,
  type CreditReservation,
  waizrServiceCode,
} from "./credit-contract";
import { CreditServiceContractError } from "./credit-errors";
import { getOrCreateWaizrCreditAccountForUser } from "./credit-account";
import { getCreditBalanceForUser as getLegacyCreditBalanceForUser } from "./legacy-credits";
import {
  captureWaizrReservation,
  createWaizrQuote,
  createWaizrReservation,
  getWaizrBalance,
  releaseWaizrReservation,
} from "./waizr-credit-client";

function idempotencyKey(prefix: string, source: string): string {
  return `${prefix}:${source}`.slice(0, 200);
}

function actionReference(actionKey: string, source: string): string {
  return `adbot:${actionKey}:${source}`.slice(0, 240);
}

async function reserveAmount(input: {
  userId: string;
  actionKey: string;
  amount: number;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  ttlSeconds?: number;
}): Promise<CreditReservation> {
  const amount = assertCreditAmount(input.amount);
  const { accountId } = await getOrCreateWaizrCreditAccountForUser(input.userId);
  const serviceCode = waizrServiceCode(input.actionKey);
  const reference = actionReference(input.actionKey, input.idempotencyKey);
  const metadata = {
    adbotUserId: input.userId,
    actionKey: input.actionKey,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
  };
  const quote = await createWaizrQuote({
    accountId,
    serviceCode,
    amount,
    idempotencyKey: idempotencyKey("quote", input.idempotencyKey),
    metadata,
  });
  if (
    quote.accountId !== accountId ||
    quote.serviceCode !== serviceCode ||
    quote.amount !== amount
  ) {
    throw new CreditServiceContractError(
      `Das zentrale Angebot für ${serviceCode} entspricht nicht der angeforderten Leistung.`,
    );
  }
  const reservation = await createWaizrReservation({
    accountId,
    quoteId: quote.id,
    actionReference: reference,
    expiresInSeconds: Math.max(60, Math.min(input.ttlSeconds ?? 900, 86_400)),
    idempotencyKey: idempotencyKey("reserve", input.idempotencyKey),
    metadata,
  });
  if (
    reservation.accountId !== accountId ||
    reservation.quoteId !== quote.id ||
    reservation.actionReference !== reference ||
    reservation.status !== "reserved" ||
    reservation.amountReserved !== amount
  ) {
    throw new CreditServiceContractError(
      `Die zentrale Reservation für ${serviceCode} entspricht nicht der angeforderten Leistung.`,
    );
  }
  const balance = await getWaizrBalance(accountId);
  return {
    provider: "waizr",
    reservationId: reservation.id,
    amount: reservation.amountReserved,
    balanceAfter: balance.available,
    alreadyExisted: reservation.alreadyExisted,
  };
}

export async function getCreditBalanceForUser(
  userId: string,
): Promise<CreditBalance | null> {
  const [{ accountId }, local] = await Promise.all([
    getOrCreateWaizrCreditAccountForUser(userId),
    getLegacyCreditBalanceForUser(userId).catch(() => null),
  ]);
  const balance = await getWaizrBalance(accountId);
  return {
    balance: balance.available,
    periodStart: local?.periodStart ?? null,
    periodEnd: local?.periodEnd ?? balance.nextExpiryAt,
    periodGranted: local?.periodGranted ?? 0,
    carryoverApplied: local?.carryoverApplied ?? 0,
    planKey: local?.planKey ?? null,
    planName: local?.planName ?? null,
    subscriptionStatus: local?.subscriptionStatus ?? null,
  };
}

export async function reserveCredits(input: {
  userId: string;
  actionKey: string;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  ttlSeconds?: number;
}): Promise<CreditReservation> {
  const amount = creditActionCost(input.actionKey);
  if (amount <= 0) {
    throw new Error("Credit action cannot be reserved at zero cost");
  }
  return reserveAmount({ ...input, amount });
}

export async function reserveCreditsAmount(input: {
  userId: string;
  actionKey: string;
  amount: number;
  idempotencyKey: string;
  referenceType?: string;
  referenceId?: string;
  ttlSeconds?: number;
}): Promise<CreditReservation> {
  const floor = creditActionCost(input.actionKey);
  return reserveAmount({ ...input, amount: Math.max(floor, input.amount) });
}

export async function commitCreditReservation(input: {
  reservationId: string;
}): Promise<boolean> {
  const reservation = await captureWaizrReservation({
    reservationId: input.reservationId,
    idempotencyKey: idempotencyKey("capture", input.reservationId),
  });
  if (reservation.id !== input.reservationId) {
    throw new CreditServiceContractError(
      "Der Credit-Service bestätigte eine andere Reservation als angefordert.",
    );
  }
  return reservation.status === "captured";
}

export async function releaseCreditReservation(input: {
  reservationId: string;
}): Promise<boolean> {
  const reservation = await releaseWaizrReservation({
    reservationId: input.reservationId,
    idempotencyKey: idempotencyKey("release", input.reservationId),
    reason: "Adbot-Aktion nicht ausgeführt oder fehlgeschlagen",
  });
  if (reservation.id !== input.reservationId) {
    throw new CreditServiceContractError(
      "Der Credit-Service bestätigte eine andere Reservation als angefordert.",
    );
  }
  return reservation.status === "released" || reservation.status === "expired";
}

export async function topUpCredits(input: {
  userId: string;
  credits: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  void input;
  throw new CreditServiceContractError(
    "Credit-Käufe benötigen einen getrennten, webhookgebundenen Fulfillment-Client und dürfen nicht über den Adbot-Laufzeitclient gebucht werden.",
  );
}
