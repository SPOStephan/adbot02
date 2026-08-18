import "server-only";

import { getCreativeAssetStorageBucket } from "@/lib/creative-assets/env";
import { inspectCreativeImage } from "@/lib/creative-assets/image";
import { CreativeAssetProviderError } from "@/lib/creative-assets/types";
import {
  describeMetaFormatCheck,
  getMetaFormatSlot,
  isMetaFormatKey,
  matchesMetaFormat,
  type MetaFormatKey,
} from "@/lib/media-library/meta-formats";
import {
  storeCustomerLibraryAsset,
  storeInspirationVaultAsset,
} from "@/lib/media-library/storage";
import { createAdminClient } from "@/lib/supabase/admin";

export type UploadedLibraryAsset = {
  brandAssetId: string;
  originalFilename: string;
  width: number;
  height: number;
  role: string;
  label: string;
};

export type UploadCustomerLibraryResult = {
  brandAssetId: string;
  originalFilename: string;
  width: number;
  height: number;
  preferredLaunchAssetId: string;
  assets: UploadedLibraryAsset[];
  cropsGenerated: number;
  cropsSkipped: number;
};

export class MediaLibraryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "MediaLibraryError";
    this.code = code;
    this.status = status;
  }
}

function asImageMime(
  value: string | null | undefined,
): "image/png" | "image/jpeg" | null {
  if (value === "image/png" || value === "image/jpeg") return value;
  if (value === "image/jpg") return "image/jpeg";
  return null;
}

export async function uploadCustomerLibraryImage(input: {
  userId: string;
  platformAccountId: string;
  brandProfileId?: string | null;
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
  /** When true, also store Meta cover-crops for formats the original lacks. */
  generateMetaCrops?: boolean;
  /**
   * Dedicated format slot upload: validate against this Meta format and
   * do not auto-crop other sizes (caller supplies formats separately).
   */
  metaFormatKey?: MetaFormatKey | null;
}): Promise<UploadCustomerLibraryResult> {
  const declared = asImageMime(input.mimeType);
  if (!declared) {
    throw new MediaLibraryError(
      "unsupported_type",
      400,
      "Nur PNG oder JPEG sind erlaubt.",
    );
  }

  let inspected;
  try {
    inspected = inspectCreativeImage({
      bytes: input.bytes,
      declaredMimeType: declared,
    });
  } catch (error) {
    if (error instanceof CreativeAssetProviderError) {
      throw new MediaLibraryError(error.code, 400, error.message);
    }
    throw new MediaLibraryError(
      "inspect_failed",
      400,
      "Bild konnte nicht geprüft werden.",
    );
  }

  const metaFormatKey =
    typeof input.metaFormatKey === "string" &&
    isMetaFormatKey(input.metaFormatKey)
      ? input.metaFormatKey
      : null;

  if (metaFormatKey) {
    const slot = getMetaFormatSlot(metaFormatKey);
    const check = describeMetaFormatCheck(
      inspected.width,
      inspected.height,
      slot,
    );
    if (!check.ok) {
      throw new MediaLibraryError("format_mismatch", 400, check.message);
    }
  }

  const bucket = getCreativeAssetStorageBucket();
  const stored = await storeCustomerLibraryAsset({
    userId: input.userId,
    platformAccountId: input.platformAccountId,
    bytes: inspected.bytes,
    sha256: inspected.sha256,
    mimeType: inspected.mimeType,
    bucket,
  });

  const brandProfileId =
    typeof input.brandProfileId === "string" &&
    /^[0-9a-f-]{36}$/i.test(input.brandProfileId.trim())
      ? input.brandProfileId.trim()
      : null;

  const originalFilename = input.fileName.slice(0, 255) || "upload.jpg";
  const formatSlot = metaFormatKey ? getMetaFormatSlot(metaFormatKey) : null;
  const role = formatSlot?.key ?? "original";
  const label = formatSlot?.label ?? "Original";

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("register_uploaded_brand_asset", {
    p_user_id: input.userId,
    p_platform_account_id: input.platformAccountId,
    p_brand_profile_id: brandProfileId,
    p_storage_bucket: stored.bucket,
    p_storage_path: stored.path,
    p_original_filename: originalFilename,
    p_sha256: inspected.sha256,
    p_mime_type: inspected.mimeType,
    p_byte_size: inspected.byteSize,
    p_width: inspected.width,
    p_height: inspected.height,
    p_metadata: {
      contract_version: 1,
      library: "customer",
      source_kind: formatSlot
        ? "customer_upload_format"
        : "customer_upload",
      role,
      brand_profile_optional: true,
      ...(formatSlot
        ? {
            meta_format_key: formatSlot.key,
            recommended_width: formatSlot.width,
            recommended_height: formatSlot.height,
          }
        : {}),
    },
  });

  if (error || typeof data !== "string") {
    throw new MediaLibraryError(
      "register_failed",
      409,
      error?.message || "Upload konnte nicht registriert werden.",
    );
  }

  const originalId = data;
  const assets: UploadedLibraryAsset[] = [
    {
      brandAssetId: originalId,
      originalFilename,
      width: inspected.width,
      height: inspected.height,
      role,
      label,
    },
  ];
  let preferredLaunchAssetId = originalId;
  if (
    !formatSlot &&
    matchesMetaFormat(inspected.width, inspected.height, {
      width: 1080,
      height: 1080,
    })
  ) {
    preferredLaunchAssetId = originalId;
  }

  let cropsGenerated = 0;
  let cropsSkipped = 0;

  // Format-slot uploads: no auto-crops (user supplies the three formats).
  // Free upload: crops only for formats the original does not already match.
  if (input.generateMetaCrops && !formatSlot) {
    try {
      const { generateMetaCropsFromOriginal, META_CROP_PRESETS } = await import(
        "@/lib/media-library/meta-crops"
      );
      const crops = await generateMetaCropsFromOriginal({
        bytes: inspected.bytes,
        mimeType: inspected.mimeType,
        originalWidth: inspected.width,
        originalHeight: inspected.height,
      });
      cropsGenerated = crops.length;
      cropsSkipped = Math.max(0, META_CROP_PRESETS.length - crops.length);

      for (const crop of crops) {
        try {
          const cropStored = await storeCustomerLibraryAsset({
            userId: input.userId,
            platformAccountId: input.platformAccountId,
            bytes: crop.bytes,
            sha256: crop.sha256,
            mimeType: crop.mimeType,
            bucket,
          });
          const base =
            originalFilename.replace(/\.[^.]+$/, "").slice(0, 180) || "creative";
          const cropName = `${base}__${crop.width}x${crop.height}.${
            crop.mimeType === "image/png" ? "png" : "jpg"
          }`;
          const { data: cropId, error: cropError } = await admin.rpc(
            "register_uploaded_brand_asset",
            {
              p_user_id: input.userId,
              p_platform_account_id: input.platformAccountId,
              p_brand_profile_id: brandProfileId,
              p_storage_bucket: cropStored.bucket,
              p_storage_path: cropStored.path,
              p_original_filename: cropName,
              p_sha256: crop.sha256,
              p_mime_type: crop.mimeType,
              p_byte_size: crop.byteSize,
              p_width: crop.width,
              p_height: crop.height,
              p_metadata: {
                contract_version: 1,
                library: "customer",
                source_kind: "meta_crop",
                role: crop.key,
                parent_asset_id: originalId,
                brand_profile_optional: true,
              },
            },
          );
          if (cropError || typeof cropId !== "string") {
            continue;
          }
          assets.push({
            brandAssetId: cropId,
            originalFilename: cropName,
            width: crop.width,
            height: crop.height,
            role: crop.key,
            label: crop.label,
          });
          if (crop.preferredForLaunch) {
            preferredLaunchAssetId = cropId;
          }
        } catch {
          // Individual crop registration is best-effort.
        }
      }
    } catch (cropError) {
      console.error("[media-library] meta crop generation skipped", cropError);
    }
  }

  return {
    brandAssetId: originalId,
    originalFilename,
    width: inspected.width,
    height: inspected.height,
    preferredLaunchAssetId,
    assets,
    cropsGenerated,
    cropsSkipped,
  };
}

