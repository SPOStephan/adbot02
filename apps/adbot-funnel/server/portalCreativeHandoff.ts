import { createHmac, randomBytes } from "node:crypto";

import { ENV } from "./_core/env";

const PURPOSE = "adbot_funnel_creative_handoff" as const;
const TTL_SECONDS = 5 * 60;

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function hmacBase64Url(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function portalBaseUrl(): string {
  return (
    process.env.ADBOT_PORTAL_URL?.trim() ||
    process.env.PUBLIC_PORTAL_URL?.trim() ||
    "https://app.adbot.one"
  ).replace(/\/+$/, "");
}

function isPortalUserId(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}

function createToken(input: {
  userId: string;
  funnelId: string;
  destinationUrl: string;
  title: string;
  slug: string;
  tags: string[];
  jobTitle: string;
  jobDescription: string;
}): string | null {
  const secret = ENV.funnelSsoSecret;
  if (!secret || secret.length < 32) return null;
  if (!isPortalUserId(input.userId)) return null;
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1 as const,
    purpose: PURPOSE,
    sub: input.userId,
    funnelId: input.funnelId,
    destinationUrl: input.destinationUrl,
    title: input.title.slice(0, 160),
    slug: input.slug.slice(0, 120),
    tags: input.tags.slice(0, 8),
    jobTitle: input.jobTitle.slice(0, 80),
    jobDescription: input.jobDescription.slice(0, 280),
    nonce: randomBytes(16).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + TTL_SECONDS,
  };
  const encoded = encodeBase64Url(JSON.stringify(payload));
  return `${encoded}.${hmacBase64Url(encoded, secret)}`;
}

export function publicFunnelDestinationUrl(input: {
  slug: string;
  readyHostname?: string | null;
}): string {
  if (input.readyHostname) return `https://${input.readyHostname.replace(/\/+$/, "")}/`;
  const shared = (
    process.env.PUBLIC_FUNNEL_URL?.trim() ||
    process.env.FUNNEL_SITE_URL?.trim() ||
    "https://funnel.adbot.one"
  ).replace(/\/+$/, "");
  return `${shared}/f/${input.slug}`;
}

/** Best-effort: never throws into Funnel publish. */
export async function pushFunnelCreativeHandoffToPortal(input: {
  ownerUserId: string | null;
  funnelId: string;
  slug: string;
  title: string;
  readyHostname?: string | null;
  jobTitle?: string;
  jobDescription?: string;
}): Promise<void> {
  const destinationUrl = publicFunnelDestinationUrl({
    slug: input.slug,
    readyHostname: input.readyHostname,
  });
  const token = createToken({
    userId: input.ownerUserId ?? "",
    funnelId: input.funnelId,
    destinationUrl,
    title: input.title,
    slug: input.slug,
    tags: ["jobs"],
    jobTitle: input.jobTitle ?? input.title,
    jobDescription: input.jobDescription ?? "",
  });
  if (!token) return;
  try {
    const response = await fetch(`${portalBaseUrl()}/api/internal/funnel-creatives`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.warn("[portal-creative-handoff] abgelehnt", response.status);
    }
  } catch (error) {
    console.warn("[portal-creative-handoff] unreachable", error);
  }
}
