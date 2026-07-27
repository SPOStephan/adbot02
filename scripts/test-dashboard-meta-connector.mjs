import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(scriptsDirectory, "..");

const dashboardSource = await readFile(
  join(projectRoot, "src/app/dashboard/page.tsx"),
  "utf8",
);
const cardSource = await readFile(
  join(projectRoot, "src/components/PlatformStatusCard.tsx"),
  "utf8",
);
const callbackSource = await readFile(
  join(projectRoot, "src/app/api/connectors/meta/callback/route.ts"),
  "utf8",
);

assert.match(dashboardSource, /actionHref:[\s\S]*"\/api\/connectors\/meta\/start"/);
assert.match(dashboardSource, /actionLabel:[\s\S]*"Meta verbinden"/);
assert.match(dashboardSource, /badge:[\s\S]*"Nur Lesezugriff"/);
assert.match(
  dashboardSource,
  /Keine Kampagnen-, Publishing- oder Messaging-Rechte\./,
);
assert.match(dashboardSource, /meta === "connected" && metaConnected/);
assert.match(dashboardSource, /Meta wurde erfolgreich verbunden\./);
assert.match(dashboardSource, /Meta-Verbindung noch nicht bestätigt\./);
assert.match(dashboardSource, /Meta konnte nicht verbunden werden\./);
assert.match(dashboardSource, /invalid_state/);
assert.match(dashboardSource, /storage/);
assert.doesNotMatch(dashboardSource, /ads_management|business_management/);

assert.match(cardSource, /href=\{actionHref!\}/);
assert.match(cardSource, /prefetch=\{false\}/);
assert.match(cardSource, /Aktiv verbunden/);
assert.match(cardSource, /In Vorbereitung/);
assert.match(cardSource, /focus-visible:outline-blue-600/);

assert.match(callbackSource, /dashboardRedirect\("connected"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "storage"\)/);
assert.match(callbackSource, /dashboardRedirect\("error", "invalid_state"\)/);

console.log("Dashboard Meta connector checks passed");
