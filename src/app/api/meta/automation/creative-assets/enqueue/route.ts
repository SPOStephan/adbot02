import { NextRequest } from "next/server";

import { enqueueCreativeAssetGenerationJob, parseCreativeAssetEnqueueBody } from "@/lib/creative-assets/enqueue";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  CustomerControlServiceError,
} from "@/lib/meta/customer-control-service";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Authenticated enqueue for Creative Generation Phase 2 (mode=free).
 * Does not charge credits in Phase 2 — see CREATIVE_GENERATION_PHASE2.md.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const parsed = parseCreativeAssetEnqueueBody(body);
    const customer = await authenticateMetaCustomer();
    const result = await enqueueCreativeAssetGenerationJob({
      customer,
      brandProfileId: parsed.brandProfileId,
      generation: parsed.input,
    });

    return controlJson({
      ok: true,
      jobId: result.jobId,
    });
  } catch (error) {
    if (error instanceof CustomerControlServiceError) {
      return controlErrorResponse(error);
    }
    if (error instanceof CustomerControlInputError) {
      return controlErrorResponse(error);
    }
    const message =
      error instanceof Error
        ? error.message
        : "Creative-Asset-Job konnte nicht eingereiht werden.";
    return controlJson({ ok: false, message }, 400);
  }
}
