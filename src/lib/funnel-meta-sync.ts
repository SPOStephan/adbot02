import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { getFunnelSsoSecret } from "@/lib/funnel-sso";
import { createFunnelUrl } from "@/lib/site-urls";

const SYNC_TTL_SECONDS = 5 * 60;
const PURPOSE = "funnel_meta_pixel_sync" as const;

export type FunnelMetaPixelSyncPayload = {
  v: 1;
  purpose: typeof PURPOSE;
  sub: string;
  pixelId: string;
  eventName: string;
  nonce: string;
  iat: number;
  exp: number;
};

function encodeBase64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function hmacBase64Url(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/** Map portal Ads custom_event_type (LEAD) → Funnel Pixel/CAPI event (Lead). */
export function mapPortalCustomEventToFunnelEventName(
  customEventType: string | null | undefined,
): string {
  const raw = (customEventType ?? "").trim();
  if (!raw) return "Lead";
  if (raw.toUpperCase() === "LEAD") return "Lead";
  if (/^[A-Z][A-Z0-9_]*$/.test(raw)) {
    return raw.charAt(0) + raw.slice(1).toLowerCase();
  }
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) return raw;
  return "Lead";
}

export function createFunnelMetaPixelSyncToken(input: {
  userId: string;
  pixelId: string;
  eventName?: string;
  now?: number;
}): string {
  const secret = getFunnelSsoSecret();
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: FunnelMetaPixelSyncPayload = {
    v: 1,
    purpose: PURPOSE,
    sub: input.userId,
    pixelId: input.pixelId.trim(),
    eventName: mapPortalCustomEventToFunnelEventName(input.eventName),
    nonce: randomBytes(24).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + SYNC_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = hmacBase64Url(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export type FunnelMetaPixelSyncResponse = {
  ok: boolean;
  message?: string;
  funnels?: Array<{
    funnelId: string;
    slug: string;
    action: "set_and_enable" | "ensure_enabled" | "skip";
  }>;
};

/**
 * Best-effort soft-apply of a confirmed pixel into the customer's Funnel workspaces.
 * Never throws — pixel confirm in Adbot must succeed even if Funnel is unreachable.
 */
export async function pushSoftMetaPixelToFunnel(input: {
  userId: string;
  pixelId: string;
  customEventType?: string | null;
}): Promise<FunnelMetaPixelSyncResponse | null> {
  if (!/^\d{5,25}$/.test(input.pixelId.trim())) return null;

  let token: string;
  try {
    token = createFunnelMetaPixelSyncToken({
      userId: input.userId,
      pixelId: input.pixelId,
      eventName: input.customEventType ?? "LEAD",
    });
  } catch (error) {
    console.warn(
      "[funnel-meta-sync] Token nicht erzeugbar (FUNNEL_SSO_SECRET?)",
      error,
    );
    return null;
  }

  const url = createFunnelUrl("/api/internal/portal-meta-sync");
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ token }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await response.json().catch(() => ({}))) as FunnelMetaPixelSyncResponse;
    if (!response.ok || !body.ok) {
      console.warn("[funnel-meta-sync] Soft-Apply abgelehnt", {
        status: response.status,
        message: body.message,
      });
      return body;
    }
    return body;
  } catch (error) {
    console.warn("[funnel-meta-sync] Soft-Apply Netzwerkfehler", error);
    return null;
  }
}
