import { isSharedFunnelHost, normalizeHostname } from "./funnelHosts";

export type FunnelHostBindingKind = "funnel" | "account";

export type ResolvedFunnelHost =
  | { kind: "platform"; hostname: string }
  | { kind: "funnel"; hostname: string; funnelId: string }
  | { kind: "account"; hostname: string; ownerUserId: string }
  | { kind: "unknown"; hostname: string };

export type PublicFunnelListItem = {
  slug: string;
  title: string;
};

export function hostnameFromSourceUrl(sourceUrl?: string | null): string {
  if (!sourceUrl) return "";
  try {
    return normalizeHostname(new URL(sourceUrl).hostname);
  } catch {
    return "";
  }
}

export function accountFunnelPath(slug: string): string {
  const clean = slug.trim().replace(/^\/+/, "");
  return `/f/${clean}`;
}

export function accountFunnelUrl(hostname: string, slug: string): string {
  return `https://${normalizeHostname(hostname)}${accountFunnelPath(slug)}`;
}

export function resolveFunnelHostKind(input: {
  hostname: string;
  extraSharedHosts?: string | null;
  funnelId?: string | null;
  ownerUserId?: string | null;
}): ResolvedFunnelHost {
  const hostname = normalizeHostname(input.hostname);
  if (!hostname || isSharedFunnelHost(hostname, input.extraSharedHosts)) {
    return { kind: "platform", hostname: hostname || "localhost" };
  }
  if (input.funnelId) {
    return { kind: "funnel", hostname, funnelId: input.funnelId };
  }
  if (input.ownerUserId) {
    return { kind: "account", hostname, ownerUserId: input.ownerUserId };
  }
  return { kind: "unknown", hostname };
}

export function funnelAllowedOnHost(input: {
  host: ResolvedFunnelHost;
  funnelId: string;
  funnelSlug: string;
  ownerUserId: string | null;
}): boolean {
  if (input.host.kind === "platform") return true;
  if (input.host.kind === "unknown") return false;
  if (input.host.kind === "funnel") {
    return input.host.funnelId === input.funnelId;
  }
  return Boolean(input.ownerUserId && input.ownerUserId === input.host.ownerUserId);
}
