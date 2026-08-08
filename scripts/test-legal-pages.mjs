import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

assert.match(read("src/app/impressum/page.tsx"), /getLegalPage\("impressum"\)/);
assert.match(read("src/app/datenschutz/page.tsx"), /getLegalPage\("datenschutz"\)/);
assert.match(read("src/components/SiteFooter.tsx"), /\/impressum/);
assert.match(read("src/components/SiteFooter.tsx"), /\/datenschutz/);
assert.match(read("src/app/dashboard/rechtliches/page.tsx"), /LegalPagesEditor/);
assert.match(read("src/app/dashboard/rechtliches/page.tsx"), /isSiteAdmin/);
assert.match(read("src/app/api/legal/pages/route.ts"), /saveLegalPage/);
assert.match(read("src/app/api/legal/pages/route.ts"), /isSiteAdmin/);
assert.match(
  read("supabase/migrations/20260807120000_site_legal_pages.sql"),
  /site_legal_pages/,
);
assert.match(
  read("supabase/migrations/20260807130000_site_admins.sql"),
  /site_admins/,
);
assert.match(read("src/app/dashboard/page.tsx"), /\/dashboard\/rechtliches/);
assert.match(read("src/app/dashboard/page.tsx"), /userIsSiteAdmin/);
assert.match(read("content/legal/impressum.md"), /Anbieter/);
assert.match(read("content/legal/datenschutz.md"), /Verantwortlicher/);
assert.doesNotMatch(read("content/legal/impressum.md"), /^#{1,6}\s/m);
assert.doesNotMatch(read("content/legal/datenschutz.md"), /^#{1,6}\s/m);

console.log("test-legal-pages: ok");


