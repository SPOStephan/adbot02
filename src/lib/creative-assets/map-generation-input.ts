/**
 * Generation execution gates (Phase 2 free + Phase 3 locked_photo compose).
 * Maps job.inputPayload through the Phase 1 contract and rejects unsupported modes.
 */

import {
  assertCreativeGenerationInput,
  CreativeGenerationContractError,
  CREATIVE_GENERATION_CONTRACT_VERSION,
  type CreativeGenerationInput,
} from "./generation-contract";
import { PHASE3_MAX_LOCKED_PHOTOS } from "./locked-photo-constants";
import { PHASE5_MAX_STYLE_REFERENCES } from "./style-reference-constants";
import {
  CreativeAssetProviderError,
  type CreativeAssetJob,
} from "./types";

export class CreativeGenerationPhase2Error extends Error {
  readonly code: string;
  readonly failureMode:
    | "PRE_DISPATCH"
    | "POLICY_REJECTED"
    | "REMOTE_REJECTED";
  readonly safeToRetry: boolean;

  constructor(input: {
    code: string;
    message: string;
    failureMode?: "PRE_DISPATCH" | "POLICY_REJECTED" | "REMOTE_REJECTED";
    safeToRetry?: boolean;
  }) {
    super(input.message);
    this.name = "CreativeGenerationPhase2Error";
    this.code = input.code;
    this.failureMode = input.failureMode ?? "POLICY_REJECTED";
    this.safeToRetry = input.safeToRetry ?? false;
  }
}

/** Alias kept for Phase 3 callers / tests. */
export class CreativeGenerationExecutionError extends CreativeGenerationPhase2Error {
  constructor(input: {
    code: string;
    message: string;
    failureMode?: "PRE_DISPATCH" | "POLICY_REJECTED" | "REMOTE_REJECTED";
    safeToRetry?: boolean;
  }) {
    super(input);
    this.name = "CreativeGenerationExecutionError";
  }
}

export function inputHasGenerationContract(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).contract_version ===
      CREATIVE_GENERATION_CONTRACT_VERSION
  );
}

/**
 * Validate execution constraints on an already-asserted contract input.
 * Phase 5: free + locked_photo; style references ≤4; locked ≤1.
 */
