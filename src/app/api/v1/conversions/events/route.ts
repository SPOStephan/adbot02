import { NextRequest, NextResponse } from "next/server";

import {
  PUBLIC_CAPI_MAX_BODY_BYTES,
  handlePublicCapiRequest,
  publicCapiEndpointEnabled,
} from "@/lib/meta/public-capi-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Conversions API (erweitert) – öffentlicher Server-zu-Server-Endpunkt.
 * Doku: /api-docs/conversions-v1.openapi.json
 * Kein CORS: Browser-Aufrufe sind ausdrücklich nicht vorgesehen.
 */

const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function notFound() {
  return json({ ok: false, error: "not_found" }, 404);
}

export async function POST(request: NextRequest) {
  if (!publicCapiEndpointEnabled()) return notFound();

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > PUBLIC_CAPI_MAX_BODY_BYTES) {
    return json({ ok: false, error: "body_too_large", message: "Höchstens 1 MB je Anfrage." }, 413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ ok: false, error: "body_invalid", message: "Body nicht lesbar." }, 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > PUBLIC_CAPI_MAX_BODY_BYTES) {
    return json({ ok: false, error: "body_too_large", message: "Höchstens 1 MB je Anfrage." }, 413);
  }

  try {
    const result = await handlePublicCapiRequest({
      authorization: request.headers.get("authorization"),
      rawBody,
    });
    return json(result.body, result.httpStatus);
  } catch {
    console.error("[public-capi] request failed");
    return json(
      { ok: false, error: "temporarily_unavailable", message: "Bitte später erneut senden." },
      503,
    );
  }
}

// Browser-Preflight bewusst ohne Access-Control-Header (CORS aus).
export async function OPTIONS() {
  if (!publicCapiEndpointEnabled()) return notFound();
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, Allow: "POST" } });
}

export async function GET() {
  if (!publicCapiEndpointEnabled()) return notFound();
  return new NextResponse(null, { status: 405, headers: { ...HEADERS, Allow: "POST" } });
}
