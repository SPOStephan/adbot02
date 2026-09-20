import { KIREADY_ROLES, type KireadyAdbotContext } from "@/lib/kiready/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseKireadyAdbotContext(raw: unknown): KireadyAdbotContext | null {
  if (!isRecord(raw)) return null;
  const identity = isRecord(raw.identity) ? raw.identity : null;
  const organization = isRecord(raw.organization) ? raw.organization : null;
  const membership = isRecord(raw.membership) ? raw.membership : null;
  const entitlement = isRecord(raw.entitlement) ? raw.entitlement : null;
  if (!identity || !organization || !membership || !entitlement) return null;

  const subject = text(identity.subject);
  const email = text(identity.email).toLowerCase();
  const organizationId = text(organization.id);
  if (!subject || !email || !organizationId) return null;

  const permissions = Array.isArray(membership.permissions)
    ? membership.permissions.filter((item): item is string => typeof item === "string")
    : [];
  const role = text(membership.role) || "member";

  return {
    version: text(raw.version) || "2026-09-20",
    identity: {
      subject,
      email,
      emailVerified: identity.emailVerified === true,
    },
    organization: {
      id: organizationId,
      name: text(organization.name) || organizationId,
      slug: text(organization.slug),
    },
    membership: {
      role: KIREADY_ROLES.includes(role as (typeof KIREADY_ROLES)[number])
        ? role
        : "member",
      permissions,
    },
    entitlement: {
      productCode: text(entitlement.productCode) || "adbot",
      planCode: text(entitlement.planCode),
      status: text(entitlement.status) || "expired",
      validUntil:
        typeof entitlement.validUntil === "string" ? entitlement.validUntil : null,
      hasAccess: entitlement.hasAccess === true,
    },
  };
}

export function hasPersonalAdbotUse(context: KireadyAdbotContext): boolean {
  return context.membership.permissions.includes("adbot:use");
}
