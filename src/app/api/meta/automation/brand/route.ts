import { NextRequest } from "next/server";

import { parseBrandCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  saveCustomerBrandProfile,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseBrandCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await saveCustomerBrandProfile(customer, command);

    return controlJson({
      ok: true,
      brandProfileId: result.brandProfileId,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
