import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fail-closed admin check. Uses service role so clients cannot enumerate admins.
 * Returns false if the table is missing or the lookup errors.
 */
export async function isSiteAdmin(userId: string | null | undefined): Promise<boolean> {
  if (!userId) {
    return false;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("site_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data?.user_id) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
