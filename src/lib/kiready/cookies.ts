import "server-only";

import type { NextResponse } from "next/server";

import { signKireadyPayload, verifyKireadySignature } from "@/lib/kiready/crypto";
import type { PendingKireadyLink } from "@/lib/kiready/types";

export const KIREADY_COOKIE = {
  state: "kiready_oidc_state",
  nonce: "kiready_oidc_nonce",
  verifier: "kiready_oidc_verifier",
  next: "kiready_oidc_next",
  pending: "kiready_pending_link",
} as const;

const COOKIE_MAX_AGE = 10 * 60;

function cookieBase(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/auth/kiready",
    maxAge: COOKIE_MAX_AGE,
  };
}

export function setOidcFlowCookies(
  response: NextResponse,
  input: { state: string; nonce: string; verifier: string; next: string; secure: boolean },
) {
  const base = cookieBase(input.secure);
  response.cookies.set(KIREADY_COOKIE.state, input.state, base);
  response.cookies.set(KIREADY_COOKIE.nonce, input.nonce, base);
  response.cookies.set(KIREADY_COOKIE.verifier, input.verifier, base);
  response.cookies.set(KIREADY_COOKIE.next, input.next, base);
}

export function clearOidcFlowCookies(response: NextResponse, secure: boolean) {
  const base = { ...cookieBase(secure), maxAge: 0 };
  for (const name of Object.values(KIREADY_COOKIE)) {
    response.cookies.set(name, "", base);
  }
}

export function encodePendingLink(pending: PendingKireadyLink, secret: string): string {
  const payload = Buffer.from(JSON.stringify(pending)).toString("base64url");
  return `${payload}.${signKireadyPayload(payload, secret)}`;
}

export function decodePendingLink(
  value: string | undefined,
  secret: string,
): PendingKireadyLink | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || !verifyKireadySignature(payload, signature, secret)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PendingKireadyLink;
    if (parsed.v !== 1 || typeof parsed.existingUserId !== "string") return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPendingLinkCookie(
  response: NextResponse,
  pending: PendingKireadyLink,
  secret: string,
  secure: boolean,
) {
  response.cookies.set(KIREADY_COOKIE.pending, encodePendingLink(pending, secret), cookieBase(secure));
}
