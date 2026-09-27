import { afterEach, describe, expect, it } from "vitest";
import { registerCustomDomain, resetCustomDomainMemoryForTests } from "./funnelCustomDomains";
import {
  getOwnerIdByAccountHostname,
  listAccountDomainsForOwner,
  markAccountDomainReady,
  registerAccountDomain,
  resetAccountDomainMemoryForTests,
} from "./funnelAccountDomains";
import { findActiveCustomDomain } from "./funnelCustomDomains";
import { findActiveAccountDomain } from "./funnelAccountDomains";
import { findHostnameBindingClash } from "./funnelDomainClash";

const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const owner = "11111111-1111-4111-8111-111111111111";

describe("Account-Domains", () => {
  afterEach(() => {
    resetAccountDomainMemoryForTests();
    resetCustomDomainMemoryForTests();
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    else delete process.env.SUPABASE_URL;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("bindet eine Domain an das Konto und liefert sie nach READY per Hostname", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetAccountDomainMemoryForTests();

    const first = await registerAccountDomain({
      ownerUserId: owner,
      hostname: "Karriere.Kunde.de",
    });
    const again = await registerAccountDomain({
      ownerUserId: owner,
      hostname: "karriere.kunde.de",
    });
    expect(again.id).toBe(first.id);
    expect(first.status).toBe("PENDING_DNS");
    expect(await getOwnerIdByAccountHostname("karriere.kunde.de")).toBeNull();

    const ready = await markAccountDomainReady({ ownerUserId: owner, domainId: first.id });
    expect(ready.status).toBe("READY");
    expect(await getOwnerIdByAccountHostname("karriere.kunde.de")).toBe(owner);
    expect(await listAccountDomainsForOwner(owner)).toHaveLength(1);
  });

  it("verhindert, dass dieselbe Domain Funnel-Root und Account-Domain ist", async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetAccountDomainMemoryForTests();
    resetCustomDomainMemoryForTests();

    await registerCustomDomain({ funnelId: "funnel-a", hostname: "jobs.kunde.de" });
    expect(await findActiveCustomDomain("jobs.kunde.de")).toBeTruthy();
    const account = await registerAccountDomain({ ownerUserId: owner, hostname: "andere.kunde.de" });
    const found = await findActiveAccountDomain("andere.kunde.de");
    expect(found?.id).toBe(account.id);
    const clash = await findHostnameBindingClash("jobs.kunde.de");
    expect(clash).toEqual({ kind: "funnel", funnelId: "funnel-a" });
    await expect(
      findHostnameBindingClash("andere.kunde.de"),
    ).resolves.toEqual({ kind: "account", ownerUserId: owner });
  });
});
