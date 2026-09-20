import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { hasPersonalAdbotUse } from "@/lib/kiready/context";
import {
  accessFromDecision,
  decideKireadyAccess,
  denialMessage,
  type KireadyAccessReason,
} from "@/lib/kiready/policy";
import { KireadyAccessError, type KireadyAdbotContext } from "@/lib/kiready/types";

export { decideKireadyAccess, denialMessage };

export type KireadyAccessDecision = {
  linked: boolean;
  allowDashboard: boolean;
  allowPaidActions: boolean;
  reason: KireadyAccessReason;
  status: string | null;
  organizationName: string | null;
};

export function decideAccessFromContext(context: KireadyAdbotContext): KireadyAccessDecision {
  const reason = decideKireadyAccess({
    hasAccess: context.entitlement.hasAccess,
    status: context.entitlement.status,
    validUntil: context.entitlement.validUntil,
    hasAdbotUse: hasPersonalAdbotUse(context),
  });
  return {
    linked: true,
    ...accessFromDecision(reason),
    reason,
    status: context.entitlement.status,
    organizationName: context.organization.name,
  };
}

export async function getKireadyAccessForUser(userId: string): Promise<KireadyAccessDecision> {
  const admin = createAdminClient();
  const { data: identity } = await admin
    .from("kiready_external_identities")
    .select("kiready_organization_id")
    .eq("local_user_id", userId)
    .maybeSingle();
  if (!identity) {
    return {
      linked: false,
      allowDashboard: true,
      allowPaidActions: true,
      reason: "unlinked",
      status: null,
      organizationName: null,
    };
  }

  const { data: membership } = await admin
    .from("adbot_organization_memberships")
    .select("has_adbot_use, organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  const { data: organization } = membership?.organization_id
    ? await admin
        .from("adbot_organizations")
        .select("name, entitlement_status, entitlement_valid_until, entitlement_has_access")
        .eq("id", membership.organization_id)
        .maybeSingle()
    : { data: null };

  const reason = decideKireadyAccess({
    hasAccess: organization?.entitlement_has_access === true,
    status: String(organization?.entitlement_status ?? "expired"),
    validUntil:
      typeof organization?.entitlement_valid_until === "string"
        ? organization.entitlement_valid_until
        : null,
    hasAdbotUse: membership?.has_adbot_use === true,
  });

  return {
    linked: true,
    ...accessFromDecision(reason),
    reason,
    status: typeof organization?.entitlement_status === "string" ? organization.entitlement_status : null,
    organizationName: typeof organization?.name === "string" ? organization.name : null,
  };
}

export async function assertKireadyPaidActionAllowed(userId: string): Promise<void> {
  const access = await getKireadyAccessForUser(userId).catch(() => null);
  if (!access) return;
  if (!access.linked) return;
  if (access.allowPaidActions) return;
  if (access.reason === "past_due") {
    throw new KireadyAccessError(
      "kiready_past_due",
      "Die Adbot-Freischaltung ist zahlungsrückständig. Neue kostenpflichtige Aktionen und Kampagnenstarts sind gesperrt.",
    );
  }
  throw new KireadyAccessError(
    "kiready_denied",
    "Kein produktiver Adbot-Zugriff. Bitte die Freischaltung in KIready prüfen.",
  );
}
