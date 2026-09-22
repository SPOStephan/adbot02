import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const help = readFileSync(join(root, "src/lib/help/lead-funnel-setup.ts"), "utf8");
const guidePage = readFileSync(join(root, "src/app/dashboard/hilfe/page.tsx"), "utf8");
const aside = readFileSync(join(root, "src/components/DashboardAsideChrome.tsx"), "utf8");
const customerDoc = readFileSync(
  join(root, "docs/customer/LEAD_FUNNEL_LIVE_SETUP.md"),
  "utf8",
);
const applicationDetail = readFileSync(
  join(root, "apps/adbot-funnel/client/src/pages/admin/ApplicationDetail.tsx"),
  "utf8",
);
const editor = readFileSync(
  join(root, "apps/adbot-funnel/client/src/pages/admin/FunnelEditor.tsx"),
  "utf8",
);

assert.match(help, /id: "pixel"/);
assert.match(help, /id: "funnel-tracking"/);
assert.match(help, /id: "domain"/);
assert.match(help, /id: "canary"/);
assert.match(help, /id: "quality"/);
assert.match(help, /Subscribe/);
assert.match(help, /Bewerbungsübersicht und Verwaltung liegen danach auf derselben Domain/);
assert.match(help, /next=\/admin\/applications/);
assert.match(customerDoc, /\/admin\/applications/);
assert.match(help, /CAPI prüfen und Pixel bestätigen/);
assert.match(help, /Events-Manager-Token ist nicht der Kundenweg/);
assert.match(customerDoc, /CAPI prüfen und Pixel bestätigen/);
assert.match(customerDoc, /nicht der Kundenweg/);
assert.match(guidePage, /LiveSetupGuide/);
assert.match(aside, /\/dashboard\/hilfe/);
assert.match(customerDoc, /Gute und schlechte Leads bewerten/);
assert.match(applicationDetail, /rateLeadQuality/);
assert.match(applicationDetail, /Gut/);
assert.match(applicationDetail, /Schlecht/);
assert.match(editor, /Wert für Meta/);

console.log("Lead-Funnel-Setup-Anleitung und Bewertungsflächen vorhanden.");
