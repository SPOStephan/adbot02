import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type FunnelCustomDomainStatus = "PENDING_DNS" | "READY" | "REVOKED";

export type FunnelCustomDomain = {
  id: string;
  funnelId: string;
  hostname: string;
  status: FunnelCustomDomainStatus;
  dnsTarget: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

const DEFAULT_DNS_TARGET = "cname.vercel-dns.com";

type MemoryRow = FunnelCustomDomain;
let memoryDomains: MemoryRow[] = [];
let client: SupabaseClient | null | undefined;

function getSupabase() {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false } })
    : null;
  return client;
}

export function resetCustomDomainMemoryForTests() {
  memoryDomains = [];
  client = undefined;
}

export function normalizeCustomHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function assertValidCustomHostname(hostname: string) {
  if (
    hostname.length < 3 ||
    hostname.length > 253 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(hostname) ||
    hostname.includes("..") ||
    !hostname.includes(".") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    throw new Error("Der Hostname ist ungültig.");
  }
  for (const label of hostname.split(".")) {
    if (
      label.length < 1 ||
      label.length > 63 ||
      label.startsWith("-") ||
      label.endsWith("-")
    ) {
      throw new Error("Der Hostname ist ungültig.");
    }
  }
}

function mapRow(row: Record<string, unknown>): FunnelCustomDomain {
  return {
    id: String(row.id),
    funnelId: String(row.funnel_id),
    hostname: String(row.hostname),
    status: String(row.status) as FunnelCustomDomainStatus,
    dnsTarget: String(row.dns_target ?? DEFAULT_DNS_TARGET),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
  };
}

export async function listCustomDomainsForFunnel(
  funnelId: string
): Promise<FunnelCustomDomain[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return memoryDomains
      .filter(
        item =>
          item.funnelId === funnelId &&
          (item.status === "PENDING_DNS" || item.status === "READY")
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const { data, error } = await supabase
    .from("funnel_custom_domains")
    .select(
      "id,funnel_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at"
    )
    .eq("funnel_id", funnelId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => mapRow(row as Record<string, unknown>));
}

export async function getFunnelIdByCustomHostname(
  hostname: string
): Promise<string | null> {
  const normalized = normalizeCustomHostname(hostname);
  const supabase = getSupabase();
  if (!supabase) {
    const match = memoryDomains.find(
      item =>
        item.hostname === normalized &&
        item.status === "READY" &&
        !item.revokedAt
    );
    return match?.funnelId ?? null;
  }

  const { data, error } = await supabase
    .from("funnel_custom_domains")
    .select("funnel_id")
    .eq("hostname", normalized)
    .eq("status", "READY")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data?.funnel_id ? String(data.funnel_id) : null;
}

export async function registerCustomDomain(input: {
  funnelId: string;
  hostname: string;
  notes?: string;
}): Promise<FunnelCustomDomain> {
  const hostname = normalizeCustomHostname(input.hostname);
  assertValidCustomHostname(hostname);
  const now = new Date().toISOString();
  const row: FunnelCustomDomain = {
    id: randomUUID(),
    funnelId: input.funnelId,
    hostname,
    status: "PENDING_DNS",
    dnsTarget: DEFAULT_DNS_TARGET,
    notes: (input.notes ?? "").trim().slice(0, 500),
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
  };

  const supabase = getSupabase();
  if (!supabase) {
    const clash = memoryDomains.find(
      item =>
        item.hostname === hostname &&
        item.status !== "REVOKED" &&
        !item.revokedAt
    );
    if (clash && clash.funnelId !== input.funnelId) {
      throw new Error("Diese Domain ist bereits einem anderen Funnel zugeordnet.");
    }
    if (clash) return clash;
    memoryDomains = [row, ...memoryDomains];
    return row;
  }

  const { data: existing } = await supabase
    .from("funnel_custom_domains")
    .select(
      "id,funnel_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at"
    )
    .eq("hostname", hostname)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) {
    const mapped = mapRow(existing as Record<string, unknown>);
    if (mapped.funnelId !== input.funnelId) {
      throw new Error("Diese Domain ist bereits einem anderen Funnel zugeordnet.");
    }
    return mapped;
  }

  const { data, error } = await supabase
    .from("funnel_custom_domains")
    .insert({
      id: row.id,
      funnel_id: row.funnelId,
      hostname: row.hostname,
      status: row.status,
      dns_target: row.dnsTarget,
      notes: row.notes,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    })
    .select(
      "id,funnel_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at"
    )
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

export async function getCustomDomainForFunnel(input: {
  funnelId: string;
  domainId: string;
}): Promise<FunnelCustomDomain | null> {
  const supabase = getSupabase();
  if (!supabase) {
    return (
      memoryDomains.find(
        item =>
          item.id === input.domainId &&
          item.funnelId === input.funnelId &&
          item.status !== "REVOKED"
      ) ?? null
    );
  }

  const { data, error } = await supabase
    .from("funnel_custom_domains")
    .select(
      "id,funnel_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at"
    )
    .eq("id", input.domainId)
    .eq("funnel_id", input.funnelId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function markCustomDomainReady(input: {
  funnelId: string;
  domainId: string;
}): Promise<FunnelCustomDomain> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  if (!supabase) {
    const index = memoryDomains.findIndex(
      item => item.id === input.domainId && item.funnelId === input.funnelId
    );
    if (index < 0) throw new Error("Custom Domain nicht gefunden.");
    memoryDomains[index] = {
      ...memoryDomains[index]!,
      status: "READY",
      updatedAt: now,
    };
    return memoryDomains[index]!;
  }

  const { data, error } = await supabase
    .from("funnel_custom_domains")
    .update({ status: "READY", updated_at: now })
    .eq("id", input.domainId)
    .eq("funnel_id", input.funnelId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .select(
      "id,funnel_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at"
    )
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Custom Domain nicht gefunden.");
  return mapRow(data as Record<string, unknown>);
}

export async function revokeCustomDomain(input: {
  funnelId: string;
  domainId: string;
}): Promise<FunnelCustomDomain> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  if (!supabase) {
    const index = memoryDomains.findIndex(
      item => item.id === input.domainId && item.funnelId === input.funnelId
    );
    if (index < 0) throw new Error("Custom Domain nicht gefunden.");
    memoryDomains[index] = {
      ...memoryDomains[index]!,
      status: "REVOKED",
      revokedAt: now,
      updatedAt: now,
    };
    return memoryDomains[index]!;
  }

  const { data, error } = await supabase
    .from("funnel_custom_domains")
    .update({
      status: "REVOKED",
      revoked_at: now,
      updated_at: now,
    })
    .eq("id", input.domainId)
    .eq("funnel_id", input.funnelId)
    .select(
      "id,funnel_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at"
    )
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Custom Domain nicht gefunden.");
  return mapRow(data as Record<string, unknown>);
}
