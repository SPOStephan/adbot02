import { createHmac, randomBytes } from "node:crypto";

import { ENV } from "./_core/env";

const TOKEN_TTL_SECONDS = 5 * 60;
const PURPOSE = "funnel_campaign_status" as const;

export type PortalFunnelCampaignStatus = {
  leadActive: boolean;
  leadSubmitted: boolean;
  trafficActive: boolean;
  trafficSubmitted: boolean;
  updatedAt: string | null;
};

function portalBaseUrl(): string {
  return (
    process.env.ADBOT_PORTAL_URL?.trim() ||
    process.env.PUBLIC_PORTAL_URL?.trim() ||
    "https://app.adbot.one"
  ).replace(/\/+$/, "");
}

export function createPortalCampaignStatusToken(input: {
  ownerUserId: string;
  now?: number;
}): string | null {
  const secret = ENV.funnelSsoSecret;
  if (secret.length < 32 || !/^[0-9a-f-]{36}$/i.test(input.ownerUserId)) return null;
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const payload = {
    v: 1 as const,
    purpose: PURPOSE,
    sub: input.ownerUserId,
    nonce: randomBytes(24).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export async function loadPortalCampaignStatuses(input: {
  ownerUserId: string;
  destinationUrls: string[];
  fetchImpl?: typeof fetch;
}): Promise<Record<string, PortalFunnelCampaignStatus>> {
  const destinationUrls = Array.from(new Set(input.destinationUrls)).slice(0, 100);
  if (destinationUrls.length === 0) return {};
  const token = createPortalCampaignStatusToken({ ownerUserId: input.ownerUserId });
  if (!token) return {};

  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${portalBaseUrl()}/api/internal/funnel-campaign-status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token, destinationUrls }),
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      statuses?: Record<string, PortalFunnelCampaignStatus>;
    };
    return response.ok && body.ok === true && body.statuses ? body.statuses : {};
  } catch {
    return {};
  }
}
