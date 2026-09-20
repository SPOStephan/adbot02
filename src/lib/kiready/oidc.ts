import "server-only";

import { createHash } from "node:crypto";

import { createRemoteJWKSet, jwtVerify } from "jose";

import type { KireadyOidcEnv } from "@/lib/kiready/env";
import type { KireadyOidcClaims } from "@/lib/kiready/types";
import { randomOidcValue } from "@/lib/kiready/crypto";

type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

let discoveryCache: { issuer: string; document: OidcDiscovery; fetchedAt: number } | null =
  null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createPkcePair() {
  const verifier = randomOidcValue() + randomOidcValue();
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function loadKireadyDiscovery(issuer: string): Promise<OidcDiscovery> {
  const now = Date.now();
  if (
    discoveryCache &&
    discoveryCache.issuer === issuer &&
    now - discoveryCache.fetchedAt < 10 * 60 * 1000
  ) {
    return discoveryCache.document;
  }

  const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("KIready-OIDC-Discovery nicht erreichbar.");
  }
  const raw = (await response.json()) as unknown;
  if (
    !isRecord(raw) ||
    typeof raw.issuer !== "string" ||
    typeof raw.authorization_endpoint !== "string" ||
    typeof raw.token_endpoint !== "string" ||
    typeof raw.jwks_uri !== "string"
  ) {
    throw new Error("KIready-OIDC-Discovery ist unvollständig.");
  }
  const document: OidcDiscovery = {
    issuer: raw.issuer,
    authorization_endpoint: raw.authorization_endpoint,
    token_endpoint: raw.token_endpoint,
    jwks_uri: raw.jwks_uri,
  };
  discoveryCache = { issuer, document, fetchedAt: now };
  return document;
}

export function buildKireadyAuthorizeUrl(input: {
  env: KireadyOidcEnv;
  authorizationEndpoint: string;
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.env.clientId);
  url.searchParams.set("redirect_uri", input.env.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeKireadyCode(input: {
  env: KireadyOidcEnv;
  tokenEndpoint: string;
  code: string;
  verifier: string;
}): Promise<{ idToken: string; accessToken: string; refreshToken: string | null; expiresIn: number | null }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.env.redirectUri,
    client_id: input.env.clientId,
    client_secret: input.env.clientSecret,
    code_verifier: input.verifier,
  });
  const response = await fetch(input.tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("KIready-Tokenaustausch fehlgeschlagen.");
  }
  const raw = (await response.json()) as unknown;
  if (
    !isRecord(raw) ||
    typeof raw.id_token !== "string" ||
    typeof raw.access_token !== "string"
  ) {
    throw new Error("KIready-Tokenantwort ist unvollständig.");
  }
  return {
    idToken: raw.id_token,
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresIn: typeof raw.expires_in === "number" ? raw.expires_in : null,
  };
}

export async function verifyKireadyIdToken(input: {
  env: KireadyOidcEnv;
  jwksUri: string;
  idToken: string;
  nonce: string;
}): Promise<KireadyOidcClaims> {
  const JWKS = createRemoteJWKSet(new URL(input.jwksUri));
  const { payload } = await jwtVerify(input.idToken, JWKS, {
    issuer: input.env.issuer,
    audience: input.env.clientId,
  });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("KIready-ID-Token ohne subject.");
  }
  if (payload.nonce !== input.nonce) {
    throw new Error("KIready-ID-Token nonce ungültig.");
  }
  return {
    iss: String(payload.iss ?? ""),
    sub: payload.sub,
    aud:
      typeof payload.aud === "string" || Array.isArray(payload.aud)
        ? payload.aud
        : "",
    exp: typeof payload.exp === "number" ? payload.exp : 0,
    iat: typeof payload.iat === "number" ? payload.iat : 0,
    nonce: typeof payload.nonce === "string" ? payload.nonce : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    email_verified: payload.email_verified === true,
  };
}
