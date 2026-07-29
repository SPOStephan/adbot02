import { NextRequest } from "next/server";

import { parseKillSwitchCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  setCustomerKillSwitch,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseKillSwitchCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await setCustomerKillSwitch(customer, command);

    return controlJson({
      ok: true,
      eventId: result.eventId,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
