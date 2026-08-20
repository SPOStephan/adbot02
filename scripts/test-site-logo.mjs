import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read(
  "supabase/migrations/20260808130000_site_branding.sql",
);
assert.match(migration, /create table if not exists public\.site_branding/);
assert.match(migration, /logo_on_light_path/);
assert.match(migration, /logo_on_dark_path/);

const faviconMigration = read(
  "supabase/migrations/20260820160000_site_branding_favicon.sql",
);
assert.match(faviconMigration, /favicon_path/);
assert.match(faviconMigration, /favicon_mime/);

const recommendations = read("src/lib/site-branding/recommendations.ts");
assert.match(recommendations, /360/);
assert.match(recommendations, /480/);
assert.match(recommendations, /80/);
assert.match(recommendations, /120/);
assert.match(recommendations, /onLight/);
assert.match(recommendations, /onDark/);
assert.match(recommendations, /SITE_FAVICON_RECOMMENDATIONS/);

const api = read("src/app/api/site-branding/logo/route.ts");
assert.match(api, /isSiteAdmin/);
assert.match(api, /export async function POST/);
assert.match(api, /export async function DELETE/);

const faviconApi = read("src/app/api/site-branding/favicon/route.ts");
assert.match(faviconApi, /isSiteAdmin/);
assert.match(faviconApi, /saveSiteFavicon/);

const editorPage = read("src/app/dashboard/branding/page.tsx");
assert.match(editorPage, /SiteLogoEditor/);
assert.match(editorPage, /isSiteAdmin/);
assert.match(editorPage, /Branding/);

const logoRedirect = read("src/app/dashboard/logo/page.tsx");
assert.match(logoRedirect, /\/dashboard\/branding/);

const editor = read("src/components/SiteLogoEditor.tsx");
assert.match(editor, /SITE_LOGO_RECOMMENDATIONS\.onLight/);
assert.match(editor, /SITE_LOGO_RECOMMENDATIONS\.onDark/);
assert.match(editor, /Empfohlene Größe/);
assert.match(editor, /Favicon/);
assert.match(editor, /\/api\/site-branding\/favicon/);
assert.match(recommendations, /Heller Modus/);
assert.match(recommendations, /Dark Mode/);

const mark = read("src/components/SiteBrandMark.tsx");
assert.match(mark, /logoOnDarkUrl/);
assert.match(mark, /logoOnLightUrl/);
assert.match(mark, /tone === "dark"/);
assert.match(mark, /Adbot\.one/);

assert.match(read("src/app/page.tsx"), /SiteBrandMark[\s\S]*tone="dark"/);
assert.match(read("src/components/DashboardShell.tsx"), /tone="light"/);
assert.match(read("src/lib/dashboard/navigation.ts"), /\/dashboard\/branding/);
assert.match(read("src/lib/dashboard/navigation.ts"), /label: "Branding"/);
assert.match(read("src/components/LegalDocument.tsx"), /tone="light"/);
assert.match(read("src/app/login/page.tsx"), /tone="dark"/);

assert.match(read("src/lib/site-branding/storage.ts"), /site-branding/);
assert.match(read("src/lib/site-branding/storage.ts"), /public: true/);
assert.match(read("src/lib/site-branding/storage.ts"), /uploadSiteFavicon/);
assert.match(read("src/lib/site-branding/branding.ts"), /faviconUrl/);
assert.match(read("src/components/SiteFooter.tsx"), /Adbot\.one/);
assert.match(read("src/app/layout.tsx"), /generateMetadata/);
assert.match(read("src/app/layout.tsx"), /\/icon\?v=/);
assert.match(read("src/app/icon/route.ts"), /serveSiteFaviconResponse/);
assert.match(
  read("src/lib/site-branding/serve-favicon.ts"),
  /faviconUrl/,
);
assert.match(
  read("next.config.ts"),
  /source:\s*"\/favicon\.ico"/,
);
assert.match(
  read("next.config.ts"),
  /destination:\s*"\/icon"/,
);

import { existsSync } from "node:fs";
assert.equal(
  existsSync(new URL("../src/app/favicon.ico", import.meta.url)),
  false,
  "static src/app/favicon.ico must be removed so branding icon is served",
);

console.log("test-site-logo: ok");
