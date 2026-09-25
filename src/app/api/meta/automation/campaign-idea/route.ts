import { NextRequest } from "next/server";

import { createCampaignIdea } from "@/lib/campaign-pipeline/service";
import { parseCampaignIdeaCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseCampaignIdeaCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await createCampaignIdea(customer, command);

    return controlJson({
      ok: true,
      alreadyExisted: result.alreadyExisted,
      idea: result.idea,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
