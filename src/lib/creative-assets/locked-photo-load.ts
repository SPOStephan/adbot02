import "server-only";

import { inspectCreativeImage } from "./image";
import {
  CreativeAssetProviderError,
  type CreativeImageMimeType,
} from "./types";
import { createAdminClient } from "../supabase/admin";

export type LockedPhotoAsset = {
  assetId: string;
  bytes: Uint8Array;
  sha256: string;
  mimeType: CreativeImageMimeType;
  width: number;
  height: number;
  byteSize: number;
};

/**
 * Load customer LOCKED_PHOTO assets for compose.
 * Fail-closed: READY + APPROVED + CUSTOMER + asset_role=LOCKED_PHOTO + byte re-hash.
 */
export async function loadVerifiedLockedPhotoAssets(input: {
  userId: string;
  platformAccountId: string;
  assetIds: readonly string[];
}): Promise<LockedPhotoAsset[]> {
  if (input.assetIds.length < 1) {
    throw new CreativeAssetProviderError({
      code: "locked_photo_required",
      message: "locked_photo mode requires at least one locked photo asset.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  const uniqueIds = [...new Set(input.assetIds.map((id) => id.toLowerCase()))];
  if (uniqueIds.length !== input.assetIds.length) {
    throw new CreativeAssetProviderError({
      code: "locked_photo_duplicate",
      message: "locked_photo_asset_ids dürfen keine Duplikate enthalten.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("brand_assets")
    .select(
      "id,sha256,mime_type,byte_size,width,height,storage_bucket,storage_path,status,moderation_status,library_scope,asset_role",
    )
    .eq("user_id", input.userId)
    .eq("platform_account_id", input.platformAccountId)
    .eq("library_scope", "CUSTOMER")
    .eq("asset_role", "LOCKED_PHOTO")
    .eq("status", "READY")
    .eq("moderation_status", "APPROVED")
    .in("id", uniqueIds);

  if (error) {
    throw new CreativeAssetProviderError({
      code: "locked_photo_lookup_failed",
      message: "Locked-Photo-Assets konnten nicht geladen werden.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: true,
    });
  }

  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== uniqueIds.length) {
    throw new CreativeAssetProviderError({
      code: "locked_photo_not_found",
      message:
        "Mindestens ein Locked-Photo fehlt, ist nicht READY/APPROVED oder hat nicht asset_role=LOCKED_PHOTO.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  const byId = new Map(
    rows.map((row) => [(row as { id: string }).id.toLowerCase(), row]),
  );
  const loaded: LockedPhotoAsset[] = [];

  for (const assetId of uniqueIds) {
    const row = byId.get(assetId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new CreativeAssetProviderError({
        code: "locked_photo_not_found",
        message: "Locked-Photo-Asset wurde nicht gefunden.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: false,
      });
    }

    const sha256 = String(row.sha256 ?? "");
    const mimeType = String(row.mime_type ?? "") as CreativeImageMimeType;
    const bucket = String(row.storage_bucket ?? "");
    const path = String(row.storage_path ?? "");
    if (
      !/^[0-9a-f]{64}$/.test(sha256) ||
      (mimeType !== "image/png" && mimeType !== "image/jpeg") ||
      !bucket ||
      !path
    ) {
      throw new CreativeAssetProviderError({
        code: "locked_photo_invalid",
        message: "Locked-Photo-Metadaten sind ungültig.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: false,
      });
    }

    const downloaded = await admin.storage.from(bucket).download(path);
    if (downloaded.error || !downloaded.data) {
      throw new CreativeAssetProviderError({
        code: "locked_photo_download_failed",
        message: "Locked-Photo-Bytes konnten nicht geladen werden.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: true,
      });
    }

    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const inspected = inspectCreativeImage({
      bytes,
      declaredMimeType: mimeType,
    });
    if (
      inspected.sha256 !== sha256 ||
      inspected.byteSize !== Number(row.byte_size) ||
      inspected.width !== Number(row.width) ||
      inspected.height !== Number(row.height)
    ) {
      throw new CreativeAssetProviderError({
        code: "locked_photo_integrity_failed",
        message: "Locked-Photo-Integrität (Hash/Maße) stimmt nicht.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: false,
      });
    }

    loaded.push({
      assetId,
      bytes: inspected.bytes,
      sha256: inspected.sha256,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
      byteSize: inspected.byteSize,
    });
  }

  return loaded;
}
