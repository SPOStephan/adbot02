import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const serviceSource = await readFile(
  join(root, "src/lib/meta/customer-control-service.ts"),
  "utf8",
);
assert.match(serviceSource, /function launchApprovalFailureMessage/);
assert.match(serviceSource, /exclusive idle account/);
assert.match(serviceSource, /ensureFreezeWritesForLaunch\(customer\)/);
assert.match(serviceSource, /drainApprovedLaunchChainForAccount/);
assert.match(
  serviceSource,
  /withLaunchFailureDetail\(launchApprovalFailureMessage\(error\), error\)/,
);
assert.doesNotMatch(
  serviceSource,
  /Der Aktiv-Launch ist nicht mehr exakt ausführbar\. Bitte Plan, Fingerprint, FREEZE_WRITES/,
);

const migration = await readFile(
  join(
    root,
    "supabase/migrations/20260817190000_launch_approve_exclusive_idle_held.sql",
  ),
  "utf8",
);
assert.match(migration, /meta_launch_account_blocks_exclusive_approve/);
assert.match(migration, /not_before, '-infinity'::timestamptz\) <= p_as_of/);
assert.match(
  migration,
  /if public\.meta_launch_account_blocks_exclusive_approve/,
);
assert.equal(
  (
    migration.match(
      /other\.status in \(\s*'PENDING', 'RETRYABLE', 'CLAIMED'/g,
    ) ?? []
  ).length,
  0,
);

const traffic = await readFile(
  join(root, "src/components/TrafficLaunchCanary.tsx"),
  "utf8",
);
assert.match(traffic, /Vorschau prüfen/);
assert.match(traffic, /objectiveLabel/);
assert.match(traffic, /friendlyCampaignLabel/);
assert.match(traffic, /\/api\/media-library\/preview\?assetId=/);
assert.match(traffic, /notice && !heldPlan/);
assert.match(traffic, /Weitere Traffic-Kampagne starten/);
assert.match(traffic, /Erledigt — Kampagne ist live/);
assert.match(traffic, /PROTOCOL_APPROVE_REASON/);
assert.match(traffic, /launchSucceeded/);
assert.match(traffic, /CreativeTextVariantFields/);
assert.match(traffic, /primaryTexts/);
assert.doesNotMatch(traffic, /Freigabe-Begründung/);
assert.doesNotMatch(traffic, /approveReason/);
assert.match(
  traffic,
  /Traffic-Canary: kurze Freeze-Phase für Freigabe/,
);
assert.doesNotMatch(
  traffic,
  /if \(killSwitchMode === "FREEZE_WRITES"\) \{\s*return;/,
);

const lead = await readFile(
  join(root, "src/components/LeadLaunchCanary.tsx"),
  "utf8",
);
assert.match(lead, /Vorschau prüfen/);
assert.match(lead, /CreativeTextVariantFields/);
assert.match(lead, /primaryTexts/);
assert.match(lead, /Weitere Lead-Kampagne starten/);
assert.match(lead, /PROTOCOL_APPROVE_REASON/);
assert.doesNotMatch(lead, /Freigabe-Begründung/);
assert.doesNotMatch(lead, /approveReason/);
assert.match(
  lead,
  /Lead-Canary: kurze Freeze-Phase für Freigabe/,
);

const onboarding = await readFile(
  join(root, "src/components/AutomationOnboardingControls.tsx"),
  "utf8",
);
assert.match(onboarding, /primaryText: string \| null/);
assert.match(onboarding, /headline: string \| null/);

const dashboard = await readFile(
  join(root, "src/app/dashboard/page.tsx"),
  "utf8",
);
assert.match(dashboard, /copyField\("message"\)/);
assert.match(dashboard, /intended_after/);

console.log("Launch approve UX contract tests passed.");
