import "server-only";

import { createHash } from "node:crypto";

import {
  assertCreativeGenerationInput,
  CreativeGenerationContractError,
  type CreativeGenerationInput,
} from "@/lib/creative-assets/generation-contract";
import {
  getCreativeAssetProviderKeyFromEnv,
  hasCreativeAssetProviderConfig,
  isModelAllowlistedForConfiguredProvider,
} from "@/lib/creative-assets/env";
import { assertExecutableGenerationInput } from "@/lib/creative-assets/map-generation-input";
import {
  InsufficientCreditsError,
  releaseCreditReservation,
  reserveCredits,
} from "@/lib/billing/credits";
import { withBillingReference } from "@/lib/billing/credit-contract";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";
import { attachCustomerWinnerStyleRefs } from "@/lib/ad-learning/style-refs";
import { createAdminClient } from "@/lib/supabase/admin";

/** Catalog action for free + locked_photo master generation (Phase 6). */
export const CREATIVE_IMAGE_CREDIT_ACTION =
  "creative.generate_image_master" as const;

/** Async jobs need a long reservation window (SQL max 86400). */
export const CREATIVE_IMAGE_CREDIT_TTL_SECONDS = 86_400;

export type EnqueueCreativeAssetJobResult = {
  jobId: string;
  creditReservationId: string | null;
  creditsReserved: number;
};

type EnqueueCustomer = {
  userId: string;
  platformAccountId: string | null;
  connectedPlatforms?: string[];
};

function requiredUuid(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new CustomerControlInputError(
      "invalid_uuid",
      `${label} muss eine gültige UUID sein.`,
    );
  }
  return value.toLowerCase();
}

/**
 * Parse enqueue body: generation contract fields + brandProfileId.
 */
