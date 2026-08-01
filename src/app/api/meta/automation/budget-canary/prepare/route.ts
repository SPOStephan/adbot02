import { NextRequest } from "next/server";

import { parseBudgetCanaryMaterializationCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  materializeCustomerBudgetCanary,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseBudgetCanaryMaterializationCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await materializeCustomerBudgetCanary(customer, command);

    return controlJson({
      ok: true,
      outcome: result.outcome,
      planId: result.planId,
      status: result.status,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
