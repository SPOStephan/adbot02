import { createHmac, randomBytes } from "node:crypto";

import { ENV } from "./_core/env";

const SYNC_TTL_SECONDS = 5 * 60;
const PURPOSE = "adbot_tool_domain_sync" as const;
const TOOL = "freebie" as const;

type SyncAction = "upsert" | "revoke" | "list";

export type PortalDomainListItem = {
  id: string;
  hostname: string;
  label: string;
  status: "PENDING_DNS" | "READY";
  dnsTarget: string;
  origin: "portal" | "funnel" | "freebie";
  bindingKind: "none" | "funnel" | "freebie";
  bindingRef: string | null;
  bindingLabel: string;
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

function createToken(input: {
  userId: string;
  action: SyncAction;
  hostname?: string;
  status?: "PENDING_DNS" | "READY";
  dnsTarget?: string;
  bindingRef?: string | null;
  bindingLabel?: string;
  toolDomainId?: string | null;
}): string | null {
  const secret = ENV.freebieSsoSecret;
  if (!secret || secret.length < 32) return null;
  if (!isPortalUserId(input.userId)) return null;

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1 as const,
    purpose: PURPOSE,
    sub: input.userId,
    tool: TOOL,
    action: input.action,
    hostname: input.hostname,
    status: input.status,
    dnsTarget: input.dnsTarget,
    bindingRef: input.bindingRef,
    bindingLabel: input.bindingLabel,
    toolDomainId: input.toolDomainId,
    nonce: randomBytes(24).toString("base64url"),
    iat: issuedAt,
    exp: issuedAt + SYNC_TTL_SECONDS,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = hmacBase64Url(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function postPortal(token: string): Promise<Record<string, unknown> | null> {
  const url = `${portalBaseUrl()}/api/internal/tool-domains`;
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
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok || body.ok !== true) {
      console.warn("[portal-domain-sync] Freebie sync abgelehnt", {
        status: response.status,
        message: body.message,
      });
      return body;
    }
    return body;
  } catch (error) {
    console.warn("[portal-domain-sync] Freebie sync unreachable", error);
    return null;
  }
}

/** Best-effort: never throws into Freebie request flow. */
export async function pushFreebieDomainUpsertToPortal(input: {
  ownerUserId: string | null;
  hostname: string;
  status: "PENDING_DNS" | "READY";
  dnsTarget: string;
  offerId: string;
  offerTitle?: string;
  toolDomainId: string;
}): Promise<void> {
  const token = createToken({
    userId: input.ownerUserId ?? "",
    action: "upsert",
    hostname: input.hostname,
    status: input.status,
    dnsTarget: input.dnsTarget,
    bindingRef: input.offerId,
    bindingLabel: input.offerTitle ?? "",
    toolDomainId: input.toolDomainId,
  });
  if (!token) return;
  await postPortal(token);
}

export async function pushFreebieDomainRevokeToPortal(input: {
  ownerUserId: string | null;
  hostname: string;
  toolDomainId: string;
}): Promise<void> {
  const token = createToken({
    userId: input.ownerUserId ?? "",
    action: "revoke",
    hostname: input.hostname,
    toolDomainId: input.toolDomainId,
  });
  if (!token) return;
  await postPortal(token);
}

export async function listPortalDomainsForFreebie(input: {
  ownerUserId: string | null;
}): Promise<PortalDomainListItem[]> {
  const token = createToken({
    userId: input.ownerUserId ?? "",
    action: "list",
  });
  if (!token) return [];
  const body = await postPortal(token);
  if (!body || !Array.isArray(body.domains)) return [];
  return body.domains as PortalDomainListItem[];
}
