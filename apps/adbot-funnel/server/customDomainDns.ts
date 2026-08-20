import { promises as dns } from "node:dns";
import { normalizeCustomHostname } from "./funnelCustomDomains";

export type CustomDomainDnsCheckResult = {
  ok: boolean;
  hostname: string;
  expectedTarget: string;
  records: string[];
  message: string;
};

function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function cnameMatchesExpected(
  records: string[],
  expectedTarget: string,
): boolean {
  const expected = normalizeDnsName(expectedTarget);
  return records.some(record => {
    const value = normalizeDnsName(record);
    if (!value) return false;
    if (value === expected) return true;
    // Accept Vercel DNS targets broadly (project-specific CNAMEs vary).
    if (expected.endsWith("vercel-dns.com") && value.endsWith("vercel-dns.com")) {
      return true;
    }
    return false;
  });
}

/**
 * Resolves CNAME records for a customer hostname.
 * Inject `resolve` in tests.
 */
export async function checkCustomDomainCname(
  hostname: string,
  expectedTarget: string,
  resolve: (host: string) => Promise<string[]> = host => dns.resolveCname(host),
): Promise<CustomDomainDnsCheckResult> {
  const normalizedHost = normalizeCustomHostname(hostname);
  const expected = normalizeDnsName(expectedTarget) || "cname.vercel-dns.com";

  try {
    const records = (await resolve(normalizedHost)).map(normalizeDnsName);
    const ok = cnameMatchesExpected(records, expected);
    return {
      ok,
      hostname: normalizedHost,
      expectedTarget: expected,
      records,
      message: ok
        ? `DNS ok: CNAME zeigt auf ${records.join(", ")}.`
        : records.length
          ? `CNAME zeigt auf ${records.join(", ")}, erwartet wird ${expected} (oder *.vercel-dns.com).`
          : `Kein CNAME für ${normalizedHost} gefunden. Bitte CNAME auf ${expected} setzen.`,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    const hint =
      code === "ENOTFOUND" || code === "ENODATA" || code === "ENAMEERR"
        ? `Kein CNAME für ${normalizedHost} gefunden.`
        : `DNS-Abfrage fehlgeschlagen${code ? ` (${code})` : ""}.`;
    return {
      ok: false,
      hostname: normalizedHost,
      expectedTarget: expected,
      records: [],
      message: `${hint} Bitte CNAME auf ${expected} setzen und DNS-Propagierung abwarten.`,
    };
  }
}
