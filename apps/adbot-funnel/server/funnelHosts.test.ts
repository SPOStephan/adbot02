import { describe, expect, it } from "vitest";
import {
  isSharedFunnelHost,
  normalizeHostname,
  parseSharedFunnelHosts,
} from "../shared/funnelHosts";
import {
  checkCustomDomainCname,
  cnameMatchesExpected,
} from "./customDomainDns";

describe("funnelHosts", () => {
  it("erkennt Shared Hosts", () => {
    expect(isSharedFunnelHost("funnel.adbot.one")).toBe(true);
    expect(isSharedFunnelHost("www.funnel.adbot.one")).toBe(true);
    expect(isSharedFunnelHost("localhost")).toBe(true);
    expect(isSharedFunnelHost("adbot-funnel-git-main.vercel.app")).toBe(true);
    expect(isSharedFunnelHost("karriere.kunde.de")).toBe(false);
  });

  it("erlaubt Extra-Hosts aus Env-String", () => {
    expect(isSharedFunnelHost("funnel.staging.example", "funnel.staging.example")).toBe(
      true,
    );
    expect(parseSharedFunnelHosts(" a.com , b.com ").includes("a.com")).toBe(true);
    expect(normalizeHostname("Karriere.Kunde.de.")).toBe("karriere.kunde.de");
  });
});

describe("customDomainDns", () => {
  it("akzeptiert erwartetes CNAME und vercel-dns Varianten", () => {
    expect(
      cnameMatchesExpected(["cname.vercel-dns.com"], "cname.vercel-dns.com"),
    ).toBe(true);
    expect(
      cnameMatchesExpected(["abc.vercel-dns.com"], "cname.vercel-dns.com"),
    ).toBe(true);
    expect(cnameMatchesExpected(["other.example"], "cname.vercel-dns.com")).toBe(
      false,
    );
  });

  it("prüft DNS über injizierte Resolve-Funktion", async () => {
    const ok = await checkCustomDomainCname(
      "jobs.example.de",
      "cname.vercel-dns.com",
      async () => ["cname.vercel-dns.com"],
    );
    expect(ok.ok).toBe(true);

    const bad = await checkCustomDomainCname(
      "jobs.example.de",
      "cname.vercel-dns.com",
      async () => ["wrong.example"],
    );
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/erwartet/i);
  });
});
