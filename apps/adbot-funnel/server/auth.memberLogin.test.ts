import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";
import {
  authenticateRequest,
  buildTenantUser,
  getTenantOwnerUserId,
  isPlatformAdmin,
} from "./_core/session";
import { resetFunnelMemberMemoryForTests } from "./funnelMembers";

const OWNER = "11111111-2222-3333-4444-555555555555";
const OTHER_OWNER = "66666666-7777-8888-9999-000000000000";

process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
process.env.ADMIN_EMAIL = "admin@example.com";
process.env.ADMIN_PASSWORD = "test-password";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

type Cookie = { name: string; value: string };

function makeCtx(user: TrpcContext["user"], cookies: Cookie[] = []): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string) => {
        cookies.push({ name, value });
      },
    } as TrpcContext["res"],
  };
}

const owner = buildTenantUser(OWNER, "adbot@boncred.info", "Stephan");
const ownerCaller = () => appRouter.createCaller(makeCtx(owner));

async function login(email: string, password: string) {
  const cookies: Cookie[] = [];
  const result = await appRouter.createCaller(makeCtx(null, cookies)).auth.login({ email, password });
  return { result, token: cookies[0]?.value ?? "" };
}

function requestWith(token: string) {
  return { headers: { cookie: `${COOKIE_NAME}=${token}` } } as Parameters<typeof authenticateRequest>[0];
}

describe("Funnel-only-Zugänge", () => {
  beforeEach(() => {
    resetFunnelMemberMemoryForTests();
  });

  it("Konto-Inhaber legt einen Zugang an, der im selben Mandanten landet", async () => {
    const created = await ownerCaller().members.create({
      email: "Kunde@Firma.de",
      name: "Firma GmbH",
      password: "kunden-passwort-123",
    });
    expect(created.email).toBe("kunde@firma.de");
    expect(created).not.toHaveProperty("passwordHash");
    expect(await ownerCaller().members.list()).toHaveLength(1);

    const { result, token } = await login("kunde@firma.de", "kunden-passwort-123");
    expect(result.user.loginMethod).toBe("member");

    const user = await authenticateRequest(requestWith(token));
    expect(user).not.toBeNull();
    expect(isPlatformAdmin(user)).toBe(false);
    expect(getTenantOwnerUserId(user!)).toBe(OWNER);
  });

  it("lehnt falsches Passwort und unbekannte Adressen ab", async () => {
    await ownerCaller().members.create({ email: "kunde@firma.de", name: "", password: "kunden-passwort-123" });
    await expect(login("kunde@firma.de", "falsch")).rejects.toThrow(/ungültig/);
    await expect(login("fremd@firma.de", "kunden-passwort-123")).rejects.toThrow(/ungültig/);
  });

  it("beendet Sitzungen bei neuem Passwort und beim Löschen", async () => {
    const created = await ownerCaller().members.create({ email: "kunde@firma.de", name: "", password: "kunden-passwort-123" });
    const first = await login("kunde@firma.de", "kunden-passwort-123");

    await ownerCaller().members.resetPassword({ id: created.id, password: "neues-passwort-456" });
    expect(await authenticateRequest(requestWith(first.token))).toBeNull();

    const second = await login("kunde@firma.de", "neues-passwort-456");
    expect(await authenticateRequest(requestWith(second.token))).not.toBeNull();

    await ownerCaller().members.remove({ id: created.id });
    expect(await authenticateRequest(requestWith(second.token))).toBeNull();
  });

  it("Mitglieder und Plattform-Admin verwalten keine Zugänge, fremde Konten sehen sie nicht", async () => {
    const created = await ownerCaller().members.create({ email: "kunde@firma.de", name: "", password: "kunden-passwort-123" });
    const { token } = await login("kunde@firma.de", "kunden-passwort-123");
    const memberUser = await authenticateRequest(requestWith(token));
    await expect(appRouter.createCaller(makeCtx(memberUser)).members.list()).rejects.toThrow(/Konto-Inhaber/);

    const other = appRouter.createCaller(makeCtx(buildTenantUser(OTHER_OWNER, "x@y.de")));
    expect(await other.members.list()).toHaveLength(0);
    await expect(other.members.remove({ id: created.id })).rejects.toThrow(/nicht gefunden/);
  });

  it("verhindert doppelte Adressen und die Plattform-Admin-Adresse", async () => {
    await ownerCaller().members.create({ email: "kunde@firma.de", name: "", password: "kunden-passwort-123" });
    await expect(
      ownerCaller().members.create({ email: "kunde@firma.de", name: "", password: "kunden-passwort-123" }),
    ).rejects.toThrow(/bereits/);
    await expect(
      ownerCaller().members.create({ email: "admin@example.com", name: "", password: "kunden-passwort-123" }),
    ).rejects.toThrow(/kein zusätzlicher Zugang/);
    await expect(
      ownerCaller().members.create({ email: "kunde2@firma.de", name: "", password: "kurz" }),
    ).rejects.toThrow();
  });
});
