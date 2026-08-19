export const CREATIVE_ASSET_PROVIDER_CONTRACT_VERSION = "2026-07-29";

export const SUPPORTED_CREATIVE_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
] as const;

export type CreativeImageMimeType =
  (typeof SUPPORTED_CREATIVE_IMAGE_MIME_TYPES)[number];

export type CreativeAssetJob = {
  jobId: string;
  userId: string;
  platformAccountId: string;
  brandProfileId: string;
  providerKey: string;
  providerModel: string;
  providerVersion: string | null;
  idempotencyKey: string;
  inputPayload: Record<string, unknown>;
  inputHash: string;
  attemptCount: number;
  leaseToken: string;
  /** Phase 6: pending credit reservation to commit/release. */
  creditReservationId: string | null;
};

export type CreativeAssetModerationStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

export type CreativeAssetBinarySource = {
  kind: "bytes";
  bytes: Uint8Array;
};

export type CreativeAssetUrlSource = {
  kind: "url";
  url: string;
};

export type CreativeAssetSource =
  | CreativeAssetBinarySource
  | CreativeAssetUrlSource;

export type CreativeAssetProviderResult = {
  providerRequestId: string | null;
  providerAssetId: string;
  fileName: string | null;
  declaredMimeType: CreativeImageMimeType;
  source: CreativeAssetSource;
  moderationStatus: CreativeAssetModerationStatus;
  metadata: Record<string, unknown>;
};

export type CreativeAssetProviderRequest = {
  job: CreativeAssetJob;
  signal: AbortSignal;
};

export interface CreativeAssetProvider {
  readonly key: string;
  readonly contractVersion: string;
  readonly guaranteesIdempotency: true;
  generate(
    request: CreativeAssetProviderRequest,
  ): Promise<CreativeAssetProviderResult>;
  materialize(
    result: CreativeAssetProviderResult,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}

export type CreativeProviderFailureMode =
  | "PRE_DISPATCH"
  | "REMOTE_REJECTED"
  | "AMBIGUOUS_TRANSPORT"
  | "POST_PROCESSING"
  | "POLICY_REJECTED";

export class CreativeAssetProviderError extends Error {
  readonly code: string;
  readonly failureMode: CreativeProviderFailureMode;
  readonly safeToRetry: boolean;
  readonly retryAfterSeconds: number | null;
  readonly providerRequestId: string | null;

  constructor(input: {
    code: string;
    message: string;
    failureMode: CreativeProviderFailureMode;
    safeToRetry?: boolean;
    retryAfterSeconds?: number | null;
    providerRequestId?: string | null;
  }) {
    super(input.message);
    this.name = "CreativeAssetProviderError";
    this.code = input.code;
    this.failureMode = input.failureMode;
    this.safeToRetry = input.safeToRetry ?? false;
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;
    this.providerRequestId = input.providerRequestId ?? null;
  }
}
