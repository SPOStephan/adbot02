import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { resetMemoryStoreForTests } from "./funnelStore";
import { appRouter } from "./routers";

const platformAdmin: TrpcContext = {
  user: {
    id: 1,
    openId: "admin:ops@example.org",
    email: "ops@example.org",
    name: "Ops",
    loginMethod: "password",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

const tenantA: TrpcContext = {
  user: {
    id: 2,
    openId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    email: "a@example.org",
    name: "Kunde A",
    loginMethod: "adbot-sso",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

const tenantB: TrpcContext = {
  user: {
    id: 3,
    openId: "ffffffff-1111-4222-8333-444444444444",
    email: "b@example.org",
    name: "Kunde B",
    loginMethod: "adbot-sso",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("Funnel Mandantentrennung", () => {
  beforeAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  beforeEach(() => {
    resetMemoryStoreForTests();
  });

  it("weist neuen Funnel dem SSO-Kunden zu und blendet fremde Funnel aus", async () => {
    const a = appRouter.createCaller(tenantA);
    const b = appRouter.createCaller(tenantB);
    const ops = appRouter.createCaller(platformAdmin);

    const created = await a.funnel.create({ title: "Funnel A", slug: "funnel-a" });
    await b.funnel.create({ title: "Funnel B", slug: "funnel-b" });

    const listA = await a.funnel.funnels();
    expect(listA).toHaveLength(1);
    expect(listA[0]?.id).toBe(created.id);
    expect(listA[0]?.ownerUserId).toBe(tenantA.user!.openId);

    const listB = await b.funnel.funnels();
    expect(listB).toHaveLength(1);
    expect(listB[0]?.slug).toBe("funnel-b");

    await expect(b.funnel.adminConfig({ id: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const all = await ops.funnel.funnels();
    expect(all.map(item => item.slug)).toEqual(
      expect.arrayContaining(["funnel-a", "funnel-b"]),
    );
  });

  it("verbietet setOwner für Kunden", async () => {
    const a = appRouter.createCaller(tenantA);
    const created = await a.funnel.create({ title: "Funnel A", slug: "funnel-a" });
    await expect(
      a.funnel.setOwner({
        funnelId: created.id,
        ownerUserId: tenantB.user!.openId,
        ownerEmail: "b@example.org",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
