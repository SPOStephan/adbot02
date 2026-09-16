import { NextRequest, NextResponse } from "next/server";

import { isSiteAdmin } from "@/lib/auth/site-admin";
import {
  generateTrainingAd,
  loadTrainingInbox,
  rateTrainingAd,
  TrainingServiceError,
} from "@/lib/ad-training/service";
import {
  isDashboardSameOriginReadRequest,
  isDashboardSameOriginRequest,
} from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
    return { error: json({ ok: false, message: "Nur Admins dürfen das Trainingsgelände nutzen." }, 403) };
  }
  return { user };
}

function errorResponse(error: unknown) {
  if (error instanceof TrainingServiceError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  const message = error instanceof Error ? error.message : "Trainingsgelände nicht erreichbar.";
  console.error("adbot_training_failed", { message });
  return json({ ok: false, message }, 500);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request, "read");
    if ("error" in auth && auth.error) return auth.error;
    const inbox = await loadTrainingInbox();
    return json({ ok: true, ...inbox });
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
    const action = typeof body.action === "string" ? body.action : "generate";

    if (action === "rate") {
      const run = await rateTrainingAd({
        id: typeof body.id === "string" ? body.id : "",
        verdict: body.verdict === "reject" ? "reject" : "keep",
        note: typeof body.note === "string" ? body.note : "",
      });
      return json({ ok: true, action, run });
    }

    const run = await generateTrainingAd({
      createdBy: auth.user.id,
      landingUrl: typeof body.landingUrl === "string" ? body.landingUrl : "",
      platform: typeof body.platform === "string" ? body.platform : "meta",
      objective: typeof body.objective === "string" ? body.objective : "traffic",
      industry: typeof body.industry === "string" ? body.industry : "",
    });
    return json({ ok: true, action: "generate", run });
  } catch (error) {
    return errorResponse(error);
  }
}
