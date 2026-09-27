import { getFunnelIdByCustomHostname } from "./funnelCustomDomains";
import { getOwnerIdByAccountHostname } from "./funnelAccountDomains";
import { resolveFunnelHostKind, type ResolvedFunnelHost } from "../shared/funnelHostResolve";

export async function resolveRequestFunnelHost(hostname: string): Promise<ResolvedFunnelHost> {
  const funnelId = await getFunnelIdByCustomHostname(hostname);
  const ownerUserId = funnelId ? null : await getOwnerIdByAccountHostname(hostname);
  return resolveFunnelHostKind({
    hostname,
    extraSharedHosts: process.env.FUNNEL_SHARED_HOSTS,
    funnelId,
    ownerUserId,
  });
}
