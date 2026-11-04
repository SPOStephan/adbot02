import { NextRequest } from "next/server";

import { parsePixelSignalCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  checkCustomerPixelEventSignal,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only: did the chosen conversion event reach the pixel in the last 7 days? */
export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parsePixelSignalCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await checkCustomerPixelEventSignal(customer, command);

    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
