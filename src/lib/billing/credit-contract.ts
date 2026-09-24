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
export type CreditProvider = "legacy" | "waizr";

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
  provider: CreditProvider;
  reservationId: string;
  amount: number;
  balanceAfter: number;
  alreadyExisted: boolean;
};

const ACTION_COSTS: Readonly<Record<CreditActionKey, number>> = {
  "creative.generate_copy_set": 5,
  "creative.generate_image_master": 20,
  "creative.render_placement": 3,
  "creative.inspire_from_upload": 8,
  "organic_boost.plan_candidate": 2,
  "organic_boost.execute_plan": 10,
  "campaign.launch_chain": 40,
  "credits.top_up_pack": 0,
};

export function isCreditActionKey(value: string): value is CreditActionKey {
  return (CREDIT_ACTION_KEYS as readonly string[]).includes(value);
}

export function creditActionCost(actionKey: string): number {
  if (!isCreditActionKey(actionKey)) {
    throw new Error(`Unknown Adbot credit action: ${actionKey}`);
  }
  return ACTION_COSTS[actionKey];
}

export function waizrServiceCode(actionKey: string): string {
  if (!isCreditActionKey(actionKey) || actionKey === "credits.top_up_pack") {
    throw new Error(`Action cannot be reserved through waizr Credit API: ${actionKey}`);
  }
  return `adbot.${actionKey}`;
}

export function parseCreditProvider(value: unknown): CreditProvider | null {
  return value === "legacy" || value === "waizr" ? value : null;
}

export function creditProviderFromEnvironment(
  value: string | undefined,
): CreditProvider {
  const normalized = value?.trim().toLowerCase() || "legacy";
  if (normalized === "legacy" || normalized === "waizr") {
    return normalized;
  }
  throw new Error("ADBOT_CREDIT_PROVIDER muss legacy oder waizr sein.");
}

export function assertCreditAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) {
    throw new Error("Credit reservation amount is invalid");
  }
  return value;
}

export function billingReferenceFromPayload(value: unknown): {
  provider: CreditProvider;
  reservationId: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const billing = (value as Record<string, unknown>)._billing;
  if (!billing || typeof billing !== "object" || Array.isArray(billing)) return null;
  const provider = parseCreditProvider(
    (billing as Record<string, unknown>).credit_provider,
  );
  const reservationId = (billing as Record<string, unknown>)
    .credit_reservation_id;
  if (!provider || typeof reservationId !== "string" || !reservationId) return null;
  return { provider, reservationId };
}

export function withBillingReference<T extends Record<string, unknown>>(
  payload: T,
  reservation: Pick<CreditReservation, "provider" | "reservationId">,
): T & { _billing: { credit_provider: CreditProvider; credit_reservation_id: string } } {
  return {
    ...payload,
    _billing: {
      credit_provider: reservation.provider,
      credit_reservation_id: reservation.reservationId,
    },
  };
}
