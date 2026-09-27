import { describe, expect, it } from "vitest";
import {
  certificateLooksLikeOldHoster,
  chromeHostReuseWarning,
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
    expect(message).toContain("alten Webspace");
    expect(message).toContain("*.kasserver.com");
    expect(message).toContain("Nicht aktivieren");
    expect(message).not.toContain("richtige Zertifikat");
  });

  it("erklärt Chrome-Altlast, wenn das Internet schon das richtige Zertifikat hat", () => {
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
    expect(message).toContain("noch nie als Website");
    expect(message).toContain("landet auf dem alten Webspace");
    expect(message).not.toContain("Nicht aktivieren");
  });

  it("warnt jeden Chrome-Besucher vor wiederverwendeten Subdomains", () => {
    const message = chromeHostReuseWarning("jobs.boncred.info");
    expect(message).toContain("Chrome");
    expect(message).toContain("jobs.boncred.info");
    expect(message).toContain("noch nie als Website");
  });
});
