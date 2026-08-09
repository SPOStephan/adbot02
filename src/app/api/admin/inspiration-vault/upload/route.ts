import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import {
  MediaLibraryError,
  uploadInspirationVaultImage,
} from "@/lib/media-library/upload";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !(await isSiteAdmin(user.id))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const note = String(form.get("note") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Datei fehlt." },
        { status: 400 },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadInspirationVaultImage({
      uploaderUserId: user.id,
      fileName: file.name || "inspiration.jpg",
      mimeType: file.type || null,
      bytes,
      note,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof MediaLibraryError) {
      return NextResponse.json(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[inspiration-vault-upload]", error);
    return NextResponse.json(
      { ok: false, error: "Upload fehlgeschlagen." },
      { status: 500 },
    );
  }
}
