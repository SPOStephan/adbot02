import "server-only";

import {
  getCreativeAssetRuntimeConfig,
  hasCreativeAssetProviderConfig,
} from "@/lib/creative-assets/env";
import { uploadInspirationVaultImage } from "@/lib/media-library/upload";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstBase64(payload: Record<string, unknown>): string | null {
  const buckets: unknown[] = [];
  if (Array.isArray(payload.data)) buckets.push(...payload.data);
  if (Array.isArray(payload.images)) buckets.push(...payload.images);
  buckets.push(payload);
  for (const entry of buckets) {
    const row = asRecord(entry);
    if (!row) continue;
    for (const key of ["b64_json", "base64", "image_base64"]) {
      if (typeof row[key] === "string" && row[key]) return String(row[key]);
    }
  }
  return null;
}

function firstHttpsUrl(payload: Record<string, unknown>): string | null {
  const buckets: unknown[] = [];
  if (Array.isArray(payload.data)) buckets.push(...payload.data);
  if (Array.isArray(payload.images)) buckets.push(...payload.images);
  buckets.push(payload);
  for (const entry of buckets) {
    const row = asRecord(entry);
    if (!row) continue;
    if (typeof row.url === "string" && row.url.startsWith("https://")) return row.url;
    const nested = asRecord(row.image_url);
    if (nested && typeof nested.url === "string" && nested.url.startsWith("https://")) {
      return nested.url;
    }
  }
  return null;
}

export function isTrainingImageGenerationConfigured(): boolean {
  return hasCreativeAssetProviderConfig();
}

export async function generateTrainingAdImage(input: {
  uploaderUserId: string;
  prompt: string;
  runId: string;
}): Promise<{ brandAssetId: string } | { skipped: string }> {
  if (!hasCreativeAssetProviderConfig()) {
    return { skipped: "Bildgenerierung ist nicht konfiguriert (OpenRouter)." };
  }

  let runtime;
  try {
    runtime = getCreativeAssetRuntimeConfig();
  } catch {
    return { skipped: "Bild-Provider ist unvollständig konfiguriert." };
  }
  if (runtime.kind !== "openrouter") {
    return { skipped: "Training-Bilder brauchen den OpenRouter-Provider." };
  }

  const model = runtime.provider.defaultModel ?? runtime.provider.modelAllowlist[0];
  if (!model) {
    return { skipped: "Kein freigegebenes Bildmodell." };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${runtime.provider.apiKey}`,
    "Content-Type": "application/json",
  };
  if (runtime.provider.httpReferer) {
    headers["HTTP-Referer"] = runtime.provider.httpReferer;
  }
  if (runtime.provider.appTitle) {
    headers["X-Title"] = runtime.provider.appTitle;
  }

  const response = await fetch(
    `${runtime.provider.baseUrl.replace(/\/+$/, "")}/images`,
    {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(runtime.provider.timeoutMs ?? 60_000),
      headers,
      body: JSON.stringify({
        model,
        prompt: input.prompt.slice(0, 4000),
        output_format: "jpeg",
        n: 1,
        aspect_ratio: "1:1",
      }),
    },
  );
  if (!response.ok) {
    return { skipped: `Bild-Provider HTTP ${response.status}.` };
  }

  const payload = asRecord(await response.json().catch(() => null));
  if (!payload) return { skipped: "Bild-Provider lieferte kein JSON." };

  let bytes: Uint8Array | null = null;
  const b64 = firstBase64(payload);
  if (b64) {
    bytes = new Uint8Array(Buffer.from(b64, "base64"));
  } else {
    const url = firstHttpsUrl(payload);
    if (url) {
      const image = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (image.ok) {
        const buffer = Buffer.from(await image.arrayBuffer());
        if (buffer.byteLength > 0 && buffer.byteLength <= MAX_IMAGE_BYTES) {
          bytes = new Uint8Array(buffer);
        }
      }
    }
  }
  if (!bytes || bytes.byteLength < 32) {
    return { skipped: "Kein Bild in der Providerantwort." };
  }

  let mimeType: "image/jpeg" | "image/png" = "image/jpeg";
  let fileName = `training-${input.runId.slice(0, 8)}.jpg`;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    mimeType = "image/png";
    fileName = `training-${input.runId.slice(0, 8)}.png`;
  } else if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) {
    const sharp = (await import("sharp")).default;
    bytes = new Uint8Array(
      await sharp(bytes, { failOn: "error", animated: false })
        .rotate()
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer(),
    );
  }

  const uploaded = await uploadInspirationVaultImage({
    uploaderUserId: input.uploaderUserId,
    fileName,
    mimeType,
    bytes,
    metadata: {
      contract_version: 1,
      library: "adbot_training_ground",
      source_kind: "adbot_training",
      never_launch: true,
      customer_visible: false,
      training_run_id: input.runId,
    },
  });
  return { brandAssetId: uploaded.brandAssetId };
}
