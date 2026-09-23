import "server-only";

import { CustomerControlServiceError } from "@/lib/meta/customer-control-service";
import { normalizeConnectedPlatform } from "@/lib/media-library/platform-formats";
import { createClient } from "@/lib/supabase/server";

export type LibraryCustomer = {
  userId: string;
  /** Meta account when present — used for launch-bound storage. */
  platformAccountId: string | null;
  connectedPlatforms: string[];
  metaConnected: boolean;
};

function serviceError(code: string, status: number, message: string): never {
  throw new CustomerControlServiceError(code, status, message);
}

export async function authenticateLibraryCustomer(): Promise<LibraryCustomer> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    serviceError("unauthorized", 401, "Bitte melde dich erneut an.");
  }

  const { data: accounts, error } = await supabase
    .from("platform_accounts")
    .select("id,platform")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .limit(20);

  if (error) {
    serviceError(
      "account_lookup_failed",
      500,
      "Verbundene Werbekonten konnten nicht geprüft werden.",
    );
  }

  const rows = Array.isArray(accounts) ? accounts : [];
  const connectedPlatforms = [
    ...new Set(
      rows
        .map((row) => normalizeConnectedPlatform(String(row.platform ?? "")))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ),
  ];
  const meta = rows.find((row) => String(row.platform ?? "") === "meta");

  return {
    userId: user.id,
    platformAccountId: meta ? String(meta.id) : rows[0] ? String(rows[0].id) : null,
    connectedPlatforms,
    metaConnected: Boolean(meta),
  };
}

export async function listConnectedPlatformsForUser(
  userId: string,
): Promise<string[]> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_accounts")
    .select("platform")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .limit(20);
  if (error || !Array.isArray(data)) return [];
  return [
    ...new Set(
      data
        .map((row) => normalizeConnectedPlatform(String(row.platform ?? "")))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    ),
  ];
}
