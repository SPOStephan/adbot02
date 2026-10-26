import { NextRequest } from "next/server";

import { parseCampaignStatusChangeRequest } from "@/lib/meta/campaign-status-change";
import { changeMetaCampaignStatus } from "@/lib/meta/campaign-status-service";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const input = parseCampaignStatusChangeRequest(await readControlJson(request));
    if (!input) {
      throw new CustomerControlInputError(
        "invalid_campaign_status",
        "Kampagne oder Status sind ungültig.",
      );
    }
    const customer = await authenticateMetaCustomer();
    const result = await changeMetaCampaignStatus(customer, input);
    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
