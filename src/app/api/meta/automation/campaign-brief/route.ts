import { NextRequest } from "next/server";

import { parseCampaignBriefCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  saveCustomerCampaignBrief,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseCampaignBriefCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await saveCustomerCampaignBrief(customer, command);

    return controlJson({
      ok: true,
      briefId: result.briefId,
      status: result.status,
      alreadyExisted: result.alreadyExisted,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
