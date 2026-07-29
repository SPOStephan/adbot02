import "server-only";

import { createHash } from "node:crypto";

import {
  CreativeAssetProviderError,
  type CreativeImageMimeType,
} from "./types";

export const MAX_CREATIVE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MIN_CREATIVE_IMAGE_DIMENSION = 256;
export const MAX_CREATIVE_IMAGE_DIMENSION = 4096;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const SECRET_KEYS = new Set([
  "accesstoken",
  "authorization",
  "clientsecret",
  "appsecret",
  "refreshtoken",
  "password",
  "privatekey",
  "apikey",
]);

export type InspectedCreativeImage = {
  bytes: Uint8Array;
  sha256: string;
  mimeType: CreativeImageMimeType;
  byteSize: number;
  width: number;
  height: number;
};

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 57 || !hasPngSignature(bytes)) {
    throw new CreativeAssetProviderError({
      code: "invalid_png",
      message: "Provider lieferte keine gültige PNG-Datei.",
      failureMode: "POLICY_REJECTED",
    });
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset + 12 <= bytes.length) {
    const dataLength = readUint32(bytes, offset);
    const chunkEnd = offset + 12 + dataLength;
    if (dataLength > MAX_CREATIVE_IMAGE_BYTES || chunkEnd > bytes.length) {
      break;
    }

    const typeBytes = bytes.slice(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.slice(offset + 8, offset + 8 + dataLength);
    const expectedCrc = readUint32(bytes, offset + 8 + dataLength) >>> 0;
    const crcInput = new Uint8Array(typeBytes.length + data.length);
    crcInput.set(typeBytes);
    crcInput.set(data, typeBytes.length);
    if (crc32(crcInput) !== expectedCrc) {
      break;
    }

    if (!sawHeader) {
      if (type !== "IHDR" || dataLength !== 13 || offset !== 8) {
        break;
      }
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      sawHeader = true;
    } else if (type === "IHDR") {
      break;
    } else if (type === "IDAT") {
      sawImageData = sawImageData || dataLength > 0;
    } else if (type === "IEND") {
      if (dataLength !== 0 || chunkEnd !== bytes.length) {
        break;
      }
      sawEnd = true;
      offset = chunkEnd;
      break;
    }

    offset = chunkEnd;
  }

  if (!sawHeader || !sawImageData || !sawEnd || offset !== bytes.length) {
    throw new CreativeAssetProviderError({
      code: "invalid_png",
      message: "Provider lieferte keine vollständig validierbare PNG-Datei.",
      failureMode: "POLICY_REJECTED",
    });
  }

  return { width, height };
}

const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function inspectJpeg(bytes: Uint8Array): { width: number; height: number } {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    throw new CreativeAssetProviderError({
      code: "invalid_jpeg",
      message: "Provider lieferte keine gültige JPEG-Datei.",
      failureMode: "POLICY_REJECTED",
    });
  }

  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset += 1;
    }
    if (offset >= bytes.length) {
      break;
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
      continue;
    }
    if (offset + 1 >= bytes.length) {
      break;
    }

    const segmentLength = bytes[offset] * 256 + bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      break;
    }

    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        break;
      }
      return {
        height: bytes[offset + 3] * 256 + bytes[offset + 4],
        width: bytes[offset + 5] * 256 + bytes[offset + 6],
      };
    }

    offset += segmentLength;
  }

  throw new CreativeAssetProviderError({
    code: "jpeg_dimensions_missing",
    message: "JPEG-Dimensionen konnten nicht sicher ermittelt werden.",
    failureMode: "POLICY_REJECTED",
  });
}

function detectedMimeType(bytes: Uint8Array): CreativeImageMimeType {
  if (hasPngSignature(bytes)) {
    return "image/png";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }

  throw new CreativeAssetProviderError({
    code: "unsupported_image_format",
    message: "Providerasset ist weder PNG noch JPEG.",
    failureMode: "POLICY_REJECTED",
  });
}

export function assertSecretFreeJson(
  value: unknown,
  path = "payload",
  depth = 0,
): void {
  if (depth > 20) {
    throw new CreativeAssetProviderError({
      code: "payload_too_deep",
      message: "Assetpayload überschreitet die erlaubte Verschachtelung.",
      failureMode: "POLICY_REJECTED",
    });
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertSecretFreeJson(item, `${path}[${index}]`, depth + 1),
    );
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (SECRET_KEYS.has(normalizedKey(key))) {
        throw new CreativeAssetProviderError({
          code: "secret_key_forbidden",
          message: `Geheimes Feld ist im Assetpayload nicht erlaubt: ${path}.${key}`,
          failureMode: "POLICY_REJECTED",
        });
      }
      assertSecretFreeJson(nested, `${path}.${key}`, depth + 1);
    }
  }
}

export function sanitizeAssetMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  assertSecretFreeJson(metadata, "metadata");
  const serialized = JSON.stringify(metadata);
  if (Buffer.byteLength(serialized, "utf8") > 32 * 1024) {
    throw new CreativeAssetProviderError({
      code: "metadata_too_large",
      message: "Providermetadaten überschreiten 32 KiB.",
      failureMode: "POLICY_REJECTED",
    });
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function inspectCreativeImage(input: {
  bytes: Uint8Array;
  declaredMimeType: CreativeImageMimeType;
}): InspectedCreativeImage {
  if (input.bytes.byteLength <= 0) {
    throw new CreativeAssetProviderError({
      code: "empty_image",
      message: "Provider lieferte ein leeres Asset.",
      failureMode: "POLICY_REJECTED",
    });
  }
  if (input.bytes.byteLength > MAX_CREATIVE_IMAGE_BYTES) {
    throw new CreativeAssetProviderError({
      code: "image_too_large",
      message: "Providerasset überschreitet 10 MiB.",
      failureMode: "POLICY_REJECTED",
    });
  }

  const mimeType = detectedMimeType(input.bytes);
  if (mimeType !== input.declaredMimeType) {
    throw new CreativeAssetProviderError({
      code: "mime_mismatch",
      message: "Deklarierter MIME-Typ stimmt nicht mit den Assetbytes überein.",
      failureMode: "POLICY_REJECTED",
    });
  }

  const dimensions = mimeType === "image/png"
    ? inspectPng(input.bytes)
    : inspectJpeg(input.bytes);

  if (
    dimensions.width < MIN_CREATIVE_IMAGE_DIMENSION ||
    dimensions.height < MIN_CREATIVE_IMAGE_DIMENSION ||
    dimensions.width > MAX_CREATIVE_IMAGE_DIMENSION ||
    dimensions.height > MAX_CREATIVE_IMAGE_DIMENSION
  ) {
    throw new CreativeAssetProviderError({
      code: "image_dimensions_out_of_range",
      message: "Providerasset liegt außerhalb der erlaubten 256–4096 Pixel.",
      failureMode: "POLICY_REJECTED",
    });
  }

  return {
    bytes: input.bytes,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    mimeType,
    byteSize: input.bytes.byteLength,
    width: dimensions.width,
    height: dimensions.height,
  };
}

export function safeCreativeFileName(input: {
  requestedName: string | null;
  jobId: string;
  mimeType: CreativeImageMimeType;
}): string {
  const extension = input.mimeType === "image/png" ? "png" : "jpg";
  const baseName = (input.requestedName ?? `creative-${input.jobId}`)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100)
    .replace(/\.(png|jpe?g)$/i, "");

  return `${baseName || `creative-${input.jobId}`}.${extension}`;
}
