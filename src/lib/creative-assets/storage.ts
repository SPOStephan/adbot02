import "server-only";

import { createAdminClient } from "../supabase/admin";

export const CREATIVE_ASSET_STORAGE_CACHE_CONTROL = "31536000";

export type StoredCreativeAsset = {
  bucket: string;
  path: string;
};

const PRIVATE_BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: 10 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg"],
};

export async function ensurePrivateCreativeAssetBucket(bucket: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.getBucket(bucket);
  if (error && !/not found|404/i.test(error.message)) {
    throw new Error("Creative asset storage bucket lookup failed");
  }

  if (!data) {
    const { error: createError } = await admin.storage.createBucket(
      bucket,
      PRIVATE_BUCKET_OPTIONS,
    );
    if (createError && !/already exists|duplicate/i.test(createError.message)) {
      throw new Error("Creative asset storage bucket provisioning failed");
    }
  }

  const { error: updateError } = await admin.storage.updateBucket(
    bucket,
    PRIVATE_BUCKET_OPTIONS,
  );
  if (updateError) {
    throw new Error("Creative asset storage bucket hardening failed");
  }

  const { data: verified, error: verifyError } = await admin.storage.getBucket(bucket);
  if (verifyError || !verified || verified.public) {
    throw new Error("Creative asset storage bucket privacy verification failed");
  }
}

export async function storeCreativeAssetInSupabase(input: {
  userId: string;
  platformAccountId: string;
  bytes: Uint8Array;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  bucket: string;
}): Promise<StoredCreativeAsset> {
  if (
    !/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(input.bucket) ||
    !/^[0-9a-f]{64}$/.test(input.sha256) ||
    !/^[0-9a-f-]{36}$/i.test(input.userId) ||
    !/^[0-9a-f-]{36}$/i.test(input.platformAccountId) ||
    input.bytes.byteLength <= 0 ||
    input.bytes.byteLength > PRIVATE_BUCKET_OPTIONS.fileSizeLimit
  ) {
    throw new Error("Creative asset storage input is invalid");
  }

  await ensurePrivateCreativeAssetBucket(input.bucket);
  const extension = input.mimeType === "image/png" ? "png" : "jpg";
  const path = [
    input.userId,
    input.platformAccountId,
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
    throw new Error("Creative asset storage upload failed");
  }
  return { bucket: input.bucket, path };
}
