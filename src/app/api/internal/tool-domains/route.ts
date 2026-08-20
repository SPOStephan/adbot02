import { NextRequest, NextResponse } from "next/server";

import {
  CustomDomainServiceError,
  listCustomerCustomDomains,
  unbindOrRevokeCustomerCustomDomainFromTool,
  upsertCustomerCustomDomainFromTool,
} from "@/lib/custom-domains/service";
import { verifyToolDomainSyncToken } from "@/lib/custom-domains/tool-domain-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Internal Funnel/Freebie → Portal domain sync.
 * Does not touch Funnel/Freebie databases. Host routing stays in the tools.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
    };
    const token = typeof body.token === "string" ? body.token : "";
    const payload = verifyToolDomainSyncToken(token);
    if (!payload) {
      return json(
        { ok: false, message: "Sync-Token ungültig oder abgelaufen." },
        401,
      );
    }

    if (payload.action === "list") {
      const domains = await listCustomerCustomDomains(payload.sub);
      return json({
        ok: true,
        domains: domains.map((domain) => ({
          id: domain.id,
          hostname: domain.hostname,
          label: domain.label,
          status: domain.status,
          dnsTarget: domain.dnsTarget,
          origin: domain.origin,
          bindingKind: domain.bindingKind,
          bindingRef: domain.bindingRef,
          bindingLabel: domain.bindingLabel,
        })),
      });
    }

    if (payload.action === "upsert") {
      if (!payload.hostname || !payload.status) {
        return json(
          { ok: false, message: "hostname und status sind erforderlich." },
          400,
        );
      }
      const domain = await upsertCustomerCustomDomainFromTool({
        userId: payload.sub,
        tool: payload.tool,
        hostname: payload.hostname,
        status: payload.status,
        dnsTarget: payload.dnsTarget,
        bindingRef: payload.bindingRef,
        bindingLabel: payload.bindingLabel,
        toolDomainId: payload.toolDomainId,
      });
      return json({ ok: true, domain });
    }

    if (payload.action === "revoke") {
      if (!payload.hostname) {
        return json({ ok: false, message: "hostname ist erforderlich." }, 400);
      }
      await unbindOrRevokeCustomerCustomDomainFromTool({
        userId: payload.sub,
        tool: payload.tool,
        hostname: payload.hostname,
        toolDomainId: payload.toolDomainId,
      });
      return json({ ok: true });
    }

    return json({ ok: false, message: "Unbekannte Aktion." }, 400);
  } catch (error) {
    if (error instanceof CustomDomainServiceError) {
      return json(
        { ok: false, code: error.code, message: error.message },
        error.status,
      );
    }
    console.error("[tool-domains]", error);
    return json({ ok: false, message: "Domain-Sync fehlgeschlagen." }, 500);
  }
}
