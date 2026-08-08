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

const recommendations = read("src/lib/site-branding/recommendations.ts");
assert.match(recommendations, /360/);
assert.match(recommendations, /480/);
assert.match(recommendations, /80/);
assert.match(recommendations, /120/);
assert.match(recommendations, /onLight/);
assert.match(recommendations, /onDark/);

const api = read("src/app/api/site-branding/logo/route.ts");
assert.match(api, /isSiteAdmin/);
assert.match(api, /export async function POST/);
assert.match(api, /export async function DELETE/);

const editorPage = read("src/app/dashboard/logo/page.tsx");
assert.match(editorPage, /SiteLogoEditor/);
assert.match(editorPage, /isSiteAdmin/);

const editor = read("src/components/SiteLogoEditor.tsx");
assert.match(editor, /SITE_LOGO_RECOMMENDATIONS\.onLight/);
assert.match(editor, /SITE_LOGO_RECOMMENDATIONS\.onDark/);
assert.match(editor, /Empfohlene Größe/);
assert.match(recommendations, /Heller Modus/);
assert.match(recommendations, /Dark Mode/);

const mark = read("src/components/SiteBrandMark.tsx");
assert.match(mark, /logoOnDarkUrl/);
assert.match(mark, /logoOnLightUrl/);
assert.match(mark, /tone === "dark"/);

assert.match(read("src/app/page.tsx"), /SiteBrandMark[\s\S]*tone="dark"/);
assert.match(read("src/app/dashboard/page.tsx"), /tone="light"/);
assert.match(read("src/app/dashboard/page.tsx"), /\/dashboard\/logo/);
assert.match(read("src/components/LegalDocument.tsx"), /tone="light"/);
assert.match(read("src/app/login/page.tsx"), /tone="dark"/);

assert.match(read("src/lib/site-branding/storage.ts"), /site-branding/);
assert.match(read("src/lib/site-branding/storage.ts"), /public: true/);

console.log("test-site-logo: ok");
