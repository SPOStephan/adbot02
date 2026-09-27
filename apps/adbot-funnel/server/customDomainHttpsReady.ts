import {
  chromeHostReuseWarning,
  probePublicHttpsCertificate,
  type PublicHttpsProbe,
} from "./customDomainHttpsProbe";
import {
  ensureVercelDomainHttpsReady,
  type VercelDomainResult,
} from "./vercelDomains";

export type CustomerHostnameHttps = {
  ok: boolean;
  verified: boolean;
  message: string;
  vercel: VercelDomainResult;
  probe: PublicHttpsProbe | null;
};

/** Vercel verified is not enough: public TLS must not still be the old hoster. */
export async function requireCustomerHostnameHttps(
  hostname: string,
): Promise<CustomerHostnameHttps> {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  const vercel = await ensureVercelDomainHttpsReady(host);
  if (!vercel.ok || !vercel.verified) {
    return {
      ok: false,
      verified: false,
      message: vercel.message,
      vercel,
      probe: null,
    };
  }

  const probe = await probePublicHttpsCertificate(host);
  if (probe.reachable && (probe.looksLikeOldHoster || !probe.matchesHostname)) {
    return {
      ok: false,
      verified: false,
      message: probe.message,
      vercel,
      probe,
    };
  }

  const chrome = chromeHostReuseWarning(host);
  return {
    ok: true,
    verified: true,
    message: probe.reachable
      ? `DNS und HTTPS für ${host} sind bereit. ${probe.message}`
      : `DNS und HTTPS für ${host} sind bei Vercel bereit. ${probe.message} ${chrome}`,
    vercel,
    probe,
  };
}
