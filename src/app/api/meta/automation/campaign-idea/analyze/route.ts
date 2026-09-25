import { NextRequest } from "next/server";

import { analyzeCampaignIdea } from "@/lib/campaign-pipeline/service";
import { parseCampaignIdeaIdCommand } from "@/lib/meta/customer-control-input";
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
    const command = parseCampaignIdeaIdCommand(body);
    const customer = await authenticateMetaCustomer();
    const idea = await analyzeCampaignIdea(customer, command.ideaId);
    return controlJson({ ok: true, idea });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
