export type CustomerCustomDomainStatus =
  | "PENDING_DNS"
  | "READY"
  | "REVOKED";

export type CustomerCustomDomainView = {
  id: string;
  hostname: string;
  label: string;
  status: Exclude<CustomerCustomDomainStatus, "REVOKED">;
  dnsTarget: string;
  notes: string;
  lastDnsCheckAt: string | null;
  lastDnsMessage: string;
  createdAt: string;
};

export const DEFAULT_CUSTOM_DOMAIN_DNS_TARGET = "cname.vercel-dns.com";

export function normalizeCustomHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function assertValidCustomHostname(hostname: string) {
  if (
    hostname.length < 3 ||
    hostname.length > 253 ||
    !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(hostname) ||
    hostname.includes("..") ||
    !hostname.includes(".") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  ) {
    throw new Error("Der Hostname ist ungültig.");
  }
  for (const label of hostname.split(".")) {
    if (
      label.length < 1 ||
      label.length > 63 ||
      label.startsWith("-") ||
      label.endsWith("-")
    ) {
      throw new Error("Der Hostname ist ungültig.");
    }
  }
}

export function destinationUrlForHostname(hostname: string): string {
  return `https://${normalizeCustomHostname(hostname)}/`;
}
