/** Allowlisted Funnel admin paths for SSO `next` — never open redirects. */

export function normalizeFunnelHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
}

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

export function resolveFunnelAdminNextPath(
  raw: unknown,
  fallback = "/admin",
): string {
  if (typeof raw !== "string" || !isAllowedFunnelAdminPath(raw)) {
    return fallback;
  }
  return raw.trim();
}
