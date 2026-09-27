import { describe, expect, it } from "vitest";
import {
  certificateLooksLikeOldHoster,
  chromeWildcardHostWarning,
  describePublicHttpsProbe,
} from "./customDomainHttpsProbe";

describe("öffentliche HTTPS-Sonde", () => {
  it("erkennt All-Inkl- und Strato-Zertifikate als alten Webspace", () => {
    expect(certificateLooksLikeOldHoster("*.kasserver.com", "Sectigo")).toBe(true);
    expect(certificateLooksLikeOldHoster("jobs.boncred.info", "Let's Encrypt")).toBe(false);
  });

  it("blockiert Aktivierung, solange das öffentliche Zertifikat der alte Hoster ist", () => {
    const message = describePublicHttpsProbe({
      hostname: "jobs.boncred.info",
      certificateName: "*.kasserver.com",
      issuer: "Sectigo",
      matchesHostname: false,
      looksLikeOldHoster: true,
    });
    expect(message).toContain("Hoster-Webspace");
    expect(message).toContain("*.kasserver.com");
    expect(message).toContain("Nicht aktivieren");
    expect(message).toContain("Wildcard");
    expect(message).not.toContain("richtige Zertifikat");
  });

  it("erklärt Chrome-Wildcard, wenn das Internet schon das richtige Zertifikat hat", () => {
    const message = describePublicHttpsProbe({
      hostname: "jobs.boncred.info",
      certificateName: "jobs.boncred.info",
      issuer: "Let's Encrypt",
      matchesHostname: true,
      looksLikeOldHoster: false,
    });
    expect(message).toContain("richtige Zertifikat");
    expect(message).toContain("Chrome");
    expect(message).toContain("Gastfenster");
    expect(message).toContain("unsichere Seite");
    expect(message).toContain("brandneue Subdomain");
    expect(message).toContain("Wildcard-CNAME");
    expect(message).not.toContain("Nicht aktivieren");
    expect(message).not.toContain("wiederverwendet");
  });

  it("warnt Chrome-Besucher vor Wildcard-*, auch bei neuer Subdomain", () => {
    const message = chromeWildcardHostWarning("jobs.boncred.info");
    expect(message).toContain("Chrome");
    expect(message).toContain("jobs.boncred.info");
    expect(message).toContain("brandneue Subdomain");
    expect(message).not.toContain("wiederverwendet");
  });
});
