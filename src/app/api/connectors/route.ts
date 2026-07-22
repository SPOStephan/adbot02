import { NextResponse } from "next/server";

import { getPlatformCatalog } from "@/lib/platforms/catalog";
import { createClient } from "@/lib/supabase/server";

type AccountRow = {
  platform: string;
  account_name: string | null;
  expires_at: string | null;
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
    .select("platform, account_name, expires_at")
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "connector_status_unavailable" },
      { status: 500 },
    );
  }

  const accounts = (data ?? []) as AccountRow[];
  const connectors = getPlatformCatalog().map((platform) => {
    const account = accounts.find((item) => item.platform === platform.id);

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
