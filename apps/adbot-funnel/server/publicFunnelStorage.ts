/** Public funnel media may be rendered on custom domains without an admin session. */
const PUBLIC_FUNNEL_STORAGE =
  /^funnels\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(branding|portraits|backgrounds)\//i;

export function isPublicFunnelStorageKey(key: string): boolean {
  const normalized = key.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!normalized || normalized.includes("..")) return false;
  return PUBLIC_FUNNEL_STORAGE.test(normalized);
}
