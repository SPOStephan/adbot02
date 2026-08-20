import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function normalizeCustomHostname(value) {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function destinationUrlForHostname(hostname) {
  return `https://${normalizeCustomHostname(hostname)}/`;
}

function cnameMatchesExpected(records, expectedTarget) {
  const expected = expectedTarget.trim().toLowerCase().replace(/\.$/, "");
  return records.some((record) => {
    const value = record.trim().toLowerCase().replace(/\.$/, "");
    if (!value) return false;
    if (value === expected) return true;
    if (expected.endsWith("vercel-dns.com") && value.endsWith("vercel-dns.com")) {
      return true;
    }
    return false;
  });
}

test("custom hostname helpers", () => {
  assert.equal(normalizeCustomHostname(" Leads.Example.DE. "), "leads.example.de");
  assert.equal(
    destinationUrlForHostname("leads.example.de"),
    "https://leads.example.de/",
  );
  assert.equal(
    cnameMatchesExpected(["abc.vercel-dns.com"], "cname.vercel-dns.com"),
    true,
  );
  assert.equal(
    cnameMatchesExpected(["example.net"], "cname.vercel-dns.com"),
    false,
  );
});

test("portal wiring for global domains", () => {
  const nav = readFileSync(join(root, "src/lib/dashboard/navigation.ts"), "utf8");
  const page = readFileSync(
    join(root, "src/app/dashboard/domains/page.tsx"),
    "utf8",
  );
  const binding = readFileSync(
    join(root, "src/components/CustomDomainBinding.tsx"),
    "utf8",
  );
  const lead = readFileSync(
    join(root, "src/components/LeadLaunchCanary.tsx"),
    "utf8",
  );
  const migration = readFileSync(
    join(root, "supabase/migrations/20260820140000_customer_custom_domains.sql"),
    "utf8",
  );
  const api = readFileSync(
    join(root, "src/app/api/custom-domains/route.ts"),
    "utf8",
  );
  const dns = readFileSync(join(root, "src/lib/custom-domains/dns.ts"), "utf8");
  const freebieCard = readFileSync(
    join(root, "src/components/FreebieWorkspaceCard.tsx"),
    "utf8",
  );

  assert.match(nav, /label: "Domains"/);
  assert.match(nav, /\/dashboard\/domains/);
  assert.match(page, /CustomDomainBinding/);
  assert.match(binding, /Domains global verbinden/);
  assert.match(lead, /readyCustomDomains/);
  assert.match(lead, /Ziel-Domain/);
  assert.match(migration, /customer_custom_domains/);
  assert.match(api, /action === "register"/);
  assert.match(api, /action === "verify"/);
  assert.match(dns, /cnameMatchesExpected/);
  assert.match(freebieCard, /\/dashboard\/domains/);
  assert.match(page, /Freebie-Admin/);
  assert.match(page, /Freebie-Vercel/);

  const freebieMigration = readFileSync(
    join(
      root,
      "apps/adbot-freebie/supabase/migrations/20260820170000_freebie_custom_domains.sql",
    ),
    "utf8",
  );
  const freebieHosts = readFileSync(
    join(root, "apps/adbot-freebie/shared/freebieHosts.ts"),
    "utf8",
  );
  const freebieRouters = readFileSync(
    join(root, "apps/adbot-freebie/server/routers.ts"),
    "utf8",
  );
  const freebieAdmin = readFileSync(
    join(root, "apps/adbot-freebie/client/src/pages/AdminPage.tsx"),
    "utf8",
  );
  const freebieOffer = readFileSync(
    join(root, "apps/adbot-freebie/client/src/pages/OfferPage.tsx"),
    "utf8",
  );

  assert.match(freebieMigration, /freebie_custom_domains/);
  assert.match(freebieHosts, /isSharedFreebieHost/);
  assert.match(freebieRouters, /offerByHost/);
  assert.match(freebieRouters, /registerCustomDomain/);
  assert.match(freebieAdmin, /Custom Domain/);
  assert.match(freebieOffer, /HostBoundOffer/);
});
