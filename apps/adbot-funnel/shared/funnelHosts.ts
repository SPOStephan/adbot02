/** Shared Funnel hosts keep the classic `/f/:slug` URLs. Everything else can be a custom domain. */

const DEFAULT_SHARED_FUNNEL_HOSTS = [
  "funnel.adbot.one",
  "www.funnel.adbot.one",
  "localhost",
  "127.0.0.1",
] as const;

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
}

export function parseSharedFunnelHosts(raw: string | undefined | null): string[] {
  const fromEnv = (raw ?? "")
    .split(",")
    .map(part => normalizeHostname(part))
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_SHARED_FUNNEL_HOSTS, ...fromEnv]));
}

export function isSharedFunnelHost(
  hostname: string,
  extraRaw?: string | null,
): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (normalized.endsWith(".vercel.app")) return true;
  return parseSharedFunnelHosts(extraRaw).includes(normalized);
}

export function getBrowserHostname(): string {
  if (typeof window === "undefined") return "";
  return normalizeHostname(window.location.hostname);
}
