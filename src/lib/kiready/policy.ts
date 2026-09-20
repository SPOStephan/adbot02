export type KireadyAccessReason =
  | "unlinked"
  | "ok"
  | "past_due"
  | "no_personal_use"
  | "no_company_access"
  | "canceled"
  | "expired";

function validUntilAllowsAccess(validUntil: string | null, now = Date.now()): boolean {
  if (!validUntil) return true;
  const ms = Date.parse(validUntil);
  if (!Number.isFinite(ms)) return false;
  return ms > now;
}

export function decideKireadyAccess(input: {
  hasAccess: boolean;
  status: string;
  validUntil: string | null;
  hasAdbotUse: boolean;
}): KireadyAccessReason {
  if (!input.hasAdbotUse) return "no_personal_use";
  if (input.status === "canceled") return "canceled";
  if (input.status === "expired") return "expired";
  if (input.status === "cancel_at_period_end" && !validUntilAllowsAccess(input.validUntil)) {
    return "expired";
  }
  if (!input.hasAccess && input.status !== "past_due") return "no_company_access";
  if (input.status === "past_due") return "past_due";
  if (
    input.status === "trial" ||
    input.status === "trialing" ||
    input.status === "active" ||
    input.status === "cancel_at_period_end"
  ) {
    return "ok";
  }
  return input.hasAccess ? "ok" : "no_company_access";
}

export function accessFromDecision(reason: KireadyAccessReason): {
  allowDashboard: boolean;
  allowPaidActions: boolean;
} {
  if (reason === "ok") return { allowDashboard: true, allowPaidActions: true };
  if (reason === "past_due") return { allowDashboard: true, allowPaidActions: false };
  return { allowDashboard: false, allowPaidActions: false };
}

export function denialMessage(reason: KireadyAccessReason): string {
  switch (reason) {
    case "no_personal_use":
      return "Dein Unternehmen hat Adbot, aber du bist persönlich nicht freigeschaltet.";
    case "no_company_access":
      return "Für dieses Unternehmen ist Adbot derzeit nicht freigeschaltet.";
    case "canceled":
    case "expired":
      return "Die Adbot-Freischaltung ist beendet. Abrechnung und Reaktivierung laufen über KIready.";
    case "past_due":
      return "Die Zahlung ist überfällig. Du siehst bestehende Daten, neue Starts sind gesperrt.";
    default:
      return "Kein produktiver Adbot-Zugriff.";
  }
}
