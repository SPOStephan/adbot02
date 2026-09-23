import { isAllowedFunnelAdminPath } from "@shared/funnelAdminPaths";

function portalBaseUrl(): string {
  const fromEnv =
    (typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_ADBOT_PORTAL_URL as string | undefined) ||
        (import.meta.env?.VITE_PUBLIC_PORTAL_URL as string | undefined)
      : undefined) ?? "";
  return (fromEnv.trim() || "https://app.adbot.one").replace(/\/+$/, "");
}

export function portalFunnelSsoUrl(nextPath = "/admin"): string {
  const next = isAllowedFunnelAdminPath(nextPath) ? nextPath : "/admin";
  const url = new URL("/api/funnel/sso", `${portalBaseUrl()}/`);
  if (next !== "/admin") url.searchParams.set("next", next);
  return url.toString();
}
