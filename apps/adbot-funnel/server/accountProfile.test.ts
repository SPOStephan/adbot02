import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { buildMemberUser, buildTenantUser } from "./_core/session";
import { resetFunnelAccountProfileMemoryForTests } from "./funnelAccountProfiles";

process.env.JWT_SECRET = "test-secret-at-least-32-characters-long";
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const OWNER = "11111111-2222-3333-4444-555555555555";

function caller(user: TrpcContext["user"]) {
  return appRouter.createCaller({
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: () => undefined } as unknown as TrpcContext["res"],
  });
}

const owner = buildTenantUser(OWNER, "adbot@boncred.info", "Stephan");
const member = buildMemberUser({ ownerUserId: OWNER, email: "kunde@gmail.com", name: "" });

describe("Firmenangaben im Konto", () => {
  beforeEach(() => {
    resetFunnelAccountProfileMemoryForTests();
  });

  it("leitet ohne Angaben aus der Domain ab und nutzt danach den angezeigten Namen", async () => {
    expect((await caller(owner).members.accountBranding()).companyName).toBe("Boncred");

    const saved = await caller(owner).members.saveAccountProfile({
      companyName: "  Boncred   Finanzvermittlungs GmbH ",
      displayName: "Boncred Finanz",
    });
    expect(saved).toEqual({ companyName: "Boncred Finanzvermittlungs GmbH", displayName: "Boncred Finanz" });
    expect(await caller(owner).members.accountProfile()).toEqual(saved);

    const branding = await caller(member).members.accountBranding();
    expect(branding.companyName).toBe("Boncred Finanz");
    expect(branding.legalName).toBe("Boncred Finanzvermittlungs GmbH");
  });

  it("nur der Konto-Inhaber darf die Angaben ändern", async () => {
    await expect(
      caller(member).members.saveAccountProfile({ companyName: "X", displayName: "X" }),
    ).rejects.toThrow(/Konto-Inhaber/);
  });
});
