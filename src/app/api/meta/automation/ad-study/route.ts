import { NextRequest } from "next/server";

import { createFunnelSplitAdStudy } from "@/lib/meta/ad-study";
import { parseAdStudyCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { authenticateMetaCustomer } from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseAdStudyCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await createFunnelSplitAdStudy({
      userId: customer.userId,
      platformAccountId: customer.platformAccountId,
      planId: command.planId,
    });

    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
