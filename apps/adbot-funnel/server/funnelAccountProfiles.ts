import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Firmenangaben eines Adbot-Kontos für das Kunden-Dashboard. */
export type FunnelAccountProfile = {
  companyName: string;
  displayName: string;
};

export const EMPTY_ACCOUNT_PROFILE: FunnelAccountProfile = { companyName: "", displayName: "" };

const memoryProfiles = new Map<string, FunnelAccountProfile>();
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

export function resetFunnelAccountProfileMemoryForTests() {
  memoryProfiles.clear();
  client = undefined;
}

function normalizeProfile(input: FunnelAccountProfile): FunnelAccountProfile {
  return {
    companyName: input.companyName.trim().replace(/\s+/g, " "),
    displayName: input.displayName.trim().replace(/\s+/g, " "),
  };
}

export async function getAccountProfile(ownerUserId: string): Promise<FunnelAccountProfile> {
  const supabase = getSupabase();
  if (!supabase) return memoryProfiles.get(ownerUserId) ?? EMPTY_ACCOUNT_PROFILE;
  const { data, error } = await supabase
    .from("funnel_account_profiles")
    .select("company_name,display_name")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return EMPTY_ACCOUNT_PROFILE;
  return {
    companyName: String(data.company_name ?? ""),
    displayName: String(data.display_name ?? ""),
  };
}

export async function saveAccountProfile(ownerUserId: string, input: FunnelAccountProfile): Promise<FunnelAccountProfile> {
  const profile = normalizeProfile(input);
  const supabase = getSupabase();
  if (!supabase) {
    memoryProfiles.set(ownerUserId, profile);
    return profile;
  }
  const { error } = await supabase
    .from("funnel_account_profiles")
    .upsert(
      { owner_user_id: ownerUserId, company_name: profile.companyName, display_name: profile.displayName },
      { onConflict: "owner_user_id" },
    );
  if (error) throw error;
  return profile;
}
