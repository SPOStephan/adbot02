import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read(
  "supabase/migrations/20260807130000_site_admins.sql",
);
assert.match(migration, /create table if not exists public\.site_admins/);
assert.match(migration, /stephan@meererfolg\.de/);
assert.match(migration, /grant select, insert, update, delete on table public\.site_admins to service_role/);
assert.doesNotMatch(migration, /grant .+ on table public\.site_admins to (anon|authenticated)/);

const helper = read("src/lib/auth/site-admin.ts");
assert.match(helper, /export async function isSiteAdmin/);
assert.match(helper, /site_admins/);
assert.match(helper, /createAdminClient/);

const api = read("src/app/api/legal/pages/route.ts");
assert.match(api, /isSiteAdmin/);
assert.match(api, /status: 403/);

const editorPage = read("src/app/dashboard/rechtliches/page.tsx");
assert.match(editorPage, /isSiteAdmin/);
assert.match(editorPage, /redirect\("\/dashboard"\)/);

const dashboardLayout = read("src/app/dashboard/layout.tsx");
const dashboardNav = read("src/lib/dashboard/navigation.ts");
assert.match(dashboardLayout, /isSiteAdmin/);
assert.match(dashboardNav, /getDashboardNavigation/);
assert.match(dashboardLayout, /isAdmin/);
assert.match(dashboardNav, /\/dashboard\/logo/);
assert.match(dashboardNav, /\/dashboard\/rechtliches/);

// Public legal pages stay readable without admin.
assert.match(read("src/app/impressum/page.tsx"), /getLegalPage\("impressum"\)/);
assert.match(read("src/app/datenschutz/page.tsx"), /getLegalPage\("datenschutz"\)/);
assert.match(read("src/app/agb/page.tsx"), /getLegalPage\("agb"\)/);
assert.doesNotMatch(read("src/app/impressum/page.tsx"), /isSiteAdmin/);
assert.doesNotMatch(read("src/app/datenschutz/page.tsx"), /isSiteAdmin/);
assert.doesNotMatch(read("src/app/agb/page.tsx"), /isSiteAdmin/);

console.log("test-site-admin: ok");
