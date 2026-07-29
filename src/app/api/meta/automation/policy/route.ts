import { NextRequest } from "next/server";

import { parsePolicyCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  saveCustomerPolicy,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parsePolicyCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await saveCustomerPolicy(customer, command);

    return controlJson({
      ok: true,
      policyId: result.policyId,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
