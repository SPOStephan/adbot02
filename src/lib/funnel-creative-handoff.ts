import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getFunnelSsoSecret } from "@/lib/funnel-sso";

const PURPOSE = "adbot_funnel_creative_handoff" as const;
const TTL_SECONDS = 5 * 60;

export type FunnelCreativeHandoffPayload = {
  v: 1;
  purpose: typeof PURPOSE;
  sub: string;
  funnelId: string;
  destinationUrl: string;
  title: string;
  slug: string;
  tags: string[];
  jobTitle: string;
  jobDescription: string;
  iat: number;
  exp: number;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function hmacBase64Url(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function verifyFunnelCreativeHandoffToken(
  token: string,
  now = Date.now(),
): FunnelCreativeHandoffPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;
  let secret: string;
  try {
    secret = getFunnelSsoSecret();
  } catch {
    return null;
  }
  const expected = hmacBase64Url(encoded, secret);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as FunnelCreativeHandoffPayload;
    if (
      payload?.v !== 1 ||
      payload.purpose !== PURPOSE ||
      typeof payload.sub !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(payload.sub) ||
      typeof payload.funnelId !== "string" ||
      typeof payload.destinationUrl !== "string" ||
      payload.exp * 1000 < now
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createFunnelCreativeHandoffToken(input: {
  userId: string;
  funnelId: string;
  destinationUrl: string;
  title: string;
  slug: string;
  tags?: string[];
  jobTitle?: string;
  jobDescription?: string;
  now?: number;
}): string {
  const secret = getFunnelSsoSecret();
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: FunnelCreativeHandoffPayload = {
    v: 1,
    purpose: PURPOSE,
    sub: input.userId,
    funnelId: input.funnelId,
    destinationUrl: input.destinationUrl,
    title: input.title.slice(0, 160),
    slug: input.slug.slice(0, 120),
    tags: (input.tags ?? ["jobs"]).slice(0, 8),
    jobTitle: (input.jobTitle ?? "").slice(0, 80),
    jobDescription: (input.jobDescription ?? "").slice(0, 280),
    iat: issuedAt,
    exp: issuedAt + TTL_SECONDS,
  };
  const encoded = encodeBase64Url(JSON.stringify(payload));
  return `${encoded}.${hmacBase64Url(encoded, secret)}`;
}