export function parseCreativeAssetEnqueueBody(body: unknown): {
  brandProfileId: string | null;
  input: CreativeGenerationInput;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CustomerControlInputError(
      "invalid_body",
      "Die Anfrage muss ein JSON-Objekt sein.",
    );
  }
  const raw = body as Record<string, unknown>;
  const brandProfileRaw =
    typeof raw.brandProfileId === "string" ? raw.brandProfileId.trim() : "";
  const brandProfileId = brandProfileRaw
    ? requiredUuid(brandProfileRaw, "Die Brand-Profil-ID")
    : null;

  const { brandProfileId: _ignored, ...generationFields } = raw;
  void _ignored;

  let input: CreativeGenerationInput;
  try {
    input = assertCreativeGenerationInput(generationFields);
  } catch (error) {
    if (error instanceof CreativeGenerationContractError) {
      throw new CustomerControlInputError(
        error.code.toLowerCase(),
        error.message,
      );
    }
    throw error;
  }

  try {
    assertExecutableGenerationInput(input, {
      providerKey: input.provider_key,
      providerModel: input.model_id,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Generationseingabe ist nicht erlaubt.";
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code.toLowerCase()
        : "policy_rejected";
    throw new CustomerControlInputError(code, message);
  }

  return { brandProfileId, input };
}

function creditIdempotencyKey(input: {
  userId: string;
  platformAccountId: string | null;
  brandProfileId: string | null;
  generation: CreativeGenerationInput;
}): string {
  return createHash("sha256")
    .update(
      [
        "creative-generate-image",
        input.userId,
        input.platformAccountId ?? "none",
        input.brandProfileId ?? "none",
        input.generation.provider_key,
        input.generation.model_id,
        input.generation.mode,
        JSON.stringify(input.generation),
      ].join("|"),
    )
    .digest("hex");
}

export async function enqueueCreativeAssetGenerationJob(input: {
  customer: EnqueueCustomer;
  brandProfileId: string | null;
  generation: CreativeGenerationInput;
}): Promise<EnqueueCreativeAssetJobResult> {
  if (!hasCreativeAssetProviderConfig()) {
    throw new CustomerControlInputError(
      "provider_not_configured",
      "Creative-Asset-Provider ist nicht konfiguriert.",
    );
  }

  const configuredKey = getCreativeAssetProviderKeyFromEnv();
  if (!configuredKey || configuredKey !== input.generation.provider_key) {
    throw new CustomerControlInputError(
      "provider_key_mismatch",
      "provider_key stimmt nicht mit dem konfigurierten Provider überein.",
    );
  }

  if (
    !isModelAllowlistedForConfiguredProvider(
      input.generation.provider_key,
      input.generation.model_id,
    )
  ) {
    throw new CustomerControlInputError(
      "model_not_allowlisted",
      "Das gewählte Modell ist nicht freigegeben.",
    );
  }

  const referenceAssetIds = await attachCustomerWinnerStyleRefs({
    userId: input.customer.userId,
    platformAccountId: input.customer.platformAccountId,
    referenceAssetIds: input.generation.reference_asset_ids,
    prompt: input.generation.prompt,
  });
  const generation = {
    ...input.generation,
    reference_asset_ids: referenceAssetIds,
  };

  if (!input.customer.platformAccountId || !input.brandProfileId) {
    const { generateLibraryCreativeNow } = await import(
      "@/lib/creative-assets/library-generate"
    );
    return generateLibraryCreativeNow({
      userId: input.customer.userId,
      platformAccountId: input.customer.platformAccountId,
      connectedPlatforms: input.customer.connectedPlatforms ?? [],
      prompt: input.generation.prompt || "Advertising image, no text, no logos.",
    });
  }

  const reservation = await reserveCredits({
    userId: input.customer.userId,
    actionKey: CREATIVE_IMAGE_CREDIT_ACTION,
    idempotencyKey: creditIdempotencyKey({
      userId: input.customer.userId,
      platformAccountId: input.customer.platformAccountId,
      brandProfileId: input.brandProfileId,
      generation,
    }),
    referenceType: "creative_asset_job",
    ttlSeconds: CREATIVE_IMAGE_CREDIT_TTL_SECONDS,
  });

  const admin = createAdminClient();
  const generationPayload = generation as unknown as Record<string, unknown>;
  const payload =
    reservation.provider === "waizr"
      ? withBillingReference(generationPayload, reservation)
      : generationPayload;

  try {
    const { data, error } = await admin.rpc("enqueue_creative_asset_job", {
      p_user_id: input.customer.userId,
      p_platform_account_id: input.customer.platformAccountId,
      p_brand_profile_id: input.brandProfileId,
      p_provider_key: input.generation.provider_key,
      p_provider_model: input.generation.model_id,
      p_provider_version: null,
      p_input_payload: payload,
      p_max_attempts: 3,
      p_credit_reservation_id:
        reservation.provider === "legacy" ? reservation.reservationId : null,
    });

    if (error) {
      const message = error.message ?? "";
      if (/Active brand profile/i.test(message)) {
        throw new CustomerControlInputError(
          "brand_profile_inactive",
          "Aktives Brand-Profil ist erforderlich.",
        );
      }
      if (/kill-switch|autonomous launch policy/i.test(message)) {
        throw new CustomerControlInputError(
          "policy_blocked",
          "Aktive Launch-Policy und offener Kill-Switch sind erforderlich.",
        );
      }
      if (/Credit reservation/i.test(message)) {
        throw new CustomerControlInputError(
          "credit_reservation_invalid",
          "Credit-Reservierung ist ungültig.",
        );
      }
      if (/Sensitive|invalid|contract|style reference|locked_photo/i.test(message)) {
        throw new CustomerControlInputError(
          "invalid_input",
          "Generationseingabe wurde abgelehnt.",
        );
      }
      throw new CustomerControlInputError(
        "enqueue_failed",
        "Creative-Asset-Job konnte nicht eingereiht werden.",
      );
    }

    if (typeof data !== "string" || !data) {
      throw new CustomerControlInputError(
        "enqueue_failed",
        "Creative-Asset-Job konnte nicht eingereiht werden.",
      );
    }

    return {
      jobId: data,
      creditReservationId: reservation.reservationId,
      creditsReserved: reservation.amount,
    };
  } catch (error) {
    if (
      !(error instanceof InsufficientCreditsError) &&
      !reservation.alreadyExisted
    ) {
      try {
        await releaseCreditReservation({
          userId: input.customer.userId,
          reservationId: reservation.reservationId,
          provider: reservation.provider,
        });
      } catch (releaseError) {
        console.error("creative_image_credit_release_failed", {
          reservationId: reservation.reservationId,
          message:
            releaseError instanceof Error
              ? releaseError.message
              : "release_failed",
        });
      }
    }
    if (error instanceof InsufficientCreditsError) {
      throw error;
    }
    throw error;
  }
}
