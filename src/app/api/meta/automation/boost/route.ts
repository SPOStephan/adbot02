import { NextRequest } from "next/server";

import {
  parseOrganicBoostApprovalCommand,
  parseOrganicBoostPrepareCommand,
} from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  approveCustomerOrganicBoost,
  authenticateMetaCustomer,
  materializeCustomerOrganicBoost,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseOrganicBoostPrepareCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await materializeCustomerOrganicBoost(customer, command);

    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseOrganicBoostApprovalCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await approveCustomerOrganicBoost(customer, command);

    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
