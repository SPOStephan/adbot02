import {
  isSharedFreebieHost as isSharedFreebieHostShared,
  getBrowserHostname,
  normalizeHostname,
  parseSharedFreebieHosts,
} from "@shared/freebieHosts";

export { getBrowserHostname, normalizeHostname, parseSharedFreebieHosts };

export function isSharedFreebieHost(hostname = getBrowserHostname()): boolean {
  const extra =
    typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_FREEBIE_SHARED_HOSTS as string | undefined)
      : undefined;
  return isSharedFreebieHostShared(hostname, extra);
}
