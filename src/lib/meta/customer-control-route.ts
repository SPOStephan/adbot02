import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { CustomerControlInputError } from "@/lib/meta/customer-control-input";
import { CustomerControlServiceError } from "@/lib/meta/customer-control-service";

const MAX_BODY_BYTES = 32_768;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

export function controlJson(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function readControlJson(request: NextRequest): Promise<unknown> {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (
    !origin ||
    origin !== request.nextUrl.origin ||
    (fetchSite && fetchSite !== "same-origin")
  ) {
    throw new CustomerControlServiceError(
      "invalid_origin",
      403,
      "Die Anfrage konnte nicht als Dashboard-Aktion bestätigt werden.",
    );
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    throw new CustomerControlInputError(
      "invalid_content_type",
      "Die Anfrage muss als JSON gesendet werden.",
    );
  }

  const declaredLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new CustomerControlInputError(
      "request_too_large",
      "Die Anfrage ist zu groß.",
    );
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    throw new CustomerControlInputError(
      "request_too_large",
      "Die Anfrage ist zu groß.",
    );
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new CustomerControlInputError(
      "invalid_json",
      "Die Anfrage enthält kein gültiges JSON.",
    );
  }
}

export function controlErrorResponse(error: unknown): NextResponse {
  if (error instanceof CustomerControlInputError) {
    return controlJson(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      400,
    );
  }

  if (error instanceof CustomerControlServiceError) {
    return controlJson(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      error.status,
    );
  }

  return controlJson(
    {
      ok: false,
      error: "internal_error",
      message:
        "Die Aktion konnte nicht sicher abgeschlossen werden. Bitte versuche es erneut.",
    },
    500,
  );
}
