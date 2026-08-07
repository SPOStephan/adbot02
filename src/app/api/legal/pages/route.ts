import { NextRequest, NextResponse } from "next/server";

import { saveLegalPage } from "@/lib/legal/pages";
import { isLegalSlug } from "@/lib/legal/types";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
};

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { ok: false, message: "Nicht angemeldet." },
        { status: 401, headers: NO_STORE },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      title?: unknown;
      body?: unknown;
    } | null;

    const slug = typeof body?.slug === "string" ? body.slug : "";
    if (!isLegalSlug(slug)) {
      return NextResponse.json(
        { ok: false, message: "Unbekannte Seite." },
        { status: 400, headers: NO_STORE },
      );
    }

    const page = await saveLegalPage({
      slug,
      title: typeof body?.title === "string" ? body.title : "",
      body: typeof body?.body === "string" ? body.body : "",
      userId: user.id,
    });

    return NextResponse.json(
      { ok: true, page },
      { headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Speichern fehlgeschlagen.",
      },
      { status: 500, headers: NO_STORE },
    );
  }
}
