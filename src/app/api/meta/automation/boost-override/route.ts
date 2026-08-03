import { NextRequest } from "next/server";

import { parseBoostOverrideCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  saveCustomerBoostOverride,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseBoostOverrideCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await saveCustomerBoostOverride(customer, command);

    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
