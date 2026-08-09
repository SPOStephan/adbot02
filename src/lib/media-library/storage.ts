import "server-only";

import {
  CREATIVE_ASSET_STORAGE_CACHE_CONTROL,
  ensurePrivateCreativeAssetBucket,
  storeCreativeAssetInSupabase,
} from "@/lib/creative-assets/storage";
import { createAdminClient } from "@/lib/supabase/admin";

export async function storeCustomerLibraryAsset(input: {
  userId: string;
  platformAccountId: string;
  bytes: Uint8Array;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  bucket: string;
}) {
  return storeCreativeAssetInSupabase(input);
}

export async function storeInspirationVaultAsset(input: {
  uploaderUserId: string;
  bytes: Uint8Array;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  bucket: string;
}) {
  if (
    !/^[0-9a-f-]{36}$/i.test(input.uploaderUserId) ||
    !/^[0-9a-f]{64}$/.test(input.sha256) ||
    input.bytes.byteLength <= 0 ||
    input.bytes.byteLength > 10 * 1024 * 1024
  ) {
    throw new Error("Inspiration vault storage input is invalid");
  }

  await ensurePrivateCreativeAssetBucket(input.bucket);

  const extension = input.mimeType === "image/png" ? "png" : "jpg";
  const path = [
    "inspiration",
    input.uploaderUserId,
    input.sha256.slice(0, 2),
    `${input.sha256}.${extension}`,
  ].join("/");

  const admin = createAdminClient();
  const { error } = await admin.storage.from(input.bucket).upload(
    path,
    input.bytes,
    {
      contentType: input.mimeType,
      cacheControl: CREATIVE_ASSET_STORAGE_CACHE_CONTROL,
      upsert: true,
    },
  );
  if (error) {
    throw new Error("Inspiration vault storage upload failed");
  }
  return { bucket: input.bucket, path };
}
