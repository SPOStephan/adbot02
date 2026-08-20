import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getFreebieSsoSecret } from "@/lib/freebie-sso";
import { getFunnelSsoSecret } from "@/lib/funnel-sso";

const SYNC_TTL_SECONDS = 5 * 60;
export const TOOL_DOMAIN_SYNC_PURPOSE = "adbot_tool_domain_sync" as const;

export type ToolDomainSyncTool = "funnel" | "freebie";
export type ToolDomainSyncAction = "upsert" | "revoke" | "list";

export type ToolDomainSyncPayload = {
  v: 1;
  purpose: typeof TOOL_DOMAIN_SYNC_PURPOSE;
  sub: string;
  tool: ToolDomainSyncTool;
  action: ToolDomainSyncAction;
  hostname?: string;
  status?: "PENDING_DNS" | "READY";
  dnsTarget?: string;
  bindingRef?: string | null;
  bindingLabel?: string;
  toolDomainId?: string | null;
  nonce: string;
  iat: number;
  exp: number;
};

const consumedNonces = new Map<string, number>();

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

function pruneNonces(nowSeconds: number) {
  for (const [nonce, exp] of consumedNonces) {
    if (exp <= nowSeconds) consumedNonces.delete(nonce);
  }
}

function secretForTool(tool: ToolDomainSyncTool): string {
  return tool === "funnel" ? getFunnelSsoSecret() : getFreebieSsoSecret();
}

export function verifyToolDomainSyncToken(
  token: string,
  expectedTool: ToolDomainSyncTool | null = null,
  now = Date.now(),
): ToolDomainSyncPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSignature] = parts;
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
    (payload as ToolDomainSyncPayload).v !== 1 ||
    (payload as ToolDomainSyncPayload).purpose !== TOOL_DOMAIN_SYNC_PURPOSE ||
    typeof (payload as ToolDomainSyncPayload).sub !== "string" ||
    typeof (payload as ToolDomainSyncPayload).tool !== "string" ||
    typeof (payload as ToolDomainSyncPayload).action !== "string" ||
    typeof (payload as ToolDomainSyncPayload).nonce !== "string" ||
    typeof (payload as ToolDomainSyncPayload).iat !== "number" ||
    typeof (payload as ToolDomainSyncPayload).exp !== "number"
  ) {
    return null;
  }

  const typed = payload as ToolDomainSyncPayload;
  if (typed.tool !== "funnel" && typed.tool !== "freebie") return null;
  if (
    typed.action !== "upsert" &&
    typed.action !== "revoke" &&
    typed.action !== "list"
  ) {
    return null;
  }
  if (expectedTool && typed.tool !== expectedTool) return null;
  if (!/^[0-9a-f-]{36}$/i.test(typed.sub)) return null;

  let secret: string;
  try {
    secret = secretForTool(typed.tool);
  } catch {
    return null;
  }

  const suppliedSignature = decodeBase64Url(encodedSignature);
  const expectedSignature = decodeBase64Url(
    hmacBase64Url(encodedPayload, secret),
  );
  if (
    !suppliedSignature ||
    !expectedSignature ||
    !equalBuffers(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  const nowSeconds = Math.floor(now / 1000);
  if (nowSeconds > typed.exp || typed.exp - typed.iat > SYNC_TTL_SECONDS + 30) {
    return null;
  }

  pruneNonces(nowSeconds);
  if (consumedNonces.has(typed.nonce)) return null;
  consumedNonces.set(typed.nonce, typed.exp);

  return typed;
}
