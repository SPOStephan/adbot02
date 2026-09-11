import { NextResponse } from "next/server";

import { getPlatformCatalog } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";

type AccountRow = {
  id: string;
  platform: string;
  platform_account_id: string;
  account_name: string | null;
  expires_at: string | null;
};

type ProviderStatusRow = {
  id: string;
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
      "id, platform, platform_account_id, account_name, expires_at",
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
  const openAIAccountIds = accounts
    .filter((account) => account.platform === "openai_ads")
    .map((account) => account.id);
  let providerStatuses = new Map<string, ProviderStatusRow>();

  if (openAIAccountIds.length > 0) {
    const { data: providerStatusData, error: providerStatusError } = await supabase
      .from("platform_accounts")
      .select("id, provider_sync_status, provider_last_success_at")
      .in("id", openAIAccountIds);

    if (providerStatusError) {
      console.error("connector_provider_status_unavailable", {
        code: providerStatusError.code,
      });
    } else {
      providerStatuses = new Map(
        ((providerStatusData ?? []) as ProviderStatusRow[]).map((row) => [
          row.id,
          row,
        ]),
      );
    }
  }

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
      connections: platformAccounts.map((item) => {
        const providerStatus = providerStatuses.get(item.id);
        return {
          id: item.id,
          remoteAccountId: item.platform_account_id,
          accountName: item.account_name,
          syncStatus: providerStatus?.provider_sync_status ?? null,
          lastSuccessAt: providerStatus?.provider_last_success_at ?? null,
        };
      }),
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
