import { NextRequest, NextResponse } from "next/server";

import {
  CustomDomainServiceError,
  listCustomerCustomDomains,
  registerCustomerCustomDomain,
  requireAuthenticatedUserId,
  revokeCustomerCustomDomain,
  verifyCustomerCustomDomain,
} from "@/lib/custom-domains/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    !origin ||
    origin !== request.nextUrl.origin ||
    (fetchSite && fetchSite !== "same-origin")
  ) {
    throw new CustomDomainServiceError(
      "invalid_origin",
      403,
      "Die Anfrage konnte nicht als Dashboard-Aktion bestätigt werden.",
    );
  }
}

export async function GET() {
  try {
    const userId = await requireAuthenticatedUserId();
    const domains = await listCustomerCustomDomains(userId);
    return json({ ok: true, domains });
  } catch (error) {
    if (error instanceof CustomDomainServiceError) {
      return json(
        { ok: false, code: error.code, message: error.message },
        error.status,
      );
    }
    return json(
      { ok: false, message: "Domains konnten nicht geladen werden." },
      500,
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const userId = await requireAuthenticatedUserId();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = String(body.action ?? "");

    if (action === "register") {
      const domain = await registerCustomerCustomDomain({
        userId,
        hostname: String(body.hostname ?? ""),
        label: typeof body.label === "string" ? body.label : "",
      });
      return json({
        ok: true,
        domain,
        message:
          "Domain hinterlegt. Setze den CNAME und prüfe danach die DNS-Verbindung.",
      });
    }

    if (action === "verify") {
      const result = await verifyCustomerCustomDomain({
        userId,
        domainId: String(body.domainId ?? ""),
        activate: body.activate !== false,
      });
      return json({
        ok: true,
        domain: result.domain,
        dnsOk: result.dnsOk,
        message: result.message,
      });
    }

    if (action === "revoke") {
      await revokeCustomerCustomDomain({
        userId,
        domainId: String(body.domainId ?? ""),
      });
      return json({ ok: true, message: "Domain zurückgezogen." });
    }

    return json({ ok: false, message: "Unbekannte Aktion." }, 400);
  } catch (error) {
    if (error instanceof CustomDomainServiceError) {
      return json(
        { ok: false, code: error.code, message: error.message },
        error.status,
      );
    }
    if (error instanceof Error && error.message.includes("Hostname")) {
      return json({ ok: false, message: error.message }, 400);
    }
    return json(
      { ok: false, message: "Domain-Aktion konnte nicht ausgeführt werden." },
      500,
    );
  }
}
