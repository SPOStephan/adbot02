import { createHash, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { ENV, assertAuthConfigured } from "./env";

export type SessionClaims = {
  sub: string;
  email: string;
  name: string;
  role: "admin";
};

function secretKey() {
  assertAuthConfigured();
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

export async function createSessionToken(user: User): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
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
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : ENV.adminName,
      role: "admin",
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
  if (!ENV.cookieSecret || !ENV.adminEmail || !ENV.adminPassword) {
    return null;
  }

  const claims = await verifySessionToken(readSessionToken(req));
  if (!claims || claims.email !== ENV.adminEmail) {
    return null;
  }

  return buildAdminUser(claims.email);
}
