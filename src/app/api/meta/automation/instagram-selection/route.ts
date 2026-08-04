import { NextRequest } from "next/server";

import { parseInstagramSelectionCommand } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  saveCustomerInstagramSelection,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseInstagramSelectionCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await saveCustomerInstagramSelection(customer, command);

    return controlJson({
      ok: true,
      selectedCount: result.selectedCount,
    });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
