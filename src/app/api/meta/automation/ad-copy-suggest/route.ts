import { NextRequest } from "next/server";

import { suggestAdCopyForDestination } from "@/lib/ad-copy/suggest";
import { InsufficientCreditsError } from "@/lib/billing/credits";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import {
  authenticateMetaCustomer,
  CustomerControlServiceError,
} from "@/lib/meta/customer-control-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CustomerControlInputError(
      "invalid_body",
      "Die Anfrage muss ein JSON-Objekt sein.",
    );
  }
  return value as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const body = asObject(await readControlJson(request));
    const destinationUrl =
      typeof body.destinationUrl === "string" ? body.destinationUrl.trim() : "";
    if (!destinationUrl) {
      throw new CustomerControlInputError(
        "invalid_destination_url",
        "Bitte zuerst eine HTTPS-Landingpage eintragen.",
      );
    }

    const objective =
      body.objective === "OUTCOME_LEADS" ? "OUTCOME_LEADS" : "OUTCOME_TRAFFIC";

    const customer = await authenticateMetaCustomer();
    const result = await suggestAdCopyForDestination({
      userId: customer.userId,
      destinationUrl,
      objective,
    });

    return controlJson({
      ok: true,
      primaryText: result.suggestion.primaryText,
      headline: result.suggestion.headline,
      description: result.suggestion.description,
      billing: result.billing,
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return controlJson(
        {
          ok: false,
          code: "INSUFFICIENT_CREDITS",
          message:
            "Nicht genügend Credits für den Textvorschlag. Bitte Guthaben prüfen.",
        },
        402,
      );
    }
    if (error instanceof CustomerControlServiceError) {
      return controlErrorResponse(error);
    }
    if (error instanceof CustomerControlInputError) {
      return controlErrorResponse(error);
    }
    const message =
      error instanceof Error
        ? error.message
        : "Textvorschlag konnte nicht erzeugt werden.";
    return controlJson({ ok: false, message }, 400);
  }
}
