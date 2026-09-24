import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { generateMasterImageBytes } from "@/lib/ad-training/image";
import {
  commitCreditReservation,
  releaseCreditReservation,
  reserveCredits,
} from "@/lib/billing/credits";
import { inspectCreativeImage } from "@/lib/creative-assets/image";

const LIBRARY_IMAGE_CREDIT_ACTION = "creative.generate_image_master" as const;
const LIBRARY_IMAGE_CREDIT_TTL_SECONDS = 86_400;
import { getCreativeAssetStorageBucket } from "@/lib/creative-assets/env";
import { CustomerControlInputError } from "@/lib/meta/customer-control-input";
import { formatSlotsForConnectedPlatforms } from "@/lib/media-library/platform-formats";
import { storeCustomerLibraryAsset } from "@/lib/media-library/storage";
import { createAdminClient } from "@/lib/supabase/admin";

export type LibraryGenerateResult = {
  jobId: string;
  creditReservationId: string | null;
  creditsReserved: number;
  brandAssetId: string | null;
  immediate: true;
  model: string | null;
};

export async function registerCustomerLibraryImage(input: {
  userId: string;
  platformAccountId: string | null;
  brandProfileId?: string | null;
  fileName: string;
  bytes: Uint8Array;
  sourceType?: "UPLOADED" | "GENERATED";
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const admin = createAdminClient();
  const inspected = inspectCreativeImage({
    bytes: input.bytes,
    declaredMimeType: input.bytes[0] === 0x89 ? "image/png" : "image/jpeg",
  });
  const bucket = getCreativeAssetStorageBucket();

  if (input.platformAccountId) {
    const stored = await storeCustomerLibraryAsset({
      userId: input.userId,
      platformAccountId: input.platformAccountId,
      bytes: inspected.bytes,
      sha256: inspected.sha256,
      mimeType: inspected.mimeType,
      bucket,
    });
    const { data, error } = await admin.rpc("register_uploaded_brand_asset", {
      p_user_id: input.userId,
      p_platform_account_id: input.platformAccountId,
      p_brand_profile_id: input.brandProfileId ?? null,
      p_storage_bucket: stored.bucket,
      p_storage_path: stored.path,
      p_original_filename: input.fileName.slice(0, 160),
      p_sha256: inspected.sha256,
      p_mime_type: inspected.mimeType,
      p_byte_size: inspected.byteSize,
      p_width: inspected.width,
      p_height: inspected.height,
      p_metadata: input.metadata ?? { contract_version: 1, library: "customer" },
    });
    if (error || typeof data !== "string") {
      throw new CustomerControlInputError(
        "register_failed",
        error?.message || "Creative konnte nicht gespeichert werden.",
      );
    }
    return data;
  }

  const path = `${input.userId}/library/${inspected.sha256.slice(0, 2)}/${inspected.sha256}.${
    inspected.mimeType === "image/png" ? "png" : "jpg"
  }`;
  const { error: uploadError } = await admin.storage.from(bucket).upload(path, inspected.bytes, {
    contentType: inspected.mimeType,
    upsert: true,
  });
  if (uploadError) {
    throw new CustomerControlInputError("storage_failed", "Creative-Datei konnte nicht gespeichert werden.");
  }
  const { data, error } = await admin.rpc("register_unbound_customer_library_asset", {
    p_user_id: input.userId,
    p_storage_bucket: bucket,
    p_storage_path: path,
    p_original_filename: input.fileName.slice(0, 160),
    p_sha256: inspected.sha256,
    p_mime_type: inspected.mimeType,
    p_byte_size: inspected.byteSize,
    p_width: inspected.width,
    p_height: inspected.height,
    p_metadata: input.metadata ?? { contract_version: 1, library: "customer" },
    p_source_type: input.sourceType ?? "GENERATED",
    p_asset_role: input.sourceType === "UPLOADED" ? "UPLOAD_EDITABLE" : "GENERATED",
  });
  if (error || typeof data !== "string") {
    throw new CustomerControlInputError(
      "register_failed",
      error?.message ||
        "Creative ohne Plattformkonto konnte nicht gespeichert werden. Bitte Migration creative_library_global ausführen.",
    );
  }
  return data;
}

export async function generateLibraryCreativeNow(input: {
  userId: string;
  platformAccountId: string | null;
  connectedPlatforms: string[];
  prompt: string;
  tags?: string[];
  skipCredits?: boolean;
}): Promise<LibraryGenerateResult> {
  const jobId = randomUUID();
  let reservation: {
    provider: "legacy" | "waizr";
    reservationId: string;
    amount: number;
    alreadyExisted: boolean;
  } | null = null;
  if (!input.skipCredits) {
    reservation = await reserveCredits({
      userId: input.userId,
      actionKey: LIBRARY_IMAGE_CREDIT_ACTION,
      idempotencyKey: createHash("sha256")
        .update(["library-generate", input.userId, jobId, input.prompt].join("|"))
        .digest("hex"),
      referenceType: "creative_asset_job",
      ttlSeconds: LIBRARY_IMAGE_CREDIT_TTL_SECONDS,
    });
  }

  try {
    const generated = await generateMasterImageBytes({ prompt: input.prompt });
    if ("skipped" in generated) {
      throw new CustomerControlInputError(
        "generation_skipped",
        generated.skipped || "Bildgenerierung ist nicht konfiguriert.",
      );
    }
    const extension = generated.mimeType === "image/png" ? "png" : "jpg";
    const brandAssetId = await registerCustomerLibraryImage({
      userId: input.userId,
      platformAccountId: input.platformAccountId,
      fileName: `creative-${jobId.slice(0, 8)}.${extension}`,
      bytes: generated.bytes,
      sourceType: "GENERATED",
      metadata: {
        contract_version: 1,
        library: "customer",
        source_kind: "library_generate",
        tags: input.tags ?? [],
        format_plan: formatSlotsForConnectedPlatforms(input.connectedPlatforms).map(
          (slot) => slot.key,
        ),
        model: generated.model,
      },
    });

    if (reservation) {
      await commitCreditReservation({
        userId: input.userId,
        reservationId: reservation.reservationId,
        provider: reservation.provider,
      });
    }

    return {
      jobId,
      creditReservationId: reservation?.reservationId ?? null,
      creditsReserved: reservation?.amount ?? 0,
      brandAssetId,
      immediate: true,
      model: generated.model,
    };
  } catch (error) {
    if (reservation && !reservation.alreadyExisted) {
      await releaseCreditReservation({
        userId: input.userId,
        reservationId: reservation.reservationId,
        provider: reservation.provider,
      }).catch(() => undefined);
    }
    throw error;
  }
}
