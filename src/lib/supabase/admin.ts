import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
  const serviceRoleKey = required(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
