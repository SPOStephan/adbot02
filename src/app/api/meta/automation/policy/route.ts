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
      managedBudgetOwnerCount: result.managedBudgetOwnerCount,
      organicBoost: result.organicBoost
        ? {
            status: result.organicBoost.status,
            plansCreated: result.organicBoost.plansCreated,
            plansExisting: result.organicBoost.plansExisting,
            candidatesFailed: result.organicBoost.candidatesFailed,
            candidatesSkipped: result.organicBoost.candidatesSkipped,
            candidatesConsidered: result.organicBoost.candidatesConsidered,
            pendingPlans: result.organicBoost.pendingPlans ?? 0,
            executorSucceeded: result.organicBoost.executorSucceeded ?? 0,
            executorLastOutcome: result.organicBoost.executorLastOutcome ?? null,
            executorLastError: result.organicBoost.executorLastError ?? null,
            lastError: result.organicBoost.lastError,
          }
        : null,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
