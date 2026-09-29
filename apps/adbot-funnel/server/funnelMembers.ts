import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Funnel-only-Login eines Kundenunternehmens, gebunden an ein Adbot-Konto (owner). */
export type FunnelMember = {
  id: string;
  ownerUserId: string;
  email: string;
  name: string;
  passwordHash: string;
  createdByEmail: string;
  lastLoginAt: string | null;
  createdAt: string;
};

/** Ohne Passwort-Hash, für die Admin-Oberfläche. */
export type FunnelMemberSummary = Omit<FunnelMember, "passwordHash" | "ownerUserId">;

const COLUMNS = "id,owner_user_id,email,name,password_hash,created_by_email,last_login_at,created_at";

let memoryMembers: FunnelMember[] = [];
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

export function resetFunnelMemberMemoryForTests() {
  memoryMembers = [];
  client = undefined;
}

export function normalizeMemberEmail(email: string) {
  return email.trim().toLowerCase();
}

export function toMemberSummary(member: FunnelMember): FunnelMemberSummary {
  const { passwordHash: _hash, ownerUserId: _owner, ...summary } = member;
  return summary;
}

function mapRow(row: Record<string, unknown>): FunnelMember {
  return {
    id: String(row.id),
    ownerUserId: String(row.owner_user_id),
    email: String(row.email),
    name: String(row.name ?? ""),
    passwordHash: String(row.password_hash),
    createdByEmail: String(row.created_by_email ?? ""),
    lastLoginAt: row.last_login_at == null ? null : String(row.last_login_at),
    createdAt: String(row.created_at),
  };
}

export async function listMembersForOwner(ownerUserId: string): Promise<FunnelMember[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return memoryMembers
      .filter(item => item.ownerUserId === ownerUserId)
      .sort((a, b) => a.email.localeCompare(b.email));
  }
  const { data, error } = await supabase
    .from("funnel_admin_members")
    .select(COLUMNS)
    .eq("owner_user_id", ownerUserId)
    .order("email", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => mapRow(row as Record<string, unknown>));
}

export async function getMemberByEmail(email: string): Promise<FunnelMember | null> {
  const normalized = normalizeMemberEmail(email);
  if (!normalized) return null;
  const supabase = getSupabase();
  if (!supabase) return memoryMembers.find(item => item.email === normalized) ?? null;
  const { data, error } = await supabase
    .from("funnel_admin_members")
    .select(COLUMNS)
    .eq("email", normalized)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export class MemberEmailTakenError extends Error {
  constructor() {
    super("Für diese E-Mail-Adresse gibt es bereits einen Zugang.");
  }
}

export async function createMember(input: {
  ownerUserId: string;
  email: string;
  name: string;
  passwordHash: string;
  createdByEmail: string;
}): Promise<FunnelMember> {
  const email = normalizeMemberEmail(input.email);
  const supabase = getSupabase();
  if (!supabase) {
    if (memoryMembers.some(item => item.email === email)) throw new MemberEmailTakenError();
    const member: FunnelMember = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      email,
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      createdByEmail: input.createdByEmail,
      lastLoginAt: null,
      createdAt: new Date().toISOString(),
    };
    memoryMembers.push(member);
    return member;
  }
  const { data, error } = await supabase
    .from("funnel_admin_members")
    .insert({
      owner_user_id: input.ownerUserId,
      email,
      name: input.name.trim(),
      password_hash: input.passwordHash,
      created_by_email: input.createdByEmail,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new MemberEmailTakenError();
    throw error;
  }
  return mapRow(data as Record<string, unknown>);
}

export async function setMemberPasswordHash(input: {
  ownerUserId: string;
  memberId: string;
  passwordHash: string;
}): Promise<FunnelMember | null> {
  const supabase = getSupabase();
  if (!supabase) {
    const member = memoryMembers.find(item => item.id === input.memberId && item.ownerUserId === input.ownerUserId);
    if (!member) return null;
    member.passwordHash = input.passwordHash;
    return member;
  }
  const { data, error } = await supabase
    .from("funnel_admin_members")
    .update({ password_hash: input.passwordHash })
    .eq("id", input.memberId)
    .eq("owner_user_id", input.ownerUserId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data as Record<string, unknown>) : null;
}

export async function deleteMember(input: { ownerUserId: string; memberId: string }): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) {
    const before = memoryMembers.length;
    memoryMembers = memoryMembers.filter(item => !(item.id === input.memberId && item.ownerUserId === input.ownerUserId));
    return memoryMembers.length < before;
  }
  const { data, error } = await supabase
    .from("funnel_admin_members")
    .delete()
    .eq("id", input.memberId)
    .eq("owner_user_id", input.ownerUserId)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

export async function touchMemberLogin(memberId: string): Promise<void> {
  const now = new Date().toISOString();
  const supabase = getSupabase();
  if (!supabase) {
    const member = memoryMembers.find(item => item.id === memberId);
    if (member) member.lastLoginAt = now;
    return;
  }
  const { error } = await supabase
    .from("funnel_admin_members")
    .update({ last_login_at: now })
    .eq("id", memberId);
  if (error) console.warn("[member-login] last_login_at nicht gespeichert", error.message);
}
