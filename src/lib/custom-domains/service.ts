import "server-only";

import { checkCustomDomainCname } from "@/lib/custom-domains/dns";
import {
  assertValidCustomHostname,
  DEFAULT_CUSTOM_DOMAIN_DNS_TARGET,
  normalizeCustomHostname,
  type CustomerCustomDomainBindingKind,
  type CustomerCustomDomainOrigin,
  type CustomerCustomDomainView,
} from "@/lib/custom-domains/types";
import type { ToolDomainSyncTool } from "@/lib/custom-domains/tool-domain-token";
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

const SELECT_COLS =
  "id,hostname,label,status,dns_target,notes,last_dns_check_at,last_dns_message,created_at,origin,binding_kind,binding_ref,binding_label,tool_domain_id";

function asOrigin(value: unknown): CustomerCustomDomainOrigin {
  if (value === "funnel" || value === "freebie" || value === "portal") {
    return value;
  }
  return "portal";
}

function asBindingKind(value: unknown): CustomerCustomDomainBindingKind {
  if (value === "funnel" || value === "freebie" || value === "none") {
    return value;
  }
  return "none";
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
    origin: asOrigin(row.origin),
    bindingKind: asBindingKind(row.binding_kind),
    bindingRef: row.binding_ref == null ? null : String(row.binding_ref),
    bindingLabel: String(row.binding_label ?? ""),
    toolDomainId:
      row.tool_domain_id == null ? null : String(row.tool_domain_id),
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
    .select(SELECT_COLS)
    .eq("user_id", userId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    // Binding columns may be missing before migration — fall back.
    const legacy = await admin
      .from("customer_custom_domains")
      .select(
        "id,hostname,label,status,dns_target,notes,last_dns_check_at,last_dns_message,created_at",
      )
      .eq("user_id", userId)
      .in("status", ["PENDING_DNS", "READY"])
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (legacy.error) {
      throw new CustomDomainServiceError(
        "list_failed",
        500,
        "Domains konnten nicht geladen werden.",
      );
    }
    return (legacy.data ?? []).flatMap((row) => {
      const mapped = mapRow(row as Record<string, unknown>);
      return mapped ? [mapped] : [];
    });
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
      origin: "portal",
      binding_kind: "none",
      binding_ref: null,
      binding_label: "",
      tool_domain_id: null,
    })
    .select(SELECT_COLS)
    .single();
  if (error || !data) {
    // Migration maybe not applied — retry without binding columns.
    if (error?.message?.includes("origin") || error?.code === "PGRST204") {
      const legacy = await admin
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
      if (legacy.error || !legacy.data) {
        throw new CustomDomainServiceError(
          "register_failed",
          500,
          "Domain konnte nicht gespeichert werden.",
        );
      }
      const mappedLegacy = mapRow(legacy.data as Record<string, unknown>);
      if (!mappedLegacy) {
        throw new CustomDomainServiceError(
          "register_failed",
          500,
          "Domain konnte nicht gespeichert werden.",
        );
      }
      return mappedLegacy;
    }
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
    .select(`${SELECT_COLS},user_id,revoked_at`)
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
    input.activate && check.ok
      ? "READY"
      : String(row.status) === "READY" && check.ok
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
    .select(SELECT_COLS)
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
    throw new CustomDomainServiceError("dns_not_ready", 400, check.message);
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
      binding_kind: "none",
      binding_ref: null,
      binding_label: "",
      tool_domain_id: null,
    })
    .eq("id", input.domainId)
    .eq("user_id", input.userId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    // Fallback without binding columns if migration missing
    const legacy = await admin
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
    if (legacy.error || !legacy.data) {
      throw new CustomDomainServiceError(
        "revoke_failed",
        500,
        "Domain konnte nicht zurückgezogen werden.",
      );
    }
    return;
  }
  if (!data) {
    throw new CustomDomainServiceError(
      "not_found",
      404,
      "Domain wurde nicht gefunden.",
    );
  }
}

/**
 * Upsert from Funnel/Freebie. Portal DB only — never writes to tool DBs.
 * Host routing remains in the tool that called us.
 */
