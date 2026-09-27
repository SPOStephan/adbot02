import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(join(root, path), "utf8");
const source = read("apps/adbot-funnel/shared/funnelPurpose.ts");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const purpose = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);

assert.equal(purpose.normalizeFunnelPurpose(undefined), "recruiting");
assert.deepEqual(purpose.funnelPurposeTags("recruiting"), [
  "funnel",
  "funnel-purpose:recruiting",
  "jobs",
  "employment",
]);
assert.deepEqual(purpose.funnelPurposeTags("appointment"), [
  "funnel",
  "funnel-purpose:appointment",
]);
assert.equal(purpose.isEmploymentFunnelPurpose("appointment"), false);
assert.equal(purpose.isEmploymentFunnelPurpose("recruiting"), true);

const migration = read("apps/adbot-funnel/supabase/migrations/20260927193000_funnel_purpose.sql");
assert.match(migration, /where not \(config \? 'purpose'\)/);
assert.match(migration, /'"recruiting"'::jsonb/);

const launch = read("src/components/LeadLaunchCanary.tsx");
assert.match(launch, /Automatisch aus dem Funnel/);
assert.match(launch, /Normale Lead-Kampagne/);
assert.match(launch, /Social Recruiting \/ Jobanzeige \(EMPLOYMENT\)/);
assert.match(launch, /Funnel A und Funnel B müssen dieselbe Anzeigenkategorie haben/);
assert.match(launch, /\/api\/funnel-purpose\?url=/);
assert.match(launch, /initialDestinationUrl/);

const resolver = read("src/lib/funnel-purpose-hints.ts");
assert.match(resolver, /funnel\.publicCatalogByHost/);
assert.match(resolver, /funnel\.publicConfig/);
assert.match(resolver, /purpose === undefined \|\| purpose === null \|\| purpose === "recruiting"/);
assert.match(resolver, /\{ slug: decodedSlug, title: "Funnel" \}/);

const library = read("apps/adbot-funnel/client/src/pages/admin/FunnelLibrary.tsx");
assert.match(library, /Diesen Funnel in Adbot bewerben/);
assert.match(library, /portalCampaignLaunchUrl\(publicUrl\)/);

console.log("test-funnel-purpose: ok");