export function assertExecutableGenerationInput(
  input: CreativeGenerationInput,
  job: Pick<CreativeAssetJob, "providerKey" | "providerModel">,
): CreativeGenerationInput {
  if (input.mode !== "free" && input.mode !== "locked_photo") {
    throw new CreativeGenerationExecutionError({
      code: "POLICY_REJECTED",
      message: "Unterstützte Modi: free und locked_photo.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  if (input.provider_key !== job.providerKey) {
    throw new CreativeGenerationExecutionError({
      code: "provider_key_mismatch",
      message: "provider_key im Input stimmt nicht mit dem Job-Provider überein.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  if (input.model_id !== job.providerModel) {
    throw new CreativeGenerationExecutionError({
      code: "model_id_mismatch",
      message: "model_id im Input stimmt nicht mit dem Job-Modell überein.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  if (input.reference_asset_ids.length > PHASE5_MAX_STYLE_REFERENCES) {
    throw new CreativeGenerationExecutionError({
      code: "style_reference_limit",
      message: `Höchstens ${PHASE5_MAX_STYLE_REFERENCES} Style-Referenzen pro Job.`,
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  if (input.mode === "free") {
    if (input.locked_photo_asset_ids.length > 0) {
      throw new CreativeGenerationExecutionError({
        code: "POLICY_REJECTED",
        message: "free-Mode darf keine locked_photo_asset_ids enthalten.",
        failureMode: "POLICY_REJECTED",
        safeToRetry: false,
      });
    }
    return input;
  }

  // locked_photo
  if (input.locked_photo_asset_ids.length < 1) {
    throw new CreativeGenerationExecutionError({
      code: "LOCKED_PHOTO_REQUIRED",
      message: "locked_photo mode requires at least one locked_photo_asset_ids entry.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  if (input.locked_photo_asset_ids.length > PHASE3_MAX_LOCKED_PHOTOS) {
    throw new CreativeGenerationExecutionError({
      code: "locked_photo_limit",
      message: `Phase 3 unterstützt höchstens ${PHASE3_MAX_LOCKED_PHOTOS} Locked Photo pro Job.`,
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  // Lossless compose requires PNG output so the pixel guard stays meaningful.
  if (input.output.mime_type !== "image/png") {
    throw new CreativeGenerationExecutionError({
      code: "locked_photo_png_required",
      message:
        "locked_photo Compose erfordert output.mime_type=image/png (Pixel-Guard).",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  return input;
}

/** @deprecated Use assertExecutableGenerationInput — kept for Phase 2 call sites/tests. */
export function assertPhase2ExecutableGenerationInput(
  input: CreativeGenerationInput,
  job: Pick<CreativeAssetJob, "providerKey" | "providerModel">,
): CreativeGenerationInput {
  return assertExecutableGenerationInput(input, job);
}

/**
 * Map a job payload for contract-aware execution (Phase 2/3).
 */
export function mapCreativeGenerationInputForExecution(
  job: CreativeAssetJob,
): CreativeGenerationInput {
  let asserted: CreativeGenerationInput;
  try {
    asserted = assertCreativeGenerationInput(job.inputPayload);
  } catch (error) {
    if (error instanceof CreativeGenerationContractError) {
      throw new CreativeGenerationExecutionError({
        code: error.code,
        message: error.message,
        failureMode: "POLICY_REJECTED",
        safeToRetry: false,
      });
    }
    throw error;
  }

  return assertExecutableGenerationInput(asserted, job);
}

/** @deprecated Use mapCreativeGenerationInputForExecution */
export function mapCreativeGenerationInputForPhase2Execution(
  job: CreativeAssetJob,
): CreativeGenerationInput {
  return mapCreativeGenerationInputForExecution(job);
}

/**
 * Worker pre-dispatch gate:
 * - Contract present → Phase 2/3 execution rules
 * - Legacy freeform → only for HTTP provider (backward compat)
 * - OpenRouter always requires the generation contract
 */
export function assertCreativeAssetJobInputForProvider(
  job: CreativeAssetJob,
): void {
  const hasContract = inputHasGenerationContract(job.inputPayload);

  if (job.providerKey === "openrouter") {
    if (!hasContract) {
      throw new CreativeAssetProviderError({
        code: "generation_contract_required",
        message:
          "OpenRouter-Jobs erfordern den Generation-Contract adbot-creative-generation-v1.",
        failureMode: "PRE_DISPATCH",
        safeToRetry: false,
      });
    }
    try {
      mapCreativeGenerationInputForExecution(job);
    } catch (error) {
      if (
        error instanceof CreativeGenerationPhase2Error ||
        error instanceof CreativeGenerationExecutionError
      ) {
        throw new CreativeAssetProviderError({
          code: sanitizeErrorClass(error.code),
          message: error.message,
          failureMode: "PRE_DISPATCH",
          safeToRetry: false,
        });
      }
      throw error;
    }
    return;
  }

  if (hasContract) {
    try {
      mapCreativeGenerationInputForExecution(job);
    } catch (error) {
      if (
        error instanceof CreativeGenerationPhase2Error ||
        error instanceof CreativeGenerationExecutionError
      ) {
        throw new CreativeAssetProviderError({
          code: sanitizeErrorClass(error.code),
          message: error.message,
          failureMode: "PRE_DISPATCH",
          safeToRetry: false,
        });
      }
      throw error;
    }
  }
  // Legacy freeform input allowed only for non-openrouter (HTTP) providers.
}

function sanitizeErrorClass(code: string): string {
  const normalized = code.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (!normalized) {
    return "policy_rejected";
  }
  if (/^[0-9]/.test(normalized)) {
    return `e_${normalized}`.slice(0, 100);
  }
  return normalized.slice(0, 100);
}

export function toCreativeAssetProviderError(
  error: unknown,
): CreativeAssetProviderError {
  if (error instanceof CreativeAssetProviderError) {
    return error;
  }
  if (
    error instanceof CreativeGenerationPhase2Error ||
    error instanceof CreativeGenerationExecutionError
  ) {
    return new CreativeAssetProviderError({
      code: sanitizeErrorClass(error.code),
      message: error.message,
      failureMode: error.failureMode,
      safeToRetry: error.safeToRetry,
    });
  }
  if (error instanceof CreativeGenerationContractError) {
    return new CreativeAssetProviderError({
      code: sanitizeErrorClass(error.code) || "invalid_generation_input",
      message: error.message,
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }
  return new CreativeAssetProviderError({
    code: "asset_post_processing_failed",
    message: "Assetverarbeitung konnte nicht sicher abgeschlossen werden.",
    failureMode: "POST_PROCESSING",
    safeToRetry: true,
  });
}
