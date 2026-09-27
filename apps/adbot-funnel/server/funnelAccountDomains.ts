import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertValidCustomHostname,
  normalizeCustomHostname,
  type FunnelCustomDomainStatus,
} from "./funnelCustomDomains";

export type FunnelAccountDomain = {
  id: string;
  ownerUserId: string;
  hostname: string;
  status: FunnelCustomDomainStatus;
  dnsTarget: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

const DEFAULT_DNS_TARGET = "cname.vercel-dns.com";

let memoryDomains: FunnelAccountDomain[] = [];
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

export function resetAccountDomainMemoryForTests() {
  memoryDomains = [];
  client = undefined;
}

function mapRow(row: Record<string, unknown>): FunnelAccountDomain {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    hostname: String(row.hostname),
    status: String(row.status) as FunnelCustomDomainStatus,
    dnsTarget: String(row.dns_target ?? DEFAULT_DNS_TARGET),
    notes: String(row.notes ?? ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
  };
}

export async function listAccountDomainsForOwner(
  ownerUserId: string,
): Promise<FunnelAccountDomain[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return memoryDomains
      .filter(item => item.ownerUserId === ownerUserId && (item.status === "PENDING_DNS" || item.status === "READY"))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const { data, error } = await supabase
    .from("funnel_account_domains")
    .select("id,owner_user_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at")
    .eq("owner_user_id", ownerUserId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(row => mapRow(row as Record<string, unknown>));
}

export async function getOwnerIdByAccountHostname(
  hostname: string,
): Promise<string | null> {
  const normalized = normalizeCustomHostname(hostname);
  const supabase = getSupabase();
  if (!supabase) {
    return memoryDomains.find(item => item.hostname === normalized && item.status === "READY" && !item.revokedAt)?.ownerUserId ?? null;
  }

  const { data, error } = await supabase
    .from("funnel_account_domains")
    .select("owner_user_id")
    .eq("hostname", normalized)
    .eq("status", "READY")
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data?.owner_user_id ? String(data.owner_user_id) : null;
}

export async function findActiveAccountDomain(
  hostname: string,
): Promise<FunnelAccountDomain | null> {
  const normalized = normalizeCustomHostname(hostname);
  const supabase = getSupabase();
  if (!supabase) {
    return memoryDomains.find(item => item.hostname === normalized && item.status !== "REVOKED" && !item.revokedAt) ?? null;
  }
  const { data, error } = await supabase
    .from("funnel_account_domains")
    .select("id,owner_user_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at")
    .eq("hostname", normalized)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function registerAccountDomain(input: {
  ownerUserId: string;
  hostname: string;
  notes?: string;
}): Promise<FunnelAccountDomain> {
  const hostname = normalizeCustomHostname(input.hostname);
  assertValidCustomHostname(hostname);
  if (!/^[0-9a-f-]{36}$/i.test(input.ownerUserId)) {
    throw new Error("Account-Domain braucht ein Kundenkonto.");
  }
  const now = new Date().toISOString();
  const row: FunnelAccountDomain = {
    id: randomUUID(),
    ownerUserId: input.ownerUserId,
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
    const clash = memoryDomains.find(item => item.hostname === hostname && item.status !== "REVOKED" && !item.revokedAt);
    if (clash && clash.ownerUserId !== input.ownerUserId) {
      throw new Error("Diese Domain ist bereits einem anderen Konto zugeordnet.");
    }
    if (clash) return clash;
    memoryDomains = [row, ...memoryDomains];
    return row;
  }

  const { data: existing } = await supabase
    .from("funnel_account_domains")
    .select("id,owner_user_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at")
    .eq("hostname", hostname)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .maybeSingle();

  if (existing) {
    const mapped = mapRow(existing as Record<string, unknown>);
    if (mapped.ownerUserId !== input.ownerUserId) {
      throw new Error("Diese Domain ist bereits einem anderen Konto zugeordnet.");
    }
    return mapped;
  }

  const { data, error } = await supabase
    .from("funnel_account_domains")
    .insert({
      id: row.id,
      owner_user_id: row.ownerUserId,
      hostname: row.hostname,
      status: row.status,
      dns_target: row.dnsTarget,
      notes: row.notes,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    })
    .select("id,owner_user_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at")
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

export async function getAccountDomainForOwner(input: {
  ownerUserId: string;
  domainId: string;
}): Promise<FunnelAccountDomain | null> {
  const supabase = getSupabase();
  if (!supabase) {
    return memoryDomains.find(item => item.id === input.domainId && item.ownerUserId === input.ownerUserId && item.status !== "REVOKED") ?? null;
  }
  const { data, error } = await supabase
    .from("funnel_account_domains")
    .select("id,owner_user_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at")
    .eq("id", input.domainId)
    .eq("owner_user_id", input.ownerUserId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function markAccountDomainReady(input: {
  ownerUserId: string;
  domainId: string;
}): Promise<FunnelAccountDomain> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  if (!supabase) {
    const index = memoryDomains.findIndex(item => item.id === input.domainId && item.ownerUserId === input.ownerUserId);
    if (index < 0) throw new Error("Account-Domain nicht gefunden.");
    memoryDomains[index] = { ...memoryDomains[index]!, status: "READY", updatedAt: now };
    return memoryDomains[index]!;
  }

  const { data, error } = await supabase
    .from("funnel_account_domains")
    .update({ status: "READY", updated_at: now })
    .eq("id", input.domainId)
    .eq("owner_user_id", input.ownerUserId)
    .in("status", ["PENDING_DNS", "READY"])
    .is("revoked_at", null)
    .select("id,owner_user_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Account-Domain nicht gefunden.");
  return mapRow(data as Record<string, unknown>);
}

export async function revokeAccountDomain(input: {
  ownerUserId: string;
  domainId: string;
}): Promise<FunnelAccountDomain> {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  if (!supabase) {
    const index = memoryDomains.findIndex(item => item.id === input.domainId && item.ownerUserId === input.ownerUserId);
    if (index < 0) throw new Error("Account-Domain nicht gefunden.");
    memoryDomains[index] = { ...memoryDomains[index]!, status: "REVOKED", revokedAt: now, updatedAt: now };
    return memoryDomains[index]!;
  }

  const { data, error } = await supabase
    .from("funnel_account_domains")
    .update({ status: "REVOKED", revoked_at: now, updated_at: now })
    .eq("id", input.domainId)
    .eq("owner_user_id", input.ownerUserId)
    .select("id,owner_user_id,hostname,status,dns_target,notes,created_at,updated_at,revoked_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Account-Domain nicht gefunden.");
  return mapRow(data as Record<string, unknown>);
}
