const DEFAULT_MARKETING_SITE_URL = "https://adbot.one";
const DEFAULT_APP_SITE_URL = "https://app.adbot.one";

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

export const MARKETING_SITE_URL = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_MARKETING_URL,
  DEFAULT_MARKETING_SITE_URL,
);

export const APP_SITE_URL = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_APP_URL,
  DEFAULT_APP_SITE_URL,
);

const marketingHostname = new URL(MARKETING_SITE_URL).hostname.toLowerCase();
const appHostname = new URL(APP_SITE_URL).hostname.toLowerCase();

export function normalizeHostname(host: string | null | undefined) {
  return (host ?? "")
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "")
    .toLowerCase();
}

export function isMarketingHostname(hostname: string) {
  return hostname === marketingHostname || hostname === `www.${marketingHostname}`;
}

export function isPortalHostname(hostname: string) {
  return hostname === appHostname || hostname.endsWith(".vercel.app");
}

export function isPortalPath(pathname: string) {
  const normalizedPath =
    pathname !== "/" ? pathname.replace(/\/+$/, "") : pathname;

  return (
    normalizedPath === "/login" ||
    normalizedPath === "/registrieren" ||
    normalizedPath === "/auth/callback" ||
    normalizedPath === "/dashboard" ||
    normalizedPath.startsWith("/dashboard/")
  );
}

export function createPortalUrl(pathname: string, search = "") {
  return new URL(`${pathname}${search}`, `${APP_SITE_URL}/`);
}
