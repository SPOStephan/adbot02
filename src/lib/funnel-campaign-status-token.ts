import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getFunnelSsoSecret } from "@/lib/funnel-sso";

const TOKEN_TTL_SECONDS = 5 * 60;
const PURPOSE = "funnel_campaign_status" as const;

type FunnelCampaignStatusTokenPayload = {
  v: 1;
  purpose: typeof PURPOSE;
  sub: string;
  nonce: string;
  iat: number;
  exp: number;
};

function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
}

function signature(value: string, secret: string): Buffer | null {
  return decodeBase64Url(createHmac("sha256", secret).update(value).digest("base64url"));
}

export function verifyFunnelCampaignStatusToken(
  token: string,
  now = Date.now(),
): FunnelCampaignStatusTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  const supplied = decodeBase64Url(encodedSignature);
  let expected: Buffer | null;
  try {
    expected = signature(encodedPayload, getFunnelSsoSecret());
  } catch {
    return null;
  }
  if (!supplied || !expected || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  const decoded = decodeBase64Url(encodedPayload);
  if (!decoded) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(decoded.toString("utf8"));
  } catch {
    return null;
  }
  const typed = payload as Partial<FunnelCampaignStatusTokenPayload>;
  if (
    typed.v !== 1 ||
    typed.purpose !== PURPOSE ||
    typeof typed.sub !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(typed.sub) ||
    typeof typed.nonce !== "string" ||
    typed.nonce.length < 16 ||
    typeof typed.iat !== "number" ||
    typeof typed.exp !== "number"
  ) {
    return null;
  }
  const nowSeconds = Math.floor(now / 1000);
  if (nowSeconds > typed.exp || typed.exp - typed.iat > TOKEN_TTL_SECONDS + 30) return null;
  return typed as FunnelCampaignStatusTokenPayload;
}
