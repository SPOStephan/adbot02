import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import {
  clearSiteFavicon,
  saveSiteFavicon,
} from "@/lib/site-branding/branding";
import { SITE_FAVICON_RECOMMENDATIONS } from "@/lib/site-branding/recommendations";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
};

const ALLOWED = new Set<string>(SITE_FAVICON_RECOMMENDATIONS.allowedMimeTypes);

async function requireAdminUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: NextResponse.json(
        { ok: false, message: "Nicht angemeldet." },
        { status: 401, headers: NO_STORE },
      ),
    };
  }

  if (!(await isSiteAdmin(user.id))) {
    return {
      error: NextResponse.json(
        { ok: false, message: "Nur Admins dürfen das Favicon ändern." },
        { status: 403, headers: NO_STORE },
      ),
    };
  }

  return { user };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminUser();
    if ("error" in auth && auth.error) return auth.error;
    const user = auth.user!;

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json(
        { ok: false, message: "Bitte eine Bilddatei auswählen." },
        { status: 400, headers: NO_STORE },
      );
    }

    if (file.size > SITE_FAVICON_RECOMMENDATIONS.maxBytes) {
      return NextResponse.json(
        { ok: false, message: "Datei zu groß (max. 512 KB)." },
        { status: 400, headers: NO_STORE },
      );
    }

    const mimeType = file.type || "image/png";
    if (!ALLOWED.has(mimeType)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Nur PNG, JPEG, WebP oder ICO sind erlaubt.",
        },
        { status: 400, headers: NO_STORE },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const branding = await saveSiteFavicon({
      bytes,
      mimeType: mimeType as (typeof SITE_FAVICON_RECOMMENDATIONS.allowedMimeTypes)[number],
      userId: user.id,
    });

    return NextResponse.json({ ok: true, branding }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Upload fehlgeschlagen.",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}

export async function DELETE() {
  try {
    const auth = await requireAdminUser();
    if ("error" in auth && auth.error) return auth.error;
    const user = auth.user!;

    const branding = await clearSiteFavicon({ userId: user.id });
    return NextResponse.json({ ok: true, branding }, { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Löschen fehlgeschlagen.",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
