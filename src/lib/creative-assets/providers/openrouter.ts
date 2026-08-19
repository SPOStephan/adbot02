import "server-only";

import {
  MAX_CREATIVE_IMAGE_BYTES,
  assertSecretFreeJson,
} from "../image";
import {
  mapCreativeGenerationInputForPhase2Execution,
  toCreativeAssetProviderError,
} from "../map-generation-input";
import {
  loadVerifiedStyleReferenceAssets,
  styleReferenceToDataUrl,
} from "../style-reference-load";
import {
  CREATIVE_ASSET_PROVIDER_CONTRACT_VERSION,
  CreativeAssetProviderError,
  SUPPORTED_CREATIVE_IMAGE_MIME_TYPES,
  type CreativeAssetProvider,
  type CreativeAssetProviderRequest,
  type CreativeAssetProviderResult,
  type CreativeAssetSource,
  type CreativeImageMimeType,
} from "../types";

const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

export type OpenRouterCreativeAssetProviderConfig = {
  key: "openrouter";
  apiKey: string;
  baseUrl: string;
  modelAllowlist: string[];
  defaultModel: string | null;
  allowedAssetHosts: string[];
  timeoutMs?: number;
  httpReferer?: string | null;
  appTitle?: string | null;
};

type JsonObject = Record<string, unknown>;

function normalizedRequired(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Creative OpenRouter configuration is missing ${name}`);
  }
  return normalized;
}

function parseHttpsUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Creative OpenRouter ${name} is not a valid URL`);
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(
      `Creative OpenRouter ${name} must be a credential-free HTTPS URL`,
    );
  }
  return url;
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(21_600, Math.max(60, Math.ceil(seconds)));
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date) && date > Date.now()) {
    return Math.min(
      21_600,
      Math.max(60, Math.ceil((date - Date.now()) / 1000)),
    );
  }
  return null;
}

