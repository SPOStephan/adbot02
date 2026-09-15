import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Inspiration vault registration requires a site_admins user_id.
 * Prefer CHATGPT_AD_LIBRARY_UPLOADER_USER_ID, else the first site admin.
 */
export async function resolveChatGPTAdLibraryUploaderUserId(): Promise<string> {
  const configured = process.env.CHATGPT_AD_LIBRARY_UPLOADER_USER_ID?.trim();
  const admin = createAdminClient();

  if (configured) {
    const { data, error } = await admin
      .from("site_admins")
      .select("user_id")
      .eq("user_id", configured)
      .maybeSingle();
    if (!error && data?.user_id) return String(data.user_id);
    throw new Error(
      "CHATGPT_AD_LIBRARY_UPLOADER_USER_ID ist gesetzt, aber kein Site-Admin.",
    );
  }

  const { data, error } = await admin
    .from("site_admins")
    .select("user_id")
    .order("user_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data?.user_id) {
    throw new Error(
      "Kein Site-Admin für ChatGPT-Ad-Library-Uploads gefunden. Bitte CHATGPT_AD_LIBRARY_UPLOADER_USER_ID setzen.",
    );
  }
  return String(data.user_id);
}
