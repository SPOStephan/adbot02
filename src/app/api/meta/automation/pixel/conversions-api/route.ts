import { NextRequest } from "next/server";

import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";
import {
  createPublicCapiKey,
  loadPublicCapiStatus,
  revokePublicCapiKey,
  sendPublicCapiTestEvent,
  setPublicCapiEnabled,
  updatePublicCapiKeyDomains,
} from "@/lib/meta/public-capi-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Conversions API (erweitert): Verwaltung im Tracking-Bereich. */
export async function POST(request: NextRequest) {
  try {
    const raw = await readControlJson(request);
    const body =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const customer = await authenticateMetaCustomer();

    switch (body.action) {
      case "status":
        return controlJson({ ok: true, ...(await loadPublicCapiStatus(customer)) });
      case "toggle":
        return controlJson({ ok: true, ...(await setPublicCapiEnabled(customer, body)) });
      case "create_key":
        return controlJson({ ok: true, ...(await createPublicCapiKey(customer, body)) });
      case "revoke_key":
        return controlJson({ ok: true, ...(await revokePublicCapiKey(customer, body)) });
      case "update_domains":
        return controlJson({ ok: true, ...(await updatePublicCapiKeyDomains(customer, body)) });
      case "test_event":
        return controlJson({ ok: true, ...(await sendPublicCapiTestEvent(customer, body)) });
      default:
        return controlJson({ ok: false, error: "invalid_action", message: "Unbekannte Aktion." }, 400);
    }
  } catch (error) {
    return controlErrorResponse(error);
  }
}
