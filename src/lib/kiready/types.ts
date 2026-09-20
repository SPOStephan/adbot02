export const KIREADY_ROLES = ["owner", "admin", "member"] as const;
export type KireadyAdbotRole = (typeof KIREADY_ROLES)[number];

export const KIREADY_PERMISSIONS = [
  "adbot:use",
  "adbot:manage_members",
  "adbot:manage_billing",
  "adbot:approve_launch",
] as const;
export type KireadyAdbotPermission = (typeof KIREADY_PERMISSIONS)[number];

export const KIREADY_ENTITLEMENT_STATUSES = [
  "trialing",
  "active",
  "cancel_at_period_end",
  "past_due",
  "canceled",
  "expired",
] as const;
export type KireadyEntitlementStatus = (typeof KIREADY_ENTITLEMENT_STATUSES)[number];

export type KireadyAdbotContext = {
  version: string;
  identity: {
    subject: string;
    email: string;
    emailVerified: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    role: KireadyAdbotRole | string;
    permissions: string[];
  };
  entitlement: {
    productCode: string;
    planCode: string;
    status: KireadyEntitlementStatus | string;
    validUntil: string | null;
    hasAccess: boolean;
  };
};

export type KireadyOidcClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
};

export type PendingKireadyLink = {
  v: 1;
  issuer: string;
  subject: string;
  email: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: string;
  permissions: string[];
  entitlementStatus: string;
  entitlementPlanCode: string;
  entitlementValidUntil: string | null;
  entitlementHasAccess: boolean;
  existingUserId: string;
  next: string;
  iat: number;
  exp: number;
};

export class KireadyAccessError extends Error {
  readonly code: "kiready_denied" | "kiready_past_due";

  constructor(code: "kiready_denied" | "kiready_past_due", message: string) {
    super(message);
    this.name = "KireadyAccessError";
    this.code = code;
  }
}
