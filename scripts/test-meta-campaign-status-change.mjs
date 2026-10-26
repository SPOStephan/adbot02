import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(new URL("..", import.meta.url).pathname);
const read = (path) => readFile(join(root, path), "utf8");

const status = await import(join(root, "src/lib/meta/campaign-status-change.ts"));

assert.deepEqual(
  status.parseCampaignStatusChangeRequest({ platformCampaignId: " 120201 ", status: "PAUSED" }),
  { platformCampaignId: "120201", status: "PAUSED" },
);
assert.equal(status.parseCampaignStatusChangeRequest({ platformCampaignId: "120201", status: "DELETED" }), null);
assert.equal(status.parseCampaignStatusChangeRequest({ platformCampaignId: "act_1", status: "ACTIVE" }), null);
assert.equal(
  status.parseCampaignStatusChangeRequest({ platformCampaignId: "1", status: "ACTIVE", extra: true }),
  null,
);
assert.equal(status.parseCampaignStatusChangeRequest(null), null);

const base = { launchedByAdbot: true, kind: "lead", lifecycle: "active", statusLabel: "Aktiv" };
assert.equal(status.campaignStatusAction(base), "PAUSED");
assert.equal(status.campaignStatusAction({ ...base, kind: "traffic" }), "PAUSED");
assert.equal(
  status.campaignStatusAction({ ...base, lifecycle: "archived", statusLabel: "Pausiert" }),
  "ACTIVE",
);
assert.equal(
  status.campaignStatusAction({ ...base, lifecycle: "archived", statusLabel: "Beendet" }),
  null,
);
assert.equal(status.campaignStatusAction({ ...base, kind: "boost" }), null);
assert.equal(status.campaignStatusAction({ ...base, launchedByAdbot: false }), null);

assert.match(status.campaignStatusBlockedMessage("status_changes_not_allowed"), /Status ändern/);
assert.match(status.campaignStatusBlockedMessage("unknown_reason"), /nicht vorbereitet/);
assert.equal(status.isTerminalPlanStatus("SUCCEEDED"), true);
assert.equal(status.isTerminalPlanStatus("PENDING"), false);

const migration = await read("supabase/migrations/20261026120000_meta_customer_campaign_status.sql");
assert.match(migration, /launch\.source_rule_key = 'active-launch-chain'/);
assert.match(migration, /resume_respects_later_status_change/);
assert.match(migration, /later_status_change_wins/);
assert.match(migration, /launch\.source_rule_key = 'organic-boost'/);

const overview = await read("src/components/CampaignAdOverview.tsx");
assert.match(overview, /campaignStatusAction\(item\)/);
assert.match(overview, /<MetaCampaignStatusButton/);

const route = await read("src/app/api/meta/automation/campaign-status/route.ts");
assert.match(route, /readControlJson/);
assert.match(route, /authenticateMetaCustomer/);

console.log("Meta campaign status change checks passed");
