import { NextRequest } from "next/server";

import { parseBudgetCanaryApprovalCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  approveCustomerBudgetCanary,
  authenticateMetaCustomer,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseBudgetCanaryApprovalCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await approveCustomerBudgetCanary(customer, command);

    return controlJson({
      ok: true,
      approvalId: result.approvalId,
      planId: result.planId,
      planStatus: result.planStatus,
      executableAt: result.executableAt,
      approvedAt: result.approvedAt,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
