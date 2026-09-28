import { NextRequest } from "next/server";

import {
  parseMetaCampaignDraftSave,
  parseMetaCampaignDraftStatus,
} from "@/lib/meta/campaign-draft";
import {
  getMetaCampaignDraftDestination,
  saveMetaCampaignDraft,
  setMetaCampaignDraftStatus,
} from "@/lib/meta/campaign-draft-service";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  releaseUnstartedCustomerLaunchReservations,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest) {
  try {
    const input = parseMetaCampaignDraftSave(await readControlJson(request));
    const customer = await authenticateMetaCustomer();
    const result = await saveMetaCampaignDraft(customer, input);
    return controlJson({ ok: true, ...result });
  } catch (error) {
    return controlErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const input = parseMetaCampaignDraftStatus(await readControlJson(request));
    const customer = await authenticateMetaCustomer();
    if (input.status === "ARCHIVED") {
      const destinationUrl = await getMetaCampaignDraftDestination(
        customer,
        input.draftId,
      );
      await releaseUnstartedCustomerLaunchReservations(customer, {
        campaignDraftId: input.draftId,
        destinationUrl,
        releaseStaleAcrossAccount: false,
      });
    }
    await setMetaCampaignDraftStatus(customer, input);
    return controlJson({ ok: true, draftId: input.draftId, status: input.status });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
