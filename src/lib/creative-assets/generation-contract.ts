/**
 * Creative Generation input contract v1 (Phase 1).
 *
 * Validates shape only — no live OpenRouter / HTTP provider calls.
 * provider_key is model-open (`openrouter`, `http`, …) for Phase 2 wiring.
 *
 * Aligns with SQL: public.creative_generation_input_contract_valid(jsonb)
 */

export const CREATIVE_GENERATION_CONTRACT_VERSION =
  "adbot-creative-generation-v1" as const;

export const CREATIVE_GENERATION_MODES = ["free", "locked_photo"] as const;
export type CreativeGenerationMode = (typeof CREATIVE_GENERATION_MODES)[number];

export const BRAND_ASSET_ROLES = [
  "LOCKED_PHOTO",
  "UPLOAD_EDITABLE",
  "GENERATED",
  "STYLE_REFERENCE",
] as const;
export type BrandAssetRole = (typeof BRAND_ASSET_ROLES)[number];

export const BRAND_ASSET_TRAINING_STATUSES = [
  "none",
  "marked_good",
  "performance_winner",
] as const;
export type BrandAssetTrainingStatus =
  (typeof BRAND_ASSET_TRAINING_STATUSES)[number];

export const CREATIVE_GENERATION_OUTPUT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
] as const;
export type CreativeGenerationOutputMimeType =
  (typeof CREATIVE_GENERATION_OUTPUT_MIME_TYPES)[number];

/** Matches SQL provider_key: ^[a-z][a-z0-9_-]{1,63}$ */
export const PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SENSITIVE_KEY_EXACT = new Set([
  "authorization",
  "password",
  "privatekey",
  "apikey",
]);

export type CreativeGenerationOutput = {
  mime_type: CreativeGenerationOutputMimeType;
  aspect_hint?: string;
};

export type CreativeGenerationInput = {
  contract_version: typeof CREATIVE_GENERATION_CONTRACT_VERSION;
  mode: CreativeGenerationMode;
  /** Provider-open; Phase 2 may use `openrouter`. */
  provider_key: string;
  model_id: string;
  prompt?: string;
  /** Style / vault / winners references. */
  reference_asset_ids: string[];
  /** Required non-empty iff mode === "locked_photo". */
  locked_photo_asset_ids: string[];
  output: CreativeGenerationOutput;
};

export type BuildCreativeGenerationInputArgs = {
  mode: CreativeGenerationMode;
  provider_key: string;
  model_id: string;
  prompt?: string;
  reference_asset_ids?: string[];
  locked_photo_asset_ids?: string[];
  output: CreativeGenerationOutput;
};

export class CreativeGenerationContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CreativeGenerationContractError";
    this.code = code;
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Mirrors public.meta_jsonb_has_sensitive_key for contract payloads. */
export function creativeGenerationPayloadHasSensitiveKey(
  value: unknown,
): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((child) => creativeGenerationPayloadHasSensitiveKey(child));
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeKey(key);
      if (
        SENSITIVE_KEY_EXACT.has(normalized) ||
        /(token|secret|password|privatekey)$/.test(normalized)
      ) {
        return true;
      }
      if (creativeGenerationPayloadHasSensitiveKey(child)) {
        return true;
      }
    }
  }
  return false;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function assertAssetIdList(
  field: string,
  value: unknown,
  max: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new CreativeGenerationContractError(
      "INVALID_ASSET_ID_LIST",
      `${field} must be an array of UUIDs`,
    );
  }
  if (value.length > max) {
    throw new CreativeGenerationContractError(
      "ASSET_ID_LIST_TOO_LONG",
      `${field} may contain at most ${max} ids`,
    );
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isUuid(entry)) {
      throw new CreativeGenerationContractError(
        "INVALID_ASSET_ID",
        `${field} entries must be UUIDs`,
      );
    }
    ids.push(entry.toLowerCase());
  }
  return ids;
}

/**
 * Build a canonical Phase 1 generation input object.
 * Does not call any external image API.
 */
export function buildCreativeGenerationInput(
  args: BuildCreativeGenerationInputArgs,
): CreativeGenerationInput {
  const reference_asset_ids = [...(args.reference_asset_ids ?? [])];
  const locked_photo_asset_ids = [...(args.locked_photo_asset_ids ?? [])];

  const input: CreativeGenerationInput = {
    contract_version: CREATIVE_GENERATION_CONTRACT_VERSION,
    mode: args.mode,
    provider_key: args.provider_key.trim(),
    model_id: args.model_id.trim(),
    reference_asset_ids,
    locked_photo_asset_ids,
    output: {
      mime_type: args.output.mime_type,
      ...(args.output.aspect_hint !== undefined
        ? { aspect_hint: args.output.aspect_hint.trim() }
        : {}),
    },
  };

  if (args.prompt !== undefined) {
    input.prompt = args.prompt;
  }

  return assertCreativeGenerationInput(input);
}

