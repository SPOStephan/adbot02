import "server-only";

import {
  MAX_CREATIVE_IMAGE_BYTES,
  assertSecretFreeJson,
} from "./image";
import {
  CREATIVE_ASSET_PROVIDER_CONTRACT_VERSION,
  CreativeAssetProviderError,
  SUPPORTED_CREATIVE_IMAGE_MIME_TYPES,
  type CreativeAssetProvider,
  type CreativeAssetProviderRequest,
  type CreativeAssetProviderResult,
  type CreativeAssetSource,
  type CreativeImageMimeType,
} from "./types";

const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;

export type HttpCreativeAssetProviderConfig = {
  key: string;
  endpoint: string;
  apiKey: string;
  allowedAssetHosts: string[];
  timeoutMs?: number;
};

type JsonObject = Record<string, unknown>;

function normalizedRequired(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Creative provider configuration is missing ${name}`);
  }
  return normalized;
}

function parseHttpsUrl(value: string, name: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Creative provider ${name} is not a valid URL`);
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error(`Creative provider ${name} must be a credential-free HTTPS URL`);
  }
  return url;
}

function safeString(
  value: unknown,
  name: string,
  maxLength = 255,
  nullable = false,
): string | null {
  if (value === null || value === undefined) {
    if (nullable) {
      return null;
    }
    throw new CreativeAssetProviderError({
      code: "invalid_provider_response",
      message: `Providerantwort enthält kein gültiges Feld ${name}.`,
      failureMode: "REMOTE_REJECTED",
    });
  }
  if (typeof value !== "string") {
    throw new CreativeAssetProviderError({
      code: "invalid_provider_response",
      message: `Providerantwort enthält kein gültiges Feld ${name}.`,
      failureMode: "REMOTE_REJECTED",
    });
  }
  const normalized = value.trim();
  if ((!nullable && !normalized) || normalized.length > maxLength) {
    throw new CreativeAssetProviderError({
      code: "invalid_provider_response",
      message: `Providerantwort enthält kein gültiges Feld ${name}.`,
      failureMode: "REMOTE_REJECTED",
    });
  }
  return normalized || null;
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
  const normalized = value.replace(/\s+/g, "");
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

function parseMimeType(value: unknown): CreativeImageMimeType {
  if (
    typeof value === "string" &&
    SUPPORTED_CREATIVE_IMAGE_MIME_TYPES.includes(
      value as CreativeImageMimeType,
    )
  ) {
    return value as CreativeImageMimeType;
  }
  throw new CreativeAssetProviderError({
    code: "unsupported_provider_mime",
    message: "Provider lieferte einen nicht unterstützten MIME-Typ.",
    failureMode: "POLICY_REJECTED",
  });
}

function parseModerationStatus(
  value: unknown,
): CreativeAssetProviderResult["moderationStatus"] {
  if (value === "PENDING" || value === "APPROVED" || value === "REJECTED") {
    return value;
  }
  throw new CreativeAssetProviderError({
    code: "invalid_moderation_status",
    message: "Providerantwort enthält keinen gültigen Moderationsstatus.",
    failureMode: "REMOTE_REJECTED",
  });
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CreativeAssetProviderError({
      code: "invalid_provider_metadata",
      message: "Providermetadaten müssen ein JSON-Objekt sein.",
      failureMode: "REMOTE_REJECTED",
    });
  }
  assertSecretFreeJson(value, "metadata");
  return value as Record<string, unknown>;
}

export class HttpCreativeAssetProvider implements CreativeAssetProvider {
  readonly key: string;
  readonly contractVersion = CREATIVE_ASSET_PROVIDER_CONTRACT_VERSION;
  readonly guaranteesIdempotency = true as const;

  private readonly endpoint: URL;
  private readonly apiKey: string;
  private readonly allowedAssetHosts: ReadonlySet<string>;
  private readonly timeoutMs: number;

  constructor(config: HttpCreativeAssetProviderConfig) {
    this.key = normalizedRequired(config.key, "key");
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(this.key)) {
      throw new Error("Creative provider key is invalid");
    }
    this.endpoint = parseHttpsUrl(config.endpoint, "endpoint");
    this.apiKey = normalizedRequired(config.apiKey, "API key");
    this.allowedAssetHosts = new Set(
      config.allowedAssetHosts.map((host) => host.trim().toLowerCase()).filter(Boolean),
    );
    this.timeoutMs = Math.min(120_000, Math.max(5_000, config.timeoutMs ?? 60_000));
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
    assertSecretFreeJson(request.job.inputPayload, "input");

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([request.signal, timeoutSignal]);
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": request.job.idempotencyKey,
          "X-Adbot-Contract-Version": this.contractVersion,
        },
        body: JSON.stringify({
          contract_version: this.contractVersion,
          job_id: request.job.jobId,
          idempotency_key: request.job.idempotencyKey,
          model: request.job.providerModel,
          model_version: request.job.providerVersion,
          input_hash: request.job.inputHash,
          input: request.job.inputPayload,
        }),
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
      const retryable = response.status === 408 || response.status === 409 ||
        response.status === 425 || response.status === 429 || response.status >= 500;
      throw new CreativeAssetProviderError({
        code: `provider_http_${response.status}`,
        message: `Provider lehnte die Anfrage mit HTTP ${response.status} ab.`,
        failureMode: "REMOTE_REJECTED",
        safeToRetry: retryable,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
        providerRequestId: requestId,
      });
    }

    const payload = parseJsonObject(responseBytes);
    const bytesBase64 = payload.asset_base64;
    const downloadUrl = payload.download_url;
    if (
      (typeof bytesBase64 === "string") === (typeof downloadUrl === "string")
    ) {
      throw new CreativeAssetProviderError({
        code: "invalid_asset_source",
        message: "Provider muss genau eine Assetquelle liefern.",
        failureMode: "REMOTE_REJECTED",
        providerRequestId: requestId,
      });
    }

    let source: CreativeAssetSource;
    if (typeof bytesBase64 === "string") {
      source = { kind: "bytes", bytes: decodeBase64Asset(bytesBase64) };
    } else {
      const value = safeString(downloadUrl, "download_url", 2048) as string;
      this.assertAllowedAssetUrl(parseHttpsUrl(value, "asset URL"));
      source = { kind: "url", url: value };
    }

    return {
      providerRequestId:
        safeString(payload.request_id, "request_id", 255, true) ?? requestId,
      providerAssetId: safeString(payload.asset_id, "asset_id", 255) as string,
      fileName: safeString(payload.file_name, "file_name", 160, true),
      declaredMimeType: parseMimeType(payload.mime_type),
      source,
      moderationStatus: parseModerationStatus(payload.moderation_status),
      metadata: parseMetadata(payload.metadata),
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
        url = parseHttpsUrl(new URL(location, url).toString(), "asset redirect");
        continue;
      }

      if (!response.ok) {
        throw new CreativeAssetProviderError({
          code: `asset_http_${response.status}`,
          message: `Providerasset konnte nicht geladen werden (HTTP ${response.status}).`,
          failureMode: "POST_PROCESSING",
          safeToRetry: response.status === 408 || response.status === 429 ||
            response.status >= 500,
          retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
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
