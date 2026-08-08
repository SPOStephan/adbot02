import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import {
  clearSiteLogoVariant,
  saveSiteLogoVariant,
} from "@/lib/site-branding/branding";
import { SITE_LOGO_RECOMMENDATIONS } from "@/lib/site-branding/recommendations";
import { isLogoVariant } from "@/lib/site-branding/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
};

const ALLOWED = new Set<string>(SITE_LOGO_RECOMMENDATIONS.allowedMimeTypes);

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
        { ok: false, message: "Nur Admins dürfen Logos ändern." },
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
    const variantRaw = String(form.get("variant") ?? "");
    if (!isLogoVariant(variantRaw)) {
      return NextResponse.json(
        { ok: false, message: "Unbekannte Logo-Variante." },
        { status: 400, headers: NO_STORE },
      );
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return NextResponse.json(
        { ok: false, message: "Bitte eine Bilddatei auswählen." },
        { status: 400, headers: NO_STORE },
      );
    }

    if (file.size > SITE_LOGO_RECOMMENDATIONS.maxBytes) {
      return NextResponse.json(
        { ok: false, message: "Datei zu groß (max. 2 MB)." },
        { status: 400, headers: NO_STORE },
      );
    }

    const mimeType = file.type;
    if (!ALLOWED.has(mimeType)) {
      return NextResponse.json(
        {
          ok: false,
          message: "Nur PNG, JPEG oder WebP sind erlaubt.",
        },
        { status: 400, headers: NO_STORE },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const branding = await saveSiteLogoVariant({
      variant: variantRaw,
      bytes,
      mimeType: mimeType as (typeof SITE_LOGO_RECOMMENDATIONS.allowedMimeTypes)[number],
      userId: user.id,
    });

    return NextResponse.json(
      { ok: true, branding },
      { headers: NO_STORE },
    );
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

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdminUser();
    if ("error" in auth && auth.error) return auth.error;
    const user = auth.user!;

    const body = (await request.json().catch(() => null)) as {
      variant?: unknown;
    } | null;
    const variantRaw = typeof body?.variant === "string" ? body.variant : "";
    if (!isLogoVariant(variantRaw)) {
      return NextResponse.json(
        { ok: false, message: "Unbekannte Logo-Variante." },
        { status: 400, headers: NO_STORE },
      );
    }

    const branding = await clearSiteLogoVariant({
      variant: variantRaw,
      userId: user.id,
    });

    return NextResponse.json(
      { ok: true, branding },
      { headers: NO_STORE },
    );
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
