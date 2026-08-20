import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const siteUrls = readFileSync(join(root, "src/lib/site-urls.ts"), "utf8");
const envExample = readFileSync(join(root, ".env.example"), "utf8");
const dashboard = readFileSync(join(root, "src/app/dashboard/page.tsx"), "utf8");
const card = readFileSync(join(root, "src/components/FunnelWorkspaceCard.tsx"), "utf8");
const migration = readFileSync(
  join(root, "apps/adbot-funnel/supabase/migrations/20260808210000_funnel_owner_binding.sql"),
  "utf8",
);
const funnelTypes = readFileSync(join(root, "apps/adbot-funnel/shared/funnel.ts"), "utf8");
const settings = readFileSync(
  join(root, "apps/adbot-funnel/client/src/pages/admin/Settings.tsx"),
  "utf8",
);
const metaConversions = readFileSync(
  join(root, "apps/adbot-funnel/server/metaConversions.ts"),
  "utf8",
);

assert.match(siteUrls, /DEFAULT_FUNNEL_SITE_URL = "https:\/\/funnel\.adbot\.one"/);
assert.match(siteUrls, /export const FUNNEL_SITE_URL/);
assert.match(siteUrls, /export function createFunnelAdminUrl/);
assert.match(siteUrls, /export function createFunnelSsoEntryPath/);
assert.match(siteUrls, /return "\/api\/funnel\/sso"/);
assert.match(envExample, /NEXT_PUBLIC_FUNNEL_URL=https:\/\/funnel\.adbot\.one/);
assert.match(envExample, /FUNNEL_SSO_SECRET=/);

assert.match(dashboard, /FunnelWorkspaceCard/);
assert.match(dashboard, /label: "Funnel"/);
assert.match(dashboard, /createFunnelSsoEntryPath/);
assert.match(dashboard, /external: true/);
assert.match(card, /id="funnel"/);
assert.match(card, /FUNNEL_SITE_URL/);
assert.match(card, /createFunnelSsoEntryPath/);

assert.match(migration, /owner_user_id uuid/);
assert.match(migration, /owner_email text/);
assert.match(migration, /funnels_owner_user_id_idx/);

assert.match(funnelTypes, /META_CONVERSION_TRIGGERS = \["submit", "doi"\]/);
assert.match(funnelTypes, /conversionTrigger: MetaConversionTrigger/);
assert.match(funnelTypes, /ownerUserId: string \| null/);
assert.match(settings, /Conversion-Zeitpunkt/);
assert.match(settings, /conversionTrigger: "doi"/);
assert.match(settings, /automatisch aus dem Adbot-Portal/);
assert.match(metaConversions, /awaiting_doi/);

const portalMetaSync = readFileSync(
  join(root, "apps/adbot-funnel/server/_core/portalMetaSyncRoute.ts"),
  "utf8",
);
const funnelMetaSync = readFileSync(join(root, "src/lib/funnel-meta-sync.ts"), "utf8");
const pixelService = readFileSync(
  join(root, "src/lib/meta/customer-control-service.ts"),
  "utf8",
);
assert.match(portalMetaSync, /\/api\/internal\/portal-meta-sync/);
assert.match(portalMetaSync, /softApplyPixelToOwnerFunnels/);
assert.match(funnelMetaSync, /pushSoftMetaPixelToFunnel/);
assert.match(funnelMetaSync, /funnel_meta_pixel_sync/);
assert.match(pixelService, /pushSoftMetaPixelToFunnel/);
assert.match(pixelService, /syncConfirmedPixelsToWorkspaces/);

console.log("Funnel-Workspace-Regressionstests erfolgreich.");
