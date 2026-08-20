/** Shared Freebie hosts keep classic `/o/:slug` URLs. Everything else can be a custom domain. */

const DEFAULT_SHARED_FREEBIE_HOSTS = [
  "freebie.adbot.one",
  "www.freebie.adbot.one",
  "localhost",
  "127.0.0.1",
] as const;

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function parseSharedFreebieHosts(raw: string | undefined | null): string[] {
  const fromEnv = (raw ?? "")
    .split(",")
    .map(part => normalizeHostname(part))
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_SHARED_FREEBIE_HOSTS, ...fromEnv]));
}

export function isSharedFreebieHost(
  hostname: string,
  extraRaw?: string | null,
): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return true;
  if (normalized.endsWith(".vercel.app")) return true;
  return parseSharedFreebieHosts(extraRaw).includes(normalized);
}

export function getBrowserHostname(): string {
  if (typeof window === "undefined") return "";
  return normalizeHostname(window.location.hostname);
}
