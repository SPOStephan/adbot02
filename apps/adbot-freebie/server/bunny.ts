import { randomUUID } from "node:crypto";
import { ENV } from "./_core/env";

export type BunnyUploadInput = {
  ownerUserId: string | null;
  filename: string;
  contentType: string;
  dataBase64: string;
};

export type BunnyUploadResult = {
  bunnyPath: string;
  cdnUrl: string | null;
  byteSize: number;
};

function storageHost() {
  const region = ENV.bunnyStorageRegion.toLowerCase();
  if (!region || region === "de") {
    return "storage.bunnycdn.com";
  }
  return `${region}.storage.bunnycdn.com`;
}

function sanitizeFilename(filename: string) {
  return filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160) || "freebie.bin";
}

export function isBunnyConfigured() {
  return Boolean(ENV.bunnyStorageZone && ENV.bunnyStorageApiKey);
}

export function buildCdnUrl(bunnyPath: string): string | null {
  if (!ENV.bunnyCdnHostname) return null;
  const host = ENV.bunnyCdnHostname.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/${bunnyPath.replace(/^\/+/, "")}`;
}

/**
 * Uploads bytes to Bunny Storage.
 * Without credentials, stores metadata paths only (dev fallback) and returns a synthetic path.
 */
export async function uploadToBunny(input: BunnyUploadInput): Promise<BunnyUploadResult> {
  const buffer = Buffer.from(input.dataBase64, "base64");
  const ownerSegment = input.ownerUserId ?? "platform";
  const bunnyPath = `freebies/${ownerSegment}/${randomUUID()}-${sanitizeFilename(input.filename)}`;

  if (!isBunnyConfigured()) {
    console.warn("[bunny] Credentials fehlen — Upload nur als Platzhalter-Pfad gespeichert");
    return {
      bunnyPath,
      cdnUrl: buildCdnUrl(bunnyPath),
      byteSize: buffer.byteLength,
    };
  }

  const url = `https://${storageHost()}/${ENV.bunnyStorageZone}/${bunnyPath}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: ENV.bunnyStorageApiKey,
      "Content-Type": input.contentType || "application/octet-stream",
    },
    body: buffer,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Bunny-Upload fehlgeschlagen (${response.status}): ${body.slice(0, 200)}`,
    );
  }

  return {
    bunnyPath,
    cdnUrl: buildCdnUrl(bunnyPath),
    byteSize: buffer.byteLength,
  };
}
