import { NextRequest } from "next/server";

import { parseAutomationScopeCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  setCustomerAutomationScope,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseAutomationScopeCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await setCustomerAutomationScope(customer, command);

    return controlJson({
      ok: true,
      selectionId: result.selectionId,
      affectedTargetCount: result.affectedTargetCount,
      managedBudgetOwnerCount: result.managedBudgetOwnerCount,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
