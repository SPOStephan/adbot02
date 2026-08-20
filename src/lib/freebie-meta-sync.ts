import "server-only";

import { createHmac, randomBytes } from "node:crypto";

import { getFreebieSsoSecret } from "@/lib/freebie-sso";
import { createFreebieUrl } from "@/lib/site-urls";

const SYNC_TTL_SECONDS = 5 * 60;
const PURPOSE = "freebie_meta_pixel_sync" as const;

export type FreebieMetaPixelSyncPayload = {
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

function mapEventName(customEventType: string | null | undefined): string {
  const raw = (customEventType ?? "").trim();
  if (!raw) return "Lead";
  if (raw.toUpperCase() === "LEAD") return "Lead";
  if (/^[A-Z][A-Z0-9_]*$/.test(raw)) {
    return raw.charAt(0) + raw.slice(1).toLowerCase();
  }
  if (/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) return raw;
  return "Lead";
}

export function createFreebieMetaPixelSyncToken(input: {
  userId: string;
  pixelId: string;
  eventName?: string;
  now?: number;
}): string {
  const secret = getFreebieSsoSecret();
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: FreebieMetaPixelSyncPayload = {
    v: 1,
    purpose: PURPOSE,
    sub: input.userId,
    pixelId: input.pixelId.trim(),
    eventName: mapEventName(input.eventName),
    nonce: randomBytes(24).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + SYNC_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = hmacBase64Url(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export type FreebieMetaPixelSyncResponse = {
  ok: boolean;
  message?: string;
  offers?: Array<{
    offerId: string;
    slug: string;
    action: "set_and_enable" | "ensure_enabled" | "skip";
  }>;
};

/**
 * Best-effort soft-apply of a confirmed pixel into Freebie offers.
 * Never throws — Adbot pixel confirm must succeed even if Freebie is unreachable.
 */
export async function pushSoftMetaPixelToFreebie(input: {
  userId: string;
  pixelId: string;
  customEventType?: string | null;
}): Promise<FreebieMetaPixelSyncResponse | null> {
  if (!/^\d{5,25}$/.test(input.pixelId.trim())) return null;

  let token: string;
  try {
    token = createFreebieMetaPixelSyncToken({
      userId: input.userId,
      pixelId: input.pixelId,
      eventName: input.customEventType ?? "LEAD",
    });
  } catch (error) {
    console.warn(
      "[freebie-meta-sync] Token nicht erzeugbar (FREEBIE_SSO_SECRET?)",
      error,
    );
    return null;
  }

  const url = createFreebieUrl("/api/internal/portal-meta-sync");
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
    const body = (await response.json().catch(() => ({}))) as FreebieMetaPixelSyncResponse;
    if (!response.ok || !body.ok) {
      console.warn("[freebie-meta-sync] Soft-Apply abgelehnt", {
        status: response.status,
        message: body.message,
      });
      return body;
    }
    return body;
  } catch (error) {
    console.warn("[freebie-meta-sync] Soft-Apply Netzwerkfehler", error);
    return null;
  }
}
