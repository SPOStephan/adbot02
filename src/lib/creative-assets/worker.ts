import "server-only";

import { HttpCreativeAssetProvider } from "./http-provider";
import {
  inspectCreativeImage,
  safeCreativeFileName,
  sanitizeAssetMetadata,
} from "./image";
import {
  CreativeAssetProviderError,
  type CreativeAssetJob,
  type CreativeAssetProvider,
  type CreativeProviderFailureMode,
} from "./types";
import { getCreativeAssetRuntimeConfig } from "./env";
import { createAdminClient } from "../supabase/admin";

const CREATIVE_ASSET_LEASE_SECONDS = 180;
const DEFAULT_BACKOFF_SECONDS = 5 * 60;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;

export const CREATIVE_ASSET_STORAGE_CACHE_CONTROL = "31536000";

export type CreativeAssetWorkerResult = {
  outcome: "idle" | "completed" | "failed";
  jobId: string | null;
  status:
    | "IDLE"
    | "SUCCEEDED"
    | "RETRYABLE"
    | "FAILED"
    | "AMBIGUOUS";
  assetId: string | null;
};

export type StoredCreativeAsset = {
  bucket: string;
  path: string;
};

export type CreativeAssetCompletion = {
  job: CreativeAssetJob;
  providerRequestId: string | null;
  providerAssetId: string;
  storage: StoredCreativeAsset;
  fileName: string;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
  moderationStatus: "PENDING" | "APPROVED" | "REJECTED";
  metadata: Record<string, unknown>;
};

export type CreativeAssetFailure = {
  job: CreativeAssetJob;
  failureMode: CreativeProviderFailureMode;
  errorClass: string;
  safeMessage: string;
  safeToRetry: boolean;
  backoffSeconds: number;
  providerRequestId: string | null;
};

export type CreativeAssetWorkerDependencies = {
  providers: ReadonlyMap<string, CreativeAssetProvider>;
  claim(ownerId: string, leaseSeconds: number): Promise<CreativeAssetJob | null>;
  markDispatched(job: CreativeAssetJob): Promise<void>;
  store(input: {
    job: CreativeAssetJob;
    bytes: Uint8Array;
    sha256: string;
    mimeType: "image/png" | "image/jpeg";
  }): Promise<StoredCreativeAsset>;
  complete(input: CreativeAssetCompletion): Promise<string>;
  fail(input: CreativeAssetFailure): Promise<"RETRYABLE" | "FAILED" | "AMBIGUOUS">;
};

type CreativeAssetJobRow = {
  job_id: string;
  user_id: string;
  platform_account_id: string;
  brand_profile_id: string;
  provider_key: string;
  provider_model: string;
  provider_version: string | null;
  idempotency_key: string;
  input_payload: Record<string, unknown>;
  input_hash: string;
  attempt_count: number;
  lease_token: string;
};

function asJob(row: CreativeAssetJobRow): CreativeAssetJob {
  return {
    jobId: row.job_id,
    userId: row.user_id,
    platformAccountId: row.platform_account_id,
    brandProfileId: row.brand_profile_id,
    providerKey: row.provider_key,
    providerModel: row.provider_model,
    providerVersion: row.provider_version,
    idempotencyKey: row.idempotency_key,
    inputPayload: row.input_payload,
    inputHash: row.input_hash,
    attemptCount: row.attempt_count,
    leaseToken: row.lease_token,
  };
}

function calculateBackoff(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(6, attemptCount - 1));
  return Math.min(MAX_BACKOFF_SECONDS, DEFAULT_BACKOFF_SECONDS * 2 ** exponent);
}

function safeFailure(error: unknown, job: CreativeAssetJob): CreativeAssetFailure {
  if (error instanceof CreativeAssetProviderError) {
    return {
      job,
      failureMode: error.failureMode,
      errorClass: error.code,
      safeMessage: error.message,
      safeToRetry: error.safeToRetry,
      backoffSeconds:
        error.retryAfterSeconds ?? calculateBackoff(job.attemptCount),
      providerRequestId: error.providerRequestId,
    };
  }

  return {
    job,
    failureMode: "POST_PROCESSING",
    errorClass: "asset_post_processing_failed",
    safeMessage: "Assetverarbeitung konnte nicht sicher abgeschlossen werden.",
    safeToRetry: true,
    backoffSeconds: calculateBackoff(job.attemptCount),
    providerRequestId: null,
  };
}

