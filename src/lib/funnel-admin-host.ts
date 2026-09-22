import {
  assertValidCustomHostname,
  normalizeCustomHostname,
} from "@/lib/custom-domains/types";
import { FUNNEL_SITE_URL } from "@/lib/site-urls";

const BLOCKED_ADMIN_HOSTS = new Set([
  "funnel.adbot.one",
  "www.funnel.adbot.one",
  "app.adbot.one",
  "www.app.adbot.one",
  "localhost",
  "127.0.0.1",
]);

export type FunnelAdminDomainHint = {
  hostname: string;
  status: string;
  bindingKind: string;
};

export function isAllowedFunnelAdminPath(path: string): boolean {
  const value = path.trim();
  if (value === "/admin" || value === "/admin/applications") return true;
  if (
    /^\/admin\/funnels\/[0-9a-f-]{36}\/(applications|settings|editor)$/i.test(
      value,
    )
  ) {
    return true;
  }
  if (
    /^\/admin\/funnels\/[0-9a-f-]{36}\/applications\/[0-9a-f-]{36}$/i.test(
      value,
    )
  ) {
    return true;
  }
  return /^\/admin\/applications\/[0-9a-f-]{36}$/i.test(value);
}

export function defaultFunnelAdminPath(hasCustomDomain: boolean): string {
  return hasCustomDomain ? "/admin/applications" : "/admin";
}

export function isSafeCustomerFunnelHostname(hostname: string): boolean {
  const host = normalizeCustomHostname(hostname);
  if (!host || BLOCKED_ADMIN_HOSTS.has(host) || host.endsWith(".vercel.app")) {
    return false;
  }
  try {
    assertValidCustomHostname(host);
  } catch {
    return false;
  }
  return true;
}

export function resolveCustomerFunnelAdminHostname(
  domains: FunnelAdminDomainHint[],
): string | null {
  for (const domain of domains) {
    if (domain.status !== "READY") continue;
    if (domain.bindingKind !== "funnel") continue;
    if (!isSafeCustomerFunnelHostname(domain.hostname)) continue;
    return normalizeCustomHostname(domain.hostname);
  }
  return null;
}

export function sharedFunnelHostname(): string {
  return new URL(FUNNEL_SITE_URL).hostname.toLowerCase();
}

export function createFunnelSsoConsumeUrl(input: {
  hostname: string | null;
  nextPath: string;
}): URL {
  const origin = input.hostname
    ? `https://${normalizeCustomHostname(input.hostname)}`
    : FUNNEL_SITE_URL;
  const url = new URL("/api/auth/adbot-sso", `${origin.replace(/\/+$/, "")}/`);
  if (input.nextPath && input.nextPath !== "/admin") {
    url.searchParams.set("next", input.nextPath);
  }
  return url;
}
