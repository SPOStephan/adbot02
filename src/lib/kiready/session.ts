import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function establishAdbotSession(email: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    throw new Error("Adbot-Sitzung konnte nicht erzeugt werden.");
  }

  const supabase = await createClient();
  const verified = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });
  if (verified.error) {
    throw new Error("Adbot-Sitzung konnte nicht geöffnet werden.");
  }
}
