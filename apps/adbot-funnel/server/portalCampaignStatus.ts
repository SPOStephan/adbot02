import { createHmac, randomBytes } from "node:crypto";

import type {
  PortalFunnelCampaign,
  PortalFunnelCampaignOverview,
} from "@shared/portalCampaigns";

import { ENV } from "./_core/env";

const TOKEN_TTL_SECONDS = 5 * 60;
const PURPOSE = "funnel_campaign_status" as const;
const OVERVIEW_PURPOSE = "funnel_campaign_overview" as const;

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
  purpose?: typeof PURPOSE | typeof OVERVIEW_PURPOSE;
}): string | null {
  const secret = ENV.funnelSsoSecret;
  if (secret.length < 32 || !/^[0-9a-f-]{36}$/i.test(input.ownerUserId)) return null;
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const payload = {
    v: 1 as const,
    purpose: input.purpose ?? PURPOSE,
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

/**
 * Lead and traffic campaigns that promote one of the given funnel URLs, with
 * their ad cards. Adbot filters server-side; other campaign types never leave
 * the portal.
 */
export async function loadPortalCampaignOverview(input: {
  ownerUserId: string;
  funnelUrls: string[];
  fetchImpl?: typeof fetch;
}): Promise<PortalFunnelCampaignOverview> {
  const funnelUrls = Array.from(new Set(input.funnelUrls)).slice(0, 100);
  const empty: PortalFunnelCampaignOverview = { available: true, advertiserName: null, campaigns: [] };
  if (funnelUrls.length === 0) return empty;
  const token = createPortalCampaignStatusToken({
    ownerUserId: input.ownerUserId,
    purpose: OVERVIEW_PURPOSE,
  });
  if (!token) return { ...empty, available: false };

  try {
    const response = await (input.fetchImpl ?? fetch)(
      `${portalBaseUrl()}/api/internal/funnel-campaign-overview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token, funnelUrls }),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      advertiserName?: unknown;
      campaigns?: unknown;
    };
    if (!response.ok || body.ok !== true || !Array.isArray(body.campaigns)) {
      return { ...empty, available: false };
    }
    const campaigns = (body.campaigns as PortalFunnelCampaign[]).filter(
      campaign => campaign && (campaign.kind === "lead" || campaign.kind === "traffic"),
    );
    return {
      available: true,
      advertiserName: typeof body.advertiserName === "string" ? body.advertiserName : null,
      campaigns,
    };
  } catch {
    return { ...empty, available: false };
  }
}