export async function upsertCustomerCustomDomainFromTool(input: {
  userId: string;
  tool: ToolDomainSyncTool;
  hostname: string;
  status: "PENDING_DNS" | "READY";
  dnsTarget?: string;
  bindingRef?: string | null;
  bindingLabel?: string;
  toolDomainId?: string | null;
}): Promise<CustomerCustomDomainView> {
  const hostname = normalizeCustomHostname(input.hostname);
  assertValidCustomHostname(hostname);
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const bindingLabel = (input.bindingLabel ?? "").trim().slice(0, 160);
  const bindingRef = input.bindingRef?.trim() || null;
  const toolDomainId = input.toolDomainId?.trim() || null;
  const dnsTarget =
    (input.dnsTarget ?? "").trim() || DEFAULT_CUSTOM_DOMAIN_DNS_TARGET;

  const { data: existing, error: existingError } = await admin
    .from("customer_custom_domains")
    .select(`${SELECT_COLS},user_id,revoked_at`)
    .eq("hostname", hostname)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .maybeSingle();
  if (existingError) {
    throw new CustomDomainServiceError(
      "sync_failed",
      500,
      "Domain-Sync fehlgeschlagen.",
    );
  }

  if (existing) {
    if (String(existing.user_id) !== input.userId) {
      throw new CustomDomainServiceError(
        "hostname_taken",
        409,
        "Diese Domain ist bereits einem anderen Konto zugeordnet.",
      );
    }
    const existingBinding = asBindingKind(existing.binding_kind);
    if (existingBinding !== "none" && existingBinding !== input.tool) {
      throw new CustomDomainServiceError(
        "bound_other_tool",
        409,
        existingBinding === "funnel"
          ? "Diese Domain ist bereits an einen Funnel gebunden."
          : "Diese Domain ist bereits an ein Freebie gebunden.",
      );
    }

    const { data: updated, error: updateError } = await admin
      .from("customer_custom_domains")
      .update({
        status: input.status,
        dns_target: dnsTarget,
        binding_kind: input.tool,
        binding_ref: bindingRef,
        binding_label: bindingLabel,
        tool_domain_id: toolDomainId,
        updated_at: now,
        last_dns_message:
          input.status === "READY"
            ? "Status von Tool synchronisiert (READY)."
            : String(existing.last_dns_message ?? ""),
        last_dns_check_at:
          input.status === "READY" ? now : existing.last_dns_check_at,
      })
      .eq("id", existing.id)
      .eq("user_id", input.userId)
      .select(SELECT_COLS)
      .single();
    if (updateError || !updated) {
      throw new CustomDomainServiceError(
        "sync_failed",
        500,
        "Domain-Sync fehlgeschlagen.",
      );
    }
    const mapped = mapRow(updated as Record<string, unknown>);
    if (!mapped) {
      throw new CustomDomainServiceError(
        "sync_failed",
        500,
        "Domain-Sync fehlgeschlagen.",
      );
    }
    return mapped;
  }

  const { data: inserted, error: insertError } = await admin
    .from("customer_custom_domains")
    .insert({
      user_id: input.userId,
      hostname,
      label: bindingLabel.slice(0, 120),
      status: input.status,
      dns_target: dnsTarget,
      notes: "",
      last_dns_message:
        input.status === "READY"
          ? "Status von Tool synchronisiert (READY)."
          : "",
      last_dns_check_at: input.status === "READY" ? now : null,
      origin: input.tool,
      binding_kind: input.tool,
      binding_ref: bindingRef,
      binding_label: bindingLabel,
      tool_domain_id: toolDomainId,
    })
    .select(SELECT_COLS)
    .single();
  if (insertError || !inserted) {
    throw new CustomDomainServiceError(
      "sync_failed",
      500,
      insertError?.message?.includes("origin")
        ? "Domain-Sync: bitte SQL-Migration für Binding-Spalten im Portal anwenden."
        : "Domain-Sync fehlgeschlagen.",
    );
  }
  const mapped = mapRow(inserted as Record<string, unknown>);
  if (!mapped) {
    throw new CustomDomainServiceError(
      "sync_failed",
      500,
      "Domain-Sync fehlgeschlagen.",
    );
  }
  return mapped;
}

/** Clear tool binding (and optionally revoke) when Funnel/Freebie revoke locally. */
export async function unbindOrRevokeCustomerCustomDomainFromTool(input: {
  userId: string;
  tool: ToolDomainSyncTool;
  hostname: string;
  toolDomainId?: string | null;
}): Promise<void> {
  const hostname = normalizeCustomHostname(input.hostname);
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: existing, error } = await admin
    .from("customer_custom_domains")
    .select("id,origin,binding_kind,tool_domain_id,user_id")
    .eq("hostname", hostname)
    .eq("user_id", input.userId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !existing) return;

  const binding = asBindingKind(existing.binding_kind);
  if (binding !== "none" && binding !== input.tool) return;
  if (
    input.toolDomainId &&
    existing.tool_domain_id &&
    String(existing.tool_domain_id) !== input.toolDomainId
  ) {
    return;
  }

  const origin = asOrigin(existing.origin);
  // Domain first created in this tool → revoke from global list.
  // Portal-origin domains stay available for campaigns; binding cleared only.
  if (origin === input.tool) {
    await admin
      .from("customer_custom_domains")
      .update({
        status: "REVOKED",
        revoked_at: now,
        updated_at: now,
        binding_kind: "none",
        binding_ref: null,
        binding_label: "",
        tool_domain_id: null,
      })
      .eq("id", existing.id)
      .eq("user_id", input.userId);
    return;
  }

  await admin
    .from("customer_custom_domains")
    .update({
      binding_kind: "none",
      binding_ref: null,
      binding_label: "",
      tool_domain_id: null,
      updated_at: now,
    })
    .eq("id", existing.id)
    .eq("user_id", input.userId);
}
