/**
 * Phase 2 execution gates for creative generation input.
 * Maps job.inputPayload through the Phase 1 contract and rejects unsupported modes.
 */

import {
  assertCreativeGenerationInput,
  CreativeGenerationContractError,
  CREATIVE_GENERATION_CONTRACT_VERSION,
  type CreativeGenerationInput,
} from "./generation-contract";
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
 * Validate Phase 2 execution constraints on an already-asserted contract input.
 * locked_photo and style references are not supported until later phases.
 */
export function assertPhase2ExecutableGenerationInput(
  input: CreativeGenerationInput,
  job: Pick<CreativeAssetJob, "providerKey" | "providerModel">,
): CreativeGenerationInput {
  if (input.mode === "locked_photo") {
    throw new CreativeGenerationPhase2Error({
      code: "POLICY_REJECTED",
      message:
        "Phase 2 unterstützt nur mode=free; locked_photo (Compose) folgt später.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  if (input.mode !== "free") {
    throw new CreativeGenerationPhase2Error({
      code: "POLICY_REJECTED",
      message: "Phase 2 unterstützt nur mode=free.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  if (input.provider_key !== job.providerKey) {
    throw new CreativeGenerationPhase2Error({
      code: "provider_key_mismatch",
      message: "provider_key im Input stimmt nicht mit dem Job-Provider überein.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  if (input.model_id !== job.providerModel) {
    throw new CreativeGenerationPhase2Error({
      code: "model_id_mismatch",
      message: "model_id im Input stimmt nicht mit dem Job-Modell überein.",
      failureMode: "PRE_DISPATCH",
      safeToRetry: false,
    });
  }

  if (input.reference_asset_ids.length > 0) {
    throw new CreativeGenerationPhase2Error({
      code: "POLICY_REJECTED",
      message:
        "Phase 2 akzeptiert noch keine reference_asset_ids (Style-Wiring folgt).",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  if (input.locked_photo_asset_ids.length > 0) {
    throw new CreativeGenerationPhase2Error({
      code: "POLICY_REJECTED",
      message: "free-Mode darf keine locked_photo_asset_ids enthalten.",
      failureMode: "POLICY_REJECTED",
      safeToRetry: false,
    });
  }

  return input;
}

/**
 * Map a job payload for Phase 2 OpenRouter / contract-aware execution.
 */
export function mapCreativeGenerationInputForPhase2Execution(
  job: CreativeAssetJob,
): CreativeGenerationInput {
  let asserted: CreativeGenerationInput;
  try {
    asserted = assertCreativeGenerationInput(job.inputPayload);
  } catch (error) {
    if (error instanceof CreativeGenerationContractError) {
      throw new CreativeGenerationPhase2Error({
        code: error.code,
        message: error.message,
        failureMode: "POLICY_REJECTED",
        safeToRetry: false,
      });
    }
    throw error;
  }

  return assertPhase2ExecutableGenerationInput(asserted, job);
}

/**
 * Worker pre-dispatch gate:
 * - Contract present → Phase 2 execution rules
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
      mapCreativeGenerationInputForPhase2Execution(job);
    } catch (error) {
      if (error instanceof CreativeGenerationPhase2Error) {
        throw new CreativeAssetProviderError({
          code: sanitizeErrorClass(error.code),
          message: error.message,
          // Pre-dispatch worker gate: fail RPC requires PRE_DISPATCH before dispatch.
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
      mapCreativeGenerationInputForPhase2Execution(job);
    } catch (error) {
      if (error instanceof CreativeGenerationPhase2Error) {
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
  if (error instanceof CreativeGenerationPhase2Error) {
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
