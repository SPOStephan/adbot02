import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import { authenticateRequest, isPlatformAdmin, getTenantOwnerUserId } from "./_core/session";
import { hashMemberPassword } from "./_core/memberLogins";

const OWNER = "11111111-2222-3333-4444-555555555555";

process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
process.env.ADMIN_EMAIL = "admin@example.com";
process.env.ADMIN_PASSWORD = "test-password";

function setMembers(entries: unknown[]) {
  process.env.FUNNEL_MEMBER_LOGINS = JSON.stringify(entries);
}

function makeCtx(cookies: Array<{ name: string; value: string }>): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string) => {
        cookies.push({ name, value });
      },
    } as TrpcContext["res"],
  };
}

async function login(email: string, password: string) {
  const cookies: Array<{ name: string; value: string }> = [];
  const result = await appRouter.createCaller(makeCtx(cookies)).auth.login({ email, password });
  return { result, token: cookies[0]?.value ?? "" };
}

function requestWith(token: string) {
  return { headers: { cookie: `${COOKIE_NAME}=${token}` } } as Parameters<typeof authenticateRequest>[0];
}

describe("Funnel-only Mitglieds-Login", () => {
  beforeEach(() => {
    setMembers([
      {
        email: "Kunde@Firma.de",
        name: "Firma GmbH",
        ownerUserId: OWNER,
        passwordHash: hashMemberPassword("kunden-passwort-123", randomBytes(16)),
      },
    ]);
  });

  it("meldet das Mitglied im Mandanten des Adbot-Kontos an, nicht als Plattform-Admin", async () => {
    const { result, token } = await login("kunde@firma.de", "kunden-passwort-123");
    expect(result.user.loginMethod).toBe("member");
    expect(result.user.openId).toBe(OWNER);

    const user = await authenticateRequest(requestWith(token));
    expect(user).not.toBeNull();
    expect(isPlatformAdmin(user)).toBe(false);
    expect(getTenantOwnerUserId(user!)).toBe(OWNER);
  });

  it("lehnt falsches Passwort und unbekannte Adressen ab", async () => {
    await expect(login("kunde@firma.de", "falsch")).rejects.toThrow(/ungültig/);
    await expect(login("fremd@firma.de", "kunden-passwort-123")).rejects.toThrow(/ungültig/);
  });

  it("beendet Sitzungen, wenn der Eintrag entfernt oder das Passwort geändert wird", async () => {
    const { token } = await login("kunde@firma.de", "kunden-passwort-123");

    setMembers([
      {
        email: "kunde@firma.de",
        ownerUserId: OWNER,
        passwordHash: hashMemberPassword("neues-passwort-456", randomBytes(16)),
      },
    ]);
    expect(await authenticateRequest(requestWith(token))).toBeNull();

    setMembers([]);
    expect(await authenticateRequest(requestWith(token))).toBeNull();
  });

  it("macht die Plattform-Admin-Adresse nie zu einem Mitglied", async () => {
    setMembers([
      {
        email: "admin@example.com",
        ownerUserId: OWNER,
        passwordHash: hashMemberPassword("kunden-passwort-123", randomBytes(16)),
      },
    ]);
    await expect(login("admin@example.com", "kunden-passwort-123")).rejects.toThrow(/ungültig/);
  });
});
