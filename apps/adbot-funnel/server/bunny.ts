import { randomUUID } from "node:crypto";
import { ENV } from "./_core/env";

export type BunnyUploadInput = {
  ownerUserId: string | null;
  filename: string;
  contentType: string;
  data: Buffer;
  folder?: string;
};

export type BunnyUploadResult = {
  bunnyPath: string;
  url: string;
  byteSize: number;
  storedOn: "bunny" | "supabase-fallback" | "memory";
};

function storageHost() {
  const region = ENV.bunnyStorageRegion.toLowerCase();
  if (!region || region === "de") return "storage.bunnycdn.com";
  return `${region}.storage.bunnycdn.com`;
}

export function sanitizeStorageFilename(filename: string) {
  return filename
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160) || "image.webp";
}

export function isBunnyConfigured() {
  return Boolean(ENV.bunnyStorageZone && ENV.bunnyStorageApiKey);
}

export function buildCdnUrl(bunnyPath: string): string | null {
  if (!ENV.bunnyCdnHostname) return null;
  const host = ENV.bunnyCdnHostname.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/${bunnyPath.replace(/^\/+/, "")}`;
}

export function buildFunnelBunnyPath(ownerUserId: string | null, filename: string, folder = "backgrounds") {
  const ownerSegment = ownerUserId || "platform";
  return `funnels/${ownerSegment}/${folder}/${randomUUID()}-${sanitizeStorageFilename(filename)}`;
}

export async function uploadFunnelBytesToBunny(input: BunnyUploadInput): Promise<BunnyUploadResult> {
  const bunnyPath = buildFunnelBunnyPath(input.ownerUserId, input.filename, input.folder);
  if (!isBunnyConfigured()) {
    return {
      bunnyPath,
      url: buildCdnUrl(bunnyPath) ?? `/api/storage/${bunnyPath}`,
      byteSize: input.data.byteLength,
      storedOn: "memory",
    };
  }

  const url = `https://${storageHost()}/${ENV.bunnyStorageZone}/${bunnyPath}`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      AccessKey: ENV.bunnyStorageApiKey,
      "Content-Type": input.contentType || "application/octet-stream",
    },
    body: new Uint8Array(input.data),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Bunny-Upload fehlgeschlagen (${response.status}): ${body.slice(0, 200)}`);
  }
  return {
    bunnyPath,
    url: buildCdnUrl(bunnyPath) ?? url,
    byteSize: input.data.byteLength,
    storedOn: "bunny",
  };
}
