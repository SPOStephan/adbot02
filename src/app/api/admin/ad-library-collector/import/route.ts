import { NextRequest, NextResponse } from "next/server";

import { AdExampleInputError } from "@/lib/ad-examples/input";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { CollectorInputError } from "@/lib/ad-library-collector/normalize";
import {
  CollectorServiceError,
  importReadyCollectorItems,
} from "@/lib/ad-library-collector/service";
import { COLLECTOR_IMPORT_BATCH_MAX } from "@/lib/ad-library-collector/types";
import { constantTimeEqual } from "@/lib/meta/crypto";
import { isDashboardSameOriginRequest } from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function hasCronAuth(request: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  return constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

async function requireAdminOrCron(request: NextRequest) {
  if (hasCronAuth(request)) {
    return { userId: null as string | null };
  }
  if (!isDashboardSameOriginRequest(request)) {
    return { error: json({ ok: false, message: "Ungültige Herkunft." }, 403) };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: json({ ok: false, message: "Nicht angemeldet." }, 401) };
  if (!(await isSiteAdmin(user.id))) {
    return {
      error: json(
        { ok: false, message: "Nur Admins dürfen Sandbox-Einträge in den Vault holen." },
        403,
      ),
    };
  }
  return { userId: user.id };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminOrCron(request);
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as {
      ids?: unknown;
      limit?: unknown;
    };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === "string")
      : undefined;
    const summary = await importReadyCollectorItems({
      uploaderUserId: auth.userId ?? undefined,
      ids,
      limit:
        typeof body.limit === "number" && Number.isFinite(body.limit)
          ? body.limit
          : COLLECTOR_IMPORT_BATCH_MAX,
    });
    return json({
      ok: true,
      customerVisible: false,
      neverLaunch: true,
      batchMax: COLLECTOR_IMPORT_BATCH_MAX,
      ...summary,
    });
  } catch (error) {
    if (error instanceof CollectorInputError || error instanceof AdExampleInputError) {
      return json({ ok: false, code: "invalid_input", message: error.message }, 400);
    }
    if (error instanceof CollectorServiceError) {
      return json({ ok: false, code: error.code, message: error.message }, error.status);
    }
    console.error("ad_library_collector_import_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return json(
      { ok: false, message: "Import aus der Sandbox ist fehlgeschlagen." },
      500,
    );
  }
}
