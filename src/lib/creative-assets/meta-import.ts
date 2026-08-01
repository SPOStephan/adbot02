import "server-only";

import { getCreativeAssetStorageBucket } from "./env";
import {
  inspectCreativeImage,
  MAX_CREATIVE_IMAGE_BYTES,
  safeCreativeFileName,
} from "./image";
import { storeCreativeAssetInSupabase } from "./storage";

const META_CDN_SUFFIXES = [
  ".fbcdn.net",
  ".fbsbx.com",
  ".cdninstagram.com",
] as const;

export class MetaCreativeImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MetaCreativeImportError";
    this.code = code;
  }
}

function importError(code: string, message: string): never {
  throw new MetaCreativeImportError(code, message);
}

function validatedMetaCdnUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    importError("invalid_meta_image_url", "Meta lieferte keine gültige Bild-URL.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !META_CDN_SUFFIXES.some(
      (suffix) => hostname.endsWith(suffix) && hostname.length > suffix.length,
    )
  ) {
    importError(
      "untrusted_meta_image_host",
      "Das Meta-Creative verweist nicht auf einen erlaubten Meta-CDN-Host.",
    );
  }
  return url;
}

function declaredMimeType(response: Response): "image/png" | "image/jpeg" {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "image/png" && contentType !== "image/jpeg") {
    importError(
      "unsupported_meta_image_mime",
      "Das Meta-Creative ist kein unterstütztes PNG- oder JPEG-Bild.",
    );
  }
  return contentType;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_CREATIVE_IMAGE_BYTES) {
      importError(
        "meta_image_size_invalid",
        "Das Meta-Creative überschreitet die sichere Dateigröße.",
      );
    }
  }

  if (!response.body) {
    importError("meta_image_empty", "Meta lieferte keine Bilddaten.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_CREATIVE_IMAGE_BYTES) {
      await reader.cancel();
      importError(
        "meta_image_too_large",
        "Das Meta-Creative überschreitet die sichere Dateigröße.",
      );
    }
    chunks.push(value);
  }

  if (length <= 0) {
    importError("meta_image_empty", "Meta lieferte keine Bilddaten.");
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export type ImportedMetaCreative = {
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  sha256: string;
  mimeType: "image/png" | "image/jpeg";
  byteSize: number;
  width: number;
  height: number;
};

export async function importMetaCreativeImage(input: {
  userId: string;
  platformAccountId: string;
  creativeId: string;
  imageUrl: string;
  signal?: AbortSignal;
}): Promise<ImportedMetaCreative> {
  const url = validatedMetaCdnUrl(input.imageUrl);
  const signal = input.signal ?? AbortSignal.timeout(25_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal,
      headers: {
        Accept: "image/png,image/jpeg",
        "User-Agent": "Adbot02-MetaCreativeImporter/1.0",
      },
    });
  } catch {
    importError(
      "meta_image_fetch_failed",
      "Das Bild des Meta-Creatives konnte nicht sicher geladen werden.",
    );
  }

  if (!response.ok || response.status >= 300) {
    importError(
      "meta_image_fetch_failed",
      "Das Bild des Meta-Creatives konnte nicht sicher geladen werden.",
    );
  }

  const mimeType = declaredMimeType(response);
  const bytes = await readBoundedBody(response);
  const image = inspectCreativeImage({ bytes, declaredMimeType: mimeType });
  const bucket = getCreativeAssetStorageBucket();
  const storage = await storeCreativeAssetInSupabase({
    userId: input.userId,
    platformAccountId: input.platformAccountId,
    bytes: image.bytes,
    sha256: image.sha256,
    mimeType: image.mimeType,
    bucket,
  });
  const originalFilename = safeCreativeFileName({
    requestedName: `meta-creative-${input.creativeId}`,
    jobId: input.creativeId,
    mimeType: image.mimeType,
  });

  return {
    storageBucket: storage.bucket,
    storagePath: storage.path,
    originalFilename,
    sha256: image.sha256,
    mimeType: image.mimeType,
    byteSize: image.byteSize,
    width: image.width,
    height: image.height,
  };
}
