import { NextRequest } from "next/server";

import { parseCampaignBriefArchiveCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  archiveCustomerCampaignBrief,
  authenticateMetaCustomer,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseCampaignBriefArchiveCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await archiveCustomerCampaignBrief(customer, command);

    return controlJson({
      ok: true,
      briefId: result.briefId,
      archived: result.archived,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
