import "server-only";

import { checkCustomDomainCname } from "@/lib/custom-domains/dns";
import {
  assertValidCustomHostname,
  DEFAULT_CUSTOM_DOMAIN_DNS_TARGET,
  normalizeCustomHostname,
  type CustomerCustomDomainView,
} from "@/lib/custom-domains/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export class CustomDomainServiceError extends Error {
  status: number;
  code: string;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CustomDomainServiceError";
    this.code = code;
    this.status = status;
  }
}

function mapRow(row: Record<string, unknown>): CustomerCustomDomainView | null {
  const status = String(row.status ?? "");
  if (status !== "PENDING_DNS" && status !== "READY") return null;
  return {
    id: String(row.id),
    hostname: String(row.hostname),
    label: String(row.label ?? ""),
    status,
    dnsTarget: String(row.dns_target ?? DEFAULT_CUSTOM_DOMAIN_DNS_TARGET),
    notes: String(row.notes ?? ""),
    lastDnsCheckAt: row.last_dns_check_at
      ? String(row.last_dns_check_at)
      : null,
    lastDnsMessage: String(row.last_dns_message ?? ""),
    createdAt: String(row.created_at),
  };
}

export async function requireAuthenticatedUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new CustomDomainServiceError(
      "unauthorized",
      401,
      "Bitte melde dich an.",
    );
  }
  return user.id;
}

export async function listCustomerCustomDomains(
  userId: string,
): Promise<CustomerCustomDomainView[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("customer_custom_domains")
    .select(
      "id,hostname,label,status,dns_target,notes,last_dns_check_at,last_dns_message,created_at",
    )
    .eq("user_id", userId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    throw new CustomDomainServiceError(
      "list_failed",
      500,
      "Domains konnten nicht geladen werden.",
    );
  }
  return (data ?? []).flatMap((row) => {
    const mapped = mapRow(row as Record<string, unknown>);
    return mapped ? [mapped] : [];
  });
}

export async function listReadyCustomerCustomDomains(
  userId: string,
): Promise<CustomerCustomDomainView[]> {
  const domains = await listCustomerCustomDomains(userId);
  return domains.filter((domain) => domain.status === "READY");
}

export async function registerCustomerCustomDomain(input: {
  userId: string;
  hostname: string;
  label?: string;
}): Promise<CustomerCustomDomainView> {
  const hostname = normalizeCustomHostname(input.hostname);
  assertValidCustomHostname(hostname);
  const label = (input.label ?? "").trim().slice(0, 120);

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("customer_custom_domains")
    .select("id,user_id,status")
    .eq("hostname", hostname)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .maybeSingle();
  if (existingError) {
    throw new CustomDomainServiceError(
      "register_failed",
      500,
      "Domain konnte nicht geprüft werden.",
    );
  }
  if (existing) {
    if (String(existing.user_id) !== input.userId) {
      throw new CustomDomainServiceError(
        "hostname_taken",
        409,
        "Diese Domain ist bereits verbunden.",
      );
    }
    throw new CustomDomainServiceError(
      "hostname_exists",
      409,
      "Diese Domain ist bereits in deinem Konto hinterlegt.",
    );
  }

  const { data, error } = await admin
    .from("customer_custom_domains")
    .insert({
      user_id: input.userId,
      hostname,
      label,
      status: "PENDING_DNS",
      dns_target: DEFAULT_CUSTOM_DOMAIN_DNS_TARGET,
      notes: "",
      last_dns_message: "",
    })
    .select(
      "id,hostname,label,status,dns_target,notes,last_dns_check_at,last_dns_message,created_at",
    )
    .single();
  if (error || !data) {
    throw new CustomDomainServiceError(
      "register_failed",
      500,
      "Domain konnte nicht gespeichert werden.",
    );
  }
  const mapped = mapRow(data as Record<string, unknown>);
  if (!mapped) {
    throw new CustomDomainServiceError(
      "register_failed",
      500,
      "Domain konnte nicht gespeichert werden.",
    );
  }
  return mapped;
}

export async function verifyCustomerCustomDomain(input: {
  userId: string;
  domainId: string;
  activate: boolean;
}): Promise<{
  domain: CustomerCustomDomainView;
  dnsOk: boolean;
  message: string;
}> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("customer_custom_domains")
    .select(
      "id,user_id,hostname,label,status,dns_target,notes,last_dns_check_at,last_dns_message,created_at,revoked_at",
    )
    .eq("id", input.domainId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error || !row || row.revoked_at) {
    throw new CustomDomainServiceError(
      "not_found",
      404,
      "Domain wurde nicht gefunden.",
    );
  }
  if (String(row.status) === "REVOKED") {
    throw new CustomDomainServiceError(
      "revoked",
      400,
      "Diese Domain wurde zurückgezogen.",
    );
  }

  const dnsTarget = String(row.dns_target ?? DEFAULT_CUSTOM_DOMAIN_DNS_TARGET);
  const check = await checkCustomDomainCname(String(row.hostname), dnsTarget);
  const now = new Date().toISOString();
  const nextStatus =
    input.activate && check.ok ? "READY" : String(row.status) === "READY" && check.ok
      ? "READY"
      : "PENDING_DNS";

  const { data: updated, error: updateError } = await admin
    .from("customer_custom_domains")
    .update({
      status: nextStatus,
      last_dns_check_at: now,
      last_dns_message: check.message,
      updated_at: now,
    })
    .eq("id", input.domainId)
    .eq("user_id", input.userId)
    .select(
      "id,hostname,label,status,dns_target,notes,last_dns_check_at,last_dns_message,created_at",
    )
    .single();
  if (updateError || !updated) {
    throw new CustomDomainServiceError(
      "verify_failed",
      500,
      "DNS-Prüfung konnte nicht gespeichert werden.",
    );
  }
  const mapped = mapRow(updated as Record<string, unknown>);
  if (!mapped) {
    throw new CustomDomainServiceError(
      "verify_failed",
      500,
      "DNS-Prüfung konnte nicht gespeichert werden.",
    );
  }

  if (input.activate && !check.ok) {
    throw new CustomDomainServiceError(
      "dns_not_ready",
      400,
      check.message,
    );
  }

  return {
    domain: mapped,
    dnsOk: check.ok,
    message: check.message,
  };
}

export async function revokeCustomerCustomDomain(input: {
  userId: string;
  domainId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("customer_custom_domains")
    .update({
      status: "REVOKED",
      revoked_at: now,
      updated_at: now,
    })
    .eq("id", input.domainId)
    .eq("user_id", input.userId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new CustomDomainServiceError(
      "revoke_failed",
      500,
      "Domain konnte nicht zurückgezogen werden.",
    );
  }
  if (!data) {
    throw new CustomDomainServiceError(
      "not_found",
      404,
      "Domain wurde nicht gefunden.",
    );
  }
}
