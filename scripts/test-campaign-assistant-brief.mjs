import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = readFileSync(
  join(root, "supabase/migrations/20260808200000_campaign_assistant_briefs.sql"),
  "utf8",
);
const inputSource = readFileSync(
  join(root, "src/lib/meta/customer-control-input.ts"),
  "utf8",
);
const serviceSource = readFileSync(
  join(root, "src/lib/meta/customer-control-service.ts"),
  "utf8",
);
const briefRoute = readFileSync(
  join(root, "src/app/api/meta/automation/campaign-brief/route.ts"),
  "utf8",
);
const archiveRoute = readFileSync(
  join(root, "src/app/api/meta/automation/campaign-brief/archive/route.ts"),
  "utf8",
);
const uiSource = readFileSync(
  join(root, "src/components/CampaignAssistantBrief.tsx"),
  "utf8",
);
const dashboardSource = readFileSync(
  join(root, "src/app/dashboard/page.tsx"),
  "utf8",
);

assert.match(migration, /create table if not exists public\.campaign_briefs/);
assert.match(migration, /put_campaign_brief/);
assert.match(migration, /archive_campaign_brief/);
assert.match(migration, /OUTCOME_TRAFFIC/);
assert.match(migration, /OUTCOME_APP_PROMOTION/);
assert.match(migration, /landing_url ~\* '\^https:\/\//);
assert.match(migration, /status in \('DRAFT', 'READY', 'CONSUMED', 'ARCHIVED'\)/);
assert.match(migration, /grant execute on function public\.put_campaign_brief/);
assert.match(migration, /to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.put_campaign_brief[\s\S]*to authenticated/);

assert.match(serviceSource, /saveCustomerCampaignBrief/);
assert.match(serviceSource, /archiveCustomerCampaignBrief/);
assert.match(serviceSource, /put_campaign_brief/);
assert.match(serviceSource, /archive_campaign_brief/);
assert.match(serviceSource, /p_landing_hostname/);
assert.match(serviceSource, /brief_hash/);

assert.match(briefRoute, /parseCampaignBriefCommand/);
assert.match(briefRoute, /saveCustomerCampaignBrief/);
assert.match(archiveRoute, /parseCampaignBriefArchiveCommand/);
assert.match(archiveRoute, /archiveCustomerCampaignBrief/);

assert.match(uiSource, /kampagnen-assistent/);
assert.match(uiSource, /\/api\/meta\/automation\/campaign-brief/);
assert.match(uiSource, /OUTCOME_TRAFFIC/);
assert.match(dashboardSource, /CampaignAssistantBrief/);
assert.match(dashboardSource, /#kampagnen-assistent/);
assert.match(dashboardSource, /from\("campaign_briefs"\)/);

const transpiledInput = ts.transpileModule(inputSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const inputModuleUrl = `data:text/javascript;base64,${Buffer.from(
  transpiledInput,
).toString("base64")}`;
const {
  CustomerControlInputError,
  parseCampaignBriefArchiveCommand,
  parseCampaignBriefCommand,
} = await import(inputModuleUrl);

function expectInputError(callback, expectedCode) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof CustomerControlInputError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

assert.deepEqual(
  parseCampaignBriefCommand({
    objective: "OUTCOME_LEADS",
    landingUrl: "https://www.example.de/angebot",
    notes: "DACH Fokus",
  }),
  {
    objective: "OUTCOME_LEADS",
    landingUrl: "https://www.example.de/angebot",
    notes: "DACH Fokus",
  },
);

assert.deepEqual(
  parseCampaignBriefCommand({
    objective: "OUTCOME_TRAFFIC",
    landingUrl: "https://shop.example.com/path",
    notes: "",
  }),
  {
    objective: "OUTCOME_TRAFFIC",
    landingUrl: "https://shop.example.com/path",
    notes: "",
  },
);

expectInputError(
  () =>
    parseCampaignBriefCommand({
      objective: "REACH",
      landingUrl: "https://www.example.de",
      notes: "",
    }),
    "invalid_option",
);

expectInputError(
  () =>
    parseCampaignBriefCommand({
      objective: "OUTCOME_TRAFFIC",
      landingUrl: "http://www.example.de",
      notes: "",
    }),
  "invalid_destination_url",
);

expectInputError(
  () =>
    parseCampaignBriefCommand({
      objective: "OUTCOME_TRAFFIC",
      landingUrl: "https://www.example.de",
      notes: "x".repeat(501),
    }),
  "invalid_text",
);

const briefId = "11111111-1111-4111-8111-111111111111";
assert.deepEqual(parseCampaignBriefArchiveCommand({ briefId }), { briefId });
expectInputError(
  () =>
    parseCampaignBriefArchiveCommand({
      briefId: "11111111-1111-4111-8111-11111111111z",
    }),
  "invalid_uuid",
);

console.log("test-campaign-assistant-brief: ok");
