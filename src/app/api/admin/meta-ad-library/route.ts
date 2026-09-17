import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import { CollectorInputError } from "@/lib/ad-library-collector/normalize";
import { CollectorServiceError } from "@/lib/ad-library-collector/service";
import { exchangePastedLibraryToken } from "@/lib/meta-ad-library/client";
import { clearLibraryConnection, saveLibraryConnection } from "@/lib/meta-ad-library/connection";
import { requireMetaAdLibraryApp } from "@/lib/meta-ad-library/env";
import { MetaAdLibraryError } from "@/lib/meta-ad-library/errors";
import {
  fetchMetaAdLibraryToStaging,
  loadMetaAdLibraryStatus,
  probeMetaAdLibrary,
} from "@/lib/meta-ad-library/service";
import {
  isDashboardSameOriginReadRequest,
  isDashboardSameOriginRequest,
} from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function requireAdmin(request: NextRequest, mode: "read" | "write" = "write") {
  const sameOrigin =
    mode === "read"
      ? isDashboardSameOriginReadRequest(request)
      : isDashboardSameOriginRequest(request);
  if (!sameOrigin) {
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
        { ok: false, message: "Nur Admins dürfen die Meta-Library-App nutzen." },
        403,
      ),
    };
  }
  return { user };
}

function errorResponse(error: unknown) {
  if (error instanceof CollectorInputError) {
    return json({ ok: false, code: "invalid_input", message: error.message }, 400);
  }
  if (error instanceof MetaAdLibraryError || error instanceof CollectorServiceError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  console.error("meta_ad_library_admin_failed", {
    message: error instanceof Error ? error.message : "unknown",
  });
  return json(
    { ok: false, code: "internal_error", message: "Die Meta-Library-App ist gerade nicht erreichbar." },
    500,
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request, "read");
    if ("error" in auth && auth.error) return auth.error;
    const status = await loadMetaAdLibraryStatus();
    return json({
      ok: true,
      customerVisible: false,
      neverLaunch: true,
      usesProductMetaApp: false,
      ...status,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ ok: false, message: "Ungültige Anfrage." }, 400);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "connect_token") {
      const app = requireMetaAdLibraryApp();
      const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
      if (accessToken.length < 20) {
        return json({ ok: false, message: "Bitte einen Library-User-Token einfügen." }, 400);
      }
      const persisted = await exchangePastedLibraryToken({
        appId: app.appId,
        appSecret: app.appSecret,
        accessToken,
      });
      await saveLibraryConnection({
        appId: app.appId,
        accessToken: persisted.accessToken,
        expiresInSeconds: persisted.expiresInSeconds,
        metaUserId: persisted.metaUserId,
        connectedBy: auth.user.id,
      });
      return json({
        ok: true,
        action,
        tokenStored: true,
        ...(await loadMetaAdLibraryStatus()),
      });
    }

    if (action === "disconnect") {
      await clearLibraryConnection();
      return json({ ok: true, action, ...(await loadMetaAdLibraryStatus()) });
    }

    if (action === "probe") {
      const probe = await probeMetaAdLibrary(body);
      return json({
        ok: true,
        action,
        customerVisible: false,
        neverLaunch: true,
        probe,
        ...(await loadMetaAdLibraryStatus()),
      });
    }

    if (action === "fetch") {
      const result = await fetchMetaAdLibraryToStaging({
        body,
        createdBy: auth.user.id,
      });
      return json({
        ok: true,
        action,
        customerVisible: false,
        neverLaunch: true,
        useForGeneration: false,
        ...result,
        ...(await loadMetaAdLibraryStatus()),
      });
    }

    return json({ ok: false, message: "Unbekannte Aktion." }, 400);
  } catch (error) {
    return errorResponse(error);
  }
}
