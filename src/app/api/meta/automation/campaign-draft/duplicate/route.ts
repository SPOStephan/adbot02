import { NextRequest } from "next/server";

import { duplicateMetaCampaignAsDraft } from "@/lib/meta/campaign-draft-service";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDuplicateRequest(value: unknown): { platformCampaignId: string } {
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const platformCampaignId =
    typeof body.platformCampaignId === "string" ? body.platformCampaignId.trim() : "";
  if (Object.keys(body).length !== 1 || !/^\d{1,64}$/.test(platformCampaignId)) {
    throw new CustomerControlInputError(
      "invalid_campaign_id",
      "Die Kampagnen-ID ist ungültig.",
    );
  }
  return { platformCampaignId };
}

export async function POST(request: NextRequest) {
  try {
    const input = parseDuplicateRequest(await readControlJson(request));
    const customer = await authenticateMetaCustomer();
    const result = await duplicateMetaCampaignAsDraft(customer, input.platformCampaignId);
    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
