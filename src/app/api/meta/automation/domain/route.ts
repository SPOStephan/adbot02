import { NextRequest } from "next/server";

import { parseDomainCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  applyCustomerDomainCommand,
  authenticateMetaCustomer,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseDomainCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await applyCustomerDomainCommand(customer, command);

    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