export async function uploadInspirationVaultImage(input: {
  uploaderUserId: string;
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
  note?: string;
}): Promise<{ brandAssetId: string }> {
  const declared = asImageMime(input.mimeType);
  if (!declared) {
    throw new MediaLibraryError(
      "unsupported_type",
      400,
      "Nur PNG oder JPEG sind erlaubt.",
    );
  }

  let inspected;
  try {
    inspected = inspectCreativeImage({
      bytes: input.bytes,
      declaredMimeType: declared,
    });
  } catch (error) {
    if (error instanceof CreativeAssetProviderError) {
      throw new MediaLibraryError(error.code, 400, error.message);
    }
    throw new MediaLibraryError(
      "inspect_failed",
      400,
      "Bild konnte nicht geprüft werden.",
    );
  }

  const bucket = getCreativeAssetStorageBucket();
  const stored = await storeInspirationVaultAsset({
    uploaderUserId: input.uploaderUserId,
    bytes: inspected.bytes,
    sha256: inspected.sha256,
    mimeType: inspected.mimeType,
    bucket,
  });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("register_inspiration_vault_asset", {
    p_uploader_user_id: input.uploaderUserId,
    p_storage_bucket: stored.bucket,
    p_storage_path: stored.path,
    p_original_filename: input.fileName.slice(0, 255) || "inspiration.jpg",
    p_sha256: inspected.sha256,
    p_mime_type: inspected.mimeType,
    p_byte_size: inspected.byteSize,
    p_width: inspected.width,
    p_height: inspected.height,
    p_metadata: {
      contract_version: 1,
      library: "inspiration_vault",
      source_kind: "platform_inspiration",
      never_launch: true,
      note: (input.note ?? "").slice(0, 500),
    },
  });

  if (error || typeof data !== "string") {
    throw new MediaLibraryError(
      "register_failed",
      409,
      error?.message || "Inspiration konnte nicht registriert werden.",
    );
  }

  return { brandAssetId: data };
}
