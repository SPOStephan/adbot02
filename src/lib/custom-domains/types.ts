export type CustomerCustomDomainStatus =
  | "PENDING_DNS"
  | "READY"
  | "REVOKED";

export type CustomerCustomDomainOrigin = "portal" | "funnel" | "freebie";
export type CustomerCustomDomainBindingKind = "none" | "funnel" | "freebie";

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
  origin: CustomerCustomDomainOrigin;
  bindingKind: CustomerCustomDomainBindingKind;
  bindingRef: string | null;
  bindingLabel: string;
  toolDomainId: string | null;
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

export function originLabel(origin: CustomerCustomDomainOrigin): string {
  if (origin === "funnel") return "Funnel";
  if (origin === "freebie") return "Freebie";
  return "Portal";
}

export function bindingLabelText(
  kind: CustomerCustomDomainBindingKind,
  label: string,
): string {
  if (kind === "none") return "Nicht an Funnel/Freebie gebunden";
  const tool = kind === "funnel" ? "Funnel" : "Freebie";
  return label.trim() ? `${tool}: ${label.trim()}` : `Gebunden an ${tool}`;
}
