import { NextRequest, NextResponse } from "next/server";

import { getPublicCreativeGenerationConfig } from "@/lib/creative-assets/env";
import {
  CustomerControlServiceError,
  authenticateMetaCustomer,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Public (authenticated) generation config for Media Library UI.
 * Never returns API keys or secrets.
 */
export async function GET(_request: NextRequest) {
  try {
    await authenticateMetaCustomer();
    const config = getPublicCreativeGenerationConfig();
    return NextResponse.json(
      {
        ok: true,
        configured: config.configured,
        providerKey: config.providerKey,
        defaultModelId: config.defaultModelId,
        modelAllowlist: config.modelAllowlist,
        modes: config.modes,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof CustomerControlServiceError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "Creative-Generation-Config konnte nicht geladen werden.",
        code: "config_failed",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
