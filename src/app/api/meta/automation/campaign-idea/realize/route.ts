import { NextRequest } from "next/server";

import { realizeCampaignIdea } from "@/lib/campaign-pipeline/service";
import { parseCampaignIdeaRealizeCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseCampaignIdeaRealizeCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await realizeCampaignIdea(customer, command);
    return controlJson({
      ok: true,
      idea: result.idea,
      launchPath: result.launchPath,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
