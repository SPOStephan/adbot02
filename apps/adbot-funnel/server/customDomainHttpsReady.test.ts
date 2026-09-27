import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./vercelDomains", () => ({
  ensureVercelDomainHttpsReady: vi.fn(),
}));

vi.mock("./customDomainHttpsProbe", async () => {
  const actual = await vi.importActual<typeof import("./customDomainHttpsProbe")>(
    "./customDomainHttpsProbe",
  );
  return {
    ...actual,
    probePublicHttpsCertificate: vi.fn(),
  };
});

import { requireCustomerHostnameHttps } from "./customDomainHttpsReady";
import { probePublicHttpsCertificate } from "./customDomainHttpsProbe";
import { ensureVercelDomainHttpsReady } from "./vercelDomains";

const vercelReady = {
  ok: true,
  configured: true,
  alreadyAttached: true,
  verified: true,
  message: "HTTPS für jobs.boncred.info ist bereit.",
  verification: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("requireCustomerHostnameHttps", () => {
  it("lässt READY nicht zu, wenn öffentlich noch *.kasserver.com liegt", async () => {
    vi.mocked(ensureVercelDomainHttpsReady).mockResolvedValue(vercelReady);
    vi.mocked(probePublicHttpsCertificate).mockResolvedValue({
      ok: false,
      reachable: true,
      certificateName: "*.kasserver.com",
      issuer: "Sectigo",
      matchesHostname: false,
      looksLikeOldHoster: true,
      message: "Die Adresse zeigt noch auf den alten Webspace (Zertifikat *.kasserver.com). Nicht aktivieren.",
    });

    const result = await requireCustomerHostnameHttps("jobs.boncred.info");
    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.message).toContain("alten Webspace");
  });

  it("bleibt bereit, warnt aber vor Chrome-Altlast wenn das Internet schon stimmt", async () => {
    vi.mocked(ensureVercelDomainHttpsReady).mockResolvedValue(vercelReady);
    vi.mocked(probePublicHttpsCertificate).mockResolvedValue({
      ok: true,
      reachable: true,
      certificateName: "jobs.boncred.info",
      issuer: "Let's Encrypt",
      matchesHostname: true,
      looksLikeOldHoster: false,
      message: "Im Internet liegt das richtige Zertifikat (jobs.boncred.info). Chrome merkt sich den alten Hoster.",
    });

    const result = await requireCustomerHostnameHttps("jobs.boncred.info");
    expect(result.ok).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.message).toContain("sind bereit");
    expect(result.message).toContain("Chrome");
  });

  it("blockiert nicht, wenn die Sonde nicht erreichbar ist und Vercel verified ist", async () => {
    vi.mocked(ensureVercelDomainHttpsReady).mockResolvedValue(vercelReady);
    vi.mocked(probePublicHttpsCertificate).mockResolvedValue({
      ok: false,
      reachable: false,
      certificateName: "",
      issuer: "",
      matchesHostname: false,
      looksLikeOldHoster: false,
      message: "HTTPS-Prüfung hat nicht geantwortet.",
    });

    const result = await requireCustomerHostnameHttps("jobs.boncred.info");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Vercel");
    expect(result.message).toContain("Chrome");
  });
});