/**
 * Assert / normalize an unknown payload against the Phase 1 contract.
 * Aligns with SQL creative_generation_input_contract_valid.
 */
export function assertCreativeGenerationInput(
  value: unknown,
): CreativeGenerationInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CreativeGenerationContractError(
      "INVALID_INPUT",
      "Generation input must be a JSON object",
    );
  }

  if (creativeGenerationPayloadHasSensitiveKey(value)) {
    throw new CreativeGenerationContractError(
      "SENSITIVE_KEY",
      "Generation input must not contain sensitive keys",
    );
  }

  const raw = value as Record<string, unknown>;

  if (raw.contract_version !== CREATIVE_GENERATION_CONTRACT_VERSION) {
    throw new CreativeGenerationContractError(
      "CONTRACT_VERSION",
      `contract_version must be ${CREATIVE_GENERATION_CONTRACT_VERSION}`,
    );
  }

  if (
    raw.mode !== "free" &&
    raw.mode !== "locked_photo"
  ) {
    throw new CreativeGenerationContractError(
      "INVALID_MODE",
      'mode must be "free" or "locked_photo"',
    );
  }

  if (
    typeof raw.provider_key !== "string" ||
    !PROVIDER_KEY_PATTERN.test(raw.provider_key)
  ) {
    throw new CreativeGenerationContractError(
      "INVALID_PROVIDER_KEY",
      "provider_key must match ^[a-z][a-z0-9_-]{1,63}$ (e.g. openrouter)",
    );
  }

  if (
    typeof raw.model_id !== "string" ||
    raw.model_id.length < 1 ||
    raw.model_id.length > 160
  ) {
    throw new CreativeGenerationContractError(
      "INVALID_MODEL_ID",
      "model_id must be 1–160 characters",
    );
  }

  let prompt: string | undefined;
  if ("prompt" in raw) {
    if (typeof raw.prompt !== "string") {
      throw new CreativeGenerationContractError(
        "INVALID_PROMPT",
        "prompt must be a string when present",
      );
    }
    if (raw.prompt.length > 8000) {
      throw new CreativeGenerationContractError(
        "PROMPT_TOO_LONG",
        "prompt must be at most 8000 characters",
      );
    }
    prompt = raw.prompt;
  }

  const reference_asset_ids = assertAssetIdList(
    "reference_asset_ids",
    raw.reference_asset_ids,
    32,
  );
  const locked_photo_asset_ids = assertAssetIdList(
    "locked_photo_asset_ids",
    raw.locked_photo_asset_ids,
    16,
  );

  if (raw.mode === "locked_photo" && locked_photo_asset_ids.length < 1) {
    throw new CreativeGenerationContractError(
      "LOCKED_PHOTO_REQUIRED",
      "locked_photo mode requires at least one locked_photo_asset_ids entry",
    );
  }

  if (raw.mode === "free" && locked_photo_asset_ids.length !== 0) {
    throw new CreativeGenerationContractError(
      "LOCKED_PHOTO_NOT_ALLOWED",
      "free mode must not include locked_photo_asset_ids",
    );
  }

  if (
    raw.output === null ||
    typeof raw.output !== "object" ||
    Array.isArray(raw.output)
  ) {
    throw new CreativeGenerationContractError(
      "INVALID_OUTPUT",
      "output must be an object",
    );
  }

  const outputRaw = raw.output as Record<string, unknown>;
  if (
    outputRaw.mime_type !== "image/png" &&
    outputRaw.mime_type !== "image/jpeg"
  ) {
    throw new CreativeGenerationContractError(
      "INVALID_MIME",
      'output.mime_type must be "image/png" or "image/jpeg"',
    );
  }

  let aspect_hint: string | undefined;
  if ("aspect_hint" in outputRaw) {
    if (typeof outputRaw.aspect_hint !== "string") {
      throw new CreativeGenerationContractError(
        "INVALID_ASPECT_HINT",
        "output.aspect_hint must be a string when present",
      );
    }
    if (
      outputRaw.aspect_hint.length < 1 ||
      outputRaw.aspect_hint.length > 32
    ) {
      throw new CreativeGenerationContractError(
        "INVALID_ASPECT_HINT",
        "output.aspect_hint must be 1–32 characters",
      );
    }
    aspect_hint = outputRaw.aspect_hint;
  }

  const result: CreativeGenerationInput = {
    contract_version: CREATIVE_GENERATION_CONTRACT_VERSION,
    mode: raw.mode,
    provider_key: raw.provider_key,
    model_id: raw.model_id,
    reference_asset_ids,
    locked_photo_asset_ids,
    output: {
      mime_type: outputRaw.mime_type,
      ...(aspect_hint !== undefined ? { aspect_hint } : {}),
    },
  };

  if (prompt !== undefined) {
    result.prompt = prompt;
  }

  return result;
}

export function isCreativeGenerationInput(value: unknown): boolean {
  try {
    assertCreativeGenerationInput(value);
    return true;
  } catch {
    return false;
  }
}
