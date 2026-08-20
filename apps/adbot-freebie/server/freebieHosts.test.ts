import { describe, expect, it } from "vitest";

import {
  isSharedFreebieHost,
  normalizeHostname,
} from "../shared/freebieHosts";
import {
  checkCustomDomainCname,
  cnameMatchesExpected,
} from "./customDomainDns";
import {
  assertValidCustomHostname,
  getOfferIdByCustomHostname,
  markCustomDomainReady,
  registerCustomDomain,
  resetCustomDomainMemoryForTests,
} from "./freebieCustomDomains";
import { resolvePublicAppBaseUrl } from "./publicAppUrl";
import type { Request } from "express";

describe("freebieHosts", () => {
  it("treats freebie.adbot.one and vercel previews as shared", () => {
    expect(isSharedFreebieHost("freebie.adbot.one")).toBe(true);
    expect(isSharedFreebieHost("www.freebie.adbot.one")).toBe(true);
    expect(isSharedFreebieHost("localhost")).toBe(true);
    expect(isSharedFreebieHost("adbot-freebie-git-main.vercel.app")).toBe(true);
    expect(isSharedFreebieHost("download.kunde.de")).toBe(false);
  });

  it("accepts extra shared hosts from env string", () => {
    expect(
      isSharedFreebieHost("freebie.staging.example", "freebie.staging.example"),
    ).toBe(true);
  });

  it("normalizes hostnames", () => {
    expect(normalizeHostname(" Download.Kunde.DE.:443 ")).toBe(
      "download.kunde.de",
    );
  });
});

describe("customDomainDns", () => {
  it("accepts vercel-dns.com family", () => {
    expect(
      cnameMatchesExpected(["abc.vercel-dns.com"], "cname.vercel-dns.com"),
    ).toBe(true);
    expect(cnameMatchesExpected(["example.net"], "cname.vercel-dns.com")).toBe(
      false,
    );
  });

  it("resolves via injected resolver", async () => {
    const ok = await checkCustomDomainCname(
      "download.kunde.de",
      "cname.vercel-dns.com",
      async () => ["cname.vercel-dns.com"],
    );
    expect(ok.ok).toBe(true);

    const bad = await checkCustomDomainCname(
      "download.kunde.de",
      "cname.vercel-dns.com",
      async () => ["elsewhere.example"],
    );
    expect(bad.ok).toBe(false);
  });
});

describe("freebieCustomDomains memory", () => {
  it("registers, activates and resolves by host", async () => {
    resetCustomDomainMemoryForTests();
    const offerId = "11111111-1111-1111-1111-111111111111";
    const domain = await registerCustomDomain({
      offerId,
      hostname: "Download.Kunde.DE",
    });
    expect(domain.status).toBe("PENDING_DNS");
    expect(domain.hostname).toBe("download.kunde.de");
    assertValidCustomHostname(domain.hostname);

    const ready = await markCustomDomainReady({
      offerId,
      domainId: domain.id,
    });
    expect(ready.status).toBe("READY");
    expect(await getOfferIdByCustomHostname("download.kunde.de")).toBe(offerId);
  });
});

describe("resolvePublicAppBaseUrl", () => {
  it("uses custom host when not shared", () => {
    const req = {
      headers: {
        host: "download.kunde.de",
        "x-forwarded-proto": "https",
      },
    } as unknown as Request;
    expect(resolvePublicAppBaseUrl(req)).toBe("https://download.kunde.de");
  });

  it("falls back to PUBLIC_APP_URL on shared host", () => {
    const prev = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = "https://freebie.adbot.one";
    const req = {
      headers: { host: "freebie.adbot.one" },
    } as unknown as Request;
    expect(resolvePublicAppBaseUrl(req)).toBe("https://freebie.adbot.one");
    process.env.PUBLIC_APP_URL = prev;
  });
});
