import { NextResponse } from "next/server";

import { getPlatformCatalog } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";

type AccountRow = {
  id: string;
  platform: string;
  platform_account_id: string;
  account_name: string | null;
  expires_at: string | null;
  provider_sync_status: string | null;
  provider_last_success_at: string | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("platform_accounts")
    .select(
      "id, platform, platform_account_id, account_name, expires_at, provider_sync_status, provider_last_success_at",
    )
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (error) {
    return NextResponse.json(
      { error: "connector_status_unavailable" },
      { status: 500 },
    );
  }

  const accounts = (data ?? []) as AccountRow[];
  const connectors = getPlatformCatalog().map((platform) => {
    const platformAccounts = accounts.filter(
      (item) => item.platform === platform.id,
    );
    const account = platformAccounts[0];

    return {
      id: platform.id,
      name: platform.name,
      description: platform.description,
      status: account
        ? "connected"
        : platform.configured
          ? "ready_to_connect"
          : "configuration_required",
      accountName: account?.account_name ?? null,
      expiresAt: account?.expires_at ?? null,
      connectionCount: platformAccounts.length,
      connections: platformAccounts.map((item) => ({
        id: item.id,
        remoteAccountId: item.platform_account_id,
        accountName: item.account_name,
        syncStatus: item.provider_sync_status,
        lastSuccessAt: item.provider_last_success_at,
      })),
    };
  });

  return NextResponse.json(
    { connectors },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    },
  );
}
