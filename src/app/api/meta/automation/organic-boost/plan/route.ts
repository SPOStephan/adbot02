import { NextRequest } from "next/server";

import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  planCustomerOrganicBoost,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // Origin/CSRF gate; body may be empty object.
    await readControlJson(request);
    const customer = await authenticateMetaCustomer();
    const organicBoost = await planCustomerOrganicBoost(customer);

    return controlJson({
      ok: true,
      organicBoost: {
        status: organicBoost.status,
        plansCreated: organicBoost.plansCreated,
        plansExisting: organicBoost.plansExisting,
        candidatesFailed: organicBoost.candidatesFailed,
        candidatesSkipped: organicBoost.candidatesSkipped,
        candidatesConsidered: organicBoost.candidatesConsidered,
        lastError: organicBoost.lastError,
      },
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
