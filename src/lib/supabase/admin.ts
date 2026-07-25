import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminKey } from "@/lib/supabase/admin-env";

function required(name: string, value: string | undefined): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(
      `Die Umgebungsvariable ${name} fehlt. Bitte ausschließlich serverseitig in Vercel hinterlegen.`,
    );
  }

  return normalized;
}

export function createAdminClient() {
  const url = required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const adminKey = getSupabaseAdminKey();

  return createSupabaseClient(url, adminKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
