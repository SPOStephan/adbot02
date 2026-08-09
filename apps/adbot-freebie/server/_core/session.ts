import { createHash, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { ENV, assertAuthConfigured } from "./env";

export type AuthSource = "password" | "adbot-sso";

export type SessionClaims = {
  sub: string;
  email: string;
  name: string;
  role: "admin";
  authSource: AuthSource;
  ownerUserId: string | null;
};

function secretKey() {
  if (!ENV.cookieSecret || ENV.cookieSecret.length < 32) {
    throw new Error("JWT_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen).");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function verifyAdminPassword(email: string, password: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!ENV.adminEmail || !ENV.adminPassword) return false;
  if (normalizedEmail !== ENV.adminEmail) return false;

  const left = digest(password);
  const right = digest(ENV.adminPassword);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function buildAdminUser(email = ENV.adminEmail): User {
  const now = new Date();
  return {
    id: 1,
    openId: `admin:${email}`,
    email,
    name: ENV.adminName,
    loginMethod: "password",
    role: "admin",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

export function buildTenantUser(ownerUserId: string, email: string, name?: string): User {
  const now = new Date();
  const normalizedEmail = email.trim().toLowerCase();
  return {
    id: 2,
    openId: ownerUserId,
    email: normalizedEmail,
    name: (name ?? "").trim() || normalizedEmail,
    loginMethod: "adbot-sso",
    role: "admin",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

export function isPlatformAdmin(user: User | null | undefined): boolean {
  return Boolean(user && user.loginMethod === "password");
}

export function getTenantOwnerUserId(user: User): string | null {
  if (isPlatformAdmin(user)) return null;
  return user.openId;
}

export async function createSessionToken(user: User): Promise<string> {
  const authSource: AuthSource =
    user.loginMethod === "adbot-sso" ? "adbot-sso" : "password";
  const ownerUserId = authSource === "adbot-sso" ? user.openId : null;

  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    authSource,
    ownerUserId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.openId)
    .setIssuedAt()
    .setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1000))
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      payload.role !== "admin"
    ) {
      return null;
    }

    const authSource: AuthSource =
      payload.authSource === "adbot-sso" ? "adbot-sso" : "password";
    const ownerUserId =
      typeof payload.ownerUserId === "string" && payload.ownerUserId.length > 0
        ? payload.ownerUserId
        : authSource === "adbot-sso"
          ? payload.sub
          : null;

    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : ENV.adminName,
      role: "admin",
      authSource,
      ownerUserId,
    };
  } catch {
    return null;
  }
}

export function readSessionToken(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const fromCookie = cookies[COOKIE_NAME];
  if (typeof fromCookie === "string" && fromCookie.length > 0) {
    return fromCookie;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return undefined;
}

export async function authenticateRequest(req: Request): Promise<User | null> {
  if (!ENV.cookieSecret || ENV.cookieSecret.length < 32) {
    return null;
  }

  const claims = await verifySessionToken(readSessionToken(req));
  if (!claims) return null;

  if (claims.authSource === "adbot-sso" && claims.ownerUserId) {
    return buildTenantUser(claims.ownerUserId, claims.email, claims.name);
  }

  if (!ENV.adminEmail || claims.email !== ENV.adminEmail) {
    return null;
  }

  return buildAdminUser(claims.email);
}

export function requirePasswordAuthConfigured() {
  assertAuthConfigured();
}
