import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const migration = await readFile(
  join(root, "supabase/migrations/20260925120000_campaign_idea_pipeline.sql"),
  "utf8",
);
assert.match(migration, /create table if not exists public\.campaign_ideas/);
assert.match(migration, /source_type in \('LINK', 'SCREENSHOT', 'KEYWORDS'\)/);
assert.match(
  migration,
  /status in \(\s*'QUEUED', 'READY', 'REALIZING', 'REALIZED', 'FAILED', 'ARCHIVED'\s*\)/,
);
assert.match(migration, /put_campaign_idea/);
assert.match(migration, /set_campaign_idea_core/);
assert.match(migration, /realize_campaign_idea/);
assert.match(migration, /Competitor screenshot must not be used as the launch creative/);
assert.match(migration, /library_scope = 'CUSTOMER'/);
assert.match(migration, /grant execute on function public\.put_campaign_idea/);
assert.match(migration, /to service_role/);
assert.doesNotMatch(
  migration,
  /grant execute on function public\.put_campaign_idea[\s\S]*to authenticated/,
);
assert.doesNotMatch(migration, /materialize_meta_organic_boost_plan/);
assert.doesNotMatch(migration, /library_scope = 'INSPIRATION'/);

const ui = await readFile(
  join(root, "src/components/CampaignIdeaPipeline.tsx"),
  "utf8",
);
assert.match(ui, /Idee jetzt umsetzen/);
assert.match(ui, /niemals 1:1/);
assert.match(ui, /\/api\/meta\/automation\/campaign-idea/);
assert.match(ui, /campaign-idea\/realize/);
assert.doesNotMatch(ui, /from \"@\/lib\/campaign-pipeline\/service\"/);

const nav = await readFile(join(root, "src/lib/dashboard/navigation.ts"), "utf8");
assert.match(nav, /\/dashboard\/kampagnen-pipeline/);

const page = await readFile(
  join(root, "src/app/dashboard/kampagnen-pipeline/page.tsx"),
  "utf8",
);
assert.match(page, /CampaignIdeaPipeline/);
assert.match(page, /from\(\"campaign_ideas\"\)/);

const realizeRoute = await readFile(
  join(root, "src/app/api/meta/automation/campaign-idea/realize/route.ts"),
  "utf8",
);
assert.match(realizeRoute, /parseCampaignIdeaRealizeCommand/);
assert.match(realizeRoute, /realizeCampaignIdea/);

const launchPage = await readFile(
  join(root, "src/app/dashboard/traffic-launch/page.tsx"),
  "utf8",
);
assert.match(launchPage, /ideaId/);
assert.match(launchPage, /screenshot_asset_id/);
assert.match(launchPage, /initialDestinationUrl/);

const service = await readFile(
  join(root, "src/lib/campaign-pipeline/service.ts"),
  "utf8",
);
assert.match(service, /screenshotAssetId/);
assert.match(service, /generated\.brandAssetId !== latest\.screenshotAssetId/);
assert.doesNotMatch(service, /materialize_meta_organic_boost_plan/);

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), "adbot-idea-pipeline-"));
try {
  const coreSource = await readFile(
    join(root, "src/lib/campaign-pipeline/idea-core.ts"),
    "utf8",
  );
  const corePath = join(temporaryDirectory, "idea-core.mjs");
  await writeFile(corePath, transpile(coreSource), "utf8");
  const core = await import(pathToFileURL(corePath).href);

  const parsed = core.parseIdeaCore({
    product: "Coaching",
    offer: "Erstgespräch",
    core_summary: "Lokales Coaching sichtbar machen, ohne Fremdmarke.",
    forbidden_verbatim: ["Bester Coach der Stadt", "Bester Coach der Stadt"],
    not_for_direct_use: false,
  });
  assert.equal(parsed.not_for_direct_use, true);
  assert.equal(parsed.product, "Coaching");
  assert.deepEqual(parsed.forbidden_verbatim, ["Bester Coach der Stadt"]);
  assert.equal(core.ideaCoreHasSubstance(parsed), true);
  assert.equal(core.ideaCoreHasSubstance(core.emptyIdeaCore("kurz")), false);

  const inputSource = await readFile(
    join(root, "src/lib/meta/customer-control-input.ts"),
    "utf8",
  );
  const inputPath = join(temporaryDirectory, "customer-control-input.mjs");
  await writeFile(inputPath, transpile(inputSource), "utf8");
  const input = await import(pathToFileURL(inputPath).href);

  const created = input.parseCampaignIdeaCommand({
    sourceType: "KEYWORDS",
    sourceUrl: "",
    keywords: "Zahnarzt Notfall DACH",
    notes: "",
    screenshotAssetId: "",
    destinationUrl: "",
    objective: "OUTCOME_LEADS",
  });
  assert.equal(created.sourceType, "KEYWORDS");
  assert.equal(created.keywords, "Zahnarzt Notfall DACH");
  assert.equal(created.screenshotAssetId, null);

  const link = input.parseCampaignIdeaCommand({
    sourceType: "LINK",
    sourceUrl: "https://www.facebook.com/ads/library/?id=1",
    keywords: "",
    notes: "nur Inspiration",
    screenshotAssetId: "",
    destinationUrl: "https://www.example.de/funnel",
    objective: "",
  });
  assert.equal(link.sourceType, "LINK");
  assert.match(link.sourceUrl, /^https:\/\//);

  assert.throws(
    () =>
      input.parseCampaignIdeaCommand({
        sourceType: "LINK",
        sourceUrl: "",
        keywords: "",
        notes: "",
        screenshotAssetId: "",
        destinationUrl: "",
        objective: "",
      }),
    /HTTPS-Link/,
  );
  assert.throws(
    () =>
      input.parseCampaignIdeaRealizeCommand({
        ideaId: "55555555-5555-4555-8555-555555555555",
        destinationUrl: "http://example.de",
        objective: "OUTCOME_TRAFFIC",
        generateCreative: true,
      }),
    /HTTPS|Ziel-URL/,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Campaign idea pipeline contract tests passed.");