async function readLimitedBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumBytes) {
    throw new CreativeAssetProviderError({
      code: "provider_response_too_large",
      message: "Providerantwort überschreitet das erlaubte Größenlimit.",
      failureMode: "POLICY_REJECTED",
    });
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new CreativeAssetProviderError({
          code: "provider_response_too_large",
          message: "Providerantwort überschreitet das erlaubte Größenlimit.",
          failureMode: "POLICY_REJECTED",
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function parseJsonObject(bytes: Uint8Array): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CreativeAssetProviderError({
      code: "invalid_provider_json",
      message: "Providerantwort ist kein gültiges UTF-8-JSON.",
      failureMode: "REMOTE_REJECTED",
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreativeAssetProviderError({
      code: "invalid_provider_json",
      message: "Providerantwort muss ein JSON-Objekt sein.",
      failureMode: "REMOTE_REJECTED",
    });
  }
  return value as JsonObject;
}

function decodeBase64Asset(value: string): Uint8Array {
  let normalized = value.replace(/\s+/g, "");
  const dataUrlMatch = /^data:image\/(?:png|jpeg|jpg);base64,(.+)$/i.exec(
    normalized,
  );
  if (dataUrlMatch) {
    normalized = dataUrlMatch[1];
  }
  if (
    normalized.length === 0 ||
    normalized.length > Math.ceil(MAX_CREATIVE_IMAGE_BYTES / 3) * 4 + 8 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    throw new CreativeAssetProviderError({
      code: "invalid_asset_base64",
      message: "Provider lieferte ungültige Assetbytes.",
      failureMode: "REMOTE_REJECTED",
    });
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.byteLength > MAX_CREATIVE_IMAGE_BYTES) {
    throw new CreativeAssetProviderError({
      code: "asset_too_large",
      message: "Providerasset überschreitet 10 MiB.",
      failureMode: "POLICY_REJECTED",
    });
  }
  return new Uint8Array(bytes);
}

function mimeFromOutputFormat(
  mimeType: "image/png" | "image/jpeg",
): "png" | "jpeg" {
  return mimeType === "image/jpeg" ? "jpeg" : "png";
}

function parseDeclaredMime(
  value: unknown,
  fallback: CreativeImageMimeType,
): CreativeImageMimeType {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "image/png" || normalized === "png") {
    return "image/png";
  }
  if (
    normalized === "image/jpeg" ||
    normalized === "image/jpg" ||
    normalized === "jpeg" ||
    normalized === "jpg"
  ) {
    return "image/jpeg";
  }
  if (
    SUPPORTED_CREATIVE_IMAGE_MIME_TYPES.includes(
      normalized as CreativeImageMimeType,
    )
  ) {
    return normalized as CreativeImageMimeType;
  }
  throw new CreativeAssetProviderError({
    code: "unsupported_provider_mime",
    message: "Provider lieferte einen nicht unterstützten MIME-Typ.",
    failureMode: "POLICY_REJECTED",
  });
}

function asRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function collectCandidateImageObjects(payload: JsonObject): JsonObject[] {
  const candidates: JsonObject[] = [];
  const push = (value: unknown) => {
    const record = asRecord(value);
    if (record) {
      candidates.push(record);
    }
  };

  if (Array.isArray(payload.data)) {
    for (const entry of payload.data) {
      push(entry);
      const nested = asRecord(entry);
      if (nested && Array.isArray(nested.images)) {
        for (const image of nested.images) {
          push(image);
        }
      }
    }
  }
  if (Array.isArray(payload.images)) {
    for (const entry of payload.images) {
      push(entry);
    }
  }
  push(payload);

  return candidates;
}

/**
 * Prefer base64 bytes; fall back to HTTPS URL when allowlisted hosts exist.
 * Recognizes common OpenRouter / OpenAI-compatible shapes.
 */
export function parseOpenRouterImageResponse(input: {
  payload: JsonObject;
  fallbackMimeType: CreativeImageMimeType;
  allowedAssetHosts: ReadonlySet<string>;
  requestId: string | null;
  fallbackProviderAssetId?: string;
}): {
  source: CreativeAssetSource;
  declaredMimeType: CreativeImageMimeType;
  providerAssetId: string;
  providerRequestId: string | null;
  metadata: Record<string, unknown>;
} {
  const candidates = collectCandidateImageObjects(input.payload);
  let bytesSource: CreativeAssetSource | null = null;
  let urlSource: CreativeAssetSource | null = null;
  let declaredMimeType = input.fallbackMimeType;
  let providerAssetId: string | null = null;

  for (const candidate of candidates) {
    const b64 =
      (typeof candidate.b64_json === "string" && candidate.b64_json) ||
      (typeof candidate.base64 === "string" && candidate.base64) ||
      (typeof candidate.image_base64 === "string" && candidate.image_base64) ||
      null;
    if (b64 && !bytesSource) {
      bytesSource = { kind: "bytes", bytes: decodeBase64Asset(b64) };
      declaredMimeType = parseDeclaredMime(
        candidate.media_type ?? candidate.mime_type,
        input.fallbackMimeType,
      );
    }

    const urlValue =
      (typeof candidate.url === "string" && candidate.url) ||
      (typeof candidate.image_url === "string" && candidate.image_url) ||
      (typeof asRecord(candidate.image_url)?.url === "string"
        ? (asRecord(candidate.image_url)?.url as string)
        : null);
    if (urlValue && !urlSource) {
      const url = parseHttpsUrl(urlValue, "asset URL");
      if (
        input.allowedAssetHosts.size === 0 ||
        !input.allowedAssetHosts.has(url.hostname.toLowerCase())
      ) {
        throw new CreativeAssetProviderError({
          code: "asset_host_not_allowed",
          message:
            "Providerasset liegt nicht auf einem freigegebenen HTTPS-Host.",
          failureMode: "POLICY_REJECTED",
          providerRequestId: input.requestId,
        });
      }
      urlSource = { kind: "url", url: url.toString() };
      declaredMimeType = parseDeclaredMime(
        candidate.media_type ?? candidate.mime_type,
        input.fallbackMimeType,
      );
    }

    const idCandidate =
      (typeof candidate.id === "string" && candidate.id.trim()) ||
      (typeof candidate.asset_id === "string" && candidate.asset_id.trim()) ||
      null;
    if (idCandidate && !providerAssetId) {
      providerAssetId = idCandidate.slice(0, 255);
    }
  }

  const source = bytesSource ?? urlSource;
  if (!source) {
    throw new CreativeAssetProviderError({
      code: "invalid_asset_source",
      message: "OpenRouter lieferte keine verwertbare Bildquelle.",
      failureMode: "REMOTE_REJECTED",
      providerRequestId: input.requestId,
    });
  }

  const usage = asRecord(input.payload.usage);
  const metadata: Record<string, unknown> = {
    openrouter: true,
  };
  if (usage) {
    assertSecretFreeJson(usage, "usage");
    metadata.usage = usage;
  }
  if (typeof input.payload.created === "number") {
    metadata.created = input.payload.created;
  }

  const requestIdFromBody =
    (typeof input.payload.id === "string" && input.payload.id.trim()) ||
    (typeof input.payload.request_id === "string" &&
      input.payload.request_id.trim()) ||
    null;

  return {
    source,
    declaredMimeType,
    providerAssetId:
      providerAssetId ??
      input.fallbackProviderAssetId ??
      `openrouter:${(input.requestId ?? "local").slice(0, 48)}`,
    providerRequestId: requestIdFromBody ?? input.requestId,
    metadata,
  };
}

export class OpenRouterCreativeAssetProvider implements CreativeAssetProvider {
  readonly key = "openrouter" as const;
  readonly contractVersion = CREATIVE_ASSET_PROVIDER_CONTRACT_VERSION;
  readonly guaranteesIdempotency = true as const;

  private readonly apiKey: string;
  private readonly imagesEndpoint: URL;
  private readonly modelAllowlist: ReadonlySet<string>;
  private readonly defaultModel: string | null;
  private readonly allowedAssetHosts: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly httpReferer: string | null;
  private readonly appTitle: string | null;

  constructor(config: OpenRouterCreativeAssetProviderConfig) {
    if (config.key !== "openrouter") {
      throw new Error("OpenRouter creative provider key must be openrouter");
    }
    this.apiKey = normalizedRequired(config.apiKey, "API key");
    const base = parseHttpsUrl(
      normalizedRequired(config.baseUrl, "base URL"),
      "base URL",
    );
    this.imagesEndpoint = new URL(
      `${base.toString().replace(/\/+$/, "")}/images`,
    );
    this.modelAllowlist = new Set(config.modelAllowlist);
    if (this.modelAllowlist.size === 0) {
      throw new Error("OpenRouter model allowlist must not be empty");
    }
    this.defaultModel = config.defaultModel?.trim() || null;
    if (this.defaultModel && !this.modelAllowlist.has(this.defaultModel)) {
      throw new Error(
        "CREATIVE_ASSET_OPENROUTER_DEFAULT_MODEL ist nicht in der Allowlist.",
      );
    }
    this.allowedAssetHosts = new Set(
      config.allowedAssetHosts
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    );
    this.timeoutMs = Math.min(
      120_000,
      Math.max(5_000, config.timeoutMs ?? 60_000),
    );
    this.httpReferer = config.httpReferer?.trim() || null;
    this.appTitle = config.appTitle?.trim() || null;
  }

  async generate(
    request: CreativeAssetProviderRequest,
  ): Promise<CreativeAssetProviderResult> {
    if (request.job.providerKey !== this.key) {
      throw new CreativeAssetProviderError({
        code: "provider_key_mismatch",
        message: "Assetjob ist einem anderen Provider zugeordnet.",
        failureMode: "PRE_DISPATCH",
      });
    }

    let generation;
    try {
      generation = mapCreativeGenerationInputForPhase2Execution(request.job);
    } catch (error) {
      throw toCreativeAssetProviderError(error);
    }
    const model = generation.model_id;
    if (!this.modelAllowlist.has(model)) {
      throw new CreativeAssetProviderError({
        code: "model_not_allowlisted",
        message: "Das gewählte OpenRouter-Modell ist nicht freigegeben.",
        failureMode: "POLICY_REJECTED",
        safeToRetry: false,
      });
    }

    const prompt = generation.prompt?.trim() ?? "";
    if (!prompt) {
      throw new CreativeAssetProviderError({
        code: "prompt_required",
        message: "OpenRouter-Generierung erfordert einen Prompt.",
        failureMode: "POLICY_REJECTED",
        safeToRetry: false,
      });
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      output_format: mimeFromOutputFormat(generation.output.mime_type),
      n: 1,
    };
    if (generation.output.aspect_hint) {
      body.aspect_ratio = generation.output.aspect_hint;
    }

    let styleReferenceMeta: Array<{
      asset_id: string;
      sha256: string;
      source: string;
    }> = [];
    if (generation.reference_asset_ids.length > 0) {
      const refs = await loadVerifiedStyleReferenceAssets({
        userId: request.job.userId,
        platformAccountId: request.job.platformAccountId,
        assetIds: generation.reference_asset_ids,
      });
      body.input_references = refs.map((ref) => ({
        type: "image_url",
        image_url: { url: styleReferenceToDataUrl(ref) },
      }));
      styleReferenceMeta = refs.map((ref) => ({
        asset_id: ref.assetId,
        sha256: ref.sha256,
        source: ref.source,
      }));
    }

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([request.signal, timeoutSignal]);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": request.job.idempotencyKey,
      "X-Adbot-Contract-Version": this.contractVersion,
    };
    if (this.httpReferer) {
      headers["HTTP-Referer"] = this.httpReferer;
    }
    if (this.appTitle) {
      headers["X-Title"] = this.appTitle;
    }

    let response: Response;
    try {
      response = await fetch(this.imagesEndpoint, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal,
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      const timedOut = timeoutSignal.aborted;
      throw new CreativeAssetProviderError({
        code: timedOut ? "provider_timeout" : "provider_transport_ambiguous",
        message: timedOut
          ? "Provideraufruf hat das Zeitlimit überschritten."
          : "Providertransport endete ohne eindeutiges Remote-Ergebnis.",
        failureMode: "AMBIGUOUS_TRANSPORT",
      });
    }

    const responseBytes = await readLimitedBytes(
      response,
      MAX_PROVIDER_RESPONSE_BYTES,
    );
    const requestId = response.headers.get("x-request-id")?.trim() || null;
    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      throw new CreativeAssetProviderError({
        code: `provider_http_${response.status}`,
        message: `OpenRouter lehnte die Anfrage mit HTTP ${response.status} ab.`,
        failureMode: "REMOTE_REJECTED",
        safeToRetry: retryable,
        retryAfterSeconds: parseRetryAfter(
          response.headers.get("retry-after"),
        ),
        providerRequestId: requestId,
      });
    }

    const payload = parseJsonObject(responseBytes);
    const parsed = parseOpenRouterImageResponse({
      payload,
      fallbackMimeType: generation.output.mime_type,
      allowedAssetHosts: this.allowedAssetHosts,
      requestId,
      fallbackProviderAssetId: `openrouter:${request.job.inputHash.slice(0, 40)}`,
    });

    return {
      providerRequestId: parsed.providerRequestId,
      providerAssetId: parsed.providerAssetId,
      fileName: null,
      declaredMimeType: parsed.declaredMimeType,
      source: parsed.source,
      moderationStatus: "APPROVED",
      metadata: {
        ...parsed.metadata,
        generation_mode: generation.mode,
        model_id: model,
        ...(styleReferenceMeta.length > 0
          ? { style_references: styleReferenceMeta }
          : {}),
      },
    };
  }

  async materialize(
    result: CreativeAssetProviderResult,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    if (result.source.kind === "bytes") {
      return result.source.bytes;
    }

    let url = parseHttpsUrl(result.source.url, "asset URL");
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      this.assertAllowedAssetUrl(url);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          signal,
          headers: { Accept: result.declaredMimeType },
        });
      } catch {
        throw new CreativeAssetProviderError({
          code: "asset_download_failed",
          message: "Providerasset konnte nicht sicher geladen werden.",
          failureMode: "POST_PROCESSING",
          safeToRetry: true,
          providerRequestId: result.providerRequestId,
        });
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) {
          throw new CreativeAssetProviderError({
            code: "asset_redirect_rejected",
            message: "Providerasset überschreitet die erlaubte Redirectkette.",
            failureMode: "POLICY_REJECTED",
            providerRequestId: result.providerRequestId,
          });
        }
        url = parseHttpsUrl(
          new URL(location, url).toString(),
          "asset redirect",
        );
        continue;
      }

      if (!response.ok) {
        throw new CreativeAssetProviderError({
          code: `asset_http_${response.status}`,
          message: `Providerasset konnte nicht geladen werden (HTTP ${response.status}).`,
          failureMode: "POST_PROCESSING",
          safeToRetry:
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
          retryAfterSeconds: parseRetryAfter(
            response.headers.get("retry-after"),
          ),
          providerRequestId: result.providerRequestId,
        });
      }

      return readLimitedBytes(response, MAX_CREATIVE_IMAGE_BYTES);
    }

    throw new CreativeAssetProviderError({
      code: "asset_redirect_rejected",
      message: "Providerasset überschreitet die erlaubte Redirectkette.",
      failureMode: "POLICY_REJECTED",
      providerRequestId: result.providerRequestId,
    });
  }

  private assertAllowedAssetUrl(url: URL): void {
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !this.allowedAssetHosts.has(url.hostname.toLowerCase())
    ) {
      throw new CreativeAssetProviderError({
        code: "asset_host_not_allowed",
        message: "Providerasset liegt nicht auf einem freigegebenen HTTPS-Host.",
        failureMode: "POLICY_REJECTED",
      });
    }
  }
}
