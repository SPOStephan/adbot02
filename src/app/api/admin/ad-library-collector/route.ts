import { NextRequest, NextResponse } from "next/server";

import { AdExampleInputError } from "@/lib/ad-examples/input";
import { isSiteAdmin } from "@/lib/auth/site-admin";
import { CollectorInputError } from "@/lib/ad-library-collector/normalize";
import {
  CollectorServiceError,
  enqueueCollectorDrafts,
  loadCollectorInbox,
  previewCollectorMemory,
  transitionCollectorItem,
} from "@/lib/ad-library-collector/service";
import type { CollectorStatus } from "@/lib/ad-library-collector/types";
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
        { ok: false, message: "Nur Admins dürfen die Korpus-Sandbox nutzen." },
        403,
      ),
    };
  }
  return { user };
}

function errorResponse(error: unknown) {
  if (error instanceof CollectorInputError || error instanceof AdExampleInputError) {
    return json({ ok: false, code: "invalid_input", message: error.message }, 400);
  }
  if (error instanceof CollectorServiceError) {
    return json({ ok: false, code: error.code, message: error.message }, error.status);
  }
  console.error("ad_library_collector_admin_failed", {
    message: error instanceof Error ? error.message : "unknown",
  });
  return json(
    { ok: false, code: "internal_error", message: "Die Korpus-Sandbox ist gerade nicht erreichbar." },
    500,
  );
}

function formRecord(form: FormData): Record<string, unknown> {
  return {
    provider: form.get("provider") || "manual",
    externalId: form.get("externalId"),
    collectorBatchId: form.get("collectorBatchId"),
    title: form.get("title"),
    advertiserName: form.get("advertiserName"),
    platform: form.get("platform"),
    industry: form.get("industry"),
    objective: form.get("objective"),
    objectiveDetail: form.get("objectiveDetail"),
    funnelStage: form.get("funnelStage"),
    sourceKind: form.get("sourceKind"),
    sourceUrl: form.get("sourceUrl"),
    imageUrl: form.get("imageUrl"),
    evidenceLevel: form.get("evidenceLevel"),
    rightsBasis: form.get("rightsBasis"),
    rightsConfirmed: form.get("rightsConfirmed"),
    format: form.get("format"),
    country: form.get("country"),
    language: form.get("language"),
    hookText: form.get("hookText"),
    bodyText: form.get("bodyText"),
    ctaText: form.get("ctaText"),
    landingPageUrl: form.get("landingPageUrl"),
    performanceNote: form.get("performanceNote"),
    whyItWorks: form.get("whyItWorks"),
    tags: form.get("tags"),
    qualityRating: form.get("qualityRating"),
    useForGeneration: form.get("useForGeneration"),
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request, "read");
    if ("error" in auth && auth.error) return auth.error;
    const status = request.nextUrl.searchParams.get("status");
    const inbox = await loadCollectorInbox({
      status: (status as CollectorStatus | "all" | null) ?? "all",
    });
    return json({
      ok: true,
      customerVisible: false,
      neverLaunch: true,
      ...inbox,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if ("error" in auth && auth.error) return auth.error;

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      const image =
        file instanceof File && file.size > 0
          ? {
              fileName: file.name || "werbebeispiel.jpg",
              mimeType: file.type || "image/jpeg",
              bytes: new Uint8Array(await file.arrayBuffer()),
            }
          : null;
      const result = await enqueueCollectorDrafts({
        records: [formRecord(form)],
        createdBy: auth.user.id,
        image,
      });
      return json({ ok: true, action: "enqueue", ...result });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ ok: false, message: "Ungültige Anfrage." }, 400);
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "enqueue") {
      const records = Array.isArray(body.records)
        ? body.records
        : body.record
          ? [body.record]
          : [];
      const result = await enqueueCollectorDrafts({
        records,
        createdBy: auth.user.id,
        batchId: typeof body.batchId === "string" ? body.batchId : null,
      });
      return json({ ok: true, action, ...result });
    }

    if (action === "set_status") {
      const id = typeof body.id === "string" ? body.id : "";
      const status = body.status as CollectorStatus;
      const item = await transitionCollectorItem({ id, status });
      return json({ ok: true, action, item });
    }

    if (action === "preview") {
      const preview = await previewCollectorMemory({
        platform: typeof body.platform === "string" ? body.platform : undefined,
        objective: typeof body.objective === "string" ? body.objective : undefined,
        industry: typeof body.industry === "string" ? body.industry : undefined,
      });
      return json({ ok: true, action, preview });
    }

    return json({ ok: false, message: "Unbekannte Aktion." }, 400);
  } catch (error) {
    return errorResponse(error);
  }
}
