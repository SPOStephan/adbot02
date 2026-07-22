import { NextResponse } from "next/server";

import { getPlatformCatalog } from "@/lib/platforms/catalog";

export function GET() {
  const catalog = getPlatformCatalog();

  return NextResponse.json(
    {
      status: "ok",
      service: "adpilot-portal",
      supabaseConfigured: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      ),
      configuredConnectors: catalog
        .filter((platform) => platform.configured)
        .map((platform) => platform.id),
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
