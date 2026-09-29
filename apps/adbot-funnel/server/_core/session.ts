import { createHash, timingSafeEqual } from "node:crypto";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { ENV, assertAuthConfigured } from "./env";
import { findMemberLogin, memberCredentialVersion } from "./memberLogins";
import type { FunnelMember } from "../funnelMembers";

export type AuthSource = "password" | "adbot-sso" | "member";

export type SessionClaims = {
  sub: string;
  email: string;
  name: string;
  role: "admin";
  authSource: AuthSource;
  ownerUserId: string | null;
  credentialVersion: string | null;
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

/** Funnel-only-Login: gleicher Mandantenumfang wie `ownerUserId`, aber kein Plattform-Admin. */
export function buildMemberUser(member: Pick<FunnelMember, "ownerUserId" | "email" | "name">): User {
  return { ...buildTenantUser(member.ownerUserId, member.email, member.name), id: 3, loginMethod: "member" };
}

export function isPlatformAdmin(user: User | null | undefined): boolean {
  return Boolean(user && user.loginMethod === "password");
}

export function getTenantOwnerUserId(user: User): string | null {
  if (isPlatformAdmin(user)) return null;
  return user.openId;
}

export async function createSessionToken(
  user: User,
  options: { member?: Pick<FunnelMember, "passwordHash"> } = {},
): Promise<string> {
  const authSource: AuthSource =
    user.loginMethod === "adbot-sso" || user.loginMethod === "member"
      ? user.loginMethod
      : "password";
  const ownerUserId = authSource === "password" ? null : user.openId;
  const member = authSource === "member" ? options.member : undefined;
  if (authSource === "member" && !member) {
    throw new Error("Mitglieds-Sitzung braucht den aktuellen Zugang.");
  }

  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    authSource,
    ownerUserId,
    ...(member ? { cv: memberCredentialVersion(member) } : {}),
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
      payload.authSource === "adbot-sso" || payload.authSource === "member"
        ? payload.authSource
        : "password";
    const ownerUserId =
      typeof payload.ownerUserId === "string" && payload.ownerUserId.length > 0
        ? payload.ownerUserId
        : authSource === "password"
          ? null
          : payload.sub;

    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : ENV.adminName,
      role: "admin",
      authSource,
      ownerUserId,
      credentialVersion: typeof payload.cv === "string" ? payload.cv : null,
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

  if (claims.authSource === "member") {
    // Bei jeder Anfrage gegen den gespeicherten Zugang prüfen: Löschen des Zugangs
    // oder ein neues Passwort beendet bestehende Sitzungen sofort.
    const member = await findMemberLogin(claims.email).catch(error => {
      console.error("[member-login] Zugang nicht lesbar", error);
      return null;
    });
    if (
      !member ||
      member.ownerUserId !== claims.ownerUserId ||
      claims.credentialVersion !== memberCredentialVersion(member)
    ) {
      return null;
    }
    return buildMemberUser(member);
  }

  if (claims.authSource === "adbot-sso" && claims.ownerUserId) {
    return buildTenantUser(claims.ownerUserId, claims.email, claims.name);
  }

  if (!ENV.adminEmail || claims.email !== ENV.adminEmail) {
    return null;
  }

  return buildAdminUser(claims.email);
}

/** Used by password login path only. */
export function requirePasswordAuthConfigured() {
  assertAuthConfigured();
}
