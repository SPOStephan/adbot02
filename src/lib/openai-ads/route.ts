import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { OpenAIAdsApiError } from "@/lib/openai-ads/client";
import { OpenAIAdsServiceError } from "@/lib/openai-ads/connection";
import { OpenAIAdsInputError } from "@/lib/openai-ads/input";
import { createClient } from "@/lib/supabase/server";

const MAX_BODY_BYTES = 65_536;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function openAIAdsJson(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function readOpenAIAdsJson(request: NextRequest): Promise<unknown> {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    !origin ||
    origin !== request.nextUrl.origin ||
    (fetchSite && fetchSite !== "same-origin")
  ) {
    throw new OpenAIAdsServiceError(
      "invalid_origin",
      403,
      "Die Anfrage konnte nicht als Dashboard-Aktion bestätigt werden.",
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new OpenAIAdsInputError(
      "invalid_content_type",
      "Die Anfrage muss als JSON gesendet werden.",
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new OpenAIAdsInputError("request_too_large", "Die Anfrage ist zu groß.");
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw new OpenAIAdsInputError("request_too_large", "Die Anfrage ist zu groß.");
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new OpenAIAdsInputError(
      "invalid_json",
      "Die Anfrage enthält kein gültiges JSON.",
    );
  }
}

export async function authenticateOpenAIAdsUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new OpenAIAdsServiceError(
      "unauthorized",
      401,
      "Für diese Aktion ist eine Anmeldung erforderlich.",
    );
  }

  return user;
}

export function openAIAdsErrorResponse(error: unknown): NextResponse {
  if (error instanceof OpenAIAdsInputError) {
    return openAIAdsJson(
      { ok: false, error: error.code, message: error.message },
      400,
    );
  }
  if (error instanceof OpenAIAdsServiceError) {
    return openAIAdsJson(
      { ok: false, error: error.code, message: error.message },
      error.status,
    );
  }
  if (error instanceof OpenAIAdsApiError) {
    const status = error.status === 429 ? 429 : error.status >= 500 ? 502 : 400;
    return openAIAdsJson(
      {
        ok: false,
        error: error.code ?? "provider_error",
        message:
          error.status === 429
            ? "OpenAI Ads hat zu viele Anfragen erhalten. Bitte später erneut versuchen."
            : "OpenAI Ads konnte die Aktion nicht ausführen. Bitte Angaben und Kontostatus prüfen.",
      },
      status,
    );
  }

  console.error("openai_ads_route_failed", {
    name: error instanceof Error ? error.name : "unknown",
  });
  return openAIAdsJson(
    {
      ok: false,
      error: "internal_error",
      message:
        "Die OpenAI-Ads-Aktion konnte nicht sicher abgeschlossen werden.",
    },
    500,
  );
}
