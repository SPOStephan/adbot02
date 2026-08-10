import { afterEach, describe, expect, it } from "vitest";
import {
  assertValidCustomHostname,
  listCustomDomainsForFunnel,
  markCustomDomainReady,
  normalizeCustomHostname,
  registerCustomDomain,
  resetCustomDomainMemoryForTests,
  revokeCustomDomain,
  getFunnelIdByCustomHostname,
} from "./funnelCustomDomains";

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("funnel custom domains", () => {
  afterEach(() => {
    resetCustomDomainMemoryForTests();
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    else delete process.env.SUPABASE_URL;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("normalisiert und validiert Hostnamen", () => {
    expect(normalizeCustomHostname(" Karriere.Example.de. ")).toBe(
      "karriere.example.de"
    );
    expect(() => assertValidCustomHostname("localhost")).toThrow(/ungültig/i);
    expect(() => assertValidCustomHostname("bad..host.de")).toThrow(/ungültig/i);
  });

  it("registriert Domain idempotent pro Funnel und blockiert Konflikte", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetCustomDomainMemoryForTests();

    const first = await registerCustomDomain({
      funnelId: "funnel-a",
      hostname: "jobs.example.de",
    });
    const again = await registerCustomDomain({
      funnelId: "funnel-a",
      hostname: "jobs.example.de",
    });
    expect(again.id).toBe(first.id);
    expect(first.status).toBe("PENDING_DNS");

    await expect(
      registerCustomDomain({
        funnelId: "funnel-b",
        hostname: "jobs.example.de",
      })
    ).rejects.toThrow(/bereits/);

    const ready = await markCustomDomainReady({
      funnelId: "funnel-a",
      domainId: first.id,
    });
    expect(ready.status).toBe("READY");
    expect(await getFunnelIdByCustomHostname("jobs.example.de")).toBe("funnel-a");

    const listed = await listCustomDomainsForFunnel("funnel-a");
    expect(listed).toHaveLength(1);

    const revoked = await revokeCustomDomain({
      funnelId: "funnel-a",
      domainId: first.id,
    });
    expect(revoked.status).toBe("REVOKED");
    expect(await getFunnelIdByCustomHostname("jobs.example.de")).toBeNull();
  });
});
