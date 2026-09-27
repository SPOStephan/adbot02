import { findActiveCustomDomain } from "./funnelCustomDomains";
import { findActiveAccountDomain } from "./funnelAccountDomains";

export type HostnameBindingClash =
  | { kind: "funnel"; funnelId: string }
  | { kind: "account"; ownerUserId: string };

export async function findHostnameBindingClash(
  hostname: string,
): Promise<HostnameBindingClash | null> {
  const funnel = await findActiveCustomDomain(hostname);
  if (funnel) return { kind: "funnel", funnelId: funnel.funnelId };
  const account = await findActiveAccountDomain(hostname);
  if (account) return { kind: "account", ownerUserId: account.ownerUserId };
  return null;
}
