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
assert.match(serviceSource, /executionState: "ACTIVE" \| "QUEUED"/);
assert.match(
  serviceSource,
  /executionState = drain\.succeeded \? "ACTIVE" : "QUEUED"/,
);
assert.doesNotMatch(serviceSource, /launch_execution_incomplete/);
assert.doesNotMatch(serviceSource, /Beitrag-Push fertig werden lassen/);
assert.match(
  serviceSource,
  /withLaunchFailureDetail\(launchApprovalFailureMessage\(error\), error\)/,
);
assert.doesNotMatch(
  serviceSource,
  /Der Aktiv-Launch ist nicht mehr exakt ausführbar\. Bitte Plan, Fingerprint, FREEZE_WRITES/,
);

const formerExclusiveMigration = await readFile(
  join(
    root,
    "supabase/migrations/20260817190000_launch_approve_exclusive_idle_held.sql",
  ),
  "utf8",
);
assert.match(
  formerExclusiveMigration,
  /meta_launch_account_blocks_exclusive_approve/,
);
assert.match(
  formerExclusiveMigration,
  /not_before, '-infinity'::timestamptz\) <= p_as_of/,
);
assert.match(
  formerExclusiveMigration,
  /if public\.meta_launch_account_blocks_exclusive_approve/,
);

const queueMigration = await readFile(
  join(
    root,
    "supabase/migrations/20260928112000_meta_launch_approval_accepts_queue.sql",
  ),
  "utf8",
);
assert.match(queueMigration, /meta_launch_account_blocks_exclusive_approve/);
assert.match(queueMigration, /select false/);
assert.match(queueMigration, /cleanup_stale_meta_customer_launches/);
assert.match(queueMigration, /meta_launch_canary_approvals approval/);
assert.match(queueMigration, /mutation_executions execution/);
assert.match(queueMigration, /remote_object_bindings binding/);
assert.match(queueMigration, /step\.dispatch_state <> 'NOT_DISPATCHED'/);
assert.match(queueMigration, /'infinity'::timestamptz/);
assert.match(queueMigration, /customer_requested_clean_restart/);

const maintenance = await readFile(
  join(root, "src/lib/meta/launch-maintenance.ts"),
  "utf8",
);
assert.match(maintenance, /cleanup_stale_meta_customer_launches/);
assert.match(maintenance, /p_min_age_seconds: 7200/);

const maintenanceRoute = await readFile(
  join(root, "src/app/api/cron/meta-launch-maintenance/route.ts"),
  "utf8",
);
assert.match(maintenanceRoute, /getCronAuthEnv/);
assert.match(maintenanceRoute, /constantTimeEqual/);
assert.match(maintenanceRoute, /runMetaLaunchMaintenance/);

const vercelConfig = JSON.parse(
  await readFile(join(root, "vercel.json"), "utf8"),
);
assert.deepEqual(
  vercelConfig.crons.find(
    (cron) => cron.path === "/api/cron/meta-launch-maintenance",
  ),
  {
    path: "/api/cron/meta-launch-maintenance",
    schedule: "17 */4 * * *",
  },
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
assert.match(traffic, /Kampagne erfolgreich an Meta übermittelt/);
assert.match(traffic, /Kampagnen-Übersicht öffnen/);
assert.match(traffic, /LANDING_PAGE_VIEWS/);
assert.match(traffic, /if \(launchSucceeded\) \{\s*return \(\s*<section/);
assert.ok(
  traffic.indexOf("if (launchSucceeded)") <
    traffic.indexOf("Traffic-Kampagne mit Optimierung"),
  "Traffic-Abschluss muss vor sämtlichen Kampagnenfeldern gerendert werden",
);
const trafficSuccessFlow = traffic.slice(
  traffic.indexOf('if (result.executionState === "ACTIVE")'),
  traffic.indexOf("async function retryMetaExperiment"),
);
assert.doesNotMatch(trafficSuccessFlow, /refresh\(\)/);
assert.match(
  traffic,
  /executionState !== "ACTIVE" && result\.executionState !== "QUEUED"/,
);
assert.match(
  traffic,
  /Kampagnenstart angenommen — automatische Ausführung läuft/,
);
assert.match(traffic, /Kein weiterer Klick nötig/);
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
assert.match(lead, /Kampagne erfolgreich an Meta übermittelt/);
assert.match(lead, /Kampagnen-Übersicht öffnen/);
assert.match(lead, /if \(launchSucceeded\) \{\s*return \(\s*<section/);
assert.ok(
  lead.indexOf("if (launchSucceeded)") <
    lead.indexOf("2. Anzeige gestalten und Kampagne starten"),
  "Lead-Abschluss muss vor sämtlichen Kampagnenfeldern gerendert werden",
);
const leadSuccessFlow = lead.slice(
  lead.indexOf("setLaunchState(result.executionState)"),
  lead.indexOf("async function approveHeldPlan"),
);
assert.doesNotMatch(leadSuccessFlow, /refresh\(\)/);
assert.match(lead, /PROTOCOL_APPROVE_REASON/);
assert.match(
  lead,
  /executionState !== "ACTIVE" && result\.executionState !== "QUEUED"/,
);
assert.match(
  lead,
  /Kampagnenstart angenommen — automatische Ausführung läuft/,
);
assert.match(lead, /Kein weiterer Klick nötig/);
assert.doesNotMatch(lead, /Kampagne freigegeben\. Adbot legt sie bei Meta an/);
assert.doesNotMatch(lead, /result\.executionWarning/);
assert.doesNotMatch(lead, /Freigabe-Begründung/);
assert.doesNotMatch(lead, /approveReason/);
assert.match(
  lead,
  /Lead-Canary: kurze Freeze-Phase für Freigabe/,
);

const funnelWorkspace = await readFile(
  join(root, "src/components/FunnelMetaCampaignWorkspace.tsx"),
  "utf8",
);
assert.match(funnelWorkspace, /const launchCompleted = launchState !== "IDLE"/);
assert.match(funnelWorkspace, /launchCompleted \? null : header/);
assert.match(funnelWorkspace, /launchCompleted \? null : \(\s*<CampaignGeoTargetCard/);
assert.match(funnelWorkspace, /onLaunchStateChange=\{setLaunchState\}/);

const trafficLaunchPage = await readFile(
  join(root, "src/app/dashboard/traffic-launch/page.tsx"),
  "utf8",
);
assert.match(trafficLaunchPage, /funnelHeader=\{leadFunnelCampaign \? header : undefined\}/);
assert.match(trafficLaunchPage, /\{leadFunnelCampaign \? null : header\}/);

const onboarding = await readFile(
  join(root, "src/components/AutomationOnboardingControls.tsx"),
  "utf8",
);
assert.match(onboarding, /primaryText: string \| null/);
assert.match(onboarding, /headline: string \| null/);

const dashboard = await readFile(
  join(root, "src/lib/dashboard/load-customer-dashboard.ts"),
  "utf8",
);
assert.match(dashboard, /copyField\("message"\)/);
assert.match(dashboard, /intended_after/);

console.log("Launch approve queue UX contract tests passed.");
