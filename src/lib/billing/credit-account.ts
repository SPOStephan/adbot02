import "server-only";

import { createHash } from "node:crypto";

import { hasActiveDirectAdbotSubscription } from "@/lib/kiready/entitlement";
import { createAdminClient } from "@/lib/supabase/admin";
import { createWaizrAccount } from "./waizr-credit-client";

export type AdbotCreditOwner = {
  ownerType: "organization" | "user";
  ownerId: string;
  externalOrganizationId: string;
  displayName: string;
};

const accountCache = new Map<string, string>();

function accountIdempotencyKey(externalOrganizationId: string): string {
  const digest = createHash("sha256")
    .update(`adbot-credit-account:${externalOrganizationId}`)
    .digest("hex");
  return `account:${digest}`;
}

export async function resolveAdbotCreditOwner(
  userId: string,
): Promise<AdbotCreditOwner> {
  if (await hasActiveDirectAdbotSubscription(userId)) {
    return {
      ownerType: "user",
      ownerId: userId,
      externalOrganizationId: `direct-user:${userId}`,
      displayName: `Adbot Direktkunde ${userId}`,
    };
  }

  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("adbot_organization_memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (membershipError) {
    throw new Error("Adbot-Unternehmenszuordnung konnte nicht geladen werden.");
  }

  if (typeof membership?.organization_id === "string") {
    const ownerId = membership.organization_id;
    return {
      ownerType: "organization",
      ownerId,
      externalOrganizationId: `organization:${ownerId}`,
      displayName: `Adbot Organisation ${ownerId}`,
    };
  }

  return {
    ownerType: "user",
    ownerId: userId,
    externalOrganizationId: `user:${userId}`,
    displayName: `Adbot Nutzer ${userId}`,
  };
}

export async function getOrCreateWaizrCreditAccountForUser(
  userId: string,
): Promise<{ accountId: string; owner: AdbotCreditOwner }> {
  const owner = await resolveAdbotCreditOwner(userId);
  const cached = accountCache.get(owner.externalOrganizationId);
  if (cached) return { accountId: cached, owner };

  const account = await createWaizrAccount({
    displayName: owner.displayName,
    externalOrganizationId: owner.externalOrganizationId,
    idempotencyKey: accountIdempotencyKey(owner.externalOrganizationId),
  });
  if (account.status !== "active") {
    throw new Error("Das zentrale Credit-Konto ist nicht aktiv.");
  }
  accountCache.set(owner.externalOrganizationId, account.id);
  return { accountId: account.id, owner };
}

export function clearCreditAccountCacheForTests(): void {
  accountCache.clear();
}
