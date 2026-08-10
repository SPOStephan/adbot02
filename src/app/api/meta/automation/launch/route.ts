import { NextRequest } from "next/server";

import {
  parseLaunchApprovalCommand,
  parseLaunchCommand,
} from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  approveCustomerLaunch,
  authenticateMetaCustomer,
  materializeCustomerLaunch,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** May auto-run a Meta Abruf + snapshot ensure during prepare. */
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseLaunchCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await materializeCustomerLaunch(customer, command);

    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseLaunchApprovalCommand(body);
    const customer = await authenticateMetaCustomer();
    const result = await approveCustomerLaunch(customer, command);

    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
