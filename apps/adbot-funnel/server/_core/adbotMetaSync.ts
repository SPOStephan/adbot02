import { createHmac, timingSafeEqual } from "node:crypto";

const SYNC_TTL_SECONDS = 5 * 60;
export const FUNNEL_META_PIXEL_SYNC_PURPOSE = "funnel_meta_pixel_sync" as const;

export type FunnelMetaPixelSyncPayload = {
  v: 1;
  purpose: typeof FUNNEL_META_PIXEL_SYNC_PURPOSE;
  sub: string;
  pixelId: string;
  eventName: string;
  nonce: string;
  iat: number;
  exp: number;
};

const consumedNonces = new Map<string, number>();

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function hmacBase64Url(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function equalBuffers(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function pruneNonces(nowSeconds: number) {
  for (const [nonce, exp] of consumedNonces) {
    if (exp <= nowSeconds) consumedNonces.delete(nonce);
  }
}

export function verifyFunnelMetaPixelSyncToken(
  token: string,
  secret: string,
  now = Date.now(),
): FunnelMetaPixelSyncPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSignature] = parts;
  const suppliedSignature = decodeBase64Url(encodedSignature);
  const expectedSignature = decodeBase64Url(hmacBase64Url(encodedPayload, secret));
  if (
    !suppliedSignature ||
    !expectedSignature ||
    !equalBuffers(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  const decodedPayload = decodeBase64Url(encodedPayload);
  if (!decodedPayload) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decodedPayload.toString("utf8"));
  } catch {
    return null;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as FunnelMetaPixelSyncPayload).v !== 1 ||
    (payload as FunnelMetaPixelSyncPayload).purpose !== FUNNEL_META_PIXEL_SYNC_PURPOSE ||
    typeof (payload as FunnelMetaPixelSyncPayload).sub !== "string" ||
    typeof (payload as FunnelMetaPixelSyncPayload).pixelId !== "string" ||
    typeof (payload as FunnelMetaPixelSyncPayload).eventName !== "string" ||
    typeof (payload as FunnelMetaPixelSyncPayload).nonce !== "string" ||
    typeof (payload as FunnelMetaPixelSyncPayload).iat !== "number" ||
    typeof (payload as FunnelMetaPixelSyncPayload).exp !== "number"
  ) {
    return null;
  }

  const typed = payload as FunnelMetaPixelSyncPayload;
  if (!/^[0-9a-f-]{36}$/i.test(typed.sub)) return null;
  if (!/^\d{5,25}$/.test(typed.pixelId)) return null;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(typed.eventName) || typed.eventName.length > 64) {
    return null;
  }

  const nowSeconds = Math.floor(now / 1000);
  if (nowSeconds > typed.exp || typed.exp - typed.iat > SYNC_TTL_SECONDS + 30) {
    return null;
  }

  pruneNonces(nowSeconds);
  if (consumedNonces.has(typed.nonce)) return null;
  consumedNonces.set(typed.nonce, typed.exp);

  return typed;
}
