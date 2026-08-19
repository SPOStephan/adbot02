import "server-only";

import {
  inspectCreativeImage,
  safeCreativeFileName,
  sanitizeAssetMetadata,
} from "./image";
import {
  assertCreativeAssetJobInputForProvider,
  inputHasGenerationContract,
  mapCreativeGenerationInputForExecution,
  toCreativeAssetProviderError,
} from "./map-generation-input";
import { composeLockedPhotoCreative } from "./locked-photo-compose";
import { loadVerifiedLockedPhotoAssets } from "./locked-photo-load";
import {
  CreativeAssetProviderError,
  type CreativeAssetJob,
  type CreativeAssetProvider,
  type CreativeProviderFailureMode,
} from "./types";
import { getCreativeAssetRuntimeConfig } from "./env";
import { createCreativeAssetProviders } from "./providers";
import {
  commitCreditReservation,
  releaseCreditReservation,
} from "../billing/credits";
import { createAdminClient } from "../supabase/admin";
import {
  storeCreativeAssetInSupabase,
  type StoredCreativeAsset,
} from "./storage";

const CREATIVE_ASSET_LEASE_SECONDS = 180;
const DEFAULT_BACKOFF_SECONDS = 5 * 60;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;

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
  credit_reservation_id: string | null;
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
    creditReservationId:
      typeof row.credit_reservation_id === "string"
        ? row.credit_reservation_id
        : null,
  };
}

async function settleCreativeJobCredits(input: {
  job: CreativeAssetJob;
  outcome: "commit" | "release";
}): Promise<void> {
  const reservationId = input.job.creditReservationId;
  if (!reservationId) {
    return;
  }
  try {
    if (input.outcome === "commit") {
      await commitCreditReservation({
        userId: input.job.userId,
        reservationId,
      });
    } else {
      await releaseCreditReservation({
        userId: input.job.userId,
        reservationId,
      });
    }
  } catch (error) {
    console.error("creative_asset_credit_settle_failed", {
      jobId: input.job.jobId,
      reservationId,
      outcome: input.outcome,
      message: error instanceof Error ? error.message : "settle_failed",
    });
  }
}

function calculateBackoff(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(6, attemptCount - 1));
  return Math.min(MAX_BACKOFF_SECONDS, DEFAULT_BACKOFF_SECONDS * 2 ** exponent);
}

function safeFailure(error: unknown, job: CreativeAssetJob): CreativeAssetFailure {
  const providerError = toCreativeAssetProviderError(error);
  return {
    job,
    failureMode: providerError.failureMode,
    errorClass: providerError.code,
    safeMessage: providerError.message,
    safeToRetry: providerError.safeToRetry,
    backoffSeconds:
      providerError.retryAfterSeconds ?? calculateBackoff(job.attemptCount),
    providerRequestId: providerError.providerRequestId,
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
    if (status === "FAILED" || status === "AMBIGUOUS") {
      await settleCreativeJobCredits({ job, outcome: "release" });
    }
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
    if (status === "FAILED" || status === "AMBIGUOUS") {
      await settleCreativeJobCredits({ job, outcome: "release" });
    }
    return { outcome: "failed", jobId: job.jobId, status, assetId: null };
  }

  const signal = input.signal ?? AbortSignal.timeout(150_000);
  try {
    assertCreativeAssetJobInputForProvider(job);
    await input.dependencies.markDispatched(job);
    const result = await provider.generate({ job, signal });
    const bytes = await provider.materialize(result, signal);
    let image = inspectCreativeImage({
      bytes,
      declaredMimeType: result.declaredMimeType,
    });
    let metadata: Record<string, unknown> = {
      ...result.metadata,
      provider_contract_version: provider.contractVersion,
      input_hash: job.inputHash,
    };

    // Phase 3: locked_photo → AI background + 1:1 embed + pixel guard (PNG).
    // Phase 6: attach billing audit fields when contract is present.
    if (inputHasGenerationContract(job.inputPayload)) {
      const generation = mapCreativeGenerationInputForExecution(job);
      if (generation.mode === "locked_photo") {
        const locked = await loadVerifiedLockedPhotoAssets({
          userId: job.userId,
          platformAccountId: job.platformAccountId,
          assetIds: generation.locked_photo_asset_ids,
        });
        const composed = await composeLockedPhotoCreative({
          backgroundBytes: image.bytes,
          locked,
          aspectHint: generation.output.aspect_hint,
        });
        image = inspectCreativeImage({
          bytes: composed.bytes,
          declaredMimeType: "image/png",
        });
        metadata = {
          ...metadata,
          locked_photo_compose: {
            version: composed.composeVersion,
            placements: composed.placements,
          },
        };
      }
      metadata = {
        ...metadata,
        billing: {
          action_key: "creative.generate_image_master",
          credit_reservation_id: job.creditReservationId,
          mode: generation.mode,
          model_id: generation.model_id,
          provider_key: generation.provider_key,
          reference_asset_ids: generation.reference_asset_ids,
          locked_photo_asset_ids: generation.locked_photo_asset_ids,
        },
      };
    }

    const fileName = safeCreativeFileName({
      requestedName: result.fileName,
      jobId: job.jobId,
      mimeType: image.mimeType,
    });
    const sanitizedMetadata = sanitizeAssetMetadata(metadata);
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
      metadata: sanitizedMetadata,
    });

    await settleCreativeJobCredits({ job, outcome: "commit" });

    return {
      outcome: "completed",
      jobId: job.jobId,
      status: "SUCCEEDED",
      assetId,
    };
  } catch (error) {
    const failure = safeFailure(error, job);
    const status = await input.dependencies.fail(failure);
    if (status === "FAILED" || status === "AMBIGUOUS") {
      await settleCreativeJobCredits({ job, outcome: "release" });
    }
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
  const providers = createCreativeAssetProviders(runtime);

  return {
    providers,
    claim: claimFromSupabase,
    markDispatched: markDispatchedInSupabase,
    store: (input) =>
      storeCreativeAssetInSupabase({
        userId: input.job.userId,
        platformAccountId: input.job.platformAccountId,
        bytes: input.bytes,
        sha256: input.sha256,
        mimeType: input.mimeType,
        bucket: runtime.storageBucket,
      }),
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
