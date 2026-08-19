import "server-only";

import { generateMetaCropsFromOriginal } from "@/lib/media-library/meta-crops";
import {
  META_FORMAT_SLOTS,
  formatLabelForDimensions,
  presetsNeedingCrop,
} from "@/lib/media-library/meta-formats";
import { createAdminClient } from "@/lib/supabase/admin";
import { storeCreativeAssetInSupabase } from "./storage";
import type { CreativeAssetJob } from "./types";

export type GeneratedFormatSlotResult = {
  cropsGenerated: number;
  cropsSkipped: number;
  cropAssetIds: string[];
  masterFormatLabel: string | null;
  cropsPlanned: string[];
};

/**
 * Phase 7: after a GENERATED master is completed, create Meta format-slot
 * cover crops for formats the master does not already match.
 * Best-effort: individual crop failures never throw.
 */
export async function registerGeneratedMetaFormatSlots(input: {
  job: CreativeAssetJob;
  parentAssetId: string;
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  fileName: string;
  bucket: string;
  providerAssetId: string;
}): Promise<GeneratedFormatSlotResult> {
  const cropsPlanned = presetsNeedingCrop(input.width, input.height);
  const masterFormatLabel = formatLabelForDimensions(
    input.width,
    input.height,
  );
  const result: GeneratedFormatSlotResult = {
    cropsGenerated: 0,
    cropsSkipped: Math.max(0, META_FORMAT_SLOTS.length - cropsPlanned.length),
    cropAssetIds: [],
    masterFormatLabel,
    cropsPlanned: [...cropsPlanned],
  };

  if (cropsPlanned.length === 0) {
    return result;
  }

  let crops;
  try {
    crops = await generateMetaCropsFromOriginal({
      bytes: input.bytes,
      mimeType: input.mimeType,
      originalWidth: input.width,
      originalHeight: input.height,
      onlyKeys: cropsPlanned,
    });
  } catch (error) {
    console.error(
      "[creative-assets] meta format crop generation skipped",
      error,
    );
    return result;
  }

  const admin = createAdminClient();
  const base =
    input.fileName.replace(/\.[^.]+$/, "").slice(0, 120) || "generated";

  for (const crop of crops) {
    try {
      const stored = await storeCreativeAssetInSupabase({
        userId: input.job.userId,
        platformAccountId: input.job.platformAccountId,
        bytes: crop.bytes,
        sha256: crop.sha256,
        mimeType: crop.mimeType,
        bucket: input.bucket,
      });
      const cropName = `${base}__${crop.width}x${crop.height}.${
        crop.mimeType === "image/png" ? "png" : "jpg"
      }`.slice(0, 160);
      const providerAssetId =
        `${input.providerAssetId}:${crop.key}`.slice(0, 255);

      const { data: cropId, error } = await admin.rpc(
        "register_generated_meta_crop_asset",
        {
          p_user_id: input.job.userId,
          p_platform_account_id: input.job.platformAccountId,
          p_parent_asset_id: input.parentAssetId,
          p_storage_bucket: stored.bucket,
          p_storage_path: stored.path,
          p_original_filename: cropName,
          p_sha256: crop.sha256,
          p_mime_type: crop.mimeType,
          p_byte_size: crop.byteSize,
          p_width: crop.width,
          p_height: crop.height,
          p_meta_format_key: crop.key,
          p_provider_asset_id: providerAssetId,
          p_metadata: {
            contract_version: 1,
            preferred_for_launch: crop.preferredForLaunch,
          },
        },
      );

      if (error || typeof cropId !== "string") {
        console.error(
          "[creative-assets] meta format crop register failed",
          crop.key,
          error?.message,
        );
        continue;
      }

      result.cropsGenerated += 1;
      result.cropAssetIds.push(cropId);
    } catch (cropError) {
      console.error(
        "[creative-assets] meta format crop skipped",
        crop.key,
        cropError,
      );
    }
  }

  return result;
}

export function formatSlotsMetadataSummary(
  result: GeneratedFormatSlotResult,
): Record<string, unknown> {
  return {
    version: 1,
    master_format_label: result.masterFormatLabel,
    crops_planned: result.cropsPlanned,
    crops_generated: result.cropsGenerated,
    crops_skipped: result.cropsSkipped,
    crop_asset_ids: result.cropAssetIds,
  };
}
