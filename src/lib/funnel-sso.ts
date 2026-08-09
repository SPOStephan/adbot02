import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SSO_TTL_SECONDS = 5 * 60;
const PURPOSE = "funnel_admin_sso" as const;

export type FunnelSsoPayload = {
  v: 1;
  purpose: typeof PURPOSE;
  sub: string;
  email: string;
  name: string;
  nonce: string;
  iat: number;
  exp: number;
};

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

export function getFunnelSsoSecret(): string {
  const secret = process.env.FUNNEL_SSO_SECRET?.trim() ?? "";
  if (secret.length < 32) {
    throw new Error(
      "FUNNEL_SSO_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen). Muss in Adbot und Funnel identisch sein.",
    );
  }
  return secret;
}

export function createFunnelSsoToken(input: {
  userId: string;
  email: string;
  name?: string | null;
  now?: number;
}): string {
  const secret = getFunnelSsoSecret();
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: FunnelSsoPayload = {
    v: 1,
    purpose: PURPOSE,
    sub: input.userId,
    email: input.email.trim().toLowerCase(),
    name: (input.name ?? "").trim() || input.email.trim(),
    nonce: randomBytes(24).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + SSO_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = hmacBase64Url(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyFunnelSsoToken(
  token: string,
  secret: string,
  now = Date.now(),
): FunnelSsoPayload | null {
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
    (payload as FunnelSsoPayload).v !== 1 ||
    (payload as FunnelSsoPayload).purpose !== PURPOSE ||
    typeof (payload as FunnelSsoPayload).sub !== "string" ||
    typeof (payload as FunnelSsoPayload).email !== "string" ||
    typeof (payload as FunnelSsoPayload).nonce !== "string" ||
    typeof (payload as FunnelSsoPayload).iat !== "number" ||
    typeof (payload as FunnelSsoPayload).exp !== "number"
  ) {
    return null;
  }

  const typed = payload as FunnelSsoPayload;
  if (!/^[0-9a-f-]{36}$/i.test(typed.sub)) return null;
  if (!typed.email.includes("@")) return null;

  const nowSeconds = Math.floor(now / 1000);
  if (nowSeconds > typed.exp || typed.exp - typed.iat > SSO_TTL_SECONDS + 30) {
    return null;
  }

  return {
    ...typed,
    email: typed.email.trim().toLowerCase(),
    name:
      typeof typed.name === "string" && typed.name.trim()
        ? typed.name.trim()
        : typed.email.trim().toLowerCase(),
  };
}
