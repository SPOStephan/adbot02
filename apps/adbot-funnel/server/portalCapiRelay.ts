import { createHmac, randomBytes } from "node:crypto";

import { ENV } from "./_core/env";

const SYNC_TTL_SECONDS = 5 * 60;
const PURPOSE = "funnel_meta_capi_relay" as const;

export type PortalCapiRelayResult = {
  status: "sent" | "skipped" | "failed";
  reason?: string;
  eventsReceived?: number;
  attempts?: number;
};

function encodeBase64Url(value: string | Buffer): string {
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

export function createFunnelCapiRelayToken(input: {
  ownerUserId: string;
  pixelId: string;
  eventName: string;
  eventId: string;
  now?: number;
}): string | null {
  const secret = ENV.funnelSsoSecret;
  if (!secret || secret.length < 32) return null;
  if (!isPortalUserId(input.ownerUserId)) return null;
  if (!/^\d{5,25}$/.test(input.pixelId)) return null;

  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const payload = {
    v: 1 as const,
    purpose: PURPOSE,
    sub: input.ownerUserId,
    pixelId: input.pixelId,
    eventName: input.eventName,
    eventId: input.eventId,
    nonce: randomBytes(24).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + SYNC_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = hmacBase64Url(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function sendViaPortalCapi(input: {
  ownerUserId: string;
  pixelId: string;
  event: Record<string, unknown>;
  testEventCode?: string;
  fetchImpl?: typeof fetch;
}): Promise<PortalCapiRelayResult> {
  const eventName =
    typeof input.event.event_name === "string" ? input.event.event_name : "";
  const eventId =
    typeof input.event.event_id === "string" ? input.event.event_id : "";
  const token = createFunnelCapiRelayToken({
    ownerUserId: input.ownerUserId,
    pixelId: input.pixelId,
    eventName,
    eventId,
  });
  if (!token) {
    return {
      status: "failed",
      reason: "portal_capi_unconfigured",
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${portalBaseUrl()}/api/internal/funnel-capi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        token,
        event: input.event,
        ...(input.testEventCode ? { testEventCode: input.testEventCode } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      message?: string;
      reason?: string;
      eventsReceived?: number;
      attempts?: number;
    };
    if (response.ok && body.ok === true) {
      return {
        status: "sent",
        eventsReceived:
          typeof body.eventsReceived === "number" ? body.eventsReceived : 1,
        attempts: typeof body.attempts === "number" ? body.attempts : 1,
      };
    }
    return {
      status: "failed",
      reason:
        typeof body.reason === "string"
          ? body.reason
          : typeof body.message === "string"
            ? body.message
            : "connection_capi_denied",
      eventsReceived: body.eventsReceived,
      attempts: body.attempts,
    };
  } catch {
    return {
      status: "failed",
      reason: "portal_capi_unreachable",
    };
  }
}
