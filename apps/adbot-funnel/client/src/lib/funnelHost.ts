import {
  isSharedFunnelHost as isSharedFunnelHostShared,
  getBrowserHostname,
  normalizeHostname,
  parseSharedFunnelHosts,
} from "@shared/funnelHosts";

export { getBrowserHostname, normalizeHostname, parseSharedFunnelHosts };

export function isSharedFunnelHost(hostname = getBrowserHostname()): boolean {
  const extra =
    typeof import.meta !== "undefined"
      ? (import.meta.env?.VITE_FUNNEL_SHARED_HOSTS as string | undefined)
      : undefined;
  return isSharedFunnelHostShared(hostname, extra);
}
