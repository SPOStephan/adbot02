import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { encryptKireadySecret } from "@/lib/kiready/crypto";
import type { KireadyOidcEnv } from "@/lib/kiready/env";
import type { KireadyAdbotContext } from "@/lib/kiready/types";
import { hasPersonalAdbotUse } from "@/lib/kiready/parse";

export type LinkedKireadyUser = {
  userId: string;
  created: boolean;
};

function mapRole(role: string): "owner" | "admin" | "member" {
  if (role === "owner" || role === "admin") return role;
  return "member";
}

async function upsertOrganization(
  admin: ReturnType<typeof createAdminClient>,
  context: KireadyAdbotContext,
) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("adbot_organizations")
    .upsert(
      {
        kiready_organization_id: context.organization.id,
        name: context.organization.name,
        slug: context.organization.slug || null,
        entitlement_status: context.entitlement.status,
        entitlement_plan_code: context.entitlement.planCode || null,
        entitlement_valid_until: context.entitlement.validUntil,
        entitlement_has_access: context.entitlement.hasAccess,
        entitlement_source: "kiready_context",
        entitlement_updated_at: now,
        updated_at: now,
      },
      { onConflict: "kiready_organization_id" },
    )
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    throw new Error("Adbot-Unternehmenskonto konnte nicht gespeichert werden.");
  }
  return String(data.id);
}

async function upsertMembership(
  admin: ReturnType<typeof createAdminClient>,
  input: { organizationId: string; userId: string; context: KireadyAdbotContext },
) {
  const now = new Date().toISOString();
  const { error } = await admin.from("adbot_organization_memberships").upsert(
    {
      organization_id: input.organizationId,
      user_id: input.userId,
      role: mapRole(input.context.membership.role),
      permissions: input.context.membership.permissions,
      has_adbot_use: hasPersonalAdbotUse(input.context),
      updated_at: now,
    },
    { onConflict: "organization_id,user_id" },
  );
  if (error) {
    throw new Error("Adbot-Mitgliedschaft konnte nicht gespeichert werden.");
  }
}

function tokenColumns(
  env: KireadyOidcEnv,
  tokens: { accessToken: string; refreshToken: string | null; expiresIn: number | null },
) {
  if (!env.tokenEncryptionKey) {
    return {
      access_token_ciphertext: null,
      access_token_iv: null,
      access_token_tag: null,
      refresh_token_ciphertext: null,
      refresh_token_iv: null,
      refresh_token_tag: null,
      token_expires_at: null,
    };
  }
  const access = encryptKireadySecret(tokens.accessToken, env.tokenEncryptionKey);
  const refresh = tokens.refreshToken
    ? encryptKireadySecret(tokens.refreshToken, env.tokenEncryptionKey)
    : null;
  return {
    access_token_ciphertext: access.ciphertext,
    access_token_iv: access.iv,
    access_token_tag: access.authTag,
    refresh_token_ciphertext: refresh?.ciphertext ?? null,
    refresh_token_iv: refresh?.iv ?? null,
    refresh_token_tag: refresh?.authTag ?? null,
    token_expires_at: tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
      : null,
  };
}

export async function findIdentity(input: { issuer: string; subject: string }) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("kiready_external_identities")
    .select("local_user_id")
    .eq("issuer", input.issuer)
    .eq("subject", input.subject)
    .maybeSingle();
  return data?.local_user_id ? String(data.local_user_id) : null;
}

export async function findUsersByVerifiedEmail(email: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("id")
    .ilike("email", email);
  const ids = (data ?? [])
    .map((row) => (typeof row.id === "string" ? row.id : ""))
    .filter(Boolean);
  return [...new Set(ids)];
}

export async function persistKireadyLink(input: {
  env: KireadyOidcEnv;
  context: KireadyAdbotContext;
  userId: string;
  tokens: { accessToken: string; refreshToken: string | null; expiresIn: number | null };
}): Promise<void> {
  const admin = createAdminClient();
  const organizationId = await upsertOrganization(admin, input.context);
  await upsertMembership(admin, {
    organizationId,
    userId: input.userId,
    context: input.context,
  });
  const now = new Date().toISOString();
  const { error } = await admin.from("kiready_external_identities").upsert(
    {
      issuer: input.env.issuer,
      subject: input.context.identity.subject,
      local_user_id: input.userId,
      kiready_organization_id: input.context.organization.id,
      email_at_link: input.context.identity.email,
      last_login_at: now,
      ...tokenColumns(input.env, input.tokens),
    },
    { onConflict: "issuer,subject" },
  );
  if (error) {
    throw new Error("KIready-Identität konnte nicht verknüpft werden.");
  }
}

export async function createLocalAdbotUser(email: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { provider: "kiready" },
    app_metadata: { provider: "kiready" },
  });
  if (error || !data.user?.id) {
    const existing = await findUsersByVerifiedEmail(email);
    if (existing.length === 1) return existing[0];
    throw new Error("Lokales Adbot-Konto konnte nicht angelegt werden.");
  }
  return data.user.id;
}

export async function emailForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("email").eq("id", userId).maybeSingle();
  return typeof data?.email === "string" ? data.email : null;
}