export async function runCreativeAssetWorkerOnce(input: {
  ownerId: string;
  dependencies: CreativeAssetWorkerDependencies;
  signal?: AbortSignal;
}): Promise<CreativeAssetWorkerResult> {
  const ownerId = input.ownerId.trim();
  if (!ownerId || ownerId.length > 160) {
    throw new Error("Creative asset worker owner ID is invalid");
  }

  const job = await input.dependencies.claim(
    ownerId,
    CREATIVE_ASSET_LEASE_SECONDS,
  );
  if (!job) {
    return { outcome: "idle", jobId: null, status: "IDLE", assetId: null };
  }

  const provider = input.dependencies.providers.get(job.providerKey);
  if (!provider) {
    const status = await input.dependencies.fail({
      job,
      failureMode: "PRE_DISPATCH",
      errorClass: "provider_not_configured",
      safeMessage: "Der für diesen Assetjob gewählte Provider ist nicht konfiguriert.",
      safeToRetry: false,
      backoffSeconds: calculateBackoff(job.attemptCount),
      providerRequestId: null,
    });
    return { outcome: "failed", jobId: job.jobId, status, assetId: null };
  }
  if (!provider.guaranteesIdempotency) {
    const status = await input.dependencies.fail({
      job,
      failureMode: "PRE_DISPATCH",
      errorClass: "provider_not_idempotent",
      safeMessage: "Creative-Provider garantiert keine idempotente Verarbeitung.",
      safeToRetry: false,
      backoffSeconds: calculateBackoff(job.attemptCount),
      providerRequestId: null,
    });
    return { outcome: "failed", jobId: job.jobId, status, assetId: null };
  }

  const signal = input.signal ?? AbortSignal.timeout(150_000);
  try {
    await input.dependencies.markDispatched(job);
    const result = await provider.generate({ job, signal });
    const bytes = await provider.materialize(result, signal);
    const image = inspectCreativeImage({
      bytes,
      declaredMimeType: result.declaredMimeType,
    });
    const fileName = safeCreativeFileName({
      requestedName: result.fileName,
      jobId: job.jobId,
      mimeType: image.mimeType,
    });
    const metadata = sanitizeAssetMetadata({
      ...result.metadata,
      provider_contract_version: provider.contractVersion,
      input_hash: job.inputHash,
    });
    const storage = await input.dependencies.store({
      job,
      bytes: image.bytes,
      sha256: image.sha256,
      mimeType: image.mimeType,
    });
    const assetId = await input.dependencies.complete({
      job,
      providerRequestId: result.providerRequestId,
      providerAssetId: result.providerAssetId,
      storage,
      fileName,
      sha256: image.sha256,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      width: image.width,
      height: image.height,
      moderationStatus: result.moderationStatus,
      metadata,
    });

    return {
      outcome: "completed",
      jobId: job.jobId,
      status: "SUCCEEDED",
      assetId,
    };
  } catch (error) {
    const failure = safeFailure(error, job);
    const status = await input.dependencies.fail(failure);
    return { outcome: "failed", jobId: job.jobId, status, assetId: null };
  }
}

async function claimFromSupabase(
  ownerId: string,
  leaseSeconds: number,
): Promise<CreativeAssetJob | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_creative_asset_job", {
    p_owner_id: ownerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) {
    throw new Error("Creative asset job claim failed");
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? asJob(row as CreativeAssetJobRow) : null;
}

async function markDispatchedInSupabase(job: CreativeAssetJob): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "mark_creative_asset_job_dispatched",
    { p_job_id: job.jobId, p_lease_token: job.leaseToken },
  );
  if (error || data !== true) {
    throw new CreativeAssetProviderError({
      code: "dispatch_gate_failed",
      message: "Providerdispatch konnte nicht atomar beansprucht werden.",
      failureMode: "PRE_DISPATCH",
    });
  }
}

async function ensurePrivateBucket(bucket: string): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.getBucket(bucket);
  if (!error && data) {
    if (data.public) {
      throw new Error("Creative asset storage bucket must be private");
    }
    return;
  }

  const { error: createError } = await admin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg"],
  });
  if (createError && !/already exists|duplicate/i.test(createError.message)) {
    throw new Error("Creative asset storage bucket provisioning failed");
  }
}

async function storeInSupabase(input: {
  job: CreativeAssetJob;
  bytes: Uint8Array;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  bucket: string;
}): Promise<StoredCreativeAsset> {
  await ensurePrivateBucket(input.bucket);
  const extension = input.mimeType === "image/png" ? "png" : "jpg";
  const path = [
    input.job.userId,
    input.job.platformAccountId,
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

async function completeInSupabase(
  input: CreativeAssetCompletion,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("complete_creative_asset_job", {
    p_job_id: input.job.jobId,
    p_lease_token: input.job.leaseToken,
    p_provider_request_id: input.providerRequestId,
    p_provider_asset_id: input.providerAssetId,
    p_storage_bucket: input.storage.bucket,
    p_storage_path: input.storage.path,
    p_original_filename: input.fileName,
    p_sha256: input.sha256,
    p_mime_type: input.mimeType,
    p_byte_size: input.byteSize,
    p_width: input.width,
    p_height: input.height,
    p_moderation_status: input.moderationStatus,
    p_metadata: input.metadata,
  });
  if (error || typeof data !== "string") {
    throw new Error("Creative asset job completion failed");
  }
  return data;
}

async function failInSupabase(
  input: CreativeAssetFailure,
): Promise<"RETRYABLE" | "FAILED" | "AMBIGUOUS"> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fail_creative_asset_job", {
    p_job_id: input.job.jobId,
    p_lease_token: input.job.leaseToken,
    p_failure_mode: input.failureMode,
    p_error_class: input.errorClass,
    p_safe_error_message: input.safeMessage,
    p_safe_to_retry: input.safeToRetry,
    p_backoff_seconds: input.backoffSeconds,
    p_provider_request_id: input.providerRequestId,
  });
  if (
    error ||
    (data !== "RETRYABLE" && data !== "FAILED" && data !== "AMBIGUOUS")
  ) {
    throw new Error("Creative asset job failure persistence failed");
  }
  return data;
}

export function createCreativeAssetWorkerDependencies(): CreativeAssetWorkerDependencies {
  const runtime = getCreativeAssetRuntimeConfig();
  const provider = new HttpCreativeAssetProvider(runtime.provider);

  return {
    providers: new Map([[provider.key, provider]]),
    claim: claimFromSupabase,
    markDispatched: markDispatchedInSupabase,
    store: (input) => storeInSupabase({ ...input, bucket: runtime.storageBucket }),
    complete: completeInSupabase,
    fail: failInSupabase,
  };
}

export async function processNextCreativeAssetJob(input: {
  ownerId: string;
  signal?: AbortSignal;
}): Promise<CreativeAssetWorkerResult> {
  return runCreativeAssetWorkerOnce({
    ...input,
    dependencies: createCreativeAssetWorkerDependencies(),
  });
}
